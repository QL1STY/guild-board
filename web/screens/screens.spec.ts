import type { Browser, Locator, Page } from '@playwright/test'
import path from 'node:path'
import type { Backlog, BacklogRegion, Pulls as PullsModel, Status } from '../src/types.ts'
import { changeAnswer } from '../e2e/answers.ts'
import { setBoard } from '../e2e/board.ts'
import { expect, test, type Api, type Core } from '../e2e/fixtures.ts'
import { SCREENS_OUT } from './out.ts'

const ASSETS = SCREENS_OUT
/**
 * The stage 1b pictures. Only the tests tagged STAGE_1B write here, and only `npm run screens:1b` runs them.
 * `npm run screens` runs every other test.
 */
const FOLDER = path.join(ASSETS, '2026-10-13-stage-1b-screens')
const STAGE_1B = '@1b'
/**
 * The pictures of the Achievements page and its settings, Timers, Commissions, the Board and Stats, which only
 * `npm run screens` takes.
 */
const FOLDER_2A = path.join(ASSETS, '2026-10-19-stage-2a-screens')
/**
 * The look pass's pictures, to be looked at once the motion has settled. Only the tests
 * tagged LOOK write here, and only `npm run screens:look` runs them.
 */
const FOLDER_LOOK = path.join(ASSETS, '2026-10-22-look-pass-screens')
const LOOK = '@look'
/**
 * The overlay's pictures, to be looked at. Only the tests tagged OVERLAY
 * write here, and only `npm run screens:overlay` runs them.
 */
const FOLDER_OVERLAY = path.join(ASSETS, '2026-10-23-overlay-screens')
const OVERLAY = '@overlay'
/**
 * The scaling pass's pictures, to be looked at. Only the tests
 * tagged SCALING write here, and only `npm run screens:scaling` runs them.
 */
const FOLDER_SCALING = path.join(ASSETS, '2026-10-23-scaling-screens')
const SCALING = '@scaling'
/**
 * The Pulls pictures, to be looked at. Only the tests tagged PULLS write here, and only `npm run screens:pulls` runs them.
 */
const FOLDER_PULLS = path.join(ASSETS, '2026-10-23-pulls-screens')
const PULLS = '@pulls'
/**
 * The top bar's and the undo note's pictures, to be looked at. Only the tests tagged TOPBAR write here, and only `npm run screens:topbar` runs them.
 */
const FOLDER_TOPBAR = path.join(ASSETS, '2026-10-25-top-bar-screens')
const TOPBAR = '@topbar'
/**
 * The Characters pictures, to be looked at: the roster, the profile, the planner, the week, the endgame, the Today widget
 * and the overlay. Only the tests tagged CHARACTERS
 * write here, and only `npm run screens:characters` runs them.
 */
const FOLDER_CHARACTERS = path.join(ASSETS, '2026-10-25-characters-screens')
const CHARACTERS = '@characters'

/**
 * Waits until the page's motion has settled (look pass spec 6.3): no animation or transition runs, a delayed one
 * included, and every counted number shows its value. A picture then catches no ring half filled and no number on
 * its way.
 */
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
 * Makes the window `width` pixels wide and as tall as the page, so that the rail reaches the bottom, but no taller than
 * `maxHeight`: a longer page is pictured from its top. A page can grow with the window: the Achievements page's
 * categories column is as tall as the window lets it be (achievements.css). So the window grows until the page fits in
 * it, and the column then shows its end.
 */
async function fit(page: Page, width: number, maxHeight = Infinity): Promise<void> {
  // Measured at this width, in a short window: the page is never shorter than the window.
  let height = Math.min(900, maxHeight)
  await page.setViewportSize({ width, height })
  await page.evaluate(async () => {
    await document.fonts.ready
  })
  // No image is caught on its way: each has loaded, or failed and hidden itself, as the demo's primogem icons do.
  await page.waitForFunction(() =>
    [...document.images].every((image) => image.hidden || (image.complete && image.naturalWidth > 0)),
  )
  // A panel that still grows, or widgets that still glide to the window's columns, change what is measured.
  await settled(page)
  // Each round adds what the page outgrew the window by, about 150 pixels on the Achievements page. The rounds are
  // counted, so that a page that outgrows every window, by a mistake in its layout, ends the run instead of the loop
  // going on.
  for (let round = 0; ; round += 1) {
    const needed = Math.min(maxHeight, await page.evaluate(() => document.documentElement.scrollHeight))
    if (needed <= height) break
    if (round === 50) throw new Error(`After ${round} rounds the page still outgrows a window ${height} pixels tall.`)
    height = needed
    await page.setViewportSize({ width, height })
  }
  await page.evaluate(() => window.scrollTo(0, 0))
}

/**
 * Takes the picture into `folder`, once the page's motion has settled. A test tagged STAGE_1B writes only into the
 * stage 1b folder, one tagged LOOK only into the look pass's, one tagged OVERLAY only into the overlay's, one tagged
 * SCALING only into the scaling pass's, one tagged PULLS only into the Pulls pictures', one tagged TOPBAR only into the
 * top bar's, one tagged CHARACTERS only into the Characters pictures', and no other test writes into any of them, so the commands never take each other's pictures.
 */
async function picture(page: Page, name: string, folder: string, part?: Locator): Promise<void> {
  const owners: [string, string][] = [
    [STAGE_1B, FOLDER], [LOOK, FOLDER_LOOK], [OVERLAY, FOLDER_OVERLAY], [SCALING, FOLDER_SCALING],
    [PULLS, FOLDER_PULLS], [TOPBAR, FOLDER_TOPBAR], [CHARACTERS, FOLDER_CHARACTERS],
  ]
  for (const [tag, owned] of owners) {
    const rule = `only a test tagged ${tag} writes into ${path.basename(owned)}, and it writes nowhere else`
    expect(test.info().tags.includes(tag), `${name}.png goes into ${path.basename(folder)}: ${rule}`).toBe(folder === owned)
  }
  await settled(page)
  // With `part`, the picture is that element alone.
  await (part ?? page).screenshot({ path: path.join(folder, `${name}.png`) })
}

/** The whole page in one picture, `width` pixels wide (fit), with no tooltip in it. */
async function shoot(page: Page, name: string, width = 1440, folder = FOLDER, maxHeight = Infinity): Promise<void> {
  await fit(page, width, maxHeight)
  await page.mouse.move(0, 0) // no tooltip in the picture
  await picture(page, name, folder)
}

/**
 * Opens Settings and waits until all it shows is read: the sync log's 50 runs, and the Achievements section's list
 * line, which Settings reads apart from the sync log.
 */
async function openSettings(page: Page, origin: string): Promise<void> {
  await page.goto(`${origin}/#/settings`)
  await page.getByRole('button', { name: 'Show the sync log' }).click()
  await expect(page.getByRole('region', { name: 'Sync log' }).getByRole('row')).toHaveCount(51)
  const list = page.getByRole('region', { name: 'Achievements' }).getByText(/^Achievement list version /)
  await expect(list).toBeVisible()
}

// The stage 1b pictures, which only `npm run screens:1b` takes.

test('backlog', { tag: STAGE_1B }, async ({ page, core }) => {
  await page.goto(`${core.origin}/#/backlog`)
  await expect(page.getByTestId('region')).toHaveCount(6)
  await shoot(page, 'backlog')
})

test('stats', { tag: STAGE_1B }, async ({ page, core }) => {
  await page.goto(`${core.origin}/#/stats`)
  await expect(page.getByRole('region', { name: 'Endgame' }).getByRole('row')).toHaveCount(4)
  await shoot(page, 'stats')
})

test('settings', { tag: STAGE_1B }, async ({ page, core }) => {
  await openSettings(page, core.origin)
  await shoot(page, 'settings')
})

test('a verification check', { tag: STAGE_1B }, async ({ page, api }) => {
  await api.fault('verification_needed')
  await api.sync()
  await expect(page.getByTestId('banner')).toContainText('verification check')
  await shoot(page, 'banner-verification')
})

test.describe('first run', () => {
  test.use({ firstRun: true })

  test('first run', { tag: STAGE_1B }, async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Welcome to Guild Board')
    await shoot(page, 'first-run')
  })
})

// The stage 2A pictures, which `npm run screens` takes.

/**
 * How far down the opening category is pictured: the demo's opening category holds about 288 groups, a page over
 * 10,000 pixels tall. The categories column ends further down, so the Pinned picture, whose cards are few, is the one
 * taken whole, with the column's end.
 */
const ACHIEVEMENTS_HEIGHT = 2400

test('achievements', async ({ page, core }) => {
  await page.goto(`${core.origin}/#/achievements`)
  await expect(page.getByTestId('ach-group').nth(3)).toBeVisible() // 4 or more
  await shoot(page, 'achievements-1440', 1440, FOLDER_2A, ACHIEVEMENTS_HEIGHT)
  await shoot(page, 'achievements-2560', 2560, FOLDER_2A, ACHIEVEMENTS_HEIGHT)
})

test('achievements pinned', async ({ page, core }) => {
  await page.goto(`${core.origin}/#/achievements`)
  const categories = page.getByRole('navigation', { name: 'Categories' })
  await categories.getByRole('button', { name: 'Pinned' }).click()
  await expect(page.getByTestId('ach-group')).toHaveCount(3)
  await shoot(page, 'achievements-pinned', 1440, FOLDER_2A) // no cap: the window grows to hold the whole column
  // The picture shows the end of the categories column, where the complete categories fold away (spec 12.3).
  await expect(categories.getByRole('button', { name: 'Show 3 complete categories' })).toBeInViewport({ ratio: 1 })
})

test('settings achievements', async ({ page, core }) => {
  await openSettings(page, core.origin)
  await expect(page.getByRole('region', { name: 'Your data' }).getByTestId('import-panel')).toBeVisible()
  await shoot(page, 'settings-achievements', 1440, FOLDER_2A)
  await shoot(page, 'settings-achievements-2560', 2560, FOLDER_2A)
})

/*
 * Plan 2A-2's special categories, compared with the stage 2A spec (sections 9.2, 11.1 and 12.1), and Timers also with
 * the accepted mockup's groups: Ready now, Running, Your own timers. As for Pinned, the window grows to hold the whole
 * categories column.
 */

/** Opens the Timers category and waits until its groups are read. */
async function openTimers(page: Page, origin: string): Promise<void> {
  await page.goto(`${origin}/#/achievements/timers`)
  await expect(page.getByTestId('timers').getByRole('heading', { level: 3 }))
    .toHaveText(['Ready now 2', 'Running 4', 'Your own timers 2'])
}

/** Opens Daily commissions on the region in Settings, Liyue, and waits until its cards are read. */
async function openCommissions(page: Page, origin: string): Promise<void> {
  await page.goto(`${origin}/#/achievements/commissions`)
  await expect(page.getByTestId('commission').getByRole('heading', { level: 3 }))
    .toHaveText(['Pirates! Argh!', "All's Well That Ends Well", 'Swordseeker'])
}

test('timers', async ({ page, core }) => {
  await openTimers(page, core.origin)
  await shoot(page, 'timers-1440', 1440, FOLDER_2A)
})

test('timers at 2560', async ({ page, core }) => {
  await openTimers(page, core.origin)
  await shoot(page, 'timers-2560', 2560, FOLDER_2A)
})

test('commissions', async ({ page, core }) => {
  await openCommissions(page, core.origin)
  await shoot(page, 'commissions-1440', 1440, FOLDER_2A)
})

test('commissions at 2560', async ({ page, core }) => {
  await openCommissions(page, core.origin)
  await shoot(page, 'commissions-2560', 2560, FOLDER_2A)
})

/** Opens the Board, spec 13.2's starting one, and waits until each widget has read its data. */
async function openBoard(page: Page, origin: string): Promise<void> {
  await page.goto(`${origin}/#/board`)
  await expect(page.getByTestId('board').locator('[data-widget] .w-name')).toHaveCount(8)
  await expect(page.locator('[data-widget="start-notes"] textarea')).toHaveValue('Fishing: Luhua Pool comes back on Friday.')
  await expect(page.locator('[data-widget="start-timers"] li.tm-row')).toHaveCount(8)
  await expect(page.locator('[data-widget="start-pinned"] li.pn-row')).toHaveCount(3)
  await expect(page.locator('[data-widget="start-expeditions"] li')).toHaveCount(5)
}

test('board', async ({ page, core }) => {
  await openBoard(page, core.origin)
  await shoot(page, 'board-1440', 1440, FOLDER_2A)
})

test('board at 2560', async ({ page, core }) => {
  await openBoard(page, core.origin)
  await shoot(page, 'board-2560', 2560, FOLDER_2A)
})

test('board edit', async ({ page, core }) => {
  await openBoard(page, core.origin)
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await page.getByRole('button', { name: 'Add a widget' }).click()
  await expect(page.getByRole('region', { name: 'Add a widget' })).toBeVisible()
  await shoot(page, 'board-edit-1440', 1440, FOLDER_2A)
})

/*
 * Stage 1's Backlog and Stats at 2,560 pixels, compared with the stage 2A spec, sections 3 and 12.1: the top bar keeps
 * the frame's 1,912 pixels, and their content 1,440, the width their rows and tables are made for (frame.css).
 */

test('backlog at 2560', async ({ page, core }) => {
  await page.goto(`${core.origin}/#/backlog`)
  await expect(page.getByTestId('region')).toHaveCount(6)
  await shoot(page, 'backlog-2560', 2560, FOLDER_2A)
})

test('stats at 2560', async ({ page, core }) => {
  await page.goto(`${core.origin}/#/stats`)
  await expect(page.getByRole('region', { name: 'Endgame' }).getByRole('row')).toHaveCount(4)
  await shoot(page, 'stats-2560', 2560, FOLDER_2A)
})

/*
 * The look pass's pictures, which only `npm run screens:look` takes, compared with the look pass spec and its mockup:
 * the Board, at rest and in Edit with a widget being dragged; the Achievements page with an achievement's panel open;
 * Timers and Daily commissions; Stats; and the Backlog. Each is taken once its opening motion has played.
 */

test('look: board', { tag: LOOK }, async ({ page, core }) => {
  await openBoard(page, core.origin)
  await shoot(page, 'board-1440', 1440, FOLDER_LOOK)
  await shoot(page, 'board-2560', 2560, FOLDER_LOOK)
})

test('look: board edit, a widget dragged', { tag: LOOK }, async ({ page, core }) => {
  await openBoard(page, core.origin)
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await expect(page.locator('#board-help')).toBeVisible()
  await fit(page, 1440)
  // Resets is taken onto the Clock's cell, column 3 of row 7, and held a little past it, less than half a cell: it is
  // lifted under the pointer, the gold outline shows the cell where it would land, and the Clock has slid down out of
  // its way.
  const resets = page.locator('[data-widget="start-resets"]')
  const [box, head, board] = await Promise.all([
    resets.boundingBox(),
    resets.locator('.w-head').boundingBox(),
    page.getByTestId('board').boundingBox(),
  ])
  const grab = { x: head!.x + 12, y: head!.y + head!.height / 2 }
  await page.mouse.move(grab.x, grab.y)
  await page.mouse.down()
  await page.mouse.move(board!.x + 2 * 180 + grab.x - box!.x + 64, board!.y + 6 * 108 + grab.y - box!.y + 34, { steps: 8 })
  await expect(resets).toContainClass('lifted')
  await expect(page.getByTestId('board').locator('.board-landing')).toBeVisible()
  await picture(page, 'board-edit-drag-1440', FOLDER_LOOK)
  await page.mouse.up()
})

/** Opens the Achievements page on its opening category, with the first achievement's panel open under its row. */
async function openAchievementPanel(page: Page, origin: string): Promise<void> {
  await page.goto(`${origin}/#/achievements`)
  const card = page.getByRole('article', { name: "It's Yesterday Once More" })
  await card.getByRole('button', { name: '3 stages' }).click()
  await expect(page.getByRole('region', { name: "It's Yesterday Once More" })).toBeVisible()
}

test('look: achievements with a panel open', { tag: LOOK }, async ({ page, core }) => {
  await openAchievementPanel(page, core.origin)
  await shoot(page, 'achievements-1440', 1440, FOLDER_LOOK, ACHIEVEMENTS_HEIGHT)
  await shoot(page, 'achievements-2560', 2560, FOLDER_LOOK, ACHIEVEMENTS_HEIGHT)
})

test("look: an achievement's parts as chips", { tag: LOOK }, async ({ page, core }) => {
  // The opening category's checklists are far down its list: a search shows one with four parts as chips.
  await page.goto(`${core.origin}/#/achievements`)
  await page.getByRole('searchbox', { name: 'Search achievements' }).fill('favonius')
  await expect(page.getByRole('article', { name: 'In the Name of Favonius' }).locator('.ach-chip')).toHaveCount(4)
  await shoot(page, 'achievements-chips-1440', 1440, FOLDER_LOOK, 900) // the card is at the top: the column's end is not needed
})

test('look: timers at 2560', { tag: LOOK }, async ({ page, core }) => {
  await openTimers(page, core.origin)
  await shoot(page, 'timers-2560', 2560, FOLDER_LOOK)
})

test('look: commissions at 2560', { tag: LOOK }, async ({ page, core }) => {
  await openCommissions(page, core.origin)
  await shoot(page, 'commissions-2560', 2560, FOLDER_LOOK)
})

test('look: stats at 2560', { tag: LOOK }, async ({ page, core }) => {
  await page.goto(`${core.origin}/#/stats`)
  await expect(page.getByRole('region', { name: 'Endgame' }).getByRole('row')).toHaveCount(4)
  await shoot(page, 'stats-2560', 2560, FOLDER_LOOK)
})

test('look: backlog at 2560', { tag: LOOK }, async ({ page, core }) => {
  await page.goto(`${core.origin}/#/backlog`)
  await expect(page.getByTestId('region')).toHaveCount(6)
  await shoot(page, 'backlog-2560', 2560, FOLDER_LOOK)
})

/*
 * The overlay's pictures (plan 2A-4), which only `npm run screens:overlay` takes, compared with the stage 2A spec's
 * section 14 by eye: the overlay's page at 2,560 × 1,440, as its window covers the game's display, on its starting
 * layout, over a stand-in for the game, a bright scene and a dark one. Closed, with the Timers pinned; open; and open in
 * Edit with a widget being dragged.
 */

/**
 * Stand-ins for the game, set on the page's html, which the overlay leaves see-through. Fixed, so that they fill the
 * display: everything on the overlay's page is fixed, and its html has no height of its own.
 */
const GAMES: [name: string, backdrop: string][] = [
  ['light', 'linear-gradient(135deg, #F6F3EA 0%, #CFE3F2 45%, #A8C98F 100%) fixed'],
  ['dark', 'linear-gradient(135deg, #0B1020 0%, #1E2A3A 55%, #26331F 100%) fixed'],
]

/** Opens the overlay's page at `hash`, 2,560 × 1,440, over a stand-in game, once the Timers have read their data. */
async function openOverlay(page: Page, origin: string, hash: string, backdrop: string): Promise<void> {
  await page.setViewportSize({ width: 2560, height: 1440 })
  await page.goto(`${origin}/${hash}`)
  await expect(page.locator('[data-widget="start-ov-timers"] li.tm-row').first()).toBeVisible()
  await page.evaluate((background) => {
    document.documentElement.style.background = background
  }, backdrop)
  await page.evaluate(async () => {
    await document.fonts.ready
  })
  await page.mouse.move(0, 0) // no tooltip in the picture
}

for (const [name, backdrop] of GAMES) {
  test(`overlay: closed, the timers pinned, over a ${name} game`, { tag: OVERLAY }, async ({ page, core }) => {
    await openOverlay(page, core.origin, '#/overlay', backdrop)
    await expect(page.getByTestId('overlay').locator('[data-widget]')).toHaveCount(1)
    await picture(page, `overlay-closed-${name}`, FOLDER_OVERLAY)
  })

  test(`overlay: open, over a ${name} game`, { tag: OVERLAY }, async ({ page, core }) => {
    await openOverlay(page, core.origin, '#/overlay/open', backdrop)
    await expect(page.getByTestId('overlay').locator('[data-widget] .w-name')).toHaveCount(4)
    await expect(page.locator('[data-widget="start-ov-commissions"] li')).not.toHaveCount(0)
    await picture(page, `overlay-open-${name}`, FOLDER_OVERLAY)
  })

  test(`overlay: open in Edit, a widget dragged, over a ${name} game`, { tag: OVERLAY }, async ({ page, core }) => {
    await openOverlay(page, core.origin, '#/overlay/open', backdrop)
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    await expect(page.locator('#overlay-help')).toBeVisible()
    // The Clock is taken from under the Timers to the right of the Commissions, column 7 of row 4, and held a little
    // past it: it is lifted under the pointer, and the gold outline shows the cell where it would land.
    const clock = page.locator('[data-widget="start-ov-clock"]')
    const [box, head, grid] = await Promise.all([
      clock.boundingBox(),
      clock.locator('.w-head').boundingBox(),
      page.getByTestId('overlay').boundingBox(),
    ])
    const grab = { x: head!.x + 12, y: head!.y + head!.height / 2 }
    await page.mouse.move(grab.x, grab.y)
    await page.mouse.down()
    await page.mouse.move(grid!.x + 6 * 180 + grab.x - box!.x + 64, grid!.y + 3 * 108 + grab.y - box!.y + 34, { steps: 8 })
    await expect(clock).toContainClass('lifted')
    await expect(page.getByTestId('overlay').locator('.board-landing')).toBeVisible()
    await picture(page, `overlay-edit-drag-${name}`, FOLDER_OVERLAY)
    await page.mouse.up()
  })
}

test('overlay: its settings, as Guild Board with its window shows them', { tag: OVERLAY }, async ({ page, core }) => {
  // The demo has no shell to report the displays and the hotkey, so the report of a shell on two displays, holding
  // the hotkey, stands in for it (spec 12.5).
  await page.route('**/api/overlay', (route) =>
    route.fulfill({
      json: {
        available: true,
        hotkey: 'Ctrl+Alt+G',
        hotkey_state: 'held',
        displays: [
          { name: '\\\\.\\DISPLAY1', label: 'Display 1, 2560 × 1440, main', primary: true },
          { name: '\\\\.\\DISPLAY2', label: 'Display 2, 2560 × 1440', primary: false },
        ],
        display: '',
      },
    }),
  )
  await openSettings(page, core.origin)
  await page.getByRole('region', { name: 'Guild Board', exact: true }).getByRole('button', { name: 'Change', exact: true }).click()
  const overlay = page.getByRole('group', { name: 'Overlay', exact: true })
  await expect(overlay.getByText('Ctrl+Alt+G opens and closes the overlay.')).toBeVisible()
  // Its row, with the hotkey, sits just above.
  await overlay.evaluate((section) => section.scrollIntoView({ block: 'end' }))
  await page.mouse.move(0, 0) // no tooltip in the picture
  await picture(page, 'overlay-settings', FOLDER_OVERLAY)
})

/*
 * The scaling pass's pictures, which only `npm run screens:scaling` takes, compared with its spec by eye: the Board,
 * Achievements, Stats and the Backlog in the player's usual window, 1,640 × 1,100, and full screen on their 2,560-pixel
 * display, 2,560 × 1,400, as the window's zoom shows them; and the Backlog with every region complete, as the player's
 * map is. Each is what the window shows, from the page's top, once its motion has settled.
 */

/** The window's own size: the picture is what it shows, from the page's top, once the fonts and pictures are in. */
async function inWindow(page: Page, name: string, folder = FOLDER_SCALING): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready
  })
  await page.waitForFunction(() =>
    [...document.images].every((image) => image.hidden || (image.complete && image.naturalWidth > 0)),
  )
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.mouse.move(0, 0) // no tooltip in the picture
  await picture(page, name, folder)
}

/** The pages pictured, each with how it is opened and seen to have read its data. */
const SCALED_PAGES: [name: string, open: (page: Page, origin: string) => Promise<void>][] = [
  ['board', openBoard],
  [
    'achievements',
    async (page, origin) => {
      await page.goto(`${origin}/#/achievements`)
      await expect(page.getByTestId('ach-group').nth(3)).toBeVisible() // 4 or more
    },
  ],
  [
    'stats',
    async (page, origin) => {
      await page.goto(`${origin}/#/stats`)
      await expect(page.getByRole('region', { name: 'Endgame' }).getByRole('row')).toHaveCount(4)
    },
  ],
  [
    'backlog',
    async (page, origin) => {
      await page.goto(`${origin}/#/backlog`)
      await expect(page.getByTestId('region-complete')).toHaveCount(7)
    },
  ],
]

for (const [name, open] of SCALED_PAGES) {
  test(`scaling: ${name} in the usual window`, { tag: SCALING }, async ({ page, core }) => {
    await page.setViewportSize({ width: 1640, height: 1100 })
    await open(page, core.origin)
    await inWindow(page, `${name}-1640`)
  })

  // Full screen on the 2,560-pixel display, the window zooms its page by 2,560 / 1,640 (scaling pass spec, section 5):
  // the page lays out at 1,640 pixels and is drawn 1.56 times larger. A browser of its own does the same, at 1,640 × 897
  // and 2,560 / 1,640 device pixels to a pixel. It is a new context, so it is logged in through the launch link, and the
  // risk statement is marked as read; `api` waits for the sync that runs at start-up to end.
  test(`scaling: ${name} full screen at 2560, zoomed`, { tag: SCALING }, async ({ browser, core, api }) => {
    void api
    const context = await browser.newContext({ viewport: { width: 1640, height: 897 }, deviceScaleFactor: 2560 / 1640 })
    try {
      await context.request.get(core.launch, { maxRedirects: 0 })
      await context.request.put(`${core.origin}/api/settings`, { data: { risk_acknowledged: true } })
      const zoomed = await context.newPage()
      await open(zoomed, core.origin)
      await inWindow(zoomed, `${name}-2560`)
    } finally {
      await context.close()
    }
  })
}

/**
 * The player's map, every region complete. The demo has thirteen regions, which are made complete; seven of their
 * areas stand in for the regions it lacks, each after its nation, so that the page holds twenty, as the player's does.
 */
function everyRegionComplete(data: Backlog): void {
  const standIns: [name: string, parent: string][] = [
    ['The Chasm: Underground Mines', 'Liyue'], ['Tsurumi Island', 'Inazuma'], ['Seirai Island', 'Inazuma'],
    ['Desert of Hadramaveth', 'Sumeru'], ['Ancient Sacred Mountain', 'Natlan'], ['Hiisi Island', 'Nod-Krai'],
    ['Coastal tundra', 'Snezhnaya'],
  ]
  const complete = (region: BacklogRegion): BacklogRegion => ({
    ...region,
    pct: 100,
    areas: region.areas.map((area) => ({ ...area, pct: 100 })),
    complete: true,
  })
  const regions = [...data.regions, ...data.complete].sort((one, other) => one.id - other.id).map(complete)
  data.complete = regions.flatMap((region) => [
    region,
    ...standIns.flatMap(([name, parent], index) =>
      parent === region.name ? [{ ...region, id: 100 + index, name, parent, note: '', areas: [] }] : [],
    ),
  ])
  data.regions = []
  data.closest = []
}

test('scaling: the backlog with every region complete, in the usual window', { tag: SCALING }, async ({ page, core }) => {
  await changeAnswer<Backlog>(page, '/api/backlog', everyRegionComplete)
  await page.setViewportSize({ width: 1640, height: 1100 })
  await page.goto(`${core.origin}/#/backlog`)
  await expect(page.getByTestId('region-complete')).toHaveCount(20)
  await inWindow(page, 'backlog-all-complete-1640')
  // Twenty complete regions leave the side column on the first screen (the scaling plan's review focus 5).
  const archon = await page.getByRole('region', { name: 'Archon Quests' }).boundingBox()
  expect(archon!.y + archon!.height).toBeLessThanOrEqual(1100)
})

/*
 * The Pulls pictures (the Pulls plan, Task 13), which only `npm run screens:pulls` takes, compared with the Pulls design
 * and its mockups by eye: the page in the player's usual window, 1,640 × 1,100, and full screen on their 2,560-pixel
 * display, as the window's zoom shows it; the six widgets on the Board; and the page before any import, on a core
 * without a login. Each is what the window shows, from the page's top, once its motion has settled. The demo's history
 * is made up; nothing in them is the player's.
 *
 * The second pass (the Pulls second pass, spec 8) adds the parts of the page that lie under the first window, each with
 * the window scrolled to it, as the player scrolls: the Savings ledger beside the planner, which end level, and the
 * history with its luck tiles and the graph of the wishes each month, in both window sizes; and the ledger with no
 * balance set, with the events form open, beside a wishlist of six and beside one longer than the card holds; the graph
 * with a tooltip and as a table. The ledger is compared with the accepted mockup (savings-chosen.html).
 */

/** Opens the Pulls page and waits until it has read its model: the strip's banners, the cards and the history's rows. */
async function openPulls(page: Page, origin: string): Promise<void> {
  await page.goto(`${origin}/#/pulls`)
  await expect(page.getByTestId('pulls-banner')).toHaveCount(3)
  await expect(page.getByTestId('pity-card')).toHaveCount(4)
  await expect(page.getByTestId('history-row')).toHaveCount(100)
}

/**
 * The window scrolled to a part of the page (by its test id), as the player scrolls to it, with the part 12 pixels under
 * the window's top: the picture is what it shows, once the fonts and pictures are in and the motion has settled. With
 * `over`, the pointer is on that element, for a tooltip; else it is out of the window, so that no tooltip is in the
 * picture.
 */
async function inWindowAt(page: Page, name: string, testid: string, over?: Locator): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready
  })
  await page.waitForFunction(() =>
    [...document.images].every((image) => image.hidden || (image.complete && image.naturalWidth > 0)),
  )
  await page.evaluate((id) => {
    const top = document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect().top + window.scrollY
    window.scrollTo(0, Math.max(0, top - 12))
  }, testid)
  if (over === undefined) await page.mouse.move(0, 0)
  else await over.hover()
  await picture(page, name, FOLDER_PULLS)
}

test('pulls: the page in the usual window', { tag: PULLS }, async ({ page, core }) => {
  await page.setViewportSize({ width: 1640, height: 1100 })
  await openPulls(page, core.origin)
  await inWindow(page, 'pulls-1640', FOLDER_PULLS)
})

test('pulls: the ledger beside the planner, and the history, in the usual window', { tag: PULLS }, async ({ page, core }) => {
  await page.setViewportSize({ width: 1640, height: 1100 })
  await openPulls(page, core.origin)
  await inWindowAt(page, 'pulls-ledger-1640', 'pulls-savings')
  await inWindowAt(page, 'pulls-history-1640', 'pulls-history')
})

test('pulls: the ledger with the events form open and both switches on', { tag: PULLS }, async ({ page, core }) => {
  await page.setViewportSize({ width: 1640, height: 1100 })
  await openPulls(page, core.origin)
  const savings = page.getByTestId('pulls-savings')
  const hymn = savings.getByRole('button', { name: 'Gnostic Hymn' })
  if ((await hymn.getAttribute('aria-pressed')) !== 'true') await hymn.click()
  await expect(hymn).toHaveAttribute('aria-pressed', 'true')
  const welkin = savings.getByRole('button', { name: 'Blessing of the Welkin Moon' })
  if ((await welkin.getAttribute('aria-pressed')) !== 'true') await welkin.click()
  await expect(welkin).toHaveAttribute('aria-pressed', 'true')
  await savings.getByRole('button', { name: 'Type the events count' }).click()
  await expect(savings.getByLabel('Events, as the community counts them')).toBeFocused()
  await inWindowAt(page, 'pulls-ledger-form-1640', 'pulls-savings')
})

test('pulls: the ledger with no balance set', { tag: PULLS }, async ({ page, core }) => {
  await changeAnswer<PullsModel>(page, '/api/pulls', (data) => {
    Object.assign(data.savings, { set: null, pulls: null, estimated: null, by_next_end: null })
  })
  await page.setViewportSize({ width: 1640, height: 1100 })
  await openPulls(page, core.origin)
  await expect(page.getByTestId('pulls-savings')).toContainText('Type your primogems and fates to see your savings as pulls.')
  await inWindowAt(page, 'pulls-ledger-nobalance-1640', 'pulls-savings')
})

test('pulls: the ledger beside a wishlist of six', { tag: PULLS }, async ({ page, core, api }) => {
  for (const name of ['Mavuika', 'Furina', 'Navia', 'Xiangling', 'Clorinde']) {
    await api.post('/api/pulls/wishlist', { name, kind: 'character', about: '2026-12-05', copies: 1 })
  }
  await page.setViewportSize({ width: 1640, height: 1100 })
  await openPulls(page, core.origin)
  await expect(page.getByTestId('pulls-wishlist').getByRole('listitem')).toHaveCount(6)
  await inWindowAt(page, 'pulls-ledger-six-1640', 'pulls-savings')
})

test('pulls: a wishlist longer than the planner holds', { tag: PULLS }, async ({ page, core, api }) => {
  const names = ['Mavuika', 'Furina', 'Navia', 'Xiangling', 'Clorinde', 'Arlecchino', 'Kinich', 'Chasca', 'Mualani', 'Xilonen']
  for (const name of [...names, 'Dehya', 'Alhaitham', 'Cyno']) {
    await api.post('/api/pulls/wishlist', { name, kind: 'character', about: '2026-12-05', copies: 1 })
  }
  await page.setViewportSize({ width: 1640, height: 1100 })
  await openPulls(page, core.origin)
  await expect(page.getByTestId('pulls-wishlist').getByRole('listitem')).toHaveCount(14)
  await inWindowAt(page, 'pulls-ledger-long-1640', 'pulls-savings')
})

test('pulls: the months with a tooltip, and as a table', { tag: PULLS }, async ({ page, core }) => {
  await page.setViewportSize({ width: 1640, height: 1100 })
  await openPulls(page, core.origin)
  const months = page.getByTestId('pulls-months')
  // A month's character segment, with the tooltip the pointer over it shows.
  const segment = months.getByTestId('months-hit').and(page.locator('[data-wish="character"]')).nth(2)
  await inWindowAt(page, 'pulls-months-tip-1640', 'pulls-history', segment)
  await months.getByRole('button', { name: 'Show as a table' }).click()
  await inWindowAt(page, 'pulls-months-table-1640', 'pulls-history')
})

// Full screen on the 2,560-pixel display, as the scaling pass's pictures take it: a browser of its own at 1,640 × 897
// and 2,560 / 1,640 device pixels to a pixel, logged in through the launch link, with the risk statement read.
test('pulls: the page full screen at 2560, zoomed', { tag: PULLS }, async ({ browser, core, api }) => {
  void api
  const context = await browser.newContext({ viewport: { width: 1640, height: 897 }, deviceScaleFactor: 2560 / 1640 })
  try {
    await context.request.get(core.launch, { maxRedirects: 0 })
    await context.request.put(`${core.origin}/api/settings`, { data: { risk_acknowledged: true } })
    const zoomed = await context.newPage()
    await openPulls(zoomed, core.origin)
    await inWindow(zoomed, 'pulls-2560', FOLDER_PULLS)
    await inWindowAt(zoomed, 'pulls-ledger-2560', 'pulls-savings')
    await inWindowAt(zoomed, 'pulls-history-2560', 'pulls-history')
  } finally {
    await context.close()
  }
})

test('pulls: the six widgets on the Board', { tag: PULLS }, async ({ page, api }) => {
  await page.setViewportSize({ width: 1640, height: 1100 })
  // Each at the size it is added at, in the eight columns the usual window gives the Board.
  await setBoard(api, page, [
    { id: 'pulls-wishing-now', type: 'wishing-now', w: 3, h: 2, x: 0, y: 0, settings: {} },
    { id: 'pulls-pity', type: 'pity', w: 2, h: 2, x: 3, y: 0, settings: {} },
    { id: 'pulls-savings', type: 'savings', w: 2, h: 2, x: 5, y: 0, settings: {} },
    { id: 'pulls-luck', type: 'luck', w: 1, h: 2, x: 7, y: 0, settings: {} },
    { id: 'pulls-wishlist', type: 'wishlist', w: 2, h: 2, x: 0, y: 2, settings: {} },
    { id: 'pulls-last', type: 'last-pulls', w: 2, h: 2, x: 2, y: 2, settings: {} },
  ])
  await expect(page.locator('[data-widget="pulls-wishing-now"]')).toContainText("Void Star's Advent")
  await expect(page.locator('[data-widget="pulls-pity"] .ring')).toContainText('61')
  await expect(page.locator('[data-widget="pulls-savings"]')).toContainText('75 pulls')
  await expect(page.locator('[data-widget="pulls-luck"]')).toContainText('average 5★ pity')
  await expect(page.locator('[data-widget="pulls-wishlist"]')).toContainText('Citlali')
  await expect(page.locator('[data-widget="pulls-last"] .lp-face')).toHaveCount(12)
  await inWindow(page, 'pulls-widgets-1640', FOLDER_PULLS)
})

test.describe('pulls: before any import', () => {
  test.use({ mode: 'live' })

  test('pulls: the page before any import', { tag: PULLS }, async ({ page, core }) => {
    await page.setViewportSize({ width: 1640, height: 1100 })
    await page.goto(`${core.origin}/#/pulls`)
    await expect(page.getByText('No wish history yet. Open Wish → History in the game, then press Import.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeVisible()
    await inWindow(page, 'pulls-empty-1640', FOLDER_PULLS)
  })
})

/*
 * The top bar's and the undo note's pictures (the top bar and undo plan, Task 5), which only `npm run screens:topbar`
 * takes, compared with the design's sections 3 to 6 and its accepted mockup (arrangement B) by eye: the top bar with
 * its plate in each row of the design's table of sync states; the rail's profile card, with an account and without
 * one; the profile panel and the sync panel open; and the note after a tick, after an undo and as a refusal, on the
 * Achievements page and on the Board. All are in the player's usual window, 1,640 × 1,100; the plate, the two panels
 * and the notes are also pictured full screen on their 2,560-pixel display, as the window's zoom shows it.
 */

/** The window's top bar alone (title, the page's own controls and the plate), once the fonts and pictures are in. */
async function topBarStrip(page: Page, name: string): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready
  })
  await page.waitForFunction(() =>
    [...document.images].every((image) => image.hidden || (image.complete && image.naturalWidth > 0)),
  )
  await page.mouse.move(0, 0) // no tooltip in the picture
  await picture(page, name, FOLDER_TOPBAR, page.locator('main > header'))
}

/**
 * Shows the status as the test edits it and nothing the event stream says over it; the reload takes it from the start.
 */
async function editedStatus(page: Page, change: (status: Status) => void): Promise<void> {
  await page.route('**/api/events', (route) => route.abort())
  await changeAnswer<Status>(page, '/api/status', change)
  await page.reload()
}

/**
 * The note as it stands: the pointer on it stops its 8 seconds (and its gold line), so that the picture is not too
 * late.
 */
async function noteWindow(page: Page, name: string): Promise<void> {
  const note = page.getByTestId('note')
  await expect(note).toBeVisible()
  await page.evaluate(async () => {
    await document.fonts.ready
  })
  await note.hover()
  await picture(page, name, FOLDER_TOPBAR)
}

/**
 * A browser of its own at 1,640 × 897 and 2,560 / 1,640 device pixels to a pixel, logged in, as the pictures at 2560
 * take it.
 */
async function zoomedPage(browser: Browser, core: Core, use: (page: Page) => Promise<void>): Promise<void> {
  const context = await browser.newContext({ viewport: { width: 1640, height: 897 }, deviceScaleFactor: 2560 / 1640 })
  try {
    await context.request.get(core.launch, { maxRedirects: 0 })
    await context.request.put(`${core.origin}/api/settings`, { data: { risk_acknowledged: true } })
    await use(await context.newPage())
  } finally {
    await context.close()
  }
}

/**
 * A browser of its own for a full screen `width` x `height` on the window's zoom: the page is 1,640 CSS pixels wide and
 * `height` over the zoom tall, at `width / 1,640` device pixels to a pixel. Logged in, as the pictures at 2560 take it.
 */
async function windowPage(browser: Browser, core: Core, width: number, height: number, use: (page: Page) => Promise<void>): Promise<void> {
  const zoom = width / 1640
  const context = await browser.newContext({ viewport: { width: 1640, height: Math.round(height / zoom) }, deviceScaleFactor: zoom })
  try {
    await context.request.get(core.launch, { maxRedirects: 0 })
    await context.request.put(`${core.origin}/api/settings`, { data: { risk_acknowledged: true } })
    await use(await context.newPage())
  } finally {
    await context.close()
  }
}

/** Opens the Board, which shows the top bar of every page, and waits until the plate has read the status. */
async function openTopBar(page: Page, origin: string): Promise<void> {
  await openBoard(page, origin)
  await expect(page.getByTestId('plate')).toContainText(/\d+ \/ 200/)
}

/** Drives the demo core into a sync state; `api.sync()` advances the demo clock past the wait and runs a sync. */
const faulty = (kind: string) => async ({ api }: { api: Api }) => {
  await api.fault(kind)
  await api.sync()
}

/** Each row of the design's table (section 5) that the demo can show, with how the test brings it about. */
type Scene = { page: Page; api: Api; core: Core }
const PLATE_STATES: [name: string, expected: RegExp, drive: (on: Scene) => Promise<void>][] = [
  ['synced-waiting', /again in \d:\d\d/, async () => {}], // the sync at start-up has run: the wait counts
  [
    'synced-ready',
    /\d+ min ago/,
    async ({ page, api }) => {
      await api.advance(301)
      await expect(page.getByRole('button', { name: 'Sync now', exact: true })).toBeEnabled()
    },
  ],
  [
    'daily-limit',
    /daily limit reached/,
    async ({ page }) => {
      await editedStatus(page, (status) => {
        status.sync.runs_today = status.sync.daily_cap
      })
    },
  ],
  [
    'never-synced',
    /Not synced yet/,
    async ({ page }) => {
      await editedStatus(page, (status) => {
        status.sync.last_ok_at = null
      })
    },
  ],
  [
    'syncing',
    /reading HoYoLAB/,
    async ({ page, api }) => {
      await api.fault('slow')
      await api.advance(360)
      const button = page.getByRole('button', { name: 'Sync now', exact: true })
      await expect(button).toBeEnabled()
      await button.click()
      await expect(page.getByTestId('sync')).toContainText('Syncing…')
      // The sign turns and the dot pulses for as long as the sync runs: the picture holds them where they are.
      await page.evaluate(() => document.getAnimations().forEach((animation) => animation.pause()))
    },
  ],
  ['offline', /No connection/, faulty('offline')],
  ['login-needed', /Log in needed/, faulty('login_needed')],
  ['verification-needed', /Check needed/, faulty('verification_needed')],
  [
    'paused',
    /Syncing paused/,
    async ({ api }) => {
      await api.post('/api/sync/pause')
    },
  ],
  ['switch-off', /A switch is off/, faulty('switch_off')],
  ['error', /Sync failed/, faulty('error')],
  [
    'not-connected',
    /Not connected/,
    async ({ page, core }) => {
      core.stop()
      await expect(page.locator('main > .gb-banner[role="alert"]')).toContainText('Guild Board is not answering.', {
        timeout: 15_000,
      })
    },
  ],
]

for (const [name, expected, drive] of PLATE_STATES) {
  test(`topbar: the plate, ${name}`, { tag: TOPBAR }, async ({ page, core, api }) => {
    await page.setViewportSize({ width: 1640, height: 1100 })
    await openTopBar(page, core.origin)
    await drive({ page, api, core })
    await expect(page.getByTestId('plate')).toContainText(expected)
    await expect(page.getByTestId('plate')).toContainText('/ 200') // Resin and the primogems stay in every state
    await expect(page.getByTestId('plate')).toContainText('pulls saved')
    await page.waitForTimeout(400) // an amber part has been drawn
    await topBarStrip(page, `plate-${name}-1640`)
  })
}

test('topbar: the plate when Resin is full and no balance is set', { tag: TOPBAR }, async ({ page, core }) => {
  await page.setViewportSize({ width: 1640, height: 1100 })
  await openTopBar(page, core.origin)
  await editedStatus(page, (status) => {
    status.savings = null
    status.account!.resin = status.account!.resin_max
    status.account!.resin_full_at = status.now
  })
  await expect(page.getByTestId('plate')).toContainText('Set on Pulls')
  await expect(page.getByTestId('plate')).toContainText('Full')
  await topBarStrip(page, 'plate-resin-full-nobalance-1640')
})

test('topbar: the page with its plate, both sizes', { tag: TOPBAR }, async ({ page, core, browser }) => {
  await page.setViewportSize({ width: 1640, height: 1100 })
  await openTopBar(page, core.origin)
  await inWindow(page, 'board-1640', FOLDER_TOPBAR)
  await zoomedPage(browser, core, async (zoomed) => {
    await openTopBar(zoomed, core.origin)
    await inWindow(zoomed, 'board-2560', FOLDER_TOPBAR)
  })
})

test('topbar: the amber plate on a page, both sizes', { tag: TOPBAR }, async ({ page, core, api, browser }) => {
  await api.fault('verification_needed')
  expect(await api.sync()).toBe('verification_needed')
  await page.setViewportSize({ width: 1640, height: 1100 })
  await page.goto(`${core.origin}/#/board`)
  await expect(page.getByTestId('sync')).toContainText('Check needed')
  await expect(page.getByTestId('board').locator('[data-widget] .w-name')).toHaveCount(8)
  await inWindow(page, 'board-amber-1640', FOLDER_TOPBAR)
  await zoomedPage(browser, core, async (zoomed) => {
    await zoomed.goto(`${core.origin}/#/board`)
    await expect(zoomed.getByTestId('sync')).toContainText('Check needed')
    await expect(zoomed.getByTestId('board').locator('[data-widget] .w-name')).toHaveCount(8)
    await inWindow(zoomed, 'board-amber-2560', FOLDER_TOPBAR)
  })
})

test('topbar: the profile card on the rail, with and without an account', { tag: TOPBAR }, async ({ page, core }) => {
  await page.setViewportSize({ width: 1640, height: 1100 })
  await openTopBar(page, core.origin)
  await expect(page.getByTestId('profile')).toContainText('AR 60')
  await page.mouse.move(0, 0)
  await picture(page, 'profile-card-1640', FOLDER_TOPBAR, page.locator('.gb-rail'))
  await editedStatus(page, (status) => {
    status.account = null
  })
  await expect(page.getByTestId('profile')).toContainText('Not logged in')
  await page.mouse.move(0, 0)
  await picture(page, 'profile-card-nologin-1640', FOLDER_TOPBAR, page.locator('.gb-rail'))
})

test('topbar: the profile panel open, both sizes', { tag: TOPBAR }, async ({ page, core, browser }) => {
  await page.setViewportSize({ width: 1640, height: 1100 })
  await openTopBar(page, core.origin)
  await page.getByTestId('profile').click()
  await expect(page.getByTestId('profile-panel')).toBeVisible()
  await inWindow(page, 'profile-panel-1640', FOLDER_TOPBAR)
  await zoomedPage(browser, core, async (zoomed) => {
    await openTopBar(zoomed, core.origin)
    await zoomed.getByTestId('profile').click()
    await expect(zoomed.getByTestId('profile-panel')).toBeVisible()
    await inWindow(zoomed, 'profile-panel-2560', FOLDER_TOPBAR)
  })
})

test('topbar: the sync panel open, both sizes', { tag: TOPBAR }, async ({ page, core, browser }) => {
  await page.setViewportSize({ width: 1640, height: 1100 })
  await openTopBar(page, core.origin)
  await page.getByTestId('sync').locator('.gb-sync-text').click()
  await expect(page.getByTestId('sync-panel')).toBeVisible()
  await inWindow(page, 'sync-panel-1640', FOLDER_TOPBAR)
  await zoomedPage(browser, core, async (zoomed) => {
    await openTopBar(zoomed, core.origin)
    await zoomed.getByTestId('sync').locator('.gb-sync-text').click()
    await expect(zoomed.getByTestId('sync-panel')).toBeVisible()
    await inWindow(zoomed, 'sync-panel-2560', FOLDER_TOPBAR)
  })
})

test('topbar: the sync panel of a switch that is off', { tag: TOPBAR }, async ({ page, core, api }) => {
  await api.fault('switch_off')
  expect(await api.sync()).toBe('switch_off')
  await page.setViewportSize({ width: 1640, height: 1100 })
  await page.goto(`${core.origin}/#/board`)
  await expect(page.getByTestId('sync')).toContainText('A switch is off')
  await expect(page.getByTestId('board').locator('[data-widget] .w-name')).toHaveCount(8)
  await page.getByTestId('sync').getByRole('button', { name: 'How to fix', exact: true }).click()
  await expect(page.getByTestId('sync-panel')).toContainText('Real-Time Notes')
  await inWindow(page, 'sync-panel-switch-off-1640', FOLDER_TOPBAR)
})

// The note on the Achievements page.

const LETTER = "Winter Night's Letter"

/** The Achievements page's note after a tick, after Undo, and as a refusal, in whichever window `page` is. */
async function achievementNotes(page: Page, origin: string, size: string): Promise<void> {
  await page.goto(`${origin}/#/achievements`)
  await expect(page.getByTestId('ach-group').nth(3)).toBeVisible() // 4 or more
  const checkbox = page.getByRole('article', { name: LETTER }).getByRole('checkbox')
  await checkbox.check()
  await expect(page.getByTestId('note').locator('.note-text')).toHaveText(`Ticked ${LETTER}`)
  await noteWindow(page, `note-achievements-ticked-${size}`)
  await page.getByTestId('note').getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(page.getByTestId('note').locator('.note-text')).toHaveText(`Undone: Ticked ${LETTER}`)
  await noteWindow(page, `note-achievements-undone-${size}`)
  await page.keyboard.press('Control+z') // the core holds no earlier change: the note says so, without a button
  await expect(page.getByTestId('note').locator('.note-text')).toHaveText('There is nothing to undo.')
  await noteWindow(page, `note-achievements-nothing-${size}`)
  await page.route('**/api/achievements/stage/*', (route) =>
    route.fulfill({ status: 404, json: { error: 'There is no achievement with this number.' } }),
  )
  await checkbox.click()
  await expect(page.getByRole('alert').getByTestId('note')).toContainText('There is no achievement with this number.')
  await noteWindow(page, `note-achievements-refused-${size}`)
}

test('topbar: the note on the Achievements page, in the usual window', { tag: TOPBAR }, async ({ page, core }) => {
  await page.setViewportSize({ width: 1640, height: 1100 })
  await achievementNotes(page, core.origin, '1640')
})

test('topbar: the note on the Achievements page, full screen', { tag: TOPBAR }, async ({ browser, core }) => {
  await zoomedPage(browser, core, (zoomed) => achievementNotes(zoomed, core.origin, '2560'))
})

// The note on the Board.

const CLEARED = 'Cleared Teapot · Jade Field'

/** The Board's note after a timer is cleared, after Undo, and as a refusal. */
async function boardNotes(page: Page, origin: string, size: string): Promise<void> {
  await openBoard(page, origin)
  const timers = page.locator('[data-widget="start-timers"]')
  const note = page.getByTestId('note')
  await timers.getByRole('button', { name: CLEARED }).click()
  await expect(note.locator('.note-text')).toHaveText(CLEARED)
  await noteWindow(page, `note-board-cleared-${size}`)
  await note.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(note.locator('.note-text')).toHaveText(`Undone: ${CLEARED}`)
  await noteWindow(page, `note-board-undone-${size}`)
  await page.route('**/api/timers/*/cleared', (route) =>
    route.fulfill({ status: 409, json: { error: 'That timer is not ready to be cleared.' } }),
  )
  await timers.getByRole('button', { name: CLEARED }).click()
  await expect(page.getByRole('alert').getByTestId('note')).toContainText('That timer is not ready to be cleared.')
  await expect(timers.getByRole('button', { name: CLEARED })).toBeEnabled() // the page has read its model again
  await noteWindow(page, `note-board-refused-${size}`)
}

test('topbar: the note on the Board, in the usual window', { tag: TOPBAR }, async ({ page, core }) => {
  await page.setViewportSize({ width: 1640, height: 1100 })
  await boardNotes(page, core.origin, '1640')
})

test('topbar: the note on the Board, full screen', { tag: TOPBAR }, async ({ browser, core }) => {
  await zoomedPage(browser, core, (zoomed) => boardNotes(zoomed, core.origin, '2560'))
})


/*
 * The Characters pictures (the Characters plan, Task U9), which only `npm run screens:characters` takes: the pages in the
 * player's usual window, 1,640 × 1,100, and the profile, the week and the endgame also full screen on their 2,560 × 1,400
 * display, as the window's zoom shows it (1,640 × 897 at 2,560 / 1,640 device pixels to a pixel). The demo core starts on
 * Sunday 25 October 2026, 08:00 UTC, with Sandrone, Odette, Alyosha and Jahoda in the focus, as the mockups show them. Each
 * is what the window shows once the fonts and pictures are in and the motion has settled; a long page has a picture for each
 * part, with the window scrolled to it. The demo's characters and pictures are made up.
 */
test.describe('characters', () => {
  // Your week and Endgame are hidden (characters.WEEK_AND_ENDGAME, hidden.ts), so these are the pictures of the shipped build: the
  // rail without Your week, the roster without the Endgame tab. Those two pages' pictures are taken only on request, with
  // GB_SCREENS_WEEK=1, which shows them (they and the Today widget are in `week` below).
  test.use({ demoNow: '2026-10-25T08:00:00+00:00', weekAndEndgame: false })
  const week = process.env.GB_SCREENS_WEEK === '1' ? test.describe : test.describe.skip

  /** What the window shows, scrolled to `part` (12 pixels under the window's top) or to the page's top. */
  async function characters(page: Page, name: string, part?: Locator): Promise<void> {
    await page.evaluate(async () => {
      await document.fonts.ready
    })
    await page.waitForFunction(() =>
      [...document.images].every((image) => image.hidden || (image.complete && image.naturalWidth > 0)),
    )
    await settled(page)
    await page.evaluate(() => window.scrollTo(0, 0))
    if (part !== undefined) {
      await part.evaluate((element) => window.scrollTo(0, element.getBoundingClientRect().top + window.scrollY - 12))
    }
    await page.mouse.move(0, 0) // no tooltip in the picture
    await picture(page, name, FOLDER_CHARACTERS)
  }

  type CharactersPage = {
    name: string
    hash: string
    ready: (page: Page) => Promise<void>
    parts: [name: string, at: (page: Page) => Locator][]
  }

  /** The pages pictured, each with how it is opened and what shows that it has read its data. */
  const PAGES: CharactersPage[] = [
    {
      name: 'roster',
      hash: '#/characters',
      ready: async (page) => {
        await expect(page.locator('.cr-card[data-key="sandrone"]')).toContainText('Level 90')
      },
      parts: [['roster-grid', (page) => page.getByTestId('roster-grid')]],
    },
    {
      name: 'planner',
      hash: '#/characters/sandrone/plan',
      ready: async (page) => {
        await expect(page.locator('.pp-chip.hero b .sr-only')).toHaveText('+35%')
      },
      parts: [['planner-days', (page) => page.locator('.pp-days').first()]],
    },
  ]

  for (const { name, hash, ready, parts } of PAGES) {
    test(`${name} in the usual window`, { tag: CHARACTERS }, async ({ page, core }) => {
      await page.setViewportSize({ width: 1640, height: 1100 })
      await page.goto(`${core.origin}/${hash}`)
      await ready(page)
      await characters(page, `${name}-1640`)
      for (const [part, at] of parts) await characters(page, `${part}-1640`, at(page))
    })
  }

  for (const { name, hash, ready, parts } of PAGES) {
    test(`${name} full screen at 2560`, { tag: CHARACTERS }, async ({ browser, core }) => {
      await zoomedPage(browser, core, async (zoomed) => {
        await zoomed.goto(`${core.origin}/${hash}`)
        await ready(zoomed)
        await characters(zoomed, `${name}-2560`)
        for (const [part, at] of parts) await characters(zoomed, `${part}-2560`, at(zoomed))
      })
    })
  }

  // The player's full screens (the Characters design, 11.7): 2,000 x 1,125 and 2,560 x 1,440 on the window's zoom, which show a
  // page 1,640 CSS pixels wide and about 920 tall. The Characters pages are scaled so that the whole card is on the screen.
  const FULL: [width: number, height: number][] = [
    [2000, 1125],
    [2560, 1440],
  ]
  for (const [width, height] of FULL) {
    test(`the roster, the whole card and the planner full screen at ${width} x ${height}`, { tag: CHARACTERS }, async ({ browser, core }) => {
      await windowPage(browser, core, width, height, async (full) => {
        await full.goto(`${core.origin}/#/characters`)
        await expect(full.locator('.cr-card[data-key="sandrone"]')).toContainText('Level 90')
        await characters(full, `roster-${width}x${height}`)
        await full.goto(`${core.origin}/#/characters/sandrone`)
        await expect(full.locator('.pf-name')).toHaveText('Sandrone')
        await characters(full, `profile-whole-${width}x${height}`)
        await full.goto(`${core.origin}/#/characters/sandrone/plan`)
        await expect(full.locator('.pp-chip.hero b .sr-only')).toHaveText('+35%')
        await characters(full, `planner-${width}x${height}`)
      })
    })
  }

  test('the roster with a search, and a card with the arrows to the characters beside it', { tag: CHARACTERS }, async ({ page, core }) => {
    await page.setViewportSize({ width: 1640, height: 1100 })
    await page.goto(`${core.origin}/#/characters`)
    await expect(page.locator('.cr-card[data-key="sandrone"]')).toContainText('Level 90')
    const box = page.getByRole('textbox', { name: 'Search characters' })
    await box.fill('catalyst')
    await page.getByRole('radio', { name: 'Name', exact: true }).click()
    await expect(page.locator('.cr-card .cr-kind').first()).toContainText('Catalyst')
    await characters(page, 'roster-search-1640')
    // A card from the middle of that list, with its arrows both ways, and the first of it, which has none back.
    const names = await page.locator('.cr-card .cr-name').allTextContents()
    expect(names.length).toBeGreaterThan(2)
    await page.locator('.cr-card a.cr-link').nth(1).click()
    await expect(page.locator('.pf-name')).toHaveText(names[1])
    await expect(page.getByRole('link', { name: `Next character: ${names[2]}` })).toBeVisible()
    await characters(page, 'profile-arrows-1640')
    await page.keyboard.press('ArrowLeft')
    await expect(page.locator('.pf-name')).toHaveText(names[0])
    await expect(page.getByLabel('Previous character: none')).toBeVisible()
    await characters(page, 'profile-arrows-first-1640')
  })

  const PANES: [name: string, label: string][] = [
    ['attributes', 'Attributes'],
    ['weapon', 'Weapon'],
    ['artifacts', 'Artifacts'],
    ['constellation', 'Constellation'],
    ['talents', 'Talents'],
    ['story', 'Story'],
  ]

  test('the profile on each of its six pages, and the Goblet unfolded', { tag: CHARACTERS }, async ({ page, core }) => {
    await page.setViewportSize({ width: 1640, height: 1100 })
    await page.goto(`${core.origin}/#/characters/sandrone`)
    await expect(page.locator('.pf-name')).toHaveText('Sandrone')
    const nav = page.getByRole('navigation', { name: "Sandrone's pages" })
    for (const [name, label] of PANES) {
      await nav.getByRole('button', { name: label }).click()
      await expect(page.locator('.pf-pane')).toBeVisible()
      await characters(page, `profile-${name}-1640`)
    }
    await nav.getByRole('button', { name: 'Attributes' }).click()
    await page.locator('button[data-open="goblet"]').click()
    await expect(page.locator('#pf-unfold')).toBeVisible()
    await characters(page, 'profile-goblet-unfolded-1640')
    await characters(page, 'profile-sheet-1640', page.locator('.pf-sheet'))
  })

  test('the profile full screen at 2560', { tag: CHARACTERS }, async ({ browser, core }) => {
    await zoomedPage(browser, core, async (zoomed) => {
      await zoomed.goto(`${core.origin}/#/characters/sandrone`)
      await expect(zoomed.locator('.pf-name')).toHaveText('Sandrone')
      await characters(zoomed, 'profile-attributes-2560')
      await zoomed.getByRole('navigation', { name: "Sandrone's pages" }).getByRole('button', { name: 'Constellation' }).click()
      await characters(zoomed, 'profile-constellation-2560')
    })
  })

  // Your week, Endgame and the Today widget are hidden (characters.WEEK_AND_ENDGAME): their pictures are taken on request, with
  // GB_SCREENS_WEEK=1, and are not in the folder while they are hidden.
  week('Your week and Endgame, and the Today widget', () => {
    test.use({ weekAndEndgame: true })

    const WEEK_PAGES: CharactersPage[] = [
    {
      name: 'week',
      hash: '#/week',
      ready: async (page) => {
        await expect(page.locator('.wk-sec[data-sec="0"] .wk-step').first()).toBeVisible()
      },
      parts: [['week-grid', (page) => page.locator('.wk-week')]],
    },
    {
      name: 'endgame',
      hash: '#/characters/endgame',
      ready: async (page) => {
        await expect(page.locator('.eg-mode')).toHaveCount(3)
      },
      parts: [['endgame-clear', (page) => page.locator('.eg-clear')]],
    },
    ]

    for (const { name, hash, ready, parts } of WEEK_PAGES) {
      test(`${name} in the usual window`, { tag: CHARACTERS }, async ({ page, core }) => {
        await page.setViewportSize({ width: 1640, height: 1100 })
        await page.goto(`${core.origin}/${hash}`)
        await ready(page)
        await characters(page, `${name}-1640`)
        for (const [part, at] of parts) await characters(page, `${part}-1640`, at(page))
      })
      test(`${name} full screen at 2560`, { tag: CHARACTERS }, async ({ browser, core }) => {
        await zoomedPage(browser, core, async (zoomed) => {
          await zoomed.goto(`${core.origin}/${hash}`)
          await ready(zoomed)
          await characters(zoomed, `${name}-2560`)
          for (const [part, at] of parts) await characters(zoomed, `${part}-2560`, at(zoomed))
        })
      })
    }

  test("your week's focus with its Add a character list open, and the list searched", { tag: CHARACTERS }, async ({ page, core }) => {
    await page.setViewportSize({ width: 1640, height: 1100 })
    await page.goto(`${core.origin}/#/week`)
    await expect(page.locator('.wk-sec[data-sec="0"] .wk-step').first()).toBeVisible()
    await page.getByRole('button', { name: 'Add a character' }).click()
    const list = page.getByRole('dialog', { name: 'Add a character' })
    await expect(list.locator('.wk-opt').first()).toBeVisible()
    await characters(page, 'week-add-1640', page.locator('.wk-top'))
    await list.getByRole('searchbox').fill('fl')
    await expect(list.locator('.wk-opt')).not.toHaveCount(0)
    await characters(page, 'week-add-search-1640', page.locator('.wk-top'))
  })

  test('the endgame after the plans', { tag: CHARACTERS }, async ({ page, core }) => {
    await page.setViewportSize({ width: 1640, height: 1100 })
    await page.goto(`${core.origin}/#/characters/endgame`)
    await expect(page.locator('.eg-mode')).toHaveCount(3)
    const asked = page.waitForResponse((response) => response.url().endsWith('/api/endgame?after=1'))
    await page.getByRole('radio', { name: 'After your plans' }).click()
    await asked
    await expect(page.getByRole('radio', { name: 'After your plans' })).toBeChecked()
    await characters(page, 'endgame-after-1640')
  })

  test('the Board with the Today widget, and the overlay with it', { tag: CHARACTERS }, async ({ page, core, api }) => {
    await page.setViewportSize({ width: 1640, height: 1100 })
    await setBoard(api, page, [
      { id: 'today-board', type: 'today', w: 3, h: 3, x: 0, y: 0, settings: {} },
      { id: 'today-small', type: 'today', w: 3, h: 2, x: 3, y: 0, settings: {} },
      { id: 'today-wide', type: 'today', w: 5, h: 3, x: 0, y: 3, settings: {} },
    ])
    await expect(page.locator('[data-widget="today-board"] .td-row').first()).toContainText('The Doctor, weekly boss')
    await expect(page.locator('[data-widget="today-wide"] .td-faces').first()).toBeVisible()
    await characters(page, 'board-today-1640')
    // On the overlay, over a stand-in for the game, pinned where it stays while the overlay is closed.
    const { revision } = await api.get<{ revision: number }>('/api/layouts/overlay')
    await api.put('/api/layouts/overlay', {
      revision,
      widgets: [{ id: 'ov-today', type: 'today', w: 3, h: 3, x: 0, y: 0, settings: {}, pinned: true }],
    })
    await page.setViewportSize({ width: 2560, height: 1440 })
    await page.goto(`${core.origin}/#/overlay/open`)
    await expect(page.locator('[data-widget="ov-today"] .td-row').first()).toBeVisible()
    await page.evaluate((background) => {
      document.documentElement.style.background = background
    }, GAMES[1][1])
    await page.mouse.move(0, 0)
    await picture(page, 'overlay-today-dark', FOLDER_CHARACTERS)
  })

  })

  test('the Card panel', { tag: CHARACTERS }, async ({ page, core }) => {
    await page.setViewportSize({ width: 1640, height: 1100 })
    await page.goto(`${core.origin}/#/characters/sandrone`)
    await page.getByRole('button', { name: 'Her card' }).click()
    const panel = page.getByRole('dialog')
    await expect(panel).toBeVisible()
    await characters(page, 'card-panel-top-1640')
    // One goal edited, so that the panel shows what "yours" and "Back to the card" look like.
    const crit = panel.locator('.cp-goal', { hasText: 'Crit Rate' }).locator('input')
    await crit.fill('60')
    await crit.press('Enter')
    await expect(panel.locator('[data-group="goals"]').getByText('yours')).toBeVisible()
    await panel.locator('[data-group="goals"]').scrollIntoViewIfNeeded()
    await characters(page, 'card-panel-goals-1640')
    await panel.locator('[data-group="mains"]').scrollIntoViewIfNeeded()
    await panel.locator('.cp-body').evaluate((body) => {
      body.scrollTop = body.querySelector<HTMLElement>('[data-group="mains"]')!.offsetTop - 8
    })
    await characters(page, 'card-panel-mains-1640')
  })
})
