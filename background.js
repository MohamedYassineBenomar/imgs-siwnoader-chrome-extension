// Service worker: performs the actual download using the chrome.downloads API,
// which content scripts are not allowed to call directly.

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "CID_DOWNLOAD" || !msg.url) return;

  try {
    chrome.downloads.download(
      {
        url: msg.url,
        filename: msg.filename || undefined,
        saveAs: false
      },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        } else if (downloadId === undefined) {
          sendResponse({ ok: false, error: "Download was not started" });
        } else {
          sendResponse({ ok: true, id: downloadId });
        }
      }
    );
  } catch (e) {
    sendResponse({ ok: false, error: String((e && e.message) || e) });
  }

  // Keep the message channel open for the async sendResponse above.
  return true;
});

// Clicking the toolbar icon triggers the same "download main image" action
// on the active tab (the extension has no popup, so onClicked fires).
chrome.action.onClicked.addListener((tab) => {
  if (tab && tab.id != null) {
    chrome.tabs.sendMessage(tab.id, { type: "CID_TRIGGER" }).catch(() => {
      /* Tab has no content script (e.g. chrome:// pages). Ignore. */
    });
  }
});
