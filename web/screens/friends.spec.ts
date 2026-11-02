import type { Locator, Page } from '@playwright/test'
import path from 'node:path'
import { SCREENS_OUT } from './out.ts'
import { expect, test, type Core } from '../e2e/fixtures.ts'

/*
 * The Friends pictures, which only `npm run screens:friends` takes, to be looked at. Each is what the
 * window shows, in the player's usual window, 1,640 × 1,100, and full screen on their 2,560-pixel display as the window's
 * zoom shows it, once the motion has settled: Friends with a request, Your profile, a friend's profile, Compare with a
 * tooltip, and Settings' Online signed out and signed in. The account, the friends and every number are the demo's, made up.
 */

const FOLDER = path.join(SCREENS_OUT, '2026-10-28-online-friends-screens')
const FRIENDS = '@friends'
const RILEY = '00000000-0000-4000-8000-000000007687'

/** Waits until no animation or transition runs and every counted number shows its value (look pass spec 6.3). */
async function settled(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const moving = document.getAnimations().some((animation) => animation.playState === 'running')
    const counting = [...document.querySelectorAll('span[aria-hidden="true"] + .sr-only')].some(
      (real) => real.previousElementSibling?.textContent !== real.textContent,
    )
    return !moving && !counting
  })
}

/**
 * The window's picture, once the fonts and pictures are in and the motion has settled. With `at`, the window is first
 * scrolled to that element, 12 pixels under its top, as the player scrolls to it; with `hover`, the pointer rests on that
 * element, for its tooltip, else it is out of the window.
 */
async function shot(page: Page, name: string, at?: Locator, hover?: Locator): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready
  })
  await page.waitForFunction(() =>
    [...document.images].every((image) => image.hidden || (image.complete && image.naturalWidth > 0)),
  )
  if (at === undefined) await page.evaluate(() => window.scrollTo(0, 0))
  else await at.evaluate((element) => window.scrollTo(0, Math.max(0, element.getBoundingClientRect().top + window.scrollY - 12)))
  if (hover === undefined) await page.mouse.move(0, 0)
  else await hover.hover()
  await settled(page)
  await page.screenshot({ path: path.join(FOLDER, `${name}.png`) })
}

type Scene = {
  name: string
  /** Opens the page and waits until it has read what it shows. */
  open: (page: Page, core: Core) => Promise<void>
  at?: (page: Page) => Locator
  hover?: (page: Page) => Locator
}

const friendList = (page: Page) => page.getByRole('list', { name: 'Friends' })
const onlineGroup = (page: Page) => page.getByRole('region', { name: 'Online', exact: true })

const openCompare = async (page: Page, core: Core) => {
  await page.goto(`${core.origin}/#/friends/${RILEY}/compare`)
  await expect(page.getByTestId('compare-score')).toContainText('8 – 3')
  await expect(page.getByRole('region', { name: 'Play time each week' }).locator('.cmp-col')).toHaveCount(6)
}

const SCENES: Scene[] = [
  {
    // The demo's request from Nova#5120 on top, and Riley's row under the pointer, as the mockup has it.
    name: 'friends',
    open: async (page, core) => {
      await page.goto(`${core.origin}/#/friends`)
      await expect(friendList(page).getByRole('listitem')).toHaveCount(3)
      await expect(page.getByRole('group', { name: 'Requests' })).toContainText('Nova#5120 wants to be your friend.')
    },
    hover: (page) => friendList(page).getByRole('listitem').first(),
  },
  {
    name: 'profile',
    open: async (page, core) => {
      await page.goto(`${core.origin}/#/friends/me`)
      await expect(page.getByRole('heading', { name: 'What your friends see' })).toBeVisible()
      await expect(page.getByTestId('profile-preview').locator('.frd-chip')).toHaveCount(3)
    },
  },
  {
    name: 'friend',
    open: async (page, core) => {
      await page.goto(`${core.origin}/#/friends/${RILEY}`)
      await expect(page.getByTestId('friend-name')).toHaveText('Riley#7687')
      await expect(page.getByRole('group', { name: 'Endgame' })).toBeVisible()
    },
  },
  {
    name: 'compare',
    open: openCompare,
  },
  {
    // The two charts, with the tooltip of the week of 12 October, as the mockup's chart shows one.
    name: 'compare-charts',
    open: openCompare,
    at: (page) => page.getByRole('region', { name: 'Play time each week' }),
    hover: (page) => page.getByRole('region', { name: 'Play time each week' }).locator('.cmp-col').nth(5),
  },
  {
    name: 'settings-online-out',
    open: async (page, core) => {
      await page.request.post(`${core.origin}/api/demo/online`, { data: { state: 'signed_out' } })
      await page.goto(`${core.origin}/#/settings`)
      await expect(onlineGroup(page)).toContainText('Sign in to add friends')
    },
    at: onlineGroup,
  },
  {
    name: 'settings-online-in',
    open: async (page, core) => {
      await page.goto(`${core.origin}/#/settings`)
      await expect(onlineGroup(page)).toContainText('Signed in with Discord as Traveler#2048')
    },
    at: onlineGroup,
  },
]

for (const scene of SCENES) {
  test(`friends: ${scene.name} in the usual window`, { tag: FRIENDS }, async ({ page, core }) => {
    await page.setViewportSize({ width: 1640, height: 1100 })
    await scene.open(page, core)
    await shot(page, `${scene.name}-1640`, scene.at?.(page), scene.hover?.(page))
  })

  // Full screen on the 2,560-pixel display, the window zooms its page by 2,560 / 1,640 (the scaling pass spec, section
  // 5): a browser of its own does the same, at 1,640 × 897 and 2,560 / 1,640 device pixels to a pixel, logged in through
  // the launch link.
  test(`friends: ${scene.name} full screen at 2560, zoomed`, { tag: FRIENDS }, async ({ browser, core, api }) => {
    void api // the fixture marks the risk statement as read, for every page of this core
    const context = await browser.newContext({ viewport: { width: 1640, height: 897 }, deviceScaleFactor: 2560 / 1640 })
    try {
      await context.request.get(core.launch, { maxRedirects: 0 })
      const zoomed = await context.newPage()
      await scene.open(zoomed, core)
      await shot(zoomed, `${scene.name}-2560`, scene.at?.(zoomed), scene.hover?.(zoomed))
    } finally {
      await context.close()
    }
  })
}

void RILEY
