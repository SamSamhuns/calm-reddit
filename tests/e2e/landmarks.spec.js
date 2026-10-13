// Landmarks: what the protections need to find on Reddit's pages (see page.js), on stub pages shaped like Reddit's.
const { test, expect, openReddit, pageReport } = require('../fixtures');

const post = (id, count = '<faceplate-number number="7">7</faceplate-number>') =>
  `<article><shreddit-post id="t3_${id}"><a href="/r/aww/comments/${id}/x/">A post</a>${count}</shreddit-post></article><hr>`;
const POSTS = post('a') + post('b') + post('c');
const LOADER = '<faceplate-partial slot="load-after" src="/svc/shreddit/community-more-posts/hot/?after=t3_c"></faceplate-partial>';
const RENAMED_POSTS = ['a', 'b', 'c'].map((id) => `<article><new-post><a href="/r/aww/comments/${id}/x/">A post</a></new-post></article>`).join('');

// Serves `main` as the main column of the page at `path`.
const serve = (page, path, main) => page.route(`https://www.reddit.com${path}`, (route) => route.fulfill({
  contentType: 'text/html',
  body: `<!doctype html><title>Reddit</title><main>${main}</main>`,
}));

test("a feed shaped like Reddit's has every landmark", async ({ page }) => {
  await serve(page, '/r/aww/', `<shreddit-feed>${POSTS}${LOADER}</shreddit-feed>`);
  await openReddit(page, '/r/aww/');
  await expect.poll(async () => (await pageReport(page)).landmarks).toEqual({ posts: true, feed: true, counts: true, loader: true });
  expect((await pageReport(page)).affected).toEqual([]);
});

for (const [what, feed, landmarks, affected] of [
  ['the post element', RENAMED_POSTS, { posts: false }, ['paginate', 'recs']],
  ['the loader', POSTS + LOADER.replaceAll('faceplate-partial', 'new-loader'),
    { posts: true, feed: true, counts: true, loader: false }, ['paginate']],
  ['the vote count', post('a', '') + post('b', '') + post('c', '') + LOADER,
    { posts: true, feed: true, counts: false, loader: true }, ['counts']],
]) {
  test(`when Reddit renames ${what}, its landmark is missing`, async ({ page }) => {
    await serve(page, '/r/aww/', `<shreddit-feed>${feed}</shreddit-feed>`);
    await openReddit(page, '/r/aww/');
    await expect.poll(async () => (await pageReport(page)).landmarks).toEqual(landmarks);
    expect((await pageReport(page)).affected).toEqual(affected);
  });
}

test('on a post page, a renamed comment section is missing', async ({ page }) => {
  const path = '/r/aww/comments/abc123/x/';
  await serve(page, path, '<shreddit-post id="t3_abc123">The post</shreddit-post><new-comment-tree></new-comment-tree>');
  await openReddit(page, path);
  await expect.poll(async () => (await pageReport(page)).landmarks).toEqual({ post: true, comments: false });
  expect((await pageReport(page)).affected).toEqual(['comments']);
});

test('the toolbar icon and the popup show the protections that may not work', async ({ page, extensionContext, extensionId, worker }) => {
  const popup = await extensionContext.newPage(); // a second tab: the popup shows the active tab, which stays the Reddit one
  await serve(page, '/r/aww/', `<shreddit-feed>${RENAMED_POSTS}</shreddit-feed>`);
  await openReddit(page, '/r/aww/');
  await page.bringToFront();
  const badge = () => worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return chrome.action.getBadgeText({ tabId: tab.id });
  });
  await expect.poll(badge, { timeout: 10_000 }).toBe('!'); // after the page has been quiet for 2 s

  await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await expect(popup.locator('#health li')).toHaveText(['Pages, not infinite scroll', 'Hide recommendations']);
  await popup.close();

  // The "!" goes away when the page has its landmarks again.
  await page.evaluate((posts) => { document.querySelector('shreddit-feed').innerHTML = posts; }, POSTS);
  await expect.poll(badge, { timeout: 10_000 }).toBe('');
});
