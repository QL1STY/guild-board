import { expect, test } from 'vitest'
import { GameState, prepareCore, showRequest } from '../src/bootstrap.js'
import { type Message, PendingMessages } from '../src/instance.js'

// ---- the game: the latest news wins, whichever order the event and the answer arrive in

test('a game event that comes before the overlay exists still ends with the overlay told true', () => {
  const state = new GameState()
  const told: boolean[] = []
  state.heard(true) // the core's watcher polls at once, while the shell still waits for hello
  state.attach((running) => told.push(running))
  expect(told).toEqual([true])
  state.answered(false) // the answer to game_running is older than the event
  expect(told).toEqual([true])
})

test('the answer first and then an event: the overlay ends with the event', () => {
  const state = new GameState()
  const told: boolean[] = []
  state.attach((running) => told.push(running))
  state.answered(true)
  state.heard(false)
  expect(told).toEqual([true, false])
})

test('an answer with no event heard is applied, also when it is false', () => {
  const state = new GameState()
  const told: boolean[] = []
  state.attach((running) => told.push(running))
  state.answered(false)
  expect(told).toEqual([false])
})

test('events after the overlay is attached go straight to it, and nothing is told before there is one', () => {
  const state = new GameState()
  const told: boolean[] = []
  state.answered(true) // no overlay yet: kept, not lost
  state.attach((running) => told.push(running))
  state.heard(false)
  expect(told).toEqual([true, false])
})

// ---- the tray's Open before the core is ready

test('an Open before the core is ready waits, and runs once, after ready', () => {
  const pending = new PendingMessages()
  const ran: Message[] = []
  const open = showRequest(pending, (message) => ran.push(message))
  open()
  open()
  expect(ran).toEqual([])
  const collected: Message[] = []
  pending.ready((message) => collected.push(message))
  expect(collected).toEqual([{ action: 'show' }, { action: 'show' }])
  open() // after ready: at once
  expect(ran).toEqual([{ action: 'show' }])
})

// ---- hello and the demo's acknowledgement

function setup(options: { demo?: boolean; acknowledged?: boolean; fail?: string[] } = {}) {
  const calls: { name: string; args: object }[] = []
  const warnings: string[] = []
  return {
    calls,
    warnings,
    deps: {
      demo: options.demo ?? false,
      acknowledged: options.acknowledged ?? false,
      hasTray: true,
      async call(name: 'hello' | 'update_settings', args: object) {
        calls.push({ name, args })
        if (options.fail?.includes(name)) throw new Error('The core did not answer.')
        return null
      },
      warn: (text: string) => warnings.push(text),
    },
  }
}

test('hello tells the core whether there is a tray', async () => {
  const f = setup()
  await prepareCore(f.deps)
  expect(f.calls).toEqual([{ name: 'hello', args: { has_tray: true } }])
})

test('a demo started with --acknowledged marks the risk statement as read', async () => {
  const f = setup({ demo: true, acknowledged: true })
  await prepareCore({ ...f.deps, hasTray: false })
  expect(f.calls).toEqual([
    { name: 'hello', args: { has_tray: false } },
    { name: 'update_settings', args: { changes: { risk_acknowledged: true } } },
  ])
})

test('a hello that fails is told to the log, and the acknowledgement is still sent', async () => {
  const f = setup({ demo: true, acknowledged: true, fail: ['hello'] })
  await expect(prepareCore(f.deps)).resolves.toBeUndefined()
  expect(f.warnings).toEqual(['The core could not be told whether there is a tray.'])
  expect(f.calls.map((c) => c.name)).toEqual(['hello', 'update_settings'])
})

test('an acknowledgement that fails is told to the log, and nothing throws', async () => {
  const f = setup({ demo: true, acknowledged: true, fail: ['update_settings'] })
  await expect(prepareCore(f.deps)).resolves.toBeUndefined()
  expect(f.warnings).toEqual(['The demo’s risk statement could not be marked as read.'])
})

test('a real start never sends the acknowledgement', async () => {
  const f = setup({ demo: false, acknowledged: true })
  await prepareCore(f.deps)
  expect(f.calls.map((c) => c.name)).toEqual(['hello'])
})
