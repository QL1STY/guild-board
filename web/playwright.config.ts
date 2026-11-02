import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: true,
  forbidOnly: true,
  reporter: [['list']],
  use: {
    channel: 'msedge', // the Edge that Windows already has; no browser is downloaded
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
  },
})
