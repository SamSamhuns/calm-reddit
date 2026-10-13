// Playwright fixtures: a Chromium with the unpacked extension loaded, shared by every test in the worker.
const base = require('@playwright/test');
const path = require('node:path');

const EXTENSION = path.join(__dirname, '../..');
const REDDIT = 'https://www.reddit.com';

const test = base.test.extend({
  // Launching Chromium with an extension is slow, so one browser serves all tests in a worker.
  extensionContext: [async ({}, use) => {
    const context = await base.chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: false, // Reddit answers headless browsers with a "Prove your humanity" page
      viewport: { width: 1280, height: 900 },
      args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
    });
    await use(context);
    await context.close();
  }, { scope: 'worker' }],

  // The extension's service worker: used to read and write chrome.storage.
  worker: [async ({ extensionContext }, use) => {
    const worker = extensionContext.serviceWorkers()[0] || await extensionContext.waitForEvent('serviceworker');
    await use(worker);
  }, { scope: 'worker' }],

  extensionId: [async ({ worker }, use) => {
    await use(new URL(worker.url()).host);
  }, { scope: 'worker' }],

  // Each test starts from default settings with the pause screen out of the way.
  // Call setSettings({ ... }) to change settings before opening a page.
  setSettings: async ({ worker }, use) => {
    await worker.evaluate(async () => {
      await chrome.storage.sync.clear();
      await chrome.storage.local.clear();
      await chrome.storage.local.set({ calmLastActive: Date.now() });
    });
    await use((patch) => worker.evaluate((p) => chrome.storage.sync.set(p), patch));
  },

  page: async ({ extensionContext, setSettings }, use) => {
    const page = await extensionContext.newPage();
    await use(page);
    await page.close();
  },
});

// Opens a Reddit page, retrying when Reddit shows its bot check (it usually does for a fresh browser's first visit).
async function openReddit(page, urlPath) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.goto(REDDIT + urlPath, { waitUntil: 'domcontentloaded' });
    if (!/prove your humanity/i.test(await page.title())) return;
    await page.waitForTimeout(2000);
  }
  throw new Error(`Reddit kept showing its bot check for ${urlPath}`);
}

// The pause and block screens and the reminder use closed shadow roots, so tests check their hosts and the
// attributes bridge.js writes on <html> (data-calm-blocked holds the reason a page is blocked).
const blockedReason = (page) => page.locator('html').getAttribute('data-calm-blocked');

// The text nodes inside one of those screens. Playwright cannot see into a closed shadow root; DevTools can.
async function shadowTexts(page, selector) {
  const cdp = await page.context().newCDPSession(page);
  const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
  const texts = [];
  const walk = (n) => {
    if (n.nodeType === 3) texts.push(n.nodeValue);
    for (const child of [...(n.children || []), ...(n.shadowRoots || [])]) walk(child);
  };
  walk((await cdp.send('DOM.describeNode', { nodeId, depth: -1, pierce: true })).node);
  await cdp.detach();
  return texts;
}

module.exports = { test, expect: base.expect, openReddit, blockedReason, shadowTexts, REDDIT };
