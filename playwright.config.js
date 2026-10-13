// @ts-check
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  reporter: [['list'], ['html', { open: 'never' }]],
  projects: [
    {
      name: 'unit',
      testDir: './tests/unit',
    },
    {
      // The extension in a headless Chromium, with a stub page for reddit.com addresses (see tests/fixtures.js).
      name: 'e2e',
      testDir: './tests/e2e',
    },
    {
      // Runs against live reddit.com, so it needs network access and opens a browser window
      // (Reddit challenges headless browsers). One worker keeps the request rate polite.
      name: 'live',
      testDir: './tests/live',
      timeout: 90_000,
      retries: 1,
      fullyParallel: false,
      workers: 1,
      use: { trace: 'retain-on-failure' },
    },
  ],
});
