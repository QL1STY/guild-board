import type { Locator, Page } from '@playwright/test'
import type { Achievements, CommissionsModel, Status, TimersModel } from '../src/types.ts'
import { changeAnswer } from './answers.ts'
import { layoutOf, PLAY_WEEK, playAs, setBoard, widgetById, widgetIds } from './board.ts'
import { type Api, expect, test } from './fixtures.ts'

/*
 * The widget frame and each type's sizes (look pass spec 8.1 and 8.2). The browser tests cannot import the registry,
 * which is React, so spec 8.2's table is written out below and the tests hold the registry to it: a widget saved
 * one cell below a type's smallest size, or one above its largest, shows at the table's size; a widget is added at the
 * table's starting size; and at the smallest and the largest size nothing spills out of the frame.
 */

/** A size in cells: its width, then its height. */
type Cells = readonly [w: number, h: number]

type Kind = {
  id: string
  name: string
  min: Cells
  max: Cells
  /** The size it is added at. */
  start: Cells
  /** What its widget needs to draw real content, apart from the demo's data: the settings it is saved with. */
  prepare?: (api: Api) => Promise<Record<string, unknown>>
  /** The widget's own data, kept in the core under its id once the widget is on the Board. */
  data?: Record<string, unknown>
  /**
   * What the page needs before the widget shows, apart from the core's data: edits of the answers it reads, for a type
   * whose content depends on something of the player's PC (the game running), which a test does not read.
   */
  show?: (page: Page) => Promise<void>
  /** Waits until the widget shows what it read, not the line it shows while it reads. */
  loaded: (frame: Locator) => Promise<void>
}

/** The demo's longest timer name, which a One timer has to fit in a header and in its body. */
const LONG_TIMER = 'Fishing spot · Luhua Pool, Liyue'

const TYPES: readonly Kind[] = [
  {
    id: 'timers', name: 'Timers', min: [3, 2], max: [6, 5], start: [4, 3],
    loaded: (frame) => expect(frame.getByRole('listitem')).toHaveCount(8),
  },
  {
    id: 'one-timer', name: 'One timer', min: [2, 1], max: [3, 3], start: [2, 2],
    prepare: async (api) => {
      const { timers } = await api.get<TimersModel>('/api/timers')
      return { timer: timers.find((timer) => timer.name === LONG_TIMER)!.id }
    },
    loaded: (frame) => expect(frame).toContainText(LONG_TIMER),
  },
  {
    id: 'pinned', name: 'Pinned achievements', min: [3, 2], max: [6, 5], start: [4, 3],
    loaded: (frame) => expect(frame.getByText('Pirates! Argh!').first()).toBeVisible(),
  },
  {
    id: 'commissions', name: 'Commissions to look for', min: [2, 2], max: [4, 4], start: [2, 3],
    loaded: (frame) => expect(frame.getByText('Liyue').first()).toBeVisible(),
  },
  {
    id: 'progress', name: 'Achievement progress', min: [2, 1], max: [4, 2], start: [3, 1],
    loaded: (frame) => expect(frame).toContainText('of 1,854 ticked'),
  },
  {
    id: 'resin', name: 'Resin', min: [1, 1], max: [3, 2], start: [2, 1],
    loaded: (frame) => expect(frame.locator('.ring')).toBeVisible(),
  },
  {
    id: 'expeditions', name: 'Expeditions', min: [2, 1], max: [4, 3], start: [3, 2],
    loaded: (frame) => expect(frame).toContainText('3 of 5 back'),
  },
  {
    id: 'daily-notes', name: 'Daily notes', min: [2, 2], max: [4, 3], start: [3, 2],
    loaded: (frame) => expect(frame).toContainText('Commissions'),
  },
  {
    id: 'resets', name: 'Resets', min: [2, 1], max: [4, 2], start: [2, 1],
    loaded: (frame) => expect(frame).toContainText('Daily reset'),
  },
  {
    id: 'playtime', name: 'Playtime', min: [2, 1], max: [4, 2], start: [2, 1],
    show: (page) => playAs(page, { running: false, started: null, last: 93, week: PLAY_WEEK }),
    loaded: (frame) => expect(frame).toContainText('Not playing'),
  },
  {
    id: 'quick-timer', name: 'Quick timer', min: [2, 2], max: [4, 4], start: [3, 2],
    prepare: async (api) => {
      for (const seconds of [60, 300, 3600]) await api.post('/api/quick-timers', { seconds })
      return {}
    },
    loaded: (frame) => expect(frame.locator('.qt-run')).toHaveCount(1), // the first of the three fills it
  },
  {
    id: 'stopwatch', name: 'Stopwatch', min: [2, 1], max: [3, 3], start: [2, 2],
    data: { running_since: null, elapsed_ms: 125_400, laps: [31_200, 62_800, 95_100, 125_400] },
    loaded: (frame) => expect(frame.getByRole('button', { name: 'Start' })).toBeVisible(),
  },
  {
    id: 'clock', name: 'Clock', min: [1, 1], max: [3, 2], start: [2, 1],
    loaded: (frame) => expect(frame).toContainText(/\d{2}:\d{2}/),
  },
  {
    id: 'notes', name: 'Notes', min: [2, 1], max: [6, 6], start: [3, 3],
    data: { text: Array.from({ length: 40 }, (_, line) => `Line ${line + 1}: Sweet Flowers for Kirara.`).join('\n') },
    loaded: (frame) => expect(frame.getByRole('textbox', { name: 'Notes' })).toHaveValue(/^Line 1: /),
  },
  // The Pulls plan, Task 12 (its calls, item 14).
  {
    id: 'wishing-now', name: 'Wishing now', min: [3, 2], max: [6, 4], start: [3, 2],
    loaded: (frame) => expect(frame).toContainText("Void Star's Advent"),
  },
  {
    id: 'pity', name: 'Pity', min: [2, 2], max: [6, 3], start: [2, 2],
    loaded: (frame) => expect(frame.locator('.ring')).toBeVisible(),
  },
  {
    // The demo's estimate is the pulls its balance gives, with the diary's income of the day it was set.
    id: 'savings', name: 'Savings', min: [2, 2], max: [4, 3], start: [2, 2],
    loaded: (frame) => expect(frame).toContainText(/\d+ pulls/),
  },
  {
    id: 'wishlist', name: 'Wishlist', min: [2, 2], max: [4, 4], start: [2, 2],
    loaded: (frame) => expect(frame).toContainText('Citlali'),
  },
  {
    id: 'last-pulls', name: 'Last pulls', min: [2, 2], max: [4, 3], start: [2, 2],
    loaded: (frame) => expect(frame.locator('.lp-face')).toHaveCount(12),
  },
  {
    id: 'luck', name: 'Luck', min: [1, 2], max: [3, 2], start: [1, 2],
    loaded: (frame) => expect(frame).toContainText('average 5★ pity'),
  },
]

/**
 * The size a frame shows at, in cells: the Board's cells are 96 pixels tall, and its columns share its width, 168
 * pixels or a little more, with 12-pixel gaps. A frame is exactly the pixels of its cells, to half a pixel; one that is
 * not is said in pixels.
 */
async function sizeOf(frame: Locator): Promise<readonly number[] | string> {
  return frame.evaluate((section) => {
    const grid = section.closest('[data-testid="board"]')
    if (grid === null) return 'not on the Board'
    const column = parseFloat(getComputedStyle(grid).gridTemplateColumns)
    const { width, height } = section.getBoundingClientRect()
    const w = Math.round((width + 12) / (column + 12))
    const h = Math.round((height + 12) / 108)
    const whole = Math.abs(width - (w * column + (w - 1) * 12)) <= 0.5 && Math.abs(height - (h * 96 + (h - 1) * 12)) <= 0.5
    return whole ? [w, h] : `${width} × ${height} pixels, not whole cells of ${column} × 96`
  })
}

const PROBE = 'probe'

/**
 * What of a frame's content lies outside it, one line for each; none when everything is inside. A list that scrolls is
 * measured by its own box, since what lies below its edge is reached by scrolling. The body must not be wider than
 * itself either, as nothing scrolls sideways.
 */
function spill(frame: Locator): Promise<string[]> {
  return frame.evaluate((section) => {
    const outer = section.getBoundingClientRect()
    const found: string[] = []
    const describe = (element: Element) => {
      const classes = typeof element.className === 'string' ? element.className.trim().split(/\s+/).filter(Boolean) : []
      return `${element.tagName.toLowerCase()}${classes.map((one) => `.${one}`).join('')} "${(element.textContent ?? '').trim().slice(0, 30)}"`
    }
    const body = section.querySelector('.w-body')
    if (body === null) return ['the frame has no .w-body']
    if (body.scrollWidth > body.clientWidth + 1) found.push(`.w-body is ${body.scrollWidth} wide in ${body.clientWidth}`)
    const scrolls = (element: Element) => {
      const { overflowY } = getComputedStyle(element)
      return (overflowY === 'auto' || overflowY === 'scroll') && element.scrollHeight > element.clientHeight + 1
    }
    const visit = (parent: Element) => {
      for (const element of parent.children) {
        const style = getComputedStyle(element)
        if (style.display === 'none' || style.visibility === 'hidden') continue
        const box = element.getBoundingClientRect()
        const sized = box.width > 0 || box.height > 0
        if (
          sized &&
          (box.left < outer.left - 0.5 || box.top < outer.top - 0.5 || box.right > outer.right + 0.5 || box.bottom > outer.bottom + 0.5)
        ) {
          found.push(`${describe(element)} lies outside the frame`)
        }
        if (element.tagName !== 'svg' && !scrolls(element)) visit(element)
      }
    }
    visit(section)
    return found
  })
}

/**
 * Why a frame's content does not fit its body, one line each; none when it does. The body must not scroll, and the
 * visual centre (the one element with data-centre) must be drawn inside the body's content box, clear of its padding,
 * which at the bottom is the soft fade of what is cut off.
 */
function misfit(frame: Locator): Promise<string[]> {
  return frame.evaluate((section) => {
    const body = section.querySelector('.w-body')
    if (body === null) return ['the frame has no .w-body']
    const found: string[] = []
    if (body.scrollHeight > body.clientHeight + 1) found.push(`.w-body scrolls: ${body.scrollHeight} high in ${body.clientHeight}`)
    if (body.scrollWidth > body.clientWidth + 1) found.push(`.w-body is ${body.scrollWidth} wide in ${body.clientWidth}`)
    const centres = section.querySelectorAll('[data-centre]')
    if (centres.length !== 1) return [...found, `${centres.length} elements carry data-centre, not one`]
    const style = getComputedStyle(body)
    const outer = body.getBoundingClientRect()
    const room = {
      left: outer.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft),
      top: outer.top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop),
      right: outer.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight),
      bottom: outer.bottom - parseFloat(style.borderBottomWidth) - parseFloat(style.paddingBottom),
    }
    const box = centres[0].getBoundingClientRect()
    const round = (n: number) => Math.round(n * 10) / 10
    if (box.width <= 0 || box.height <= 0) found.push('the visual centre has no size')
    else if (box.left < room.left - 0.5 || box.top < room.top - 0.5 || box.right > room.right + 0.5 || box.bottom > room.bottom + 0.5) {
      found.push(
        `the visual centre (${round(box.left)}, ${round(box.top)}) to (${round(box.right)}, ${round(box.bottom)}) lies outside the body's ` +
          `room (${round(room.left)}, ${round(room.top)}) to (${round(room.right)}, ${round(room.bottom)})`,
      )
    }
    return found
  })
}

test.describe('every widget type at its smallest and largest size keeps its content inside its frame', () => {
  for (const kind of TYPES) {
    test(kind.name, async ({ page, api }) => {
      await page.setViewportSize({ width: 2560, height: 1440 }) // thirteen columns: the window cuts no size
      await kind.show?.(page)
      const settings = (await kind.prepare?.(api)) ?? {}
      for (const [label, size] of [['smallest', kind.min], ['largest', kind.max]] as const) {
        await setBoard(api, page, [{ id: PROBE, type: kind.id, w: size[0], h: size[1], settings }])
        if (kind.data !== undefined && label === 'smallest') {
          await api.put(`/api/widgets/${PROBE}/data`, { data: kind.data })
          await page.reload()
        }
        const frame = widgetById(page, PROBE)
        await expect(frame.locator('.w-head'), label).toBeVisible()
        await expect(frame, label).not.toContainText('Reading the')
        await kind.loaded(frame)
        await page.evaluate(async () => {
          await document.fonts.ready // the measure is of the type as it is set, not of the one it falls back to
        })
        expect(await sizeOf(frame), `${label} size`).toEqual(size)
        expect(await spill(frame), label).toEqual([])
        // Every type is rebuilt on the frame: its content fits its body without scrolling, and its visual centre is drawn.
        await expect(frame.locator('[data-centre]'), `${label} visual centre`).toBeVisible()
        expect(await misfit(frame), label).toEqual([])
      }
    })
  }
})

/**
 * Playtime with the game running has the session so far in large figures where the other state has the last one, and
 * here a session of nearly twelve hours, the widest figures it is likely to show, over a week of days of many hours.
 * They fit at both sizes too.
 */
test('Playtime with the game running keeps its content inside its frame at its smallest and largest size', async ({ page, api }) => {
  await page.setViewportSize({ width: 2560, height: 1440 })
  const { now } = await api.get<Status>('/api/status')
  const started = new Date(Date.parse(now) - (11 * 60 + 59) * 60_000).toISOString() // a session of 11 h 59 min
  const week = PLAY_WEEK.map((day) => ({ ...day, minutes: day.minutes + 1_000 }))
  await playAs(page, { running: true, started, last: 93, week })
  for (const [label, size] of [['smallest', [2, 1]], ['largest', [4, 2]]] as const) {
    await setBoard(api, page, [{ id: PROBE, type: 'playtime', w: size[0], h: size[1], settings: {} }])
    const frame = widgetById(page, PROBE)
    await expect(frame, label).toContainText('Playing now')
    await expect(frame.locator('[data-centre] .fig'), label).toContainText('11 h')
    await page.evaluate(async () => {
      await document.fonts.ready
    })
    expect(await sizeOf(frame), `${label} size`).toEqual(size)
    expect(await spill(frame), label).toEqual([])
    await expect(frame.locator('[data-centre]'), `${label} visual centre`).toBeVisible()
    expect(await misfit(frame), label).toEqual([])
  }
})

/**
 * A One timer whose achievement is counted with − and + (a teapot field's items, the fish caught) has the count in its
 * body from two cells tall, under the achievement's name with Cleared under that. It fits at every size from 2 × 2 up
 * (the loop above has the smallest and the largest size, with the fishing spot of the longest name): the longest name an
 * achievement of a timer has ("We're Going to Need More Crops!") and the longest count ("1,312 of 2,000") are the two
 * that could crowd the narrowest body.
 */
test('a One timer with a count to change fits its body at every size from 2 × 2 up', async ({ page, api }) => {
  await page.setViewportSize({ width: 2560, height: 1440 })
  const { timers } = await api.get<TimersModel>('/api/timers')
  const fishing = timers.find((timer) => timer.name === 'Fishing spot · Cider Lake (1), Mondstadt')!
  await api.post(`/api/achievements/counter/${fishing.achievement!.id}`, { value: 1312 })
  for (const name of ['Teapot · Jade Field', fishing.name]) {
    const timer = timers.find((one) => one.name === name)!
    for (const size of [[2, 2], [3, 2], [2, 3], [3, 3]] as const) {
      const label = `${name} at ${size[0]} × ${size[1]}`
      await setBoard(api, page, [{ id: PROBE, type: 'one-timer', w: size[0], h: size[1], settings: { timer: timer.id } }])
      const frame = widgetById(page, PROBE)
      await expect(frame.getByRole('button', { name: 'Count up' }), label).toBeVisible()
      await page.evaluate(async () => {
        await document.fonts.ready // the measure is of the type as it is set, not of the one it falls back to
      })
      expect(await sizeOf(frame), `${label}: size`).toEqual(size)
      expect(await spill(frame), label).toEqual([])
      await expect(frame.locator('[data-centre]'), `${label}: visual centre`).toBeVisible()
      expect(await misfit(frame), label).toEqual([])
    }
  }
})

/**
 * Pinned achievements and Commissions to look for show what the player's list gives them, so the longest of it has to
 * fit: an achievement with a name of a hundred letters, a long unit of its count and a dozen long parts at the smallest
 * size, with the stage's text and the reward beside them at the largest, and commission names as long.
 */
test('Pinned achievements and Commissions to look for keep a very long name, count and parts inside their frames', async ({ page, api }) => {
  await page.setViewportSize({ width: 2560, height: 1440 })
  const long = 'A very long name that does not stop for a long time and then goes on a little more still, and more'
  await changeAnswer<Achievements>(page, '/api/achievements', (model) => {
    for (const group of model.groups) {
      group.name = `${long} (${group.id})`
      group.counter = { value: 1312, unit: 'times a very long unit of a count is written out in full', unit_one: null, targets: group.stages.map((_, index) => 2000 + index) }
      group.stages[group.stages.length - 1].description = `${long}, ${long}, ${long}`
      group.stages[group.stages.length - 1].parts = Array.from({ length: 12 }, (_, number) => ({ label: `A long part number ${number + 1}`, done_at: null }))
    }
  })
  await changeAnswer<CommissionsModel>(page, '/api/commissions', (model) => {
    model.looking_for = Array.from({ length: 6 }, (_, number) => `${long} ${number + 1}`)
  })
  for (const [type, id, smallest, largest] of [
    ['pinned', 'pinned-long', [3, 2], [6, 5]],
    ['commissions', 'commissions-long', [2, 2], [4, 4]],
  ] as const) {
    for (const [label, size] of [['smallest', smallest], ['largest', largest]] as const) {
      await setBoard(api, page, [{ id, type, w: size[0], h: size[1], settings: {} }])
      const frame = widgetById(page, id)
      await expect(frame.locator('[data-centre]'), `${type} ${label} visual centre`).toBeVisible()
      await page.evaluate(async () => {
        await document.fonts.ready
      })
      expect(await sizeOf(frame), `${type} ${label} size`).toEqual(size)
      expect(await spill(frame), `${type} ${label}`).toEqual([])
      expect(await misfit(frame), `${type} ${label}`).toEqual([])
    }
  }
})

test("each widget's heading shows its sign and its name", async ({ page, api }) => {
  await page.setViewportSize({ width: 2560, height: 1440 })
  // At its starting size, and two cells wide at least: one cell wide a heading hides its name (the next test), and
  // Luck starts one cell wide.
  await setBoard(
    api,
    page,
    TYPES.map((kind) => ({ id: kind.id, type: kind.id, w: Math.max(2, kind.start[0]), h: kind.start[1], settings: {} })),
  )
  const signs = new Map<string, string>()
  for (const kind of TYPES) {
    const frame = widgetById(page, kind.id)
    const head = frame.locator('.w-head')
    await expect(head.locator('svg')).toBeVisible()
    await expect(head.locator('.w-name')).toBeVisible()
    await expect(head.locator('.w-name')).toHaveText(kind.name)
    await expect(frame).toHaveAttribute('aria-label', kind.name) // the widget is named by its type
    signs.set(kind.id, await head.locator('svg').innerHTML())
  }
  // Spec 7.2: Timers and One timer draw the hourglass, and each other type a sign of its own.
  expect(signs.get('timers')).toBe(signs.get('one-timer'))
  expect(new Set(signs.values()).size).toBe(TYPES.length - 1)
})

test('at one cell wide the heading keeps its sign and hides its name, and the widget keeps its name', async ({ page, api }) => {
  await setBoard(api, page, [
    { id: 'resin-1', type: 'resin', w: 1, h: 1, settings: {} },
    { id: 'clock-1', type: 'clock', w: 1, h: 1, settings: {} },
  ])
  for (const [id, name] of [['resin-1', 'Resin'], ['clock-1', 'Clock']]) {
    await expect(widgetById(page, id).locator('.w-head svg')).toBeVisible()
    await expect(widgetById(page, id).locator('.w-name')).toBeHidden()
    await expect(page.getByRole('region', { name, exact: true })).toHaveAttribute('data-widget', id)
  }
})

test('the Clock at 1 × 1 shows the time and the day', async ({ page, api }) => {
  await setBoard(api, page, [{ id: 'clock-s', type: 'clock', w: 1, h: 1, settings: {} }])
  const small = widgetById(page, 'clock-s')
  // The demo's clock is 08:00 UTC, which is 09:00 on the Europe server; this PC's own time is what the PC says.
  await expect(small.locator('[data-centre]')).toHaveText(/^\d{2}:\d{2}$/)
  await expect(small.getByText(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2} [A-Z][a-z]{2}$/)).toBeVisible()
  // The server's time is in the heading, which has no room for the name of the server in the body.
  await expect(small.locator('.w-meta')).toHaveText(/^Server 09:0\d$/)
  await expect(small.getByText(/Server 09:0\d · Europe/)).toBeHidden()
})

test("the Clock at 2 × 1 has the server's time with its name in the body, and none in the heading", async ({ page, api }) => {
  await setBoard(api, page, [{ id: 'clock-m', type: 'clock', w: 2, h: 1, settings: {} }])
  const wide = widgetById(page, 'clock-m')
  await expect(wide.locator('[data-centre]')).toHaveText(/^\d{2}:\d{2}$/)
  await expect(wide.getByText(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2} [A-Z][a-z]{2}$/)).toBeVisible()
  await expect(wide.getByText(/^Server 09:0\d · Europe$/)).toBeVisible()
  await expect(wide.locator('.w-meta')).toHaveCount(0)
})

test('a heading that depends on the size follows it as the size changes', async ({ page, api }) => {
  await setBoard(api, page, [
    { id: 'clock-a', type: 'clock', w: 1, h: 1, settings: {}, x: 0, y: 0 },
    { id: 'exp-a', type: 'expeditions', w: 2, h: 1, settings: {}, x: 3, y: 0 },
  ])
  const clock = widgetById(page, 'clock-a')
  const expeditions = widgetById(page, 'exp-a')
  // Resizes in Edit, a cell at a time with Shift and an arrow key, and goes back to the Board: in Edit the heading
  // holds the widget's buttons instead of its meta.
  const resize = async (steps: [Locator, string][]) => {
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    for (const [frame, key] of steps) {
      await frame.focus()
      await page.keyboard.press(key)
    }
    await page.getByRole('button', { name: 'Done' }).click()
    await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible()
  }
  // One cell wide the Clock's server time is in the heading; one cell tall the Expeditions' next return is.
  await expect(clock.locator('.w-meta')).toHaveText(/^Server 09:0\d$/)
  await expect(expeditions.locator('.w-meta')).toHaveText(/^3 of 5 back · next \d{2}:\d{2}$/)
  await resize([[clock, 'Shift+ArrowRight'], [expeditions, 'Shift+ArrowDown']]) // 2 × 1 and 2 × 2
  await expect(clock.locator('.w-meta')).toHaveCount(0) // no longer one cell wide: the body has it
  await expect(expeditions.locator('.w-meta')).toHaveText(/^3 of 5 back · Read at \d{2}:\d{2}$/)
  await resize([[clock, 'Shift+ArrowLeft'], [expeditions, 'Shift+ArrowUp']]) // 1 × 1 and 2 × 1
  await expect(clock.locator('.w-meta')).toHaveText(/^Server 09:0\d$/)
  await expect(expeditions.locator('.w-meta')).toHaveText(/^3 of 5 back · next \d{2}:\d{2}$/)
})

test('a widget is added at the size its type starts at', async ({ page, api }) => {
  await page.setViewportSize({ width: 2560, height: 1440 })
  await setBoard(api, page, [])
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await page.getByRole('button', { name: 'Add a widget' }).click()
  const sheet = page.getByRole('region', { name: 'Add a widget' })
  for (const kind of TYPES) await sheet.getByRole('button', { name: `Add ${kind.name}`, exact: true }).click()
  const ids = await widgetIds(page) // in reading order, which is not the order they were added in
  expect(ids).toHaveLength(TYPES.length)
  for (const kind of TYPES) {
    const added = ids.filter((id) => id.startsWith(`${kind.id}-`))
    expect(added, kind.name).toHaveLength(1)
    expect(await sizeOf(widgetById(page, added[0])), kind.name).toEqual(kind.start)
  }
})

test("a saved size outside its type's range shows at the nearest size inside it", async ({ page, api }) => {
  await page.setViewportSize({ width: 2560, height: 1440 })
  await setBoard(
    api,
    page,
    TYPES.flatMap((kind) => [
      { id: `${kind.id}-below`, type: kind.id, w: Math.max(1, kind.min[0] - 1), h: Math.max(1, kind.min[1] - 1), settings: {} },
      { id: `${kind.id}-above`, type: kind.id, w: kind.max[0] + 1, h: kind.max[1] + 1, settings: {} },
    ]),
  )
  for (const kind of TYPES) {
    await expect(widgetById(page, `${kind.id}-above`)).toBeVisible()
    expect(await sizeOf(widgetById(page, `${kind.id}-below`)), `${kind.name} below`).toEqual(kind.min)
    expect(await sizeOf(widgetById(page, `${kind.id}-above`)), `${kind.name} above`).toEqual(kind.max)
  }
})

test("Done saves the size inside the range for a widget that was saved outside it, and leaves a type it does not know", async ({
  page,
  api,
}) => {
  const later = { id: 'map-1', type: 'map', w: 6, h: 4, settings: { tab: 'fishing' } }
  await setBoard(api, page, [{ id: 'clock-a', type: 'clock', w: 4, h: 3, settings: {} }, later])
  expect(await sizeOf(widgetById(page, 'clock-a'))).toEqual([3, 2])
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await expect(widgetById(page, 'clock-a')).toHaveAccessibleName('Clock, 3 by 2, column 1, row 1')
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible()
  // Done saves every widget's place too: the map goes below the clock, in the first room six columns wide.
  expect((await layoutOf(api)).widgets).toEqual([
    { id: 'clock-a', type: 'clock', w: 3, h: 2, settings: {}, x: 0, y: 0 },
    { ...later, x: 0, y: 2 },
  ])
})

test('in Edit, Shift with the arrow keys goes through every size from the smallest to the largest', async ({ page, api }) => {
  await setBoard(api, page, [{ id: 'clock-a', type: 'clock', w: 2, h: 1, settings: {} }])
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  const clock = widgetById(page, 'clock-a')
  const said = page.locator('[aria-live="polite"]')
  await clock.focus()
  for (const [key, sentence] of [
    ['Shift+ArrowLeft', 'Clock, 1 by 1.'],
    ['Shift+ArrowLeft', 'Clock is at its smallest size.'],
    ['Shift+ArrowUp', 'Clock is at its smallest size.'],
    ['Shift+ArrowDown', 'Clock, 1 by 2.'],
    ['Shift+ArrowRight', 'Clock, 2 by 2.'],
    ['Shift+ArrowRight', 'Clock, 3 by 2.'],
    ['Shift+ArrowRight', 'Clock is at its largest size.'],
    ['Shift+ArrowDown', 'Clock is at its largest size.'],
    ['Shift+ArrowUp', 'Clock, 3 by 1.'],
  ]) {
    await page.keyboard.press(key)
    await expect(said, key).toHaveText(sentence)
  }
  expect(await sizeOf(clock)).toEqual([3, 1])
})

test('a widget wider than the window has columns shows as wide as the window, and wide again when the window is', async ({
  page,
  api,
}) => {
  await page.setViewportSize({ width: 1040, height: 900 })
  await setBoard(api, page, [
    { id: 'timers-1', type: 'timers', w: 6, h: 5, settings: {} },
    { id: 'map-1', type: 'map', w: 7, h: 2, settings: {} },
  ])
  const columns = () =>
    page.getByTestId('board').evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.split(' ').length)
  const narrow = await columns()
  expect(narrow).toBe(4) // the narrowest window has four columns
  await expect.poll(() => sizeOf(widgetById(page, 'timers-1'))).toEqual([narrow, 5])
  expect(await sizeOf(widgetById(page, 'map-1'))).toEqual([narrow, 2]) // a type it does not know too
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  await page.setViewportSize({ width: 2560, height: 1440 })
  await expect.poll(() => sizeOf(widgetById(page, 'timers-1'))).toEqual([6, 5])
  expect(await sizeOf(widgetById(page, 'map-1'))).toEqual([7, 2])
})

test('the frame is drawn with the widget roles, so that the dark panel can set them again', async ({ page }) => {
  const frame = widgetById(page, 'start-clock')
  const drawn = () =>
    frame.evaluate((section) => {
      const head = section.querySelector('.w-head')!
      return {
        card: getComputedStyle(section).backgroundColor,
        shadow: getComputedStyle(section).boxShadow,
        plate: getComputedStyle(head).backgroundColor,
        name: getComputedStyle(head.querySelector('.w-name')!).color,
      }
    })
  expect(await drawn()).toEqual({
    card: 'rgb(247, 242, 231)', shadow: 'none', plate: 'rgb(241, 234, 217)', name: 'rgb(94, 98, 114)',
  })
  await frame.evaluate((section) => section.classList.add('on-dark'))
  expect(await drawn()).toEqual({
    card: 'rgba(43, 49, 66, 0.93)', shadow: 'none', plate: 'rgba(241, 234, 219, 0.07)', name: 'rgb(217, 210, 195)',
  })
})
