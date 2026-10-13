/* Calm Reddit: background service worker. */

chrome.runtime.onInstalled.addListener(({ reason }) => {
  // First install: show the one-time setup page (it walks through "Allow in Incognito").
  if (reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('welcome/welcome.html') });
  }
});

chrome.runtime.onMessage.addListener((message, sender) => {
  // "Never mind, close tab" on the pause screen, and "Done" on the reminder.
  if (message && message.type === 'calm:close-tab' && sender.tab && sender.tab.id !== undefined) {
    chrome.tabs.remove(sender.tab.id).catch(() => {});
  }
});
