import type { Page } from '@playwright/test'
import type { Backlog, BoardModel, Status } from '../src/types.ts'
import { changeAnswer, holding } from './answers.ts'
import { counted, setBoard, widgetById } from './board.ts'
import { expect, test } from './fixtures.ts'

/*
 * Motion across the app (look pass spec 14): a number a sync changed glints once, the clock's ticks glint nothing, and
 * with reduced motion nothing on any page animates and the counted numbers are final at once.
 */

/** One glint: which number it was on, when the class `glint` came, and when it went (null while it stays). */
type Lit = { what: string; at: number; off: number | null }

/**
 * Records, from the start of every load of the page, each element of these selectors that gets the class `glint` (by the
 * name the selector has), and when it loses it. Answers the records so far. An element that has the class from the moment
 * it appears is recorded too: a number never glints on its first render.
 */
async function watchGlints(page: Page, selectors: Record<string, string>): Promise<() => Promise<Lit[]>> {
  await page.addInitScript((selectors) => {
    const log: Lit[] = []
    ;(window as unknown as { glints: Lit[] }).glints = log
    const open = new Map<Element, Lit>()
    const scan = () => {
      const now = performance.now()
      for (const [what, selector] of Object.entries(selectors)) {
        for (const element of document.querySelectorAll(selector)) {
          const lit = element.classList.contains('glint')
          const seen = open.get(element)
          if (lit && seen === undefined) {
            const one = { what, at: now, off: null }
            open.set(element, one)
            log.push(one)
          } else if (!lit && seen !== undefined) {
            seen.off = now
            open.delete(element)
          }
        }
      }
      for (const [element, one] of open) {
        if (!element.isConnected) {
          one.off = now
          open.delete(element)
        }
      }
    }
    new MutationObserver(scan).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class'],
    })
  }, selectors)
  return () => page.evaluate(() => (window as unknown as { glints: Lit[] }).glints)
}

/** The names of the glints recorded so far, in order. */
const whatLit = (log: Lit[]) => log.map((one) => one.what).sort()

/** Every glint ended, after the length of --t-glint (900 ms) and not much longer. */
function expectEnded(log: Lit[]) {
  for (const one of log) {
    expect(one.off, one.what).not.toBeNull()
    expect(one.off! - one.at, one.what).toBeGreaterThanOrEqual(850)
    expect(one.off! - one.at, one.what).toBeLessThan(3000)
  }
}

test('a number a sync changed glints once, and the clock’s ticks glint nothing', async ({ page, api }) => {
  const lit = await watchGlints(page, {
    'resin ring': '[data-widget="resin-1"] .ring-in .fig',
    'resin now': '[data-widget="resin-1"] .resin-now .fig',
    'return time': '[data-widget="expeditions-1"] .t b',
    heading: '[data-widget="expeditions-1"] .w-meta',
  })
  await setBoard(api, page, [
    { id: 'resin-1', type: 'resin', w: 2, h: 2, settings: {} },
    { id: 'expeditions-1', type: 'expeditions', w: 3, h: 2, settings: {} },
  ])
  const resin = widgetById(page, 'resin-1')
  const before = (await api.get<Status>('/api/status')).account!.resin!
  await expect(counted(resin.locator('.ring-in .fig'))).toHaveText(String(before))
  // Every expedition has its label, Back or its time: three back and two still out.
  await expect(widgetById(page, 'expeditions-1').locator('.t b')).toHaveText(['Back', 'Back', 'Back', /\d\d:\d\d/, /\d\d:\d\d/])
  // The page has been drawn, its clock has ticked, and its models have been read again: no number glinted, not even as
  // it first appeared.
  await page.waitForTimeout(2300)
  expect(await lit()).toEqual([])
  // Eight minutes on, with no sync: the core counts resin on from the same read, one more, and nothing glints.
  await api.advance(8 * 60)
  await expect(counted(resin.locator('.ring-in .fig'))).toHaveText(String(before + 1))
  await page.waitForTimeout(1200)
  expect(await lit()).toEqual([])
  // A sync reads more resin, and times of return later by the minutes the demo's clock moved on (api.sync, 6 minutes).
  // The count of those back stays: the heading does not glint.
  expect(await api.sync()).toBe('ok')
  const after = (await api.get<Status>('/api/status')).account!.resin!
  expect(after).toBeGreaterThan(before)
  await expect(counted(resin.locator('.ring-in .fig'))).toHaveText(String(after))
  await expect.poll(async () => whatLit(await lit())).toEqual(['resin now', 'resin ring', 'return time', 'return time'])
  // Each one glints for --t-glint and then does not: the class is gone, and nothing glints a second time.
  await expect.poll(async () => (await lit()).every((one) => one.off !== null)).toBe(true)
  await expect(resin.locator('.fig.glint')).toHaveCount(0)
  await page.waitForTimeout(1200)
  const seen = await lit()
  expect(whatLit(seen)).toEqual(['resin now', 'resin ring', 'return time', 'return time'])
  expectEnded(seen)
})

for (const late of ['the Board model', 'the status'] as const) {
  test(`Resin glints for a read that lowers a resin full by the clock, also when ${late} comes later`, async ({
    page,
    api,
  }) => {
    const lit = await watchGlints(page, { 'resin now': '[data-widget="resin-1"] .resin-now .fig' })
    await setBoard(api, page, [{ id: 'resin-1', type: 'resin', w: 2, h: 2, settings: {} }])
    const figure = counted(widgetById(page, 'resin-1').locator('.resin-now .fig'))
    // A day on, with no read, the resin has filled by the clock: the notes' full time is behind.
    await api.advance(24 * 60 * 60)
    const { account } = await api.get<Status>('/api/status')
    await expect(figure).toHaveText(String(account!.resin_max))
    // The next read finds 150, as after the player spent some, and full again in 50 times 8 minutes. One of the two
    // answers that bring it, the status with the count and the Board model with the full time, comes late.
    const { held, release } = holding()
    await page.route('**/api/status*', async (route) => {
      const response = await route.fetch()
      const data = (await response.json()) as Status
      const read = data.account !== null && data.account.resin_read_at !== account!.resin_read_at
      if (read) data.account!.resin = 150
      if (read && late === 'the status') await held
      await route.fulfill({ response, json: data })
    })
    await page.route('**/api/board*', async (route) => {
      const response = await route.fetch()
      const data = (await response.json()) as BoardModel
      const read = data.notes !== null && data.notes.read_at !== account!.resin_read_at
      if (read) data.notes!.resin_full_at = new Date(Date.parse(data.notes!.read_at) + 50 * 8 * 60_000).toISOString()
      if (read && late === 'the Board model') await held
      await route.fulfill({ response, json: data })
    })
    expect(await api.sync()).toBe('ok')
    await page.waitForTimeout(1500) // the answer that is not held has been taken
    release()
    await expect(figure).toHaveText('150')
    await expect.poll(async () => whatLit(await lit())).toEqual(['resin now'])
    await page.waitForTimeout(1200)
    expect(whatLit(await lit())).toEqual(['resin now']) // once
  })
}

test("an expedition sent again glints its time, and the heading's count glints for a read, not for the clock", async ({
  page,
  api,
}) => {
  let resent = false
  // A later read, as a sync would give it: the first expedition, which was back, was sent again, for three hours.
  await changeAnswer<BoardModel>(page, '/api/board', (board) => {
    if (!resent || board.notes === null || board.notes.expeditions === null) return
    const read = Date.parse(board.notes.read_at) + 60_000
    board.notes.read_at = new Date(read).toISOString()
    board.notes.expeditions[0].back_at = new Date(read + 3 * 3_600_000).toISOString()
  })
  const lit = await watchGlints(page, {
    first: '[data-widget="expeditions-1"] li:nth-child(1) .t b',
    fourth: '[data-widget="expeditions-1"] li:nth-child(4) .t b',
    heading: '[data-widget="expeditions-1"] .w-meta',
  })
  await setBoard(api, page, [{ id: 'expeditions-1', type: 'expeditions', w: 3, h: 2, settings: {} }])
  const expeditions = widgetById(page, 'expeditions-1')
  const heading = expeditions.locator('.w-meta')
  const first = expeditions.locator('li:nth-child(1) .t b')
  await expect(heading).toHaveText(/^3 of 5 back · /)
  await page.waitForTimeout(1500)
  expect(await lit()).toEqual([])
  // Two hours on, with no sync: the fourth expedition comes back by the clock. Its label and the count change, and
  // neither glints, for no read gave them.
  await api.advance(2 * 3600 + 60)
  await expect(heading).toHaveText(/^4 of 5 back · /)
  await expect(expeditions.locator('li:nth-child(4) .t b')).toHaveText('Back')
  await page.waitForTimeout(1200)
  expect(await lit()).toEqual([])
  // A read says that the first was sent again: its label goes from Back to its time, and the count down by one. Both glint.
  await expect(first).toHaveText('Back')
  resent = true
  await api.advance(1) // the core's next event has the Board read its model again
  await expect(first).toHaveText(/\d\d:\d\d/)
  await expect(heading).toHaveText(/^3 of 5 back · /)
  await expect.poll(async () => whatLit(await lit())).toEqual(['first', 'heading'])
  await expect.poll(async () => (await lit()).every((one) => one.off !== null)).toBe(true)
  await page.waitForTimeout(1200)
  const seen = await lit()
  expect(whatLit(seen)).toEqual(['first', 'heading'])
  expectEnded(seen)
})

test('Daily notes and Achievement progress glint the numbers they come to', async ({ page, api }) => {
  let changed = false
  // The demo's notes keep their numbers from one sync to the next. These are read as a later sync would give them.
  await changeAnswer<BoardModel>(page, '/api/board', (board) => {
    if (!changed || board.notes === null) return
    board.notes.realm_currency += 100
    board.notes.boss_discounts_left = 2
    board.notes.commissions_done = board.notes.commissions_done === 4 ? 3 : board.notes.commissions_done + 1
  })
  const lit = await watchGlints(page, {
    commissions: '[data-widget="daily-1"] .dn-commissions .val b',
    discounts: '[data-widget="daily-1"] .dn-discounts .val b',
    realm: '[data-widget="daily-1"] .dn-realm .val b',
    progress: '[data-widget="progress-1"] .fig',
  })
  await setBoard(api, page, [
    { id: 'daily-1', type: 'daily-notes', w: 3, h: 3, settings: {} },
    { id: 'progress-1', type: 'progress', w: 3, h: 1, settings: {} },
  ])
  const daily = widgetById(page, 'daily-1')
  const progress = widgetById(page, 'progress-1')
  await expect(daily.locator('.dn-realm .val b')).toHaveText('1,800')
  const ticked = (await api.get<BoardModel>('/api/board')).achievements.done
  await expect(counted(progress.locator('.fig'))).toHaveText(ticked.toLocaleString('en-US'))
  await page.waitForTimeout(1500)
  expect(await lit()).toEqual([]) // nothing glinted as the page was drawn and read again

  // A stage is unticked: the count of Achievement progress is another number.
  await api.post('/api/achievements/stage/82056', { status: 'not_started' })
  const now = (await api.get<BoardModel>('/api/board')).achievements.done
  expect(now).not.toBe(ticked)
  await expect(counted(progress.locator('.fig'))).toHaveText(now.toLocaleString('en-US'))
  await expect.poll(async () => whatLit(await lit())).toEqual(['progress'])

  // A later sync gives other numbers for the notes: the core's next event has the Board read them.
  changed = true
  await api.advance(1)
  await expect(daily.locator('.dn-realm .val b')).toHaveText('1,900')
  await expect.poll(async () => whatLit(await lit())).toEqual(['commissions', 'discounts', 'progress', 'realm'])
  await expect.poll(async () => (await lit()).every((one) => one.off !== null)).toBe(true)
  await page.waitForTimeout(1200)
  const seen = await lit()
  expect(whatLit(seen)).toEqual(['commissions', 'discounts', 'progress', 'realm'])
  expectEnded(seen)
})

test("the Backlog's counters glint the numbers a later read gives them", async ({ page, core, api }) => {
  let changed = false
  // The demo's counters keep their numbers from one sync to the next. These are read as a later sync would give them.
  await changeAnswer<Backlog>(page, '/api/backlog', (backlog) => {
    if (!changed) return
    const chests = backlog.counters.find((counter) => counter.id === 'chests')!
    chests.value += 12
  })
  const lit = await watchGlints(page, {
    chests: '[data-testid="counter-chests"] .v',
    oculi: '[data-testid="counter-oculi"] .v',
    achievements: '[data-testid="counter-achievements"] .v',
    waypoints: '[data-testid="counter-waypoints"] .v',
    archon: '[data-testid="counter-archon"] .v',
  })
  await page.goto(`${core.origin}/#/backlog`)
  await page.reload()
  const chests = page.getByTestId('counter-chests').locator('.v')
  await expect(counted(chests)).toHaveText('5,349')
  await page.waitForTimeout(1500)
  expect(await lit()).toEqual([]) // nothing glinted as the page was drawn and read again
  // The core's next event has the page read its model again.
  changed = true
  await api.advance(1)
  await expect(counted(chests)).toHaveText('5,361')
  await expect.poll(async () => whatLit(await lit())).toEqual(['chests'])
  await expect.poll(async () => (await lit()).every((one) => one.off !== null)).toBe(true)
  await page.waitForTimeout(1200)
  const seen = await lit()
  expect(whatLit(seen)).toEqual(['chests'])
  expectEnded(seen)
})

/** What a page did with motion from its first moment, as the page itself recorded it. */
type MotionLog = { running: string[]; figures: number; stale: string[] }

/**
 * Records, from the start of every load of the page: each animation seen running in any frame of the first three
 * seconds (a transition, a keyframe animation or one of the Web Animations API), how many counted numbers the page has,
 * and each moment at which one of them showed something other than its final value. A counted number is a pair of
 * elements, the digits that count (aria-hidden) and, beside them, the real value for screen readers.
 */
async function recordMotion(page: Page): Promise<() => Promise<MotionLog>> {
  await page.addInitScript(() => {
    const log: MotionLog = { running: [], figures: 0, stale: [] }
    ;(window as unknown as { motion: MotionLog }).motion = log
    const figures = new Set<Element>()
    new MutationObserver(() => {
      for (const real of document.querySelectorAll('span[aria-hidden="true"] + .sr-only')) {
        figures.add(real)
        const shown = real.previousElementSibling?.textContent ?? ''
        if (shown !== real.textContent) log.stale.push(`${shown} for ${real.textContent}`)
      }
      log.figures = figures.size
    }).observe(document, { subtree: true, childList: true, characterData: true })
    const started = performance.now()
    const sample = () => {
      for (const animation of document.getAnimations()) {
        if (animation.playState !== 'running') continue
        const target = (animation.effect as KeyframeEffect | null)?.target
        const name = (animation as CSSAnimation).animationName ?? (animation as CSSTransition).transitionProperty ?? animation.id
        const where = target instanceof Element ? `${target.tagName.toLowerCase()}.${String(target.getAttribute('class'))}` : '?'
        const text = `${name} on ${where}`
        if (!log.running.includes(text)) log.running.push(text)
      }
      if (performance.now() - started < 3000) requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })
  return () => page.evaluate(() => (window as unknown as { motion: MotionLog }).motion)
}

/**
 * The pages the plan names, each with what shows that it has been read and drawn, and how many counted numbers it shows
 * on the demo, as the recorder above counts them: Resin's on the Board (the recorder finds two, one of which the
 * widget's size hides); the ticks and the primogems to earn on the Achievements page; the five tiles of Stats; and the
 * five counters of the Backlog.
 */
const PAGES = [
  {
    name: 'Board',
    path: '/#/board',
    ready: (page: Page) => expect(widgetById(page, 'start-resin').locator('.fig').first()).toBeAttached(),
    figures: 1,
  },
  {
    name: 'Achievements',
    path: '/#/achievements',
    ready: (page: Page) => expect(page.getByTestId('ach-group').first()).toBeVisible(),
    figures: 2,
  },
  {
    name: 'Stats',
    path: '/#/stats',
    ready: (page: Page) => expect(page.getByRole('region', { name: 'Endgame' })).toBeVisible(),
    figures: 5,
  },
  {
    name: 'Backlog',
    path: '/#/backlog',
    ready: (page: Page) => expect(page.getByTestId('region').first()).toBeVisible(),
    figures: 5,
  },
]

test('with reduced motion nothing animates on any page', async ({ page, core }) => {
  test.setTimeout(90_000)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const motion = await recordMotion(page)
  for (const { name, path, ready, figures } of PAGES) {
    await page.goto('about:blank') // each page is opened afresh: its numbers are drawn for the first time
    await page.goto(core.origin + path)
    await ready(page)
    await page.waitForTimeout(1500) // the time in which the motion of a page would run
    const seen = await motion()
    expect(seen.running, `${name}: animations that ran`).toEqual([])
    expect(seen.stale, `${name}: a counted number that showed less than its value`).toEqual([])
    expect(seen.figures, `${name}: counted numbers`).toBeGreaterThanOrEqual(figures)
    const now = await page.evaluate(() => document.getAnimations().filter((one) => one.playState === 'running').length)
    expect(now, `${name}: animations running now`).toBe(0)
  }
})

test('the same recording sees the motion of a page when it is allowed, so that the check above can fail', async ({
  page,
  core,
}) => {
  const motion = await recordMotion(page)
  await page.goto('about:blank')
  await page.goto(core.origin + '/#/board')
  await PAGES[0].ready(page)
  await expect.poll(async () => (await motion()).running.length).toBeGreaterThan(0)
  expect((await motion()).stale.length).toBeGreaterThan(0) // the numbers count up from 0
})

test("a card's panel grows as it opens and shrinks as it closes, and with reduced motion it only opens and closes", async ({
  page,
  core,
}) => {
  // Records, from the start of every load of the page, each transition that begins on a panel's wrap (RowPanel.tsx).
  await page.addInitScript(() => {
    const runs: string[] = []
    ;(window as unknown as { runs: string[] }).runs = runs
    document.addEventListener(
      'transitionrun',
      (event) => {
        const target = event.target as Element
        if (!target.classList.contains('ach-panel-wrap')) return
        runs.push(`${(event as TransitionEvent).propertyName} ${target.classList.contains('closing') ? 'shrinks' : 'grows'}`)
      },
      true,
    )
  })
  const runs = () => page.evaluate(() => (window as unknown as { runs: string[] }).runs)
  // How long a click on the open panel's button takes to take the panel out of the page, in milliseconds.
  const closing = () =>
    page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const started = performance.now()
          const observer = new MutationObserver(() => {
            if (document.querySelector('[data-testid="ach-panel"]') !== null) return
            observer.disconnect()
            resolve(performance.now() - started)
          })
          observer.observe(document.body, { subtree: true, childList: true })
          document.querySelector<HTMLButtonElement>('.ach-panel-btn[aria-expanded="true"]')!.click()
        }),
    )
  for (const reduced of [false, true]) {
    await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' })
    await page.goto('about:blank')
    await page.goto(`${core.origin}/#/achievements`)
    const card = page.getByRole('article', { name: "It's Yesterday Once More" })
    await card.getByRole('button', { name: '3 stages' }).click()
    await expect(page.getByTestId('ach-panel')).toBeVisible()
    await expect.poll(async () => (await page.locator('.ach-panel-wrap').boundingBox())?.height ?? 0).toBeGreaterThan(150)
    const took = await closing()
    if (reduced) {
      expect(await runs(), 'with reduced motion').toEqual([])
      expect(took, 'with reduced motion: gone at once').toBeLessThan(150)
    } else {
      expect(await runs()).toEqual(['height grows', 'height shrinks'])
      expect(took).toBeGreaterThanOrEqual(250) // it shrank away over --t-open, 260 ms
    }
  }
})
