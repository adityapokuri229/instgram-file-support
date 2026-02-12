// Background Service Worker - Handles file uploads
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'uploadFile') {
    handleFileUpload(request.file, request.binId, request.filename, sender.tab.id)
      .then(result => sendResponse({ success: true, url: result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Will respond asynchronously
  }
});

async function handleFileUpload(fileData, binId, filename, tabId) {
  const url = `https://filebin.net/${binId}/${encodeURIComponent(filename)}`;
  
  // Convert base64 back to blob
  const base64Data = fileData.split(',')[1];
  const byteCharacters = atob(base64Data);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  const blob = new Blob([byteArray]);
  const totalSize = blob.size;
  
  // Simulate progress since we can't track it with fetch in service worker
  let uploadedSize = 0;
  const progressInterval = setInterval(() => {
    uploadedSize += totalSize / 20; // Increment by 5%
    const percentage = Math.min(Math.round((uploadedSize / totalSize) * 100), 95);
    
    // Safely send message, ignore errors if tab is closed
    try {
      chrome.tabs.sendMessage(tabId, {
        action: 'uploadProgress',
        progress: percentage
      }).catch(() => {});
    } catch (e) {
      clearInterval(progressInterval);
    }
    
    if (percentage >= 95) {
      clearInterval(progressInterval);
    }
  }, 150);

  try {
    const response = await fetch(url, {
      method: 'POST',
      body: blob,
      headers: {
        'Content-Type': fileData.split(';')[0].split(':')[1] || 'application/octet-stream'
      }
    });

    clearInterval(progressInterval);
    
    // Send 100% progress safely
    try {
      chrome.tabs.sendMessage(tabId, {
        action: 'uploadProgress',
        progress: 100
      }).catch(() => {});
    } catch (e) {
      // Ignore if tab is closed
    }

    if (!response.ok) {
      throw new Error(`Upload failed: ${response.status} ${response.statusText}`);
    }

    // Return only the bin URL, not the full file URL
    return `https://filebin.net/${binId}/`;
  } catch (error) {
    clearInterval(progressInterval);
    throw error;
  }
}
