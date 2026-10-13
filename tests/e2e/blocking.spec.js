// Blocked pages and the subreddit list, on the stub page for reddit.com addresses.
const { test, expect, openReddit, blockedReason } = require('../fixtures');

async function expectBlocked(page, text) {
  await expect.poll(() => blockedReason(page)).toContain(text);
  await expect(page.locator('#calm-reddit-block')).toBeAttached();
  await expect(page.locator('body')).toBeHidden();
}

async function expectAllowed(page) {
  await expect.poll(() => blockedReason(page)).toBeNull();
  await expect(page.locator('#calm-reddit-block')).toHaveCount(0);
}

test('nothing is blocked by default', async ({ page }) => {
  await openReddit(page, '/r/popular/');
  await expectAllowed(page);
});

for (const [setting, path, text] of [
  ['blockHome', '/', 'Home feed'],
  ['blockPopular', '/r/popular/', 'r/popular'],
  ['blockExplore', '/explore/', 'Explore'],
  ['blockSearch', '/search/?q=cats', 'Search'],
  ['blockProfiles', '/user/spez/', 'profiles'],
  ['blockSubreddits', '/r/aww/', 'Subreddit feeds'],
]) {
  test(`${setting} blocks ${path}`, async ({ page, setSettings }) => {
    await setSettings({ [setting]: true });
    await openReddit(page, path);
    await expectBlocked(page, text);
  });
}

test('allow list: listed subreddits open, others are blocked', async ({ page, setSettings }) => {
  await setSettings({ subredditMode: 'allow', subreddits: ['aww'] });
  await openReddit(page, '/r/aww/');
  await expectAllowed(page);
  await openReddit(page, '/r/gifs/');
  await expectBlocked(page, "r/gifs isn't on your allow list");
});

test('block list: listed subreddits are blocked', async ({ page, setSettings }) => {
  await setSettings({ subredditMode: 'block', subreddits: ['gifs'] });
  await openReddit(page, '/r/gifs/');
  await expectBlocked(page, 'r/gifs is on your block list');
});

test('blocks pages reached without a reload, and lifts the block on the way back', async ({ page, setSettings }) => {
  await setSettings({ blockPopular: true });
  await openReddit(page, '/r/aww/');
  await expectAllowed(page);

  await page.evaluate(() => history.pushState({}, '', '/r/popular/')); // how Reddit's own links navigate
  await expectBlocked(page, 'r/popular');

  await page.evaluate(() => history.back());
  await expectAllowed(page);
});

test('settings changed in the popup apply to open tabs', async ({ page, setSettings }) => {
  await openReddit(page, '/r/aww/');
  await expectAllowed(page);
  await setSettings({ blockSubreddits: true });
  await expectBlocked(page, 'Subreddit feeds');
  await setSettings({ blockSubreddits: false });
  await expectAllowed(page);
});
