/**
 * Instagram File Support - Background Service Worker
 * Author: Aditya Pokuri
 * Version: 1.3.0
 */

// ── Upload via long-lived port ─────────────────────────────────────────────
//
// Chunks arrive as Uint8Array (NOT transferred ArrayBuffer — transferring
// detaches the buffer on the sender side making it empty on arrival).
// We store each chunk's bytes and assemble into one Blob before uploading.

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'upload') return;

  let meta = null;
  const chunks = [];

  port.onMessage.addListener(async (msg) => {

    if (msg.type === 'start') {
      meta = msg;
      return;
    }

    if (msg.type === 'chunk') {
      // Decode base64 chunk back to Uint8Array
      const binary = atob(msg.base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      chunks[msg.index] = bytes;
      const received = chunks.filter(Boolean).length;
      const pct = Math.round((received / meta.totalChunks) * 20);
      try { port.postMessage({ type: 'progress', progress: pct }); } catch (_) {}
      return;
    }

    if (msg.type === 'done') {
      try {
        const blob = new Blob(chunks, {
          type: meta.mimeType || 'application/octet-stream'
        });

        const url = `https://filebin.net/${meta.binId}/${encodeURIComponent(meta.filename)}`;

        let progress = 20;
        const iv = setInterval(() => {
          const step = progress < 50 ? 5 : progress < 75 ? 3 : progress < 88 ? 1 : 0;
          progress = Math.min(progress + step, 90);
          try { port.postMessage({ type: 'progress', progress }); } catch (_) {}
          if (progress >= 90) clearInterval(iv);
        }, 300);

        const res = await fetch(url, {
          method: 'POST',
          body: blob,
          headers: {
            'Content-Type': meta.mimeType || 'application/octet-stream',
            'Content-Length': String(blob.size)
          }
        });

        clearInterval(iv);

        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new Error(`${res.status} ${res.statusText}${body ? ': ' + body : ''}`);
        }

        try { port.postMessage({ type: 'progress', progress: 100 }); } catch (_) {}
        try { port.postMessage({ type: 'success', url: `https://filebin.net/${meta.binId}/` }); } catch (_) {}

      } catch (err) {
        try { port.postMessage({ type: 'error', message: err.message }); } catch (_) {}
      }
    }
  });
});

// ── sendMessage handlers (file list + downloads) ───────────────────────────

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  if (request.action === 'fetchBinFiles') {
    fetch(`https://filebin.net/${request.binId}`, {
      headers: { 'Accept': 'application/json' }
    })
      .then(r => r.json())
      .then(data => sendResponse({ success: true, files: (data.files || []).map(f => f.filename) }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === 'downloadFile') {
    chrome.downloads.download(
      { url: request.url, filename: request.filename, saveAs: false },
      (id) => sendResponse(chrome.runtime.lastError
        ? { success: false, error: chrome.runtime.lastError.message }
        : { success: true, downloadId: id })
    );
    return true;
  }

  if (request.action === 'downloadZip') {
    chrome.downloads.download(
      { url: `https://filebin.net/archive/${request.binId}/zip`, filename: `files-${request.binId}.zip`, saveAs: false },
      (id) => sendResponse(chrome.runtime.lastError
        ? { success: false, error: chrome.runtime.lastError.message }
        : { success: true, downloadId: id })
    );
    return true;
  }

});
