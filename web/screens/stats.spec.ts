import type { Locator, Page, Route } from '@playwright/test'
import path from 'node:path'
import { changeAnswer } from '../e2e/answers.ts'
import { SCREENS_OUT } from './out.ts'
import { expect, test, type Core } from '../e2e/fixtures.ts'
import type { EndgameCardModel, YearAnswer } from '../src/types.ts'

/*
 * The Stats pictures, which only `npm run screens:stats` takes (into the 2026-11-06-stats-screens folder of GB_SCREENS_DIR), to be
 * looked at: the Overview with its grids and the Endgame card, a full month and
 * a thin one, the Year and the two pictures Wrapped saves (once: they are the same at either size). Each is what the window shows, in the player's usual window,
 * 1,640 × 1,100, and full screen on their 2,560-pixel display as the window's zoom shows it, once the motion has settled. The
 * account, the months and every number are the demo's, made up.
 *
 * The demo contacts nothing and its art cache serves no picture, so its headers and faces would show their fallbacks. The test
 * alone gives the Endgame card and the Year the addresses a live app has once its art is kept, and answers every `/api/art/<key>` with a
 * stand-in it draws itself (a plain shape in a colour that follows the key): no picture of the game's is made, fetched or kept
 * here. The core is the one the site's screenshots use, which names each picture of the demo's list.
 */

const FOLDER = path.join(SCREENS_OUT, '2026-11-06-stats-screens')
const STATS = '@stats'
const OCTOBER = '2026-10' // the demo's newest month: the full one
const FEBRUARY = '2026-02' // a thin one, before Guild Board ran: its primogems, and its wishes with one 5★

test.use({ siteArt: true })

/** A colour from a key, so that the same picture is the same stand-in every time. */
function hueOf(text: string): number {
  let hash = 0
  for (const letter of text) hash = (hash * 31 + letter.charCodeAt(0)) % 360
  return hash
}

/** The stand-in for a picture: a header, an icon or a portrait, drawn in a colour of the key, with a light shape in it. */
function standIn(key: string): string {
  const hue = hueOf(key)
  const wide = key.startsWith('stand-in-header')
  const [width, height] = wide ? [640, 300] : [256, 256]
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 38% 40%)"/>`,
    `<stop offset="1" stop-color="hsl(${(hue + 40) % 360} 34% 22%)"/></linearGradient></defs>`,
    `<rect width="${width}" height="${height}" fill="url(#g)"/>`,
    `<circle cx="${wide ? width * 0.72 : width / 2}" cy="${height * 0.42}" r="${height * 0.2}" fill="hsl(${hue} 30% 78% / 0.55)"/>`,
    `<path d="M0 ${height} Q ${width * 0.5} ${height * 0.5} ${width} ${height} Z" fill="hsl(${hue} 30% 78% / 0.4)"/>`,
    '</svg>',
  ].join('')
}

const answerArt = (route: Route): Promise<void> => {
  const key = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop() ?? '')
  return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: standIn(key) })
}

/** The Endgame card as a live app gives it once its art is kept: an address of the art cache for every picture. */
function pictured(data: EndgameCardModel): void {
  let at = 0
  const art = (kind: string) => `/api/art/stand-in-${kind}-${(at += 1)}`
  for (const mode of data.modes) {
    mode.header = { icon: art('icon'), picture: art('header'), crop: mode.mode === 'stygian' ? [0, 0, 0.48, 0.84] : null }
    if ('ranks' in mode) for (const rank of mode.ranks ?? []) rank.face = art('face')
    if (mode.mode === 'abyss') for (const group of mode.foes) for (const foe of group.foes) foe.icon = art('enemy')
    if (mode.mode === 'stygian') {
      mode.medal = art('medal')
      for (const boss of mode.bosses) boss.icon = art('boss')
    }
  }
}

/** The Year as a live app gives it once the art is kept: the character of the year has a portrait, and her card a face. */
function portrayed(data: YearAnswer): void {
  if (data.year === null) return
  const portrait = '/api/art/stand-in-portrait-1'
  if (data.year.hero.character !== null) data.year.hero.character.picture = portrait
  if (data.year.poster.character !== null) data.year.poster.character.picture = portrait
  for (const card of data.year.cards) if (card.kind === 'character') card.faces = ['/api/art/stand-in-face-1']
}

/** Waits until no animation or transition runs and every counted number shows its value (look pass spec 6.3). */
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
    { timeout: 30_000 },
  )
}

/** The window's picture. With `at`, the window is first scrolled to that element, 12 pixels under its top. */
async function shot(page: Page, name: string, at?: Locator): Promise<void> {
  if (at === undefined) await page.evaluate(() => window.scrollTo(0, 0))
  else await at.evaluate((element) => window.scrollTo(0, Math.max(0, element.getBoundingClientRect().top + window.scrollY - 12)))
  await page.mouse.move(0, 0) // no tooltip in the picture
  await settled(page)
  await page.screenshot({ path: path.join(FOLDER, `${name}.png`) })
}

/** The Save buttons hand the PNG to the browser as a download where there is no window: the file it holds is the picture saved. */
async function saved(page: Page, button: string, name: string): Promise<void> {
  const download = page.waitForEvent('download')
  await page.getByTestId(button).click()
  await (await download).saveAs(path.join(FOLDER, `${name}.png`))
}

type Scene = {
  name: string
  /** Opens the page and waits until it has read what it shows. */
  open: (page: Page, core: Core) => Promise<void>
  at?: (page: Page) => Locator
  /** What a scene takes besides its picture of the window: the pictures the Save buttons give. */
  more?: (page: Page) => Promise<void>
}

const endgameCard = (page: Page) => page.getByRole('region', { name: 'Endgame' })

async function prepare(page: Page): Promise<void> {
  await page.route('**/api/art/**', answerArt)
  await changeAnswer<EndgameCardModel>(page, '/api/stats/endgame', pictured)
  await changeAnswer<YearAnswer>(page, '/api/stats/year', portrayed)
}

const SCENES: Scene[] = [
  {
    name: 'overview',
    open: async (page, core) => {
      await page.goto(`${core.origin}/#/stats`)
      await expect(page.getByText('Exploration gained')).toBeVisible()
      await expect(endgameCard(page).getByTestId('ec-abyss')).toBeVisible()
    },
  },
  {
    name: 'endgame',
    open: async (page, core) => {
      await page.goto(`${core.origin}/#/stats`)
      await expect(endgameCard(page).getByTestId('ec-stygian')).toBeVisible()
    },
    at: endgameCard,
  },
  {
    name: 'month-full',
    open: async (page, core) => {
      await page.goto(`${core.origin}/#/stats/months/${OCTOBER}`)
      await expect(page.getByTestId('month-strip').getByRole('link', { name: 'Oct 2026 so far' })).toHaveAttribute('aria-current', 'page')
      await expect(page.getByTestId('month-records')).toBeVisible()
    },
  },
  {
    name: 'month-thin',
    open: async (page, core) => {
      await page.goto(`${core.origin}/#/stats/months/${FEBRUARY}`)
      await expect(page.getByTestId('month-strip').getByRole('link', { name: 'Feb 2026' })).toHaveAttribute('aria-current', 'page')
      await expect(page.getByTestId('month-tile-primogems')).toBeVisible()
    },
  },
  {
    name: 'year',
    open: async (page, core) => {
      await page.emulateMedia({ reducedMotion: 'reduce' }) // the poster at rest: its counters at their values, its stage entered
      await page.goto(`${core.origin}/#/stats/year`)
      await expect(page.getByTestId('year-hero')).toBeVisible()
      await expect(page.getByTestId('year-card').first()).toBeVisible()
    },
    // The posters are the same pictures in either window, so they are saved once, from the usual one.
    more: async (page) => {
      await saved(page, 'year-save-story', 'poster-story')
      await saved(page, 'year-save-wide', 'poster-wide')
    },
  },
]

for (const scene of SCENES) {
  test(`stats: ${scene.name} in the usual window`, { tag: STATS }, async ({ page, core }) => {
    await page.setViewportSize({ width: 1640, height: 1100 })
    await prepare(page)
    await scene.open(page, core)
    await shot(page, `${scene.name}-1640`, scene.at?.(page))
    await scene.more?.(page)
  })

  // Full screen on the 2,560-pixel display, the window zooms its page by 2,560 / 1,640 (the scaling pass spec, section 5): a
  // browser of its own does the same, at 1,640 × 897 and 2,560 / 1,640 device pixels to a pixel, logged in through the launch link.
  test(`stats: ${scene.name} full screen at 2560, zoomed`, { tag: STATS }, async ({ browser, core, api }) => {
    void api // the fixture marks the risk statement as read, for every page of this core
    const context = await browser.newContext({ viewport: { width: 1640, height: 897 }, deviceScaleFactor: 2560 / 1640 })
    try {
      await context.request.get(core.launch, { maxRedirects: 0 })
      const zoomed = await context.newPage()
      await prepare(zoomed)
      await scene.open(zoomed, core)
      await shot(zoomed, `${scene.name}-2560`, scene.at?.(zoomed))
    } finally {
      await context.close()
    }
  })
}
