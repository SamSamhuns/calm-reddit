// The toolbar popup, opened as a normal page.
const { test, expect } = require('./fixtures');

test.beforeEach(async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);
});

const stored = (worker, key) => worker.evaluate((k) => chrome.storage.sync.get(k).then((s) => s[k]), key);

test('ticking a box saves it right away', async ({ page, worker }) => {
  await page.getByLabel('Home feed').check();
  await expect.poll(() => stored(worker, 'blockHome')).toBe(true);
});

test('unticking a protection asks you to wait first', async ({ page, worker }) => {
  const box = page.getByLabel('Home feed');
  await box.check();

  await box.click();
  await expect(page.locator('#confirm')).toBeVisible();
  await expect(page.locator('#confirm-title')).toHaveText('Unblock “Home feed”?');
  await expect(box).toBeChecked();
  await expect(page.locator('#confirm-ok')).toBeDisabled();

  await page.getByRole('button', { name: 'Keep it on' }).click();
  await expect(page.locator('#confirm')).toBeHidden();
  expect(await stored(worker, 'blockHome')).toBe(true);

  await box.click();
  await page.locator('#confirm-ok').click({ timeout: 15_000 }); // enabled after the 10 s cool-down
  await expect(box).not.toBeChecked();
  await expect.poll(() => stored(worker, 'blockHome')).toBe(false);
});

test('grayscale turns off without a cool-down', async ({ page, worker }) => {
  const box = page.getByLabel('Grayscale');
  const toggle = page.locator('.switch', { has: box }); // the styled switch covers the real checkbox
  await toggle.click();
  await expect.poll(() => stored(worker, 'grayscale')).toBe(true);
  await toggle.click();
  await expect(box).not.toBeChecked();
  await expect(page.locator('#confirm')).toBeHidden();
  await expect.poll(() => stored(worker, 'grayscale')).toBe(false);
});

test('the subreddit list is cleaned up and saved', async ({ page, worker }) => {
  await page.getByLabel('How to use the subreddit list').selectOption('allow');
  await expect.poll(() => stored(worker, 'subredditMode')).toBe('allow');

  const list = page.getByLabel('Subreddits, separated by commas');
  await list.fill('r/AskHistorians\n/r/homelab, aww aww');
  await list.blur();
  await expect.poll(() => stored(worker, 'subreddits')).toEqual(['askhistorians', 'homelab', 'aww']);
  await expect(list).toHaveValue('askhistorians, homelab, aww');

  await page.getByLabel('How to use the subreddit list').selectOption('off');
  await expect(page.locator('#confirm-title')).toHaveText('Stop using your subreddit list?');
  expect(await stored(worker, 'subredditMode')).toBe('allow');
});

test('number settings are saved as numbers', async ({ page, worker }) => {
  await page.getByLabel('Posts per page').selectOption('25');
  await expect.poll(() => stored(worker, 'pageSize')).toBe(25);
});
