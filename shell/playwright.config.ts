import { defineConfig } from '@playwright/test'

// One Guild Board at a time: each test starts a real core and a real window on its own temporary data folder.
export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  outputDir: 'test-results',
  timeout: 150_000,
  expect: { timeout: 7_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  reporter: [['list']],
})
