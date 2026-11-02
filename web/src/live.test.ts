import { expect, test, vi } from 'vitest'
import {
  askedBy, coalescer, coreClock, EVENTS, EVENTS_TOGETHER_MS, listenTo, liveOrder, newestOnly, oneAtATime, type OverlayLine,
  overlayLines, pullsImports, readsAgain,
} from './live.ts'
import type { PullsImportEvent } from './types.ts'

test('the events of a tenth of a second are taken together: three events, one flush', () => {
  vi.useFakeTimers()
  try {
    const flushed: string[][] = []
    const events = coalescer<string>((names) => flushed.push([...names]), EVENTS_TOGETHER_MS)
    expect(EVENTS_TOGETHER_MS).toBe(100)
    events.add('sync_started')
    vi.advanceTimersByTime(40)
    events.add('state_changed')
    vi.advanceTimersByTime(40)
    events.add('sync_finished')
    expect(flushed).toEqual([])
    vi.advanceTimersByTime(20)
    expect(flushed).toEqual([['sync_started', 'state_changed', 'sync_finished']])
    // An event after the flush begins a window of its own.
    events.add('timers_changed')
    vi.advanceTimersByTime(100)
    expect(flushed).toEqual([['sync_started', 'state_changed', 'sync_finished'], ['timers_changed']])
    // A page that goes stops what still waits.
    events.add('pulls_changed')
    events.stop()
    vi.advanceTimersByTime(200)
    expect(flushed).toHaveLength(2)
  } finally {
    vi.useRealTimers()
  }
})

test("events taken together move the pages' version once, if any of them would", () => {
  // A sync: its start reads no page, its end does. Each of them reads the status, once for all of them.
  expect(askedBy(['sync_started', 'state_changed', 'sync_finished']).pages).toBe(true)
  expect(askedBy(['sync_started']).pages).toBe(false)
  expect(askedBy(['update_changed', 'sync_started']).pages).toBe(false)
})

test("only the online account's own news moves what the online pages read on", () => {
  // A friend's data reaches this PC with online_changed or at the pages' minute; the PC's own events change none of it.
  expect(askedBy(['online_changed']).online).toBe(true)
  expect(askedBy(['state_changed', 'achievements_changed', 'sync_finished', 'timers_changed']).online).toBe(false)
  expect(askedBy(['state_changed', 'online_changed'])).toEqual({ pages: true, online: true })
})

test('one refresh at a time: one asked for meanwhile runs once after it, for every ask, and makes the one running old', async () => {
  const runs: Array<() => void> = []
  let superseded = 0
  const refresh = oneAtATime(
    () => new Promise<void>((done) => runs.push(done)),
    () => {
      superseded += 1
    },
  )
  const first = refresh()
  const second = refresh()
  const third = refresh()
  expect(runs).toHaveLength(1) // the second and the third wait for the first
  expect(superseded).toBe(2) // what the first brings back is older than what they asked for
  expect(second).toBe(third) // and they share one more run
  runs[0]()
  await first
  await vi.waitFor(() => expect(runs).toHaveLength(2))
  let ended = false
  void second.then(() => {
    ended = true
  })
  await Promise.resolve()
  expect(ended).toBe(false) // it ends with the run that began after it was asked for
  runs[1]()
  await second
  expect(ended).toBe(true)
  // With nothing running, a refresh runs at once.
  void refresh()
  expect(runs).toHaveLength(3)
  expect(superseded).toBe(2)
})

/** The core's event stream, as a test sends it: an event goes out by its name, with its data as the stream gives it. */
function fakeStream() {
  const listeners = new Map<string, Array<(event: MessageEvent<string>) => void>>()
  return {
    addEventListener(name: string, listener: (event: MessageEvent<string>) => void) {
      listeners.set(name, [...(listeners.get(name) ?? []), listener])
    },
    send(name: string, data: Record<string, unknown> = {}) {
      const event = { data: JSON.stringify({ type: name, ...data }) } as MessageEvent<string>
      for (const listener of listeners.get(name) ?? []) listener(event)
    },
  }
}

test("the pages hear when the settings change, or the overlay's status, as the overlay and Settings show them", () => {
  // The overlay reads its settings again (what it pins, how faded), and its status (the hotkey its bar names).
  expect(EVENTS).toContain('settings_changed')
  expect(EVENTS).toContain('overlay_changed')
  expect(readsAgain('settings_changed')).toBe(true)
  expect(readsAgain('overlay_changed')).toBe(true)
})

test('an overlay_line event adds a line that goes after six seconds, at most three', () => {
  vi.useFakeTimers()
  try {
    let shown: readonly OverlayLine[] = []
    const lines = overlayLines((now) => {
      shown = now
    })
    // The event's data, as the stream gives it.
    const hear = (text: string) => lines.heard(JSON.stringify({ type: 'overlay_line', text }))
    const texts = () => shown.map((line) => line.text)
    hear('Unusual Hilichurl is ready.')
    expect(texts()).toEqual(['Unusual Hilichurl is ready.'])
    vi.advanceTimersByTime(2_000)
    hear('Teapot · Jade Field is ready.')
    hear('Fishing spot · Luhua Pool, Liyue is ready.')
    hear('Parametric Transformer is ready.')
    // The last three, newest last: the first gave way. Each has an id of its own.
    expect(texts()).toEqual([
      'Teapot · Jade Field is ready.',
      'Fishing spot · Luhua Pool, Liyue is ready.',
      'Parametric Transformer is ready.',
    ])
    expect(new Set(shown.map((line) => line.id)).size).toBe(3)
    vi.advanceTimersByTime(5_999)
    expect(texts()).toHaveLength(3)
    vi.advanceTimersByTime(1) // six seconds after they came
    expect(texts()).toEqual([])
    // What holds no text is no line.
    lines.heard(JSON.stringify({ type: 'overlay_line' }))
    lines.heard('null')
    lines.heard('not an event')
    expect(texts()).toEqual([])
    // Stopped, as the page's stream closes, it leaves no timer behind.
    hear('Resin is full.')
    lines.stop()
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    vi.useRealTimers()
  }
  // A line changes no data: no page reads its model again for one.
  expect(EVENTS).not.toContain('overlay_line')
})

test('every hello of the event stream has the pages read their models again, as every event but the start of a sync', () => {
  // A hello opens the stream, at the start and after a reconnect: what the core announced meanwhile reached no page.
  expect(readsAgain('hello')).toBe(true)
  for (const event of ['sync_finished', 'state_changed', 'game_started', 'game_stopped', 'achievements_changed']) {
    expect(readsAgain(event)).toBe(true)
  }
  expect(readsAgain('sync_started')).toBe(false) // nothing has changed yet
  expect(EVENTS).toContain('update_changed') // the status is read again, for the update's note
  expect(readsAgain('update_changed')).toBe(false)
})

test('pulls_changed is among the events the pages read again on', () => {
  // The Pulls page reads its model again when a setting, the balance, the wishlist, the banners or the history changed.
  expect(EVENTS).toContain('pulls_changed')
  expect(readsAgain('pulls_changed')).toBe(true)
  const stream = fakeStream()
  const reads: string[] = []
  listenTo(stream, { hello: () => undefined, changed: (name) => reads.push(name), line: () => undefined, importing: () => undefined })
  stream.send('pulls_changed')
  expect(reads).toEqual(['pulls_changed'])
})

test('online_changed is among the events the pages read again on', () => {
  // A sign-in ends in the system browser, so Settings hears of it from the core.
  expect(EVENTS).toContain('online_changed')
  expect(readsAgain('online_changed')).toBe(true)
})

test('characters_changed is among the events the pages read again on', () => {
  // The Characters pages read their models again when a focus, a plan, a tick, a card or what HoYoLAB gave changed.
  expect(EVENTS).toContain('characters_changed')
  expect(readsAgain('characters_changed')).toBe(true)
  const stream = fakeStream()
  const reads: string[] = []
  listenTo(stream, { hello: () => undefined, changed: (name) => reads.push(name), line: () => undefined, importing: () => undefined })
  stream.send('characters_changed')
  expect(reads).toEqual(['characters_changed'])
})

test('a pulls_import event sets pullsImport and reads no page again', () => {
  const stream = fakeStream()
  let pullsImport: PullsImportEvent | null = null
  const moves: string[] = [] // each would move `version`, which has every page read its model again
  const progress = pullsImports((event) => {
    pullsImport = event
  })
  listenTo(stream, {
    hello: () => undefined,
    changed: (name) => moves.push(name),
    line: () => undefined,
    importing: (data) => progress.heard(data),
  })
  // The event as the stream gives it: the bus adds its `type` to what was published.
  stream.send('pulls_import', { state: 'running', pool: 'Character event', pages: 3, found: 41, message: null })
  expect(pullsImport).toEqual({ state: 'running', pool: 'Character event', pages: 3, found: 41, message: null })
  stream.send('pulls_import', { state: 'done', pool: null, pages: 9, found: 41, message: 'Imported 41 new wishes.' })
  // The newest replaces the one before.
  expect(pullsImport).toEqual({ state: 'done', pool: null, pages: 9, found: 41, message: 'Imported 41 new wishes.' })
  // Progress changes no data, so no page reads again for it. The end of the import publishes pulls_changed, which does.
  expect(moves).toEqual([])
  expect(EVENTS).not.toContain('pulls_import')
  stream.send('pulls_changed')
  expect(moves).toEqual(['pulls_changed'])
})

test("the stream's hello clears an import's progress, so that one from before a reconnect does not stay on screen", () => {
  // The stream opens again after a reconnect: what an import did meanwhile reached no page, and the progress kept from
  // before it is old. The page reads the model again on the hello, whose import block says how the core's import goes.
  const shown: (PullsImportEvent | null)[] = []
  const progress = pullsImports((event) => shown.push(event))
  progress.heard(JSON.stringify({ type: 'pulls_import', state: 'running', pool: 'Character event', pages: 3, found: 41, message: null }))
  expect(shown).toEqual([{ state: 'running', pool: 'Character event', pages: 3, found: 41, message: null }])
  progress.opened()
  expect(shown.at(-1)).toBeNull()
  // The events after it are shown as before.
  progress.heard(JSON.stringify({ type: 'pulls_import', state: 'done', pool: null, pages: 9, found: 41, message: 'Imported 41 new wishes.' }))
  expect(shown.at(-1)).toEqual({ state: 'done', pool: null, pages: 9, found: 41, message: 'Imported 41 new wishes.' })
})

test('a pulls_import event that does not say plainly what the import is doing is left out', () => {
  const shown: (PullsImportEvent | null)[] = []
  const progress = pullsImports((event) => shown.push(event))
  const bad = [
    'not an event', 'null', '[]', JSON.stringify({ type: 'pulls_import' }),
    JSON.stringify({ state: 'sleeping', pool: null, pages: 0, found: 0, message: null }),
    JSON.stringify({ state: 'running', pool: 5, pages: 0, found: 0, message: null }),
    JSON.stringify({ state: 'running', pool: null, pages: '3', found: 0, message: null }),
    JSON.stringify({ state: 'running', pool: null, pages: 0, found: 0, message: 7 }),
  ]
  for (const data of bad) progress.heard(data)
  expect(shown).toEqual([])
  const sentence = 'HoYoverse says there were too many requests. Wait a minute, then press Import again.'
  progress.heard(JSON.stringify({ type: 'pulls_import', state: 'failed', pool: 'Weapon event', pages: 2, found: 0, message: sentence }))
  expect(shown).toEqual([{ state: 'failed', pool: 'Weapon event', pages: 2, found: 0, message: sentence }])
})

test('the stream hands the hello, a line and a change to what hears each, and every event of EVENTS is a change', () => {
  const stream = fakeStream()
  const heard: string[] = []
  listenTo(stream, {
    hello: (data) => heard.push(`hello ${JSON.parse(data).version}`),
    changed: (name) => heard.push(`changed ${name}`),
    line: (data) => heard.push(`line ${JSON.parse(data).text}`),
    importing: (data) => heard.push(`importing ${JSON.parse(data).state}`),
  })
  stream.send('hello', { version: '0.1.0' })
  stream.send('overlay_line', { text: 'Resin is full.' })
  stream.send('pulls_import', { state: 'running' })
  expect(heard).toEqual(['hello 0.1.0', 'line Resin is full.', 'importing running'])
  heard.length = 0
  for (const name of EVENTS) stream.send(name)
  expect(heard).toEqual(EVENTS.map((name) => `changed ${name}`))
  expect(new Set(EVENTS).size).toBe(EVENTS.length) // none listened to twice, which would read twice
})

test("the core's clock is carried forward, whatever the browser's clock says", () => {
  let elapsed = 1000
  const now = coreClock('2026-10-13T08:00:00+00:00', 1000, () => elapsed)
  expect(now().toISOString()).toBe('2026-10-13T08:00:00.000Z')
  elapsed += 90_000
  expect(now().toISOString()).toBe('2026-10-13T08:01:30.000Z')
})

test('of overlapping requests only the newest counts', () => {
  const begin = newestOnly()
  const first = begin()
  expect(first()).toBe(true)
  const second = begin()
  expect(first()).toBe(false) // an old answer that arrives late is not shown over a newer one
  expect(second()).toBe(true)
})

test("the event stream's hello wins over the status of a read asked for before it, but not over its settings", () => {
  const order = liveOrder()
  const early = order.read()
  expect(early.statusIsNewest()).toBe(true)
  order.hello()
  expect(early.statusIsNewest()).toBe(false) // its status may be older than the hello's, which stays
  expect(early.isNewest()).toBe(true) // the hello carries no settings, so the read's still count
  const later = order.read()
  expect(later.statusIsNewest()).toBe(true) // asked for after the hello
  expect(later.isNewest()).toBe(true)
  expect(early.isNewest()).toBe(false) // a later read counts over it, settings and all
  order.hello() // the stream opened again
  expect(later.statusIsNewest()).toBe(false)
  expect(later.isNewest()).toBe(true)
})
