// The pause screen, on the stub page for reddit.com addresses.
const { test, expect, openReddit, shadowTexts } = require('../fixtures');

test('the pause screen asks for an intention and keeps it as a reminder and in the history', async ({ page, worker }) => {
  await worker.evaluate(() => chrome.storage.local.remove('calmLastActive')); // "been away a long time"
  await openReddit(page, '/r/aww/');

  await expect(page.locator('#calm-reddit-pause')).toBeAttached();
  await expect(page.locator('html')).toHaveAttribute('data-calm-pausing', '');
  await expect(page.locator('#calm-reddit-pause')).toBeFocused(); // the reason box takes the focus 50 ms after the screen shows
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
  await expect.poll(() => worker.evaluate(() => chrome.storage.local.get('calmHistory').then((s) => s.calmHistory)))
    .toEqual([{ text: 'check r/aww for one minute', at: expect.any(Number) }]);
});

test('the pause screen comes back to check in during a long visit', async ({ page, worker }) => {
  await worker.evaluate(() => chrome.storage.local.set({
    calmIntent: { text: 'read one thread', at: Date.now() - 20 * 60_000, dismissed: false, checkAt: Date.now() - 1000 },
  }));
  await openReddit(page, '/r/aww/');

  await expect(page.locator('#calm-reddit-pause')).toBeAttached();
  const texts = await shadowTexts(page, '#calm-reddit-pause');
  expect(texts).toContain('Still on it?');
  expect(texts.join(' ')).toContain('You have been on Reddit for 20 min.');
});
