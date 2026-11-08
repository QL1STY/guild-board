import { defineConfig } from '@playwright/test'

/**
 * Not a test run: it takes pictures to be looked at, into the `screenshots` folder at the root of the repository (git
 * ignores it; GB_SCREENS_DIR names another), each group in a folder of its own. `npm run screens` takes the stage 2A
 * pictures. Every other group has its own tag and its own command, so that the commands never take each other's
 * pictures: @1b (`screens:1b`), @look, @overlay, @scaling, @pulls, @topbar, @ledger, @characters, @friends, @stats, @readme and @site.
 * One test here takes no picture: @demoframe (`test:site-demo`) checks the site's built demo in the browser (screens/sitedemo.spec.ts).
 */
export default defineConfig({
  testDir: 'screens',
  outputDir: 'test-results/screens',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  forbidOnly: true,
  reporter: [['list']],
  use: {
    channel: 'msedge',
    viewport: { width: 1440, height: 900 },
  },
})
