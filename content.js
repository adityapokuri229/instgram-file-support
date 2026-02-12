// Instagram File Sharer - Content Script
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
    // Listen for progress updates from background
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'uploadProgress') {
        this.updateProgress(request.progress);
        // Return true to keep the message channel open
        return true;
      }
    });

    // Wait for Instagram to load
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.startObserver());
    } else {
      this.startObserver();
    }
  }

  startObserver() {
    // Use MutationObserver to detect when message input appears
    const observer = new MutationObserver(() => {
      this.injectUploadButton();
      this.processFilebinLinks(); // Check for Filebin links in messages
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Initial injection attempt
    this.injectUploadButton();
    this.processFilebinLinks();
  }

  findMessageInput() {
    // Instagram DM message input selectors (may need updates)
    const selectors = [
      'div[contenteditable="true"][role="textbox"]',
      'textarea[placeholder*="Message"]',
      'div[aria-label*="Message"]'
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element && this.isInDMContext(element)) {
        return element;
      }
    }
    return null;
  }

  isInDMContext(element) {
    // Check if the element is in a DM conversation context
    return element.closest('[role="main"]') !== null;
  }

  injectUploadButton() {
    // Don't inject if already exists
    if (this.uploadButton && document.body.contains(this.uploadButton)) {
      return;
    }

    this.messageInput = this.findMessageInput();
    if (!this.messageInput) return;

    // Find the mic button - it's the voice message icon
    const allButtons = document.querySelectorAll('div[role="button"]');
    let micButton = null;
    
    // Look for the mic icon (voice message button)
    for (const btn of allButtons) {
      const svg = btn.querySelector('svg');
      if (svg) {
        const title = svg.getAttribute('aria-label');
        // Check for mic/voice related labels
        if (title && (title.includes('voice') || title.includes('Voice') || title.includes('audio'))) {
          micButton = btn;
          break;
        }
        // Also check the SVG path for mic icon pattern
        const path = svg.querySelector('path');
        if (path) {
          const d = path.getAttribute('d');
          if (d && (d.includes('M19') || d.includes('M12 1a3'))) {
            micButton = btn;
            break;
          }
        }
      }
    }

    if (!micButton) {
      console.log('Mic button not found, trying alternative method');
      // Fallback: find by position (usually last button in the row)
      const buttonRow = this.messageInput.closest('div').querySelector('div[style*="flex"]');
      if (buttonRow) {
        const buttons = buttonRow.querySelectorAll('div[role="button"]');
        micButton = buttons[buttons.length - 1]; // Last button is usually mic
      }
    }

    if (!micButton) return;

    // Create file input
    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.multiple = true; // Allow multiple file selection
    this.fileInput.style.display = 'none';
    this.fileInput.addEventListener('change', (e) => this.handleFileSelect(e));

    // Create upload button wrapper (matches Instagram's style)
    const btnWrapper = document.createElement('div');
    btnWrapper.className = 'filebin-upload-wrapper';
    btnWrapper.setAttribute('role', 'button');
    btnWrapper.setAttribute('tabindex', '0');
    
    btnWrapper.innerHTML = `
      <svg aria-label="Attach file" class="x1lliihq x1n2onr6 x5n08y4" fill="currentColor" height="24" role="img" viewBox="0 0 24 24" width="24">
        <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" stroke="currentColor" stroke-width="2" fill="none"></path>
      </svg>
    `;
    btnWrapper.title = 'Upload file';
    btnWrapper.addEventListener('click', () => this.fileInput.click());

    // Insert BEFORE the mic button (to its left)
    micButton.parentElement.insertBefore(this.fileInput, micButton);
    micButton.parentElement.insertBefore(btnWrapper, micButton);
    this.uploadButton = btnWrapper;

    console.log('Instagram File Sharer: Upload button injected before mic');
  }

  async handleFileSelect(event) {
    const files = Array.from(event.target.files);
    if (!files.length) return;

    // Check file sizes (Filebin limit is typically 100MB per file, 500MB per bin)
    const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
    const MAX_BIN_SIZE = 500 * 1024 * 1024; // 500MB
    
    let totalSize = 0;
    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        this.showStatus(`File too large: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB). Max: 100MB per file.`, 'error');
        this.fileInput.value = '';
        return;
      }
      totalSize += file.size;
    }
    
    if (totalSize > MAX_BIN_SIZE) {
      this.showStatus(`Total size too large: ${(totalSize / 1024 / 1024).toFixed(1)}MB. Max: 500MB total.`, 'error');
      this.fileInput.value = '';
      return;
    }

    // Generate ONE bin ID for all files
    const binId = this.generateBinId();

    // Show loading state with 0% progress
    this.showStatus(`Uploading ${files.length} file(s)... 0%`, 'loading');

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        this.showStatus(`Uploading ${i + 1}/${files.length}: ${file.name}... 0%`, 'loading');
        
        // Upload to the SAME bin - don't store the URL, we'll construct it once
        await this.uploadToFilebin(file, binId);
      }
      
      // Insert only ONE bin URL (construct it, don't use the response)
      const binUrl = `https://filebin.net/${binId}/`;
      await this.insertLinkToMessage(binUrl);
      
      this.showStatus(`${files.length} file(s) uploaded! Link inserted.`, 'success');
      
      // Clear file input
      this.fileInput.value = '';
    } catch (error) {
      console.error('Upload failed:', error);
      this.showStatus(`Upload failed: ${error.message}`, 'error');
      this.fileInput.value = '';
    }
  }

  updateProgress(percentage) {
    if (this.currentStatusElement && this.currentStatusElement.isConnected) {
      this.currentStatusElement.textContent = `Uploading... ${percentage}%`;
    }
  }

  async uploadToFilebin(file, binId = null) {
    // Use provided bin ID or generate a new one
    if (!binId) {
      binId = this.generateBinId();
    }
    const filename = file.name;

    // Convert file to base64 for message passing
    const fileData = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    // Send to background script to avoid CORS
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          action: 'uploadFile',
          file: fileData,
          binId: binId,
          filename: filename
        },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (response && response.success) {
            // Just resolve without returning URL to avoid duplication
            resolve();
          } else if (response) {
            reject(new Error(response.error));
          } else {
            reject(new Error('No response from background script'));
          }
        }
      );
    });
  }

  generateBinId() {
    // Generate a random bin ID (8 characters)
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let binId = '';
    for (let i = 0; i < 8; i++) {
      binId += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return binId;
  }

  async insertLinkToMessage(fileUrl) {
    if (!this.messageInput) {
      throw new Error('Message input not found');
    }

    // Focus the input first
    this.messageInput.focus();
    this.messageInput.click();

    // Wait a bit for Instagram to initialize
    await new Promise(resolve => setTimeout(resolve, 100));

    // For contenteditable div (Instagram uses this)
    if (this.messageInput.contentEditable === 'true') {
      // Clear any existing content first
      this.messageInput.textContent = '';
      
      // Insert the URL only once
      this.messageInput.textContent = fileUrl;

      // Dispatch proper events that Instagram listens to
      const inputEvent = new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: fileUrl
      });
      
      const changeEvent = new Event('change', { bubbles: true });
      const keyupEvent = new KeyboardEvent('keyup', { bubbles: true });
      
      this.messageInput.dispatchEvent(inputEvent);
      this.messageInput.dispatchEvent(changeEvent);
      this.messageInput.dispatchEvent(keyupEvent);
      
      // Also dispatch on the parent form if it exists
      const form = this.messageInput.closest('form');
      if (form) {
        form.dispatchEvent(new Event('input', { bubbles: true }));
      }
    } 
    // For textarea (fallback)
    else if (this.messageInput.tagName === 'TEXTAREA' || this.messageInput.tagName === 'INPUT') {
      this.messageInput.value = fileUrl;
      
      // Trigger React events
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value'
      )?.set || Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set;
      
      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(this.messageInput, fileUrl);
      }
      
      this.messageInput.dispatchEvent(new Event('input', { bubbles: true }));
      this.messageInput.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // Log for debugging
    console.log('Link inserted:', fileUrl);
    console.log('Input value:', this.messageInput.textContent || this.messageInput.value);

    // Try to find and highlight the send button
    setTimeout(() => this.findAndHighlightSendButton(), 200);
  }

  findAndHighlightSendButton() {
    // Find the send button
    const sendButton = document.querySelector('button[type="submit"]') ||
                      document.querySelector('button[aria-label*="Send"]') ||
                      Array.from(document.querySelectorAll('button')).find(btn => 
                        btn.textContent.toLowerCase().includes('send')
                      );

    if (sendButton) {
      // Flash the send button to draw attention
      sendButton.style.transition = 'transform 0.2s';
      sendButton.style.transform = 'scale(1.1)';
      setTimeout(() => {
        sendButton.style.transform = 'scale(1)';
      }, 200);
    }
  }

  showStatus(message, type) {
    // Remove existing status
    const existing = document.querySelector('.filebin-status');
    if (existing) existing.remove();

    // Create status element
    const status = document.createElement('div');
    status.className = `filebin-status filebin-status-${type}`;
    status.textContent = message;
    document.body.appendChild(status);

    // Track current status for progress updates
    if (type === 'loading') {
      this.currentStatusElement = status;
    } else {
      this.currentStatusElement = null;
      // Auto-remove success/error after 3 seconds
      setTimeout(() => status.remove(), 3000);
    }
  }

  processFilebinLinks() {
    // Find all filebin links
    const filebinLinks = document.querySelectorAll('a[href*="filebin.net"]');
    
    filebinLinks.forEach(link => {
      // Skip if already processed
      if (link.hasAttribute('data-filebin-intercepted')) return;
      
      const href = link.getAttribute('href');
      const binIdMatch = href.match(/filebin\.net\/([a-z0-9]+)/i);
      
      if (!binIdMatch) return;
      
      const binId = binIdMatch[1];
      link.setAttribute('data-filebin-intercepted', 'true');
      
      // Hide the link preview (QR code and thumbnail) more aggressively
      const messageRow = link.closest('div[role="row"]');
      if (messageRow) {
        // Find the link's parent anchor and hide everything except text
        const parentAnchor = link.closest('a[href*="filebin.net"]');
        if (parentAnchor) {
          // Hide all children except text nodes
          Array.from(parentAnchor.children).forEach(child => {
            child.style.display = 'none';
          });
        }
        
        // Hide preview images/QR codes in the entire message
        const allElements = messageRow.querySelectorAll('*');
        allElements.forEach(el => {
          // Check if element or its background contains a QR code or filebin preview
          const style = window.getComputedStyle(el);
          if (style.backgroundImage && style.backgroundImage.includes('filebin')) {
            el.style.backgroundImage = 'none';
          }
          
          // Hide img, canvas, svg that might be previews
          if (el.tagName === 'IMG' || el.tagName === 'CANVAS' || el.tagName === 'SVG') {
            const parent = el.closest('a[href*="filebin.net"]');
            if (parent) {
              el.style.display = 'none';
            }
          }
        });
      }
      
      // Replace the link text if it's showing the URL
      const linkText = link.textContent.trim();
      if (linkText.includes('filebin.net')) {
        link.innerHTML = `
          <span style="display: flex; align-items: center; gap: 8px;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            <span>Click to download files</span>
          </span>
        `;
        link.style.textDecoration = 'none';
        link.style.display = 'inline-flex';
      }
      
      // Also look for text nodes near the link that show the URL
      const parent = link.closest('div[dir="auto"]');
      if (parent) {
        const textNodes = Array.from(parent.childNodes).filter(node => 
          node.nodeType === Node.TEXT_NODE && node.textContent.includes('filebin.net')
        );
        textNodes.forEach(textNode => {
          const span = document.createElement('span');
          span.style.cssText = 'display: inline-flex; align-items: center; gap: 8px; color: #0095f6; font-weight: 500;';
          span.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            <span>Click to download files</span>
          `;
          textNode.parentNode.replaceChild(span, textNode);
        });
      }
      
      // Add click handler to intercept
      link.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        // Show loading notification
        this.showStatus('Loading files...', 'loading');
        
        try {
          // Fetch the bin page
          const response = await fetch(`https://filebin.net/${binId}/`);
          const html = await response.text();
          
          // Parse HTML
          const parser = new DOMParser();
          const doc = parser.parseFromString(html, 'text/html');
          
          // Find file links and filter out archive files created by filebin
          const fileLinksRaw = Array.from(doc.querySelectorAll('a')).filter(link => {
            const href = link.getAttribute('href');
            if (!href || !href.includes(`/${binId}/`) || href.endsWith('/')) {
              return false;
            }
            
            const filename = href.split('/').pop().toLowerCase();
            // Filter out filebin's auto-generated archives
            if (filename === 'zip' || filename === 'tar' || filename === 'tar.gz') {
              return false;
            }
            
            return true;
          });
          
          // Deduplicate by filename
          const seenFiles = new Set();
          const fileLinks = fileLinksRaw.filter(link => {
            const filename = link.getAttribute('href').split('/').pop();
            if (seenFiles.has(filename)) {
              return false;
            }
            seenFiles.add(filename);
            return true;
          });
          
          if (fileLinks.length === 0) {
            this.showStatus('No files found', 'error');
            return;
          }
          
          // Remove loading notification
          const existing = document.querySelector('.filebin-status');
          if (existing) existing.remove();
          
          // Show download modal
          this.showDownloadModal(binId, fileLinks);
          
        } catch (error) {
          console.error('Failed to fetch files:', error);
          this.showStatus('Failed to load files', 'error');
        }
      });
    });
  }

  createDownloadButton(filebinUrl, binId) {
    // Create a download button container that looks like Instagram's attachment
    const container = document.createElement('div');
    container.className = 'filebin-download-container';
    container.style.cssText = `
      background: linear-gradient(45deg, #405de6, #5851db, #833ab4, #c13584, #e1306c, #fd1d1d);
      border-radius: 18px;
      padding: 16px 20px;
      margin: 8px 0;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 12px;
      transition: transform 0.2s, box-shadow 0.2s;
      color: white;
      font-weight: 500;
      font-size: 14px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      max-width: 280px;
      width: fit-content;
      position: relative;
      z-index: 1;
    `;
    
    container.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
        <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
      </svg>
      <div style="display: flex; flex-direction: column; gap: 2px;">
        <span style="font-weight: 600;">Download Attachments</span>
        <span style="font-size: 12px; opacity: 0.9;">Click to view files</span>
      </div>
    `;
    
    // Add hover effect
    container.addEventListener('mouseenter', () => {
      container.style.transform = 'scale(1.05)';
      container.style.boxShadow = '0 6px 16px rgba(0,0,0,0.25)';
    });
    
    container.addEventListener('mouseleave', () => {
      container.style.transform = 'scale(1)';
      container.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
    });
    
    // Add click handler to fetch and download files
    container.addEventListener('click', async (e) => {
      e.stopPropagation();
      await this.downloadFilebinFiles(binId, container);
    });
    
    return container;
  }

  replaceWithDownloadButton(element, filebinUrl, binId) {
    const container = this.createDownloadButton(filebinUrl, binId);
    
    // Replace the text element with the download button
    element.textContent = '';
    element.appendChild(container);
  }

  async downloadFilebinFiles(binId, buttonElement) {
    try {
      // Update button to show loading
      const originalHTML = buttonElement.innerHTML;
      buttonElement.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" style="animation: spin 1s linear infinite;">
          <style>
            @keyframes spin {
              from { transform: rotate(0deg); }
              to { transform: rotate(360deg); }
            }
          </style>
          <circle cx="12" cy="12" r="10" stroke="white" stroke-width="2" fill="none" opacity="0.25"/>
          <path d="M12 2 A 10 10 0 0 1 22 12" stroke="white" stroke-width="2" fill="none"/>
        </svg>
        <span>Loading...</span>
      `;
      
      // Fetch the bin page to get file list
      const response = await fetch(`https://filebin.net/${binId}/`);
      const html = await response.text();
      
      // Parse HTML to extract file URLs
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      
      // Find all file links
      const fileLinks = Array.from(doc.querySelectorAll('a')).filter(link => {
        const href = link.getAttribute('href');
        return href && href.includes(`/${binId}/`) && !href.endsWith('/');
      });
      
      if (fileLinks.length === 0) {
        throw new Error('No files found in bin');
      }
      
      // Restore button
      buttonElement.innerHTML = originalHTML;
      
      // Show modal with file list
      this.showDownloadModal(binId, fileLinks);
      
    } catch (error) {
      console.error('Failed to fetch files:', error);
      buttonElement.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5">
          <circle cx="12" cy="12" r="10" stroke="white" stroke-width="2" fill="none"/>
          <line x1="15" y1="9" x2="9" y2="15" stroke="white" stroke-width="2"/>
          <line x1="9" y1="9" x2="15" y2="15" stroke="white" stroke-width="2"/>
        </svg>
        <span>Failed</span>
      `;
      
      setTimeout(() => {
        buttonElement.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          <span>Download</span>
        `;
      }, 2000);
    }
  }

  showDownloadModal(binId, fileLinks) {
    // Remove existing modal if any
    const existing = document.querySelector('.filebin-modal');
    if (existing) existing.remove();
    
    // Create modal backdrop
    const modal = document.createElement('div');
    modal.className = 'filebin-modal';
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.85);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 99999;
      animation: fadeIn 0.2s;
    `;
    
    // Create modal content
    const modalContent = document.createElement('div');
    modalContent.style.cssText = `
      background: #262626;
      border-radius: 16px;
      padding: 24px;
      max-width: 400px;
      width: 90%;
      max-height: 80vh;
      overflow-y: auto;
      box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    `;
    
    // Create file list
    const fileListHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
        <h3 style="color: white; margin: 0; font-size: 18px; font-weight: 600;">
          ${fileLinks.length} File${fileLinks.length > 1 ? 's' : ''}
        </h3>
        <button class="close-modal" style="
          background: none;
          border: none;
          color: white;
          font-size: 28px;
          cursor: pointer;
          padding: 0;
          width: 32px;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          transition: background 0.2s;
        ">&times;</button>
      </div>
      <div style="display: flex; flex-direction: column; gap: 10px;">
        ${fileLinks.map((link, index) => {
          const filename = decodeURIComponent(link.getAttribute('href').split('/').pop());
          const fileUrl = `https://filebin.net${link.getAttribute('href')}`;
          
          return `
            <div class="file-item" data-url="${fileUrl}" data-filename="${filename}" style="
              background: #3a3a3a;
              border-radius: 10px;
              padding: 14px;
              display: flex;
              align-items: center;
              gap: 12px;
              cursor: pointer;
              transition: all 0.2s;
            " onmouseover="this.style.background='#4a4a4a'" onmouseout="this.style.background='#3a3a3a'">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
                <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
                <polyline points="13 2 13 9 20 9"></polyline>
              </svg>
              <span style="flex: 1; color: white; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${filename}</span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#667eea" stroke-width="2.5">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
            </div>
          `;
        }).join('')}
      </div>
      <button class="download-all-zip" style="
        width: 100%;
        margin-top: 16px;
        padding: 14px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        border: none;
        border-radius: 10px;
        font-size: 15px;
        font-weight: 600;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        transition: all 0.2s;
      " onmouseover="this.style.transform='scale(1.02)'" onmouseout="this.style.transform='scale(1)'">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
          <polyline points="21 8 21 21 3 21 3 8"></polyline>
          <rect x="1" y="3" width="22" height="5"></rect>
          <line x1="10" y1="12" x2="14" y2="12"></line>
        </svg>
        <span>Download All as ZIP</span>
      </button>
    `;
    
    modalContent.innerHTML = fileListHTML;
    modal.appendChild(modalContent);
    document.body.appendChild(modal);
    
    // Close modal on backdrop click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.remove();
      }
    });
    
    // Close button
    modalContent.querySelector('.close-modal').addEventListener('click', () => {
      modal.remove();
    });
    
    modalContent.querySelector('.close-modal').addEventListener('mouseenter', (e) => {
      e.target.style.background = 'rgba(255,255,255,0.1)';
    });
    
    modalContent.querySelector('.close-modal').addEventListener('mouseleave', (e) => {
      e.target.style.background = 'none';
    });
    
    // Add click handlers to each file
    modalContent.querySelectorAll('.file-item').forEach(fileItem => {
      fileItem.addEventListener('click', (e) => {
        e.stopPropagation();
        const url = fileItem.getAttribute('data-url');
        const filename = fileItem.getAttribute('data-filename');
        this.downloadFile(url, filename);
      });
    });
    
    // Download all as ZIP button
    modalContent.querySelector('.download-all-zip').addEventListener('click', async (e) => {
      e.stopPropagation();
      await this.downloadAllAsZip(binId, fileLinks, modalContent.querySelector('.download-all-zip'));
    });
  }

  async downloadAllAsZip(binId, fileLinks, buttonElement) {
    const originalHTML = buttonElement.innerHTML;
    
    try {
      buttonElement.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" style="animation: spin 1s linear infinite;">
          <style>
            @keyframes spin {
              from { transform: rotate(0deg); }
              to { transform: rotate(360deg); }
            }
          </style>
          <circle cx="12" cy="12" r="10" stroke="white" stroke-width="2" fill="none" opacity="0.25"/>
          <path d="M12 2 A 10 10 0 0 1 22 12" stroke="white" stroke-width="2" fill="none"/>
        </svg>
        <span>Downloading ZIP...</span>
      `;
      
      // Use Filebin's native archive endpoint
      const zipUrl = `https://filebin.net/archive/${binId}/zip`;
      
      // Fetch the ZIP
      const response = await fetch(zipUrl);
      
      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }
      
      const blob = await response.blob();
      
      // Download the ZIP
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `filebin-${binId}.zip`;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      
      // Clean up
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(downloadUrl);
      }, 100);
      
      buttonElement.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        <span>Downloaded!</span>
      `;
      
      setTimeout(() => {
        buttonElement.innerHTML = originalHTML;
      }, 2000);
      
    } catch (error) {
      console.error('Failed to download ZIP:', error);
      buttonElement.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <line x1="15" y1="9" x2="9" y2="15"/>
          <line x1="9" y1="9" x2="15" y2="15"/>
        </svg>
        <span>Failed</span>
      `;
      
      setTimeout(() => {
        buttonElement.innerHTML = originalHTML;
      }, 3000);
    }
  }

  async downloadFile(url, filename) {
    try {
      this.showStatus(`Downloading ${filename}...`, 'loading');
      
      // Fetch the file
      const response = await fetch(url);
      const blob = await response.blob();
      
      // Create download link
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(downloadUrl);
      
      this.showStatus(`Downloaded ${filename}!`, 'success');
    } catch (error) {
      console.error('Download failed:', error);
      this.showStatus(`Failed to download ${filename}`, 'error');
    }
  }
}

// Initialize when script loads
new InstagramFileSharer();
