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
      // Runs against live reddit.com, so it needs network access and opens a browser window
      // (Reddit challenges headless browsers). One worker keeps the request rate polite.
      name: 'reddit',
      testDir: './tests/e2e',
      timeout: 90_000,
      retries: 1,
      fullyParallel: false,
      workers: 1,
      use: { trace: 'retain-on-failure' },
    },
  ],
});
