// Feed and post-page features on live reddit.com.
const { test, expect, openReddit, shadowTexts } = require('./fixtures');

const SUB = '/r/aww/'; // busy, mixed images and video, serves ads
const feedPosts = (page) => page.locator('main shreddit-feed shreddit-post');

test('shows one page of posts with a pager instead of infinite scroll', async ({ page }) => {
  await openReddit(page, SUB);
  const pager = page.locator('#calm-pager');
  await expect(pager).toBeVisible();
  await expect(pager.locator('.calm-info')).toHaveText('Page 1');

  const visible = await feedPosts(page).filter({ visible: true }).count();
  expect(visible).toBeGreaterThan(0);
  expect(visible).toBeLessThanOrEqual(10);

  await pager.getByRole('button', { name: 'Next page →' }).click();
  await expect(pager.locator('.calm-info')).toHaveText('Page 2', { timeout: 20_000 });
  expect(await feedPosts(page).filter({ visible: true }).count()).toBeGreaterThan(0);

  // From page 3 on, "Next page" unlocks after 3 to 6 s.
  await pager.getByRole('button', { name: 'Next page →' }).click();
  await expect(pager.locator('.calm-info')).toHaveText('Page 3', { timeout: 20_000 });
  const next = pager.locator('.calm-primary');
  await expect(next).toHaveText(/^Next page in \ds$/);
  await expect(next).toBeDisabled();
  await expect(next).toHaveText('Next page →', { timeout: 8_000 });
  await expect(next).toBeEnabled();
});

test('stops loading after a few batches when every post in the feed is hidden', async ({ page }) => {
  await openReddit(page, '/'); // logged out, Home is nothing but suggestions
  const pager = page.locator('#calm-pager');
  await expect(pager.locator('.calm-info')).toHaveText('Page 1 · the rest were hidden', { timeout: 30_000 });

  const posts = page.locator('main shreddit-feed shreddit-post');
  const loaded = await posts.count();
  await page.mouse.wheel(0, 5000);
  await page.waitForTimeout(5000);
  expect(await posts.count()).toBe(loaded);

  // "Keep looking" loads a few more batches, then stops again.
  await pager.getByRole('button', { name: 'Keep looking' }).click();
  await expect.poll(() => posts.count()).toBeGreaterThan(loaded);
  await expect(pager.locator('.calm-info')).toHaveText('Page 1 · the rest were hidden', { timeout: 30_000 });
});

test('r/popular is paginated, not emptied by the suggestion filter', async ({ page }) => {
  await openReddit(page, '/r/popular/');
  await expect(page.locator('#calm-pager .calm-info')).toHaveText('Page 1');
  const visible = await feedPosts(page).filter({ visible: true }).count();
  expect(visible).toBeGreaterThan(0);
  expect(visible).toBeLessThanOrEqual(10);
});

test('Chrome does not blame the extension for console messages', async ({ page }) => {
  const blamed = [];
  page.on('console', (m) => { if (m.location().url.startsWith('chrome-extension://')) blamed.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => { if (/chrome-extension:\/\//.test(e.stack || '')) blamed.push(`error: ${e.message}`); });

  for (const path of [SUB, '/r/popular/', '/']) {
    await openReddit(page, path);
    await expect(page.locator('#calm-pager')).toBeVisible();
    await page.mouse.wheel(0, 5000);
    await page.waitForTimeout(2000);
  }
  expect(blamed).toEqual([]);
});

test('respects the posts-per-page setting', async ({ page, setSettings }) => {
  await setSettings({ pageSize: 5 });
  await openReddit(page, SUB);
  await expect(page.locator('#calm-pager')).toBeVisible();
  expect(await feedPosts(page).filter({ visible: true }).count()).toBeLessThanOrEqual(5);
});

test('hides ads, vote counts and comment counts, and blurs media', async ({ page }) => {
  await openReddit(page, SUB);
  await expect(page.locator('#calm-pager')).toBeVisible();
  await expect(page.locator('shreddit-ad-post, shreddit-sidebar-ad').filter({ visible: true })).toHaveCount(0);
  await expect(page.locator('main faceplate-number').filter({ visible: true })).toHaveCount(0);

  const media = feedPosts(page).filter({ visible: true }).locator('[slot="post-media-container"]').first();
  await expect(media).toHaveCSS('filter', /blur/);
});

test('hides video and GIF posts when asked, and still fills the page', async ({ page, setSettings }) => {
  await setSettings({ hideVideos: true });
  await openReddit(page, SUB);
  await expect(page.locator('#calm-pager')).toBeVisible();
  const shown = feedPosts(page).filter({ visible: true });
  expect(await shown.count()).toBeGreaterThan(0);
  await expect(shown.and(page.locator('[post-type="video"], [post-type="gif"]'))).toHaveCount(0);
});

test('hides sidebars and the logo when asked', async ({ page, setSettings }) => {
  await openReddit(page, SUB);
  await expect(page.locator('#reddit-logo')).toBeVisible();

  await setSettings({ hideSidebars: true, hideLogo: true }); // applies to open tabs without a reload
  await expect(page.locator('#reddit-logo')).toBeHidden();
  await expect(page.locator('#left-sidebar-container')).toBeHidden();
  await expect(page.locator('#right-sidebar-container')).toBeHidden();
});

test('post pages keep comments behind a button', async ({ page }) => {
  await openReddit(page, SUB);
  const permalink = await feedPosts(page).first().getAttribute('permalink');
  await openReddit(page, permalink);

  const gate = page.locator('#calm-comments-gate');
  await expect(gate).toBeVisible();
  await expect(page.locator('shreddit-comment-tree')).toBeHidden();

  await gate.getByRole('button', { name: 'Show comments' }).click();
  await expect(gate).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-calm-comments-open', '');
});

test('the pause screen asks for an intention and keeps it as a reminder', async ({ page, worker }) => {
  await worker.evaluate(() => chrome.storage.local.remove('calmLastActive')); // "been away a long time"
  await openReddit(page, SUB);

  await expect(page.locator('#calm-reddit-pause')).toBeAttached();
  await expect(page.locator('html')).toHaveAttribute('data-calm-pausing', '');
  await page.keyboard.type('check r/aww for one minute');

  // Sometimes the screen asks for a sum.
  const sum = (await shadowTexts(page, '#calm-reddit-pause')).find((t) => /^\d+( [+−] \d+)+ = \?$/.test(t));
  if (sum) {
    const [first, ...rest] = sum.replace(' = ?', '').split(' ');
    let answer = Number(first);
    for (let i = 0; i < rest.length; i += 2) answer += (rest[i] === '+' ? 1 : -1) * Number(rest[i + 1]);
    await page.keyboard.press('Tab'); // from the intention to the answer box
    await page.keyboard.type(String(answer));
  }
  await page.waitForTimeout(16_500); // the Continue button unlocks when the 8 to 16 s timer ends
  await page.keyboard.press('Enter');

  await expect(page.locator('#calm-reddit-pause')).toHaveCount(0);
  await expect(page.locator('#calm-reddit-intent')).toBeAttached();
  expect(await shadowTexts(page, '#calm-reddit-intent')).toEqual(expect.arrayContaining(['check r/aww for one minute', '· 1 min']));
  const intent = await worker.evaluate(() => chrome.storage.local.get('calmIntent'));
  expect(intent.calmIntent.text).toBe('check r/aww for one minute');
});

test('the pause screen comes back to check in during a long visit', async ({ page, worker }) => {
  await worker.evaluate(() => chrome.storage.local.set({
    calmIntent: { text: 'read one thread', at: Date.now() - 20 * 60_000, dismissed: false, checkAt: Date.now() - 1000 },
  }));
  await openReddit(page, SUB);

  await expect(page.locator('#calm-reddit-pause')).toBeAttached();
  const texts = await shadowTexts(page, '#calm-reddit-pause');
  expect(texts).toContain('Still on it?');
  expect(texts.join(' ')).toContain('You have been on Reddit for 20 min.');
});
