/**
 * Instagram File Support - Content Script
 * Author: Aditya Pokuri
 * Version: 1.2.0
 */

class InstagramFileSharer {
  constructor() {
    this.uploadButton = null;
    this.fileInput = null;
    this.messageInput = null;
    this.observerInitialized = false;
    this.currentStatusElement = null;
    this.init();
  }

  init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.startObserver());
    } else {
      this.startObserver();
    }
  }

  startObserver() {
    const observer = new MutationObserver(() => {
      this.injectUploadButton();
      this.processFilebinLinks();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    this.injectUploadButton();
    this.processFilebinLinks();
  }

  // ── Message Input ──────────────────────────────────────────────────────────

  findMessageInput() {
    const selectors = [
      'div[contenteditable="true"][role="textbox"]',
      'textarea[placeholder*="Message"]',
      'div[aria-label*="Message"]'
    ];
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && el.closest('[role="main"]')) return el;
    }
    return null;
  }

  // ── Upload Button ──────────────────────────────────────────────────────────

  injectUploadButton() {
    if (this.uploadButton && document.body.contains(this.uploadButton)) return;

    this.messageInput = this.findMessageInput();
    if (!this.messageInput) return;

    // Walk up from the message input to find the toolbar row
    // (must have 2+ buttons and be within 120px of input — avoids the top header)
    let buttonRow = null;
    let el = this.messageInput.parentElement;
    for (let i = 0; i < 12; i++) {
      if (!el) break;
      const btns = el.querySelectorAll('div[role="button"]');
      if (btns.length >= 2) {
        const elRect    = el.getBoundingClientRect();
        const inputRect = this.messageInput.getBoundingClientRect();
        if (Math.abs(elRect.top - inputRect.top) < 120) {
          buttonRow = el;
          break;
        }
      }
      el = el.parentElement;
    }
    if (!buttonRow) return;

    // Find mic button inside this row only
    let micButton = null;
    for (const btn of buttonRow.querySelectorAll('div[role="button"]')) {
      const svg = btn.querySelector('svg');
      if (!svg) continue;
      const label = (svg.getAttribute('aria-label') || '').toLowerCase();
      if (label.includes('voice') || label.includes('audio') || label.includes('mic')) {
        micButton = btn;
        break;
      }
    }
    if (!micButton) micButton = buttonRow.querySelector('div[role="button"]');
    if (!micButton) return;

    // Hidden file input
    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.multiple = true;
    this.fileInput.style.display = 'none';
    this.fileInput.addEventListener('change', (e) => this.handleFileSelect(e));

    // Button wrapper — matches Instagram's native icon style
    const btnWrapper = document.createElement('div');
    btnWrapper.className = 'filebin-upload-wrapper';
    btnWrapper.setAttribute('role', 'button');
    btnWrapper.setAttribute('tabindex', '0');
    btnWrapper.title = 'Share a file (max 45 MB)';
    btnWrapper.innerHTML = `
      <svg aria-label="Attach file" fill="currentColor" height="24" role="img"
           viewBox="0 0 24 24" width="24">
        <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66
                 l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"
              stroke="currentColor" stroke-width="2" fill="none"/>
      </svg>`;
    btnWrapper.addEventListener('click', () => this.fileInput.click());

    micButton.parentElement.insertBefore(this.fileInput, micButton);
    micButton.parentElement.insertBefore(btnWrapper, micButton);
    this.uploadButton = btnWrapper;
  }

  // ── File Upload ────────────────────────────────────────────────────────────

  async handleFileSelect(event) {
    const files = Array.from(event.target.files);
    if (!files.length) return;

    // No artificial size limit — files sent as ArrayBuffer chunks over a port
    // Filebin accepts up to ~1 GB per file
    const MAX_FILE  = 900 * 1024 * 1024; // 900 MB per file (Filebin practical limit)
    const MAX_TOTAL = 2   * 1024 * 1024 * 1024; // 2 GB total
    let total = 0;

    for (const file of files) {
      if (file.size > MAX_FILE) {
        this.showStatus(`"${file.name}" exceeds 900 MB limit`, 'error');
        this.fileInput.value = '';
        return;
      }
      total += file.size;
    }
    if (total > MAX_TOTAL) {
      this.showStatus(`Total exceeds 2 GB limit`, 'error');
      this.fileInput.value = '';
      return;
    }

    const binId = this.generateBinId();
    this.showStatus('Uploading 0%', 'loading');

    try {
      for (let i = 0; i < files.length; i++) {
        if (files.length > 1) {
          this.showStatus(`Uploading file ${i + 1}/${files.length}… 0%`, 'loading');
        }
        await this.uploadToFilebin(files[i], binId);
      }
      await this.insertLinkToMessage(`https://filebin.net/${binId}/`);
      this.showStatus(
        `${files.length > 1 ? files.length + ' files' : 'File'} uploaded! Link inserted.`,
        'success'
      );
    } catch (err) {
      this.showStatus(`Upload failed: ${err.message}`, 'error');
    }

    this.fileInput.value = '';
  }

  generateBinId() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  }

  async uploadToFilebin(file, binId) {
    const CHUNK_SIZE = 2 * 1024 * 1024; // 2 MB chunks — well under Chrome port message limit
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

    return new Promise((resolve, reject) => {
      const port = chrome.runtime.connect({ name: 'upload' });

      port.onMessage.addListener((msg) => {
        if (msg.type === 'progress') {
          this.updateProgress(msg.progress);
        } else if (msg.type === 'success') {
          port.disconnect();
          resolve();
        } else if (msg.type === 'error') {
          port.disconnect();
          reject(new Error(msg.message));
        }
      });

      port.onDisconnect.addListener(() => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        }
      });

      // Start upload session
      port.postMessage({
        type: 'start',
        binId,
        filename: file.name,
        mimeType: file.type || 'application/octet-stream',
        totalChunks
      });

      // Send each chunk as base64 string — safe, serialisable, no transfer issues
      // Each chunk is 2 MB → base64 adds ~0.67 MB overhead per chunk, well under limits
      (async () => {
        try {
          for (let i = 0; i < totalChunks; i++) {
            const start = i * CHUNK_SIZE;
            const chunk = file.slice(start, start + CHUNK_SIZE);
            const base64 = await new Promise((res, rej) => {
              const reader = new FileReader();
              reader.onload  = () => res(reader.result.split(',')[1]);
              reader.onerror = rej;
              reader.readAsDataURL(chunk);
            });
            port.postMessage({ type: 'chunk', index: i, base64 });
          }
          port.postMessage({ type: 'done' });
        } catch (err) {
          reject(err);
        }
      })();
    });
  }

  updateProgress(pct) {
    if (this.currentStatusElement?.isConnected) {
      const text   = this.currentStatusElement.textContent;
      const prefix = text.match(/^(Uploading file \d+\/\d+…)/)?.[1] || 'Uploading';
      this.currentStatusElement.textContent = `${prefix} ${pct}%`;
    }
  }

  // ── Insert Link ────────────────────────────────────────────────────────────

  async insertLinkToMessage(url) {
    if (!this.messageInput) throw new Error('Message input not found');

    this.messageInput.focus();
    this.messageInput.click();
    await new Promise(r => setTimeout(r, 100));

    if (this.messageInput.contentEditable === 'true') {
      this.messageInput.textContent = url;
      this.messageInput.dispatchEvent(new InputEvent('input', {
        bubbles: true, cancelable: true, inputType: 'insertText', data: url
      }));
      this.messageInput.dispatchEvent(new Event('change', { bubbles: true }));
      this.messageInput.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    } else {
      this.messageInput.value = url;
      this.messageInput.dispatchEvent(new Event('input',  { bubbles: true }));
      this.messageInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  // ── Incoming Filebin Link Detection ────────────────────────────────────────

  processFilebinLinks() {
    document.querySelectorAll('a[href*="filebin.net"]').forEach(link => {
      if (link.hasAttribute('data-filebin-intercepted')) return;

      const href       = link.getAttribute('href');
      const binIdMatch = href.match(/filebin\.net\/([a-z0-9]+)/i);
      if (!binIdMatch) return;

      const binId = binIdMatch[1];
      link.setAttribute('data-filebin-intercepted', 'true');

      // Hide QR / preview media inside the anchor
      const messageRow = link.closest('div[role="row"]');
      if (messageRow) {
        messageRow.querySelectorAll('img, canvas').forEach(el => {
          if (el.closest('a[href*="filebin.net"]')) el.style.display = 'none';
        });
      }

      // Replace URL text with friendly label
      if (link.textContent.trim().includes('filebin.net')) {
        link.innerHTML = `
          <span style="display:inline-flex;align-items:center;gap:8px;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            <span>Click to download files</span>
          </span>`;
        link.style.cssText = 'text-decoration:none; display:inline-flex;';
      }

      // Also replace bare URL text nodes nearby
      const dir = link.closest('div[dir="auto"]');
      if (dir) {
        dir.childNodes.forEach(node => {
          if (node.nodeType === Node.TEXT_NODE && node.textContent.includes('filebin.net')) {
            const span = document.createElement('span');
            span.style.cssText = 'display:inline-flex;align-items:center;gap:8px;color:#0095f6;font-weight:500;';
            span.innerHTML = `
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              <span>Click to download files</span>`;
            node.parentNode.replaceChild(span, node);
          }
        });
      }

      // Intercept click → in-page download modal
      link.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.showStatus('Loading files…', 'loading');
        try {
          const fileLinks = await this.fetchBinFiles(binId);
          document.querySelector('.filebin-status')?.remove();
          this.showDownloadModal(binId, fileLinks);
        } catch {
          this.showStatus('Could not load files', 'error');
        }
      });
    });
  }

  // ── Fetch File List (via background — uses proper JSON API) ────────────────

  async fetchBinFiles(binId) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'fetchBinFiles', binId }, (response) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!response.success) return reject(new Error(response.error));
        resolve(response.files.map(filename => ({
          getAttribute: (attr) => attr === 'href' ? `/${binId}/${encodeURIComponent(filename)}` : null,
          filename
        })));
      });
    });
  }

  // ── Download Modal ─────────────────────────────────────────────────────────

  showDownloadModal(binId, fileLinks) {
    document.querySelector('.filebin-modal')?.remove();

    const modal = document.createElement('div');
    modal.className = 'filebin-modal';
    modal.style.cssText = `
      position:fixed; inset:0;
      background:rgba(0,0,0,0.85);
      display:flex; align-items:center; justify-content:center;
      z-index:99999;`;

    const card = document.createElement('div');
    card.style.cssText = `
      background:#262626; border-radius:16px; padding:24px;
      width:min(420px,92vw); max-height:80vh; overflow-y:auto;
      box-shadow:0 24px 64px rgba(0,0,0,0.55);
      font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;`;

    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
        <span style="color:#fff;font-size:18px;font-weight:700;">
          ${fileLinks.length} File${fileLinks.length !== 1 ? 's' : ''}
        </span>
        <button class="fb-close" style="
          background:rgba(255,255,255,0.08);border:none;color:#fff;
          width:32px;height:32px;border-radius:50%;font-size:22px;
          cursor:pointer;display:flex;align-items:center;justify-content:center;">
          &times;
        </button>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px;">
        ${fileLinks.map(link => {
          const name = link.filename || decodeURIComponent(link.getAttribute('href').split('/').pop());
          const url  = `https://filebin.net${link.getAttribute('href')}`;
          return `
            <div class="fb-file" data-url="${url}" data-name="${name}" style="
              display:flex;align-items:center;gap:12px;padding:13px 14px;
              background:#2c2c2e;border-radius:12px;cursor:pointer;
              font-size:14px;color:#fff;transition:background 0.15s;"
              onmouseover="this.style.background='#3a3a3c'"
              onmouseout="this.style.background='#2c2c2e'">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
                <polyline points="13 2 13 9 20 9"/>
              </svg>
              <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${name}</span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                   stroke="#818cf8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
            </div>`;
        }).join('')}
      </div>
      <button class="fb-zip" style="
        width:100%;padding:14px;background:#4f46e5;color:#fff;border:none;
        border-radius:12px;font-size:15px;font-weight:600;cursor:pointer;
        display:flex;align-items:center;justify-content:center;gap:10px;transition:background 0.15s;"
        onmouseover="this.style.background='#4338ca'"
        onmouseout="this.style.background='#4f46e5'">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="21 8 21 21 3 21 3 8"/>
          <rect x="1" y="3" width="22" height="5"/>
          <line x1="10" y1="12" x2="14" y2="12"/>
        </svg>
        Download All as ZIP
      </button>`;

    modal.appendChild(card);
    document.body.appendChild(modal);

    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    card.querySelector('.fb-close').addEventListener('click', () => modal.remove());

    card.querySelectorAll('.fb-file').forEach(row =>
      row.addEventListener('click', () => this.downloadFile(row.dataset.url, row.dataset.name))
    );

    card.querySelector('.fb-zip').addEventListener('click', () =>
      this.downloadZip(binId, card.querySelector('.fb-zip'))
    );
  }

  // ── Downloads (via chrome.downloads — uses real browser session/cookies) ───

  async downloadFile(url, filename) {
    this.showStatus(`Downloading ${filename}…`, 'loading');
    chrome.runtime.sendMessage({ action: 'downloadFile', url, filename }, (response) => {
      if (response?.success) {
        this.showStatus(`Downloading ${filename}…`, 'success');
      } else {
        this.showStatus(`Failed: ${response?.error || 'unknown error'}`, 'error');
      }
    });
  }

  async downloadZip(binId, btn) {
    const original = btn.innerHTML;
    btn.innerHTML = `
      <svg style="animation:fb-spin 0.8s linear infinite" width="18" height="18"
           viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <circle cx="12" cy="12" r="10" opacity=".25"/>
        <path d="M12 2a10 10 0 0 1 10 10"/>
      </svg>
      Downloading…`;

    chrome.runtime.sendMessage({ action: 'downloadZip', binId }, (response) => {
      btn.innerHTML = response?.success ? '✓ Downloading!' : '✗ Failed';
      setTimeout(() => btn.innerHTML = original, 2000);
    });
  }

  // ── Status Toast ───────────────────────────────────────────────────────────

  showStatus(message, type) {
    document.querySelector('.filebin-status')?.remove();
    const el = document.createElement('div');
    el.className = `filebin-status filebin-status-${type}`;
    el.textContent = message;
    document.body.appendChild(el);
    this.currentStatusElement = type === 'loading' ? el : null;
    if (type !== 'loading') setTimeout(() => el.remove(), 3000);
  }
}

new InstagramFileSharer();
