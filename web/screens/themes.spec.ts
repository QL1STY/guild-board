import type { Locator, Page } from '@playwright/test'
import path from 'node:path'
import { changeAnswer } from '../e2e/answers.ts'
import { expect, test, type Core } from '../e2e/fixtures.ts'
import type { Pulls } from '../src/types.ts'
import { SCREENS_OUT } from './out.ts'

/*
 * The themes' pictures, which only `npm run screens:themes` takes, to be looked at against the themes design and its mockup
 * themes.html. Each is what the window shows in the player's usual window, 1,640 x 1,100, once the motion has settled, in
 * Parchment, Midnight, Slate, Dusk and Mist and the seven nations (Mondstadt, Liyue, Inazuma, Sumeru,
 * Fontaine, Natlan and Snezhnaya): the Board, Pulls, Characters' roster, Stats, Settings with the picker, and the profile
 * card's panel (an in-app dialog). Also the picker alone on Parchment, Midnight and Slate, scrolled to the nations on Natlan and Mondstadt, Stats with a tooltip and the profile
 * panel with the AR badge on Midnight, Slate and Dusk, and the soft-pity mark across a 5-star ring in all five looks (and, on Mist, the whole row of cards). The demo's data is made up.
 */

const FOLDER = path.join(SCREENS_OUT, '2026-11-08-themes-screens')
const THEMES = '@themes'
const LOOKS = ['parchment', 'midnight', 'slate', 'dusk', 'mist'] as const
/** The seven nations (the themes design, section 12): each gets every scene, like the five looks. */
const NATIONS = ['mondstadt', 'liyue', 'inazuma', 'sumeru', 'fontaine', 'natlan', 'snezhnaya'] as const
type Look = (typeof LOOKS)[number] | (typeof NATIONS)[number]

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

/** The window's picture, or of `clip`'s element alone, once the fonts and pictures are in and the motion has settled. */
async function shot(page: Page, name: string, options: { at?: Locator; hover?: Locator; only?: Locator } = {}): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready
  })
  await page.waitForFunction(() =>
    [...document.images].every((image) => image.hidden || (image.complete && image.naturalWidth > 0)),
  )
  if (options.at === undefined) await page.evaluate(() => window.scrollTo(0, 0))
  else await options.at.evaluate((element) => window.scrollTo(0, Math.max(0, element.getBoundingClientRect().top + window.scrollY - 12)))
  if (options.hover === undefined) await page.mouse.move(0, 0)
  else await options.hover.hover()
  await settled(page)
  if (options.only === undefined) await page.screenshot({ path: path.join(FOLDER, `${name}.png`) })
  else await options.only.screenshot({ path: path.join(FOLDER, `${name}.png`) })
}

const guildBoard = (page: Page) => page.getByRole('region', { name: 'Guild Board', exact: true })
const primogemDays = (page: Page) => page.getByRole('region', { name: 'Primogems earned per day' })

type Scene = {
  name: string
  open: (page: Page, core: Core) => Promise<void>
  at?: (page: Page) => Locator
  hover?: (page: Page) => Locator
  only?: (page: Page) => Locator
}

const SCENES: Scene[] = [
  {
    name: 'board',
    open: async (page, core) => {
      await page.goto(`${core.origin}/#/board`)
      await expect(page.getByTestId('board')).toBeVisible()
    },
  },
  {
    name: 'pulls',
    open: async (page, core) => {
      await page.goto(`${core.origin}/#/pulls`)
      await expect(page.getByTestId('pity-card')).toHaveCount(4)
      await expect(page.getByTestId('history-row')).toHaveCount(100)
    },
  },
  {
    name: 'characters',
    open: async (page, core) => {
      await page.goto(`${core.origin}/#/characters`)
      await expect(page.locator('.gb-page').first()).toBeVisible()
      await page.waitForTimeout(600) // the roster's cards arrive with their portraits
    },
  },
  {
    name: 'stats',
    open: async (page, core) => {
      await page.goto(`${core.origin}/#/stats`)
      await expect(primogemDays(page).locator('.col-item')).toHaveCount(30)
    },
  },
  {
    name: 'settings',
    open: async (page, core) => {
      await page.goto(`${core.origin}/#/settings`)
      await expect(page.getByRole('radiogroup', { name: 'Theme' })).toBeVisible()
    },
    at: guildBoard,
  },
  {
    name: 'dialog',
    open: async (page, core) => {
      await page.goto(`${core.origin}/#/board`)
      await expect(page.getByTestId('board')).toBeVisible()
      await page.getByTestId('profile').click()
      await expect(page.getByTestId('profile-panel')).toBeVisible()
    },
  },
]

for (const scene of SCENES) {
  for (const look of [...LOOKS, ...NATIONS]) {
    test(`themes: ${scene.name} on ${look}`, { tag: THEMES }, async ({ page, core, api }) => {
      await api.put('/api/settings', { theme: look satisfies Look })
      await page.reload() // the page fixture loaded the page before the theme was set
      await page.setViewportSize({ width: 1640, height: 1100 })
      await scene.open(page, core)
      await expect(page.locator('html')).toHaveAttribute('data-theme', look)
      await shot(page, `${scene.name}-${look}`, { at: scene.at?.(page), hover: scene.hover?.(page), only: scene.only?.(page) })
    })
  }
}

// The picker alone, in its own look and on the others: the tiles, the sun and moon of Match Windows, the tick, the ring.
for (const look of ['parchment', 'midnight', 'slate'] as const) {
  test(`themes: the picker alone on ${look}`, { tag: THEMES }, async ({ page, core, api }) => {
    await api.put('/api/settings', { theme: look })
    await page.reload()
    await page.setViewportSize({ width: 1640, height: 1100 })
    await page.goto(`${core.origin}/#/settings`)
    const row = guildBoard(page).locator('.set-row').first()
    await expect(row.getByRole('radiogroup', { name: 'Theme' })).toBeVisible()
    await page.locator('.tp-tile.on').focus() // the focus ring shows on the chosen tile
    await shot(page, `picker-${look}`, { only: row })
  })
}

// The picker with the nations: on Natlan, as the app leaves it when Settings opens (the chosen tile scrolled whole into view, the fade at the
// right edge gone as nothing is further right); on Mondstadt, staged: scrolled to put the "Nations" mark at the row's left edge, with its
// snapping off for the picture, so that the mark, the first nations and the fade at the right edge show.
test('themes: the picker as Settings opens it on Natlan', { tag: THEMES }, async ({ page, core, api }) => {
  await api.put('/api/settings', { theme: 'natlan' })
  await page.reload()
  await page.setViewportSize({ width: 1640, height: 1100 })
  await page.goto(`${core.origin}/#/settings`)
  const row = guildBoard(page).locator('.set-row').first()
  await expect(row.getByRole('radiogroup', { name: 'Theme' })).toBeVisible()
  await page.waitForTimeout(400) // the row's own scroll to the chosen tile
  await page.locator('.tp-tile.on').focus()
  await shot(page, 'picker-nations-natlan', { only: row })
})

test('themes: the picker scrolled to put the Nations mark first, on Mondstadt', { tag: THEMES }, async ({ page, core, api }) => {
  await api.put('/api/settings', { theme: 'mondstadt' })
  await page.reload()
  await page.setViewportSize({ width: 1640, height: 1100 })
  await page.goto(`${core.origin}/#/settings`)
  const row = guildBoard(page).locator('.set-row').first()
  const tiles = row.getByRole('radiogroup', { name: 'Theme' })
  await expect(tiles).toBeVisible()
  await tiles.evaluate((element) => {
    const mark = element.querySelector<HTMLElement>('.tp-sep')!
    element.style.scrollSnapType = 'none' // the row would pull the mark out of view again, to the start of Mondstadt's tile
    element.scrollTo({ left: mark.offsetLeft - 8, behavior: 'instant' })
  })
  await page.locator('.tp-tile.on').focus()
  await shot(page, 'picker-nations-mondstadt', { only: row })
})

// The row wrapping: a narrower window puts the tiles under the text.
test('themes: the picker row in a narrow window', { tag: THEMES }, async ({ page, core, api }) => {
  await api.put('/api/settings', { theme: 'dusk' })
  await page.reload()
  await page.setViewportSize({ width: 1100, height: 900 })
  await page.goto(`${core.origin}/#/settings`)
  const row = guildBoard(page).locator('.set-row').first()
  await expect(row.getByRole('radiogroup', { name: 'Theme' })).toBeVisible()
  await shot(page, 'picker-dusk-narrow', { only: row })
})

// Tooltips on the dark themes.
for (const look of ['midnight', 'slate', 'dusk'] as const) {
  test(`themes: Stats with a tooltip on ${look}`, { tag: THEMES }, async ({ page, core, api }) => {
    await api.put('/api/settings', { theme: look })
    await page.reload()
    await page.setViewportSize({ width: 1640, height: 1100 })
    await page.goto(`${core.origin}/#/stats`)
    await expect(primogemDays(page).locator('.col-item')).toHaveCount(30)
    await shot(page, `stats-tooltip-${look}`, { at: primogemDays(page), hover: primogemDays(page).locator('.col-item').nth(2) })
  })
}

// The soft-pity mark across a gold 5-star ring, close up: the card's pity is moved past its soft pity, so that the mark crosses
// the gold of the ring, in each of the five looks: blue on Mist (--w-gold-ink), the gold's own ink on Parchment, and the dark knock-out (--w-gap) on Midnight, Slate and Dusk.
for (const look of ['mist', 'parchment', 'midnight', 'slate', 'dusk'] as const) {
  test(`themes: the soft-pity mark across a filled pity ring on ${look}`, { tag: THEMES }, async ({ page, core, api }) => {
    await api.put('/api/settings', { theme: look })
    await changeAnswer<Pulls>(page, '/api/pulls', (data) => {
      for (const card of data.pity) card.pity = card.soft + 6
    })
    await page.reload()
    await page.setViewportSize({ width: 1640, height: 1100 })
    await page.goto(`${core.origin}/#/pulls`)
    await expect(page.getByTestId('pity-card')).toHaveCount(4)
    await shot(page, `pity-past-soft-${look}`, { only: page.getByTestId('pity-card').first() })
  })
}

// The soft-pity mark across a gold 5-star ring on Mist, close up.
test('themes: the soft-pity mark across a pity ring on Mist', { tag: THEMES }, async ({ page, core, api }) => {
  await api.put('/api/settings', { theme: 'mist' })
  await page.reload()
  await page.setViewportSize({ width: 1640, height: 1100 })
  await page.goto(`${core.origin}/#/pulls`)
  await expect(page.getByTestId('pity-card')).toHaveCount(4)
  await shot(page, 'pity-card-mist', { only: page.getByTestId('pity-card').first() })
  await shot(page, 'pity-cards-mist-all', { only: page.getByTestId('pity-card').first().locator('xpath=..') })
})
