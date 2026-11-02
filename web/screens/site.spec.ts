import type { Page, Route } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SCREENS_OUT } from './out.ts'
import { expect, test } from '../e2e/fixtures.ts'

/**
 * The pictures of the site's tabs (site/index.html): the real interface on the demo core, one size for all of them, the page's own
 * 1,640 by 1,000, each once its motion has settled. They are one to one with the app as a player sees it, game pictures included:
 * the demo core here is the one the site's recording is made on (tools/site_demo_core.py), which names each picture of the demo's
 * list, and the test alone routes `/api/art/<key>` to the official address in `pictures.json`, so that the pictures are those of
 * HoYoverse's own host and none is kept in this repository. The pictures of the icon cache (`/api/icon/<key>`: the primogem, the
 * resin, the banners' art, the timers' pictures) are routed likewise, to the addresses of the recording's `icons.json`. Where the host refuses, the page shows its drawn sign, as the app does.
 * The pictures go to `screenshots/site` (git ignores it) and are published from there to the `site-assets` branch, never committed
 * to this one. The overlay's tab is a picture taken from the player's own game, which no test makes. Only the tests tagged @site write
 * here, and only `npm run screens:site` runs them.
 */
const FOLDER = path.join(SCREENS_OUT, 'site')
const SITE = '@site'
const SIZE = { width: 1640, height: 1000 }
const HERE = path.dirname(fileURLToPath(import.meta.url))
const PICTURES = path.resolve(HERE, '..', '..', 'src', 'guildboard', 'characters', 'demo', 'pictures.json')
/** The official address of each picture of the icon cache, by key: written by tools/record-site-demo.py beside the recording. */
const ICONS = path.resolve(HERE, '..', 'site-demo', 'recording', 'icons.json')

test.use({ siteArt: true, weekAndEndgame: false })

/** The picture at `url`, fetched once through the route and kept for the next time; a host that refuses gives a 404 (the sign shows). */
function official(listed: (key: string) => string | undefined, kept: Map<string, { status: number; contentType: string; body: Buffer }>) {
  return async (route: Route): Promise<void> => {
    const key = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop() ?? '')
    const url = listed(key)
    if (url === undefined) return route.fulfill({ status: 404 })
    let answer = kept.get(url)
    if (answer === undefined) {
      try {
        const fetched = await route.fetch({ url })
        answer = { status: fetched.status(), contentType: fetched.headers()['content-type'] ?? 'image/png', body: await fetched.body() }
      } catch {
        answer = { status: 404, contentType: 'text/plain', body: Buffer.alloc(0) }
      }
      kept.set(url, answer)
      if (answer.status !== 200) console.warn(`The host answered ${answer.status} for ${url}: the page shows its sign.`)
    }
    return route.fulfill(answer.status === 200 ? { status: 200, contentType: answer.contentType, body: answer.body } : { status: 404 })
  }
}

/** `/api/art/<key>` and `/api/icon/<key>` of the demo core, answered with the picture at the official address of the demo's lists. */
async function officialArt(page: Page): Promise<void> {
  const art = JSON.parse(readFileSync(PICTURES, 'utf-8')) as Record<string, { url: string }>
  const icons = JSON.parse(readFileSync(ICONS, 'utf-8')) as Record<string, { url: string }>
  const kept = new Map<string, { status: number; contentType: string; body: Buffer }>()
  await page.route('**/api/art/**', official((key) => art[key]?.url, kept))
  await page.route('**/api/icon/**', official((key) => icons[key]?.url, kept))
  // The page fixture has loaded the app before these routes were set, so the plate's primogem and resin were asked for of the core,
  // which gave 404 and left their signs in place (a hash change does not load the page again): it is loaded once more with the routes.
  await page.reload()
}

async function settled(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready
  })
  await page.waitForFunction(
    () => {
      const moving = document.getAnimations().some((animation) => animation.playState === 'running')
      const counting = [...document.querySelectorAll('span[aria-hidden="true"] + .sr-only')].some(
        (real) => real.previousElementSibling?.textContent !== real.textContent,
      )
      const loaded = [...document.images].every((image) => image.hidden || (image.complete && image.naturalWidth > 0))
      return !moving && !counting && loaded
    },
    undefined,
    { timeout: 45_000 },
  )
  await page.mouse.move(0, 0) // no tooltip in the picture
}

async function take(page: Page, name: string): Promise<void> {
  await settled(page)
  await page.screenshot({ path: path.join(FOLDER, `${name}.png`) })
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(SIZE)
  await officialArt(page)
})

test('site: the Board', { tag: SITE }, async ({ page, core }) => {
  await page.goto(`${core.origin}/#/board`)
  await expect(page.locator('[data-widget="start-timers"] li.tm-row').first()).toBeVisible()
  await expect(page.locator('.gb-primo-ico img')).toBeVisible() // the plate's primogem and resin are the game's pictures
  await expect(page.locator('.gb-resin-ico img')).toBeVisible()
  await take(page, 'board')
})

test('site: Achievements', { tag: SITE }, async ({ page, core }) => {
  await page.goto(`${core.origin}/#/achievements`)
  await expect(page.getByText('of 1,854 ticked')).toBeVisible()
  await take(page, 'achievements')
})

test('site: Pulls', { tag: SITE }, async ({ page, core }) => {
  await page.goto(`${core.origin}/#/pulls`)
  await expect(page.getByTestId('pity-card')).toHaveCount(4)
  await expect(page.getByTestId('history-row')).toHaveCount(100)
  // The three banners show their official art, not the drawn sign.
  const art = page.getByTestId('pulls-banner').locator('img')
  await expect(art).toHaveCount(3)
  for (const one of await art.all()) await expect(one).toBeVisible()
  await take(page, 'pulls')
})

test('site: Stats', { tag: SITE }, async ({ page, core }) => {
  await page.goto(`${core.origin}/#/stats`)
  await expect(page.getByText('Exploration gained')).toBeVisible()
  await take(page, 'stats')
})

/*
 * The overlay, as it stands over the game: the real page on the demo's data, over a photograph taken in the game. The picture is
 * the maintainer's, is named by GB_OVERLAY_BACKGROUND and stays out of this repository, so without it this test is passed over.
 * It is set at its own size and cut at the bottom edge of the frame, as the game writes its logo in the corner below that.
 */
test('site: the overlay', { tag: SITE }, async ({ page, core }) => {
  const photograph = process.env.GB_OVERLAY_BACKGROUND
  test.skip(photograph === undefined, 'GB_OVERLAY_BACKGROUND names no picture')
  const picture = `data:image/png;base64,${readFileSync(photograph!).toString('base64')}`
  await page.goto(`${core.origin}/#/overlay/open`)
  await expect(page.locator('[data-widget="start-ov-timers"] li.tm-row').first()).toBeVisible()
  await expect(page.locator('[data-widget="start-ov-commissions"] li')).not.toHaveCount(0)
  await page.evaluate((image) => {
    document.documentElement.style.background = `url(${image}) -230px 0 / 2000px 1125px no-repeat fixed`
  }, picture)
  await take(page, 'overlay')
})
