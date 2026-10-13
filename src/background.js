/* Calm Reddit: background service worker. */

chrome.runtime.onInstalled.addListener(({ reason }) => {
  // First install: show the one-time setup page (it walks through "Allow in Incognito").
  if (reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('welcome/welcome.html') });
  }
});

chrome.runtime.onMessage.addListener((message, sender) => {
  const tabId = sender.tab?.id;
  if (!message || tabId === undefined) return;
  // "Never mind, close tab" on the pause screen, and "Done" on the reminder.
  if (message.type === 'calm:close-tab') chrome.tabs.remove(tabId).catch(() => {});
  // A Reddit tab reports protections that may not work there, because Reddit changed the page (landmarks in page.js).
  if (message.type === 'calm:health') {
    const broken = Array.isArray(message.affected) && message.affected.length > 0;
    if (broken) chrome.action.setBadgeBackgroundColor({ tabId, color: '#b4452f' }).catch(() => {});
    chrome.action.setBadgeText({ tabId, text: broken ? '!' : '' }).catch(() => {});
  }
});
