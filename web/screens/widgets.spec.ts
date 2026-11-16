import type { Page, Route } from '@playwright/test'
import path from 'node:path'
import { changeAnswer } from '../e2e/answers.ts'
import { layoutOf, widgetById } from '../e2e/board.ts'
import { expect, test, type Api } from '../e2e/fixtures.ts'
import type { CalendarEvent, CalendarModel, EndgameResetsModel, NextUpModel, Widget } from '../src/types.ts'
import { SCREENS_OUT } from './out.ts'

/*
 * The five widgets' pictures, which only `npm run screens:widgets` takes, to be looked at against the widgets and Friends design
 * (`2026-11-09-guild-board-widgets-and-friends-design.md`, section 2) and its mockup `widgets-friends.html`
 * (`assets/2026-11-09-widgets-friends-mockup/`, sections 1 to 5). Each is what the window shows, once the fonts and pictures are
 * in and the motion has settled, on the demo's day, Tuesday 13 October 2026:
 *   - the Board in the usual window, 1,640 × 1,100, on Parchment: Next up at 2 × 4 and 2 × 2; Primogems at 2 × 2 as it was, at
 *     2 × 2 with Earned for Pulls, at 2 × 3 with all four parts, and its settings in Edit, and Next up's; the Calendar at 6 × 4, 6 × 5, 8 × 5 and, as a
 *     list, 3 × 3, and at 6 × 4 and 3 × 5 with one Coming soon event and the Fandom wiki's dates, with its foot; Endgame resets
 *     (With pictures, the default, then Medallions, Season bars and In order) at 2 × 1, 2 × 2 and 3 × 2, with stand-in pictures,
 *     with the Theater not played and with no pictures kept, and its settings in Edit; Friends online at 2 × 2 and 2 × 1, and signed out;
 *   - the overlay at 2,560 × 1,440 over a light and a dark stand-in for the game, as screens.spec.ts stages them: Next up 2 × 2,
 *     Calendar 2 × 2, Endgame resets 2 × 1 and Friends online 2 × 1, open;
 *   - the Board with all five in each of the five looks and the seven nations.
 * The banners' faces are stand-ins the test draws itself (the route `**\/api/icon/calendar.face.*`): nothing is fetched. The demo's
 * data is made up.
 *
 * They go into the folder 2026-11-15-widgets-screens of the directory GB_SCREENS_DIR names (the design's assets folder, as the
 * Stats pictures do), else of `screenshots`.
 */

const FOLDER = path.join(SCREENS_OUT, '2026-11-15-widgets-screens')
const WIDGETS = '@widgets'
const LOOKS = ['parchment', 'midnight', 'slate', 'dusk', 'mist'] as const
const NATIONS = ['mondstadt', 'liyue', 'inazuma', 'sumeru', 'fontaine', 'natlan', 'snezhnaya'] as const

/** Stand-ins for the game, as screens.spec.ts has them: set on the page's html, which the overlay leaves see-through. */
const GAMES: [name: string, backdrop: string][] = [
  ['light', 'linear-gradient(135deg, #F6F3EA 0%, #CFE3F2 45%, #A8C98F 100%) fixed'],
  ['dark', 'linear-gradient(135deg, #0B1020 0%, #1E2A3A 55%, #26331F 100%) fixed'],
]

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

/** The window's picture, once the fonts and pictures are in and the motion has settled; the pointer is out of the window. */
async function shot(page: Page, name: string, clip?: { x: number; y: number; width: number; height: number }): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready
  })
  await page.waitForFunction(() =>
    [...document.images].every((image) => {
      const box = image.getBoundingClientRect()
      // A picture the page keeps lazy, out of sight in a scrolling list, is not waited for.
      const clip = image.closest('.w-scroll')?.getBoundingClientRect() ?? new DOMRect(0, 0, innerWidth, innerHeight)
      const shown = box.width > 0 && box.height > 0 && box.bottom > clip.top && box.top < clip.bottom && box.right > clip.left && box.left < clip.right
      return image.hidden || !shown || (image.complete && image.naturalWidth > 0)
    }),
  )
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.mouse.move(0, 0)
  await settled(page)
  await page.screenshot({ path: path.join(FOLDER, `${name}.png`), clip })
}

/** A face the test draws: a disc of a colour of its number, with a letter, in the size of a banner's face. Nothing is fetched. */
const FACE_COLOURS = ['#C97B63', '#6E8FC4', '#7FA37A', '#B592C9', '#D4A74A', '#5FA3A8']
function faceSvg(route: Route): Promise<void> {
  const number = Number(/calendar\.face\.(\d+)/.exec(route.request().url())?.[1] ?? 0)
  const colour = FACE_COLOURS[number % FACE_COLOURS.length]
  const letter = String.fromCharCode(65 + (number % 26))
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${colour}"/>` +
    `<circle cx="32" cy="25" r="12" fill="#ffffff" fill-opacity=".55"/><path d="M8 64c2-18 14-24 24-24s22 6 24 24z" fill="#ffffff" fill-opacity=".45"/>` +
    `<text x="32" y="38" font-size="26" font-family="sans-serif" font-weight="700" text-anchor="middle" fill="#2b2b2b" fill-opacity=".7">${letter}</text></svg>`
  return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg })
}

/** Gives the calendar answer's faces addresses in the icon cache's own form, and answers those with drawn stand-ins. Reload after. */
async function standInFaces(page: Page, extra?: (data: CalendarModel) => void): Promise<void> {
  await page.route('**/api/icon/calendar.face.*', faceSvg)
  await changeAnswer<CalendarModel>(page, '/api/calendar', (data) => {
    let count = 0
    for (const banner of data.banners) for (const face of banner.faces) face.icon = `/api/icon/calendar.face.${count++}`
    extra?.(data)
  })
}

/**
 * The Endgame resets widget as a live app shows it once the art cache keeps the pictures: an address for each mode's header (the
 * Stygian's cropped to its flower) and the Theater's medal, answered with stand-ins drawn here; the demo downloads nothing.
 * `notPlayed` leaves the Theater unplayed this cycle. Reload after.
 */
/**
 * The modes' icons, the Stats card's blue emblems: a diamond with four spikes in a white edge, as HoYoLAB draws them, with a small
 * motif that differs by mode and a dot in the picture's top left corner, so that an emblem set off its ring's centre shows. The
 * route for `/api/art/icon-<mode>`.
 */
async function standInIcons(page: Page): Promise<void> {
  const emblem = (mode: string): string => {
    const hue = mode === 'abyss' ? 215 : mode === 'theater' ? 205 : 225
    const motif = mode === 'abyss' ? '<path d="M48 30v36M30 48h36" stroke="#e8f4ff" stroke-width="7" stroke-linecap="round"/>' : mode === 'theater' ? '<circle cx="48" cy="48" r="13" fill="#e8f4ff"/>' : '<path d="M48 28l9 20-9 20-9-20z" fill="#e8f4ff"/>'
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96">' +
      '<path d="M48 2l12 20 22-6-6 22 20 12-20 12 6 22-22-6-12 20-12-20-22 6 6-22L4 48l20-12-6-22 22 6z" fill="#f2f5fa" stroke="#9aa6b8" stroke-width="2"/>' +
      `<path d="M48 14l34 34-34 34-34-34z" fill="hsl(${hue} 75% 45%)" stroke="#1b2540" stroke-width="3"/>${motif}` +
      '<circle cx="3" cy="3" r="3" fill="#e11d74"/></svg>'
    )
  }
  await page.route('**/api/art/icon-*', (route) =>
    route.fulfill({ contentType: 'image/svg+xml', body: emblem(/icon-(\w+)/.exec(route.request().url())?.[1] ?? '') }),
  )
}

/** Next up as a live app answers it once the art cache keeps the modes' icons: an address on each endgame row. */
async function standInModeIcons(page: Page): Promise<void> {
  await standInIcons(page)
  await changeAnswer<NextUpModel>(page, '/api/next-up', (data) => {
    for (const item of data.items) if (item.kind === 'endgame' && item.mode !== null) item.icon = `/api/art/icon-${item.mode}`
  })
}

async function standInEndgame(page: Page, notPlayed = false): Promise<void> {
  await standInIcons(page)
  await page.route('**/api/art/**', (route) => {
    if (route.request().url().includes('/api/art/icon-')) return route.fallback() // the icons' own route, set first
    const key = Number(/\/api\/art\/(\d+)/.exec(route.request().url())?.[1] ?? 0)
    const hue = [210, 330, 170, 45][key % 4]
    const svg =
      key === 3
        ? '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="28" fill="#d9a441"/><circle cx="32" cy="32" r="18" fill="#f3d58a"/></svg>'
        : key === 5 // the Stygian's medal, a stand-in with a ribbon on one side and a notch on top: a medal cut or moved shows
          ? '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><circle cx="64" cy="64" r="58" fill="#c8a24a"/><circle cx="64" cy="64" r="40" fill="#f3d58a"/><path d="M64 38l8 18 20 2-15 13 5 19-18-10-18 10 5-19-15-13 20-2z" fill="#a8742a"/><rect x="4" y="60" width="22" height="8" fill="#a33"/><rect x="60" y="2" width="8" height="16" fill="#333"/></svg>'
        : `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 45% 62%)"/><stop offset="1" stop-color="hsl(${hue + 40} 50% 32%)"/></linearGradient></defs><rect width="800" height="400" fill="url(#g)"/><circle cx="200" cy="200" r="130" fill="#ffffff" fill-opacity=".35"/><path d="M0 400L260 190L430 330L600 130L800 400z" fill="#000000" fill-opacity=".25"/></svg>`
    return route.fulfill({ contentType: 'image/svg+xml', body: svg })
  })
  await changeAnswer<EndgameResetsModel>(page, '/api/endgame-resets', (data) => {
    let at = 0
    const art = () => `/api/art/${String((at += 1)).padStart(32, '0')}`
    for (const mode of data.modes) {
      mode.header = { icon: `/api/art/icon-${mode.mode}`, picture: art(), crop: mode.mode === 'stygian' ? [0, 0, 0.48, 0.84] : null }
      if (mode.mode === 'theater') {
        mode.medal = art()
        mode.medals = 6
        mode.acts_of = 12
      }
      if (mode.mode === 'stygian') mode.medal = art() // the Stats card's official medal of its difficulty
    }
    if (notPlayed) {
      Object.assign(data.modes[1], { played: false, acts: null, acts_of: null, medals: null })
      data.not_played = 1
    }
  })
}

const soonEvent = (name: string): CalendarEvent => ({
  id: null, name, starts: null, ends: null, finished: false, primogems: null, explored: null, double: null, soon: true, status: 1,
  source: 'hoyolab',
})

/** One event with no dates, and one with the wiki's dates (copied from a running event's), and the foot that names the wiki. */
function withSoon(data: CalendarModel): void {
  data.events.push(soonEvent('Stress Block'))
  const { starts, ends } = data.events[2]!
  data.events.push({ ...soonEvent('Ley Line Overflow'), soon: false, source: 'fandom', starts, ends })
  data.upcoming_from = 'Genshin Impact Wiki (Fandom)'
}

const widget = (type: string, id: string, w: number, h: number, x: number, y: number, settings: Record<string, unknown> = {}): Widget => ({
  id, type, w, h, x, y, settings,
})
const nextUp = (id: string, w: number, h: number, x: number, y: number) => widget('next-up', id, w, h, x, y)
const calendar = (id: string, w: number, h: number, x: number, y: number) => widget('calendar', id, w, h, x, y)
const endgameResets = (id: string, w: number, h: number, x: number, y: number, settings: Record<string, unknown> = {}) =>
  widget('endgame-resets', id, w, h, x, y, settings)
const friends = (id: string, w: number, h: number, x: number, y: number) => widget('friends-online', id, w, h, x, y)
const primogems = (id: string, w: number, h: number, x: number, y: number, settings: Record<string, unknown> = {}) =>
  widget('savings', id, w, h, x, y, settings)

/** Puts these widgets on the Board through the core, and opens the page on it at the usual window, 1,640 × 1,100. */
async function openBoard(page: Page, api: Api, origin: string, widgets: Widget[]): Promise<void> {
  const { revision } = await layoutOf(api)
  await api.put('/api/layouts/board', { revision, widgets })
  await page.setViewportSize({ width: 1640, height: 1100 })
  await page.goto(`${origin}/#/board`)
  await page.reload() // the answers a test changed are read by a page that loads after its routes
  await expect(page.getByTestId('board')).toBeVisible()
  for (const one of widgets) await expect(widgetById(page, one.id)).toBeVisible()
}

type BoardScene = { name: string; widgets: Widget[]; prepare?: (page: Page, api: Api) => Promise<void>; after?: (page: Page) => Promise<void> }

const BOARD_SCENES: BoardScene[] = [
  { name: 'nextup', widgets: [nextUp('nu-tall', 2, 4, 0, 0), nextUp('nu-small', 2, 2, 2, 0)] },
  {
    name: 'primogems',
    widgets: [
      primogems('pm-old', 2, 2, 0, 0),
      primogems('pm-earned', 2, 2, 2, 0, { savings: true, pulls: false, earned: true, sources: false }),
      primogems('pm-all', 2, 3, 4, 0, { savings: true, pulls: true, earned: true, sources: true }),
    ],
  },
  {
    name: 'primogems-edit',
    widgets: [primogems('pm-edit', 2, 2, 0, 0)],
    after: async (page) => {
      await page.getByRole('button', { name: 'Edit', exact: true }).click()
      await widgetById(page, 'pm-edit').getByRole('button', { name: 'Settings of Primogems' }).click()
      await expect(page.getByRole('region', { name: 'Settings of Primogems' })).toBeVisible()
    },
  },
  {
    name: 'nextup-edit',
    widgets: [nextUp('nu-edit', 2, 3, 0, 0)],
    after: async (page) => {
      await page.getByRole('button', { name: 'Edit', exact: true }).click()
      await widgetById(page, 'nu-edit').getByRole('button', { name: 'Settings of Next up' }).click()
      await expect(page.getByRole('region', { name: 'Settings of Next up' })).toBeVisible()
    },
  },
  { name: 'calendar-6x4', widgets: [calendar('cal-6x4', 6, 4, 0, 0)], prepare: (page) => standInFaces(page) },
  { name: 'calendar-6x5', widgets: [calendar('cal-6x5', 6, 5, 0, 0)], prepare: (page) => standInFaces(page) },
  { name: 'calendar-8x5', widgets: [calendar('cal-8x5', 8, 5, 0, 0)], prepare: (page) => standInFaces(page) },
  { name: 'calendar-3x3-list', widgets: [calendar('cal-3x3', 3, 3, 0, 0)], prepare: (page) => standInFaces(page) },
  { name: 'calendar-6x5-soon', widgets: [calendar('cal-6x5s', 6, 5, 0, 0)], prepare: (page) => standInFaces(page, withSoon) },
  { name: 'calendar-3x5-list-soon', widgets: [calendar('cal-3x5s', 3, 5, 0, 0)], prepare: (page) => standInFaces(page, withSoon) },
  {
    name: 'endgame',
    widgets: [endgameResets('eg-1', 2, 1, 0, 0), endgameResets('eg-2', 2, 2, 2, 0), endgameResets('eg-3', 3, 2, 4, 0)],
    prepare: (page) => standInEndgame(page),
  },
  {
    name: 'endgame-not-played',
    widgets: [endgameResets('egn-1', 2, 1, 0, 0), endgameResets('egn-2', 2, 2, 2, 0), endgameResets('egn-3', 3, 2, 4, 0)],
    prepare: (page) => standInEndgame(page, true),
  },
  {
    name: 'endgame-no-pictures',
    widgets: [endgameResets('egp-1', 2, 1, 0, 0), endgameResets('egp-2', 2, 2, 2, 0), endgameResets('egp-3', 3, 2, 4, 0)],
  },
  ...(['medallions', 'bars', 'order'] as const).map((style) => ({
    name: `endgame-${style}`,
    widgets: [
      endgameResets('egs-1', 2, 1, 0, 0, { style }),
      endgameResets('egs-2', 2, 2, 2, 0, { style }),
      endgameResets('egs-3', 3, 2, 4, 0, { style }),
    ],
    prepare: (page: Page) => standInEndgame(page),
  })),
  {
    name: 'endgame-edit',
    widgets: [endgameResets('eg-edit', 2, 2, 0, 0)],
    prepare: (page) => standInEndgame(page),
    after: async (page) => {
      await page.getByRole('button', { name: 'Edit', exact: true }).click()
      await widgetById(page, 'eg-edit').getByRole('button', { name: 'Settings of Endgame resets' }).click()
      await expect(page.getByRole('region', { name: 'Settings of Endgame resets' })).toBeVisible()
    },
  },
  {
    name: 'nextup-mode-icons',
    widgets: [
      widget('next-up', 'nu-rail', 3, 5, 0, 0, { style: 'rail' }),
      widget('next-up', 'nu-gauges', 3, 5, 3, 0, { style: 'gauges' }),
      widget('next-up', 'nu-cards', 3, 5, 6, 0, { style: 'cards' }),
    ],
    prepare: (page) => standInModeIcons(page),
  },
  { name: 'friends', widgets: [friends('fr-2x2', 2, 2, 0, 0), friends('fr-2x1', 2, 1, 2, 0)] },
  {
    name: 'friends-signed-out',
    widgets: [friends('fr-out', 2, 2, 0, 0), friends('fr-out1', 2, 1, 2, 0)],
    prepare: async (_page, api) => {
      await api.post('/api/demo/online', { state: 'signed_out' })
    },
  },
]

for (const scene of BOARD_SCENES) {
  test(`widgets: ${scene.name} on the Board`, { tag: WIDGETS }, async ({ page, core, api }) => {
    await scene.prepare?.(page, api)
    await openBoard(page, api, core.origin, scene.widgets)
    await scene.after?.(page)
    await shot(page, `board-${scene.name}`)
  })
}

// The overlay, open, over a light and a dark stand-in for the game: the dark panel's roles on both.
for (const [name, backdrop] of GAMES) {
  test(`widgets: the overlay over a ${name} game`, { tag: WIDGETS }, async ({ page, core, api }) => {
    await standInFaces(page)
    await standInEndgame(page)
    const { revision } = await api.get<{ revision: number }>('/api/layouts/overlay')
    const pinned = (one: Widget): Widget => ({ ...one, pinned: true })
    await api.put('/api/layouts/overlay', {
      revision,
      widgets: [
        pinned(nextUp('ov-nextup', 2, 2, 0, 1)),
        pinned(calendar('ov-cal', 2, 2, 2, 1)),
        pinned(endgameResets('ov-endgame', 2, 1, 4, 1)),
        pinned(friends('ov-friends', 2, 1, 4, 2)),
      ],
    })
    await page.setViewportSize({ width: 2560, height: 1440 })
    await page.goto(`${core.origin}/#/overlay/open`)
    await page.reload()
    for (const id of ['ov-nextup', 'ov-cal', 'ov-endgame', 'ov-friends']) await expect(widgetById(page, id)).toBeVisible()
    await expect(widgetById(page, 'ov-friends')).toContainText('Riley')
    await page.evaluate((background) => {
      document.documentElement.style.background = background
    }, backdrop)
    // The overlay's widgets stand in the top left of the display: the picture is that corner, at full size.
    await shot(page, `overlay-${name}`, { x: 0, y: 0, width: 1700, height: 340 })
  })
}

// The Board with all five (the Calendar at its starting size, 6 × 4), in each of the five looks and the seven nations (api.put('/api/settings', { theme }), as themes.spec.ts does).
const ALL_FIVE: Widget[] = [
  nextUp('all-nextup', 2, 4, 0, 0),
  friends('all-fr', 2, 2, 0, 4),
  calendar('all-cal', 6, 4, 2, 0),
  primogems('all-pm', 3, 3, 2, 4, { savings: true, pulls: true, earned: true, sources: true }),
  endgameResets('all-eg', 3, 2, 5, 4),
]

for (const look of [...LOOKS, ...NATIONS]) {
  test(`widgets: the Board with all five on ${look}`, { tag: WIDGETS }, async ({ page, core, api }) => {
    await api.put('/api/settings', { theme: look })
    await standInFaces(page)
    await openBoard(page, api, core.origin, ALL_FIVE)
    await expect(page.locator('html')).toHaveAttribute('data-theme', look)
    await shot(page, `all-five-${look}`)
  })
}
