import { EventEmitter } from 'node:events'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { parseArgs } from '../src/args.js'
import { CoreProcess, endedByWindows, killArgs, killCore, spawnCore, TASKKILL, taskkillPath, type ChildLike } from '../src/core.js'
import { coreCommand, type CoreCommand } from '../src/paths.js'
import type { CoreEvent } from '../src/protocol.js'

const COMMAND: CoreCommand = { program: 'core', args: ['--shell'], cwd: '.' }

class FakeChild extends EventEmitter {
  stdin = new PassThrough()
  stdout = new PassThrough()
  pid = 4242
  sent: Record<string, unknown>[] = []
  constructor() {
    super()
    let held = ''
    this.stdin.on('data', (chunk: Buffer) => {
      held += chunk.toString('utf8')
      const lines = held.split('\n')
      held = lines.pop() ?? ''
      for (const line of lines) this.sent.push(JSON.parse(line))
    })
  }
  say(text: string): void {
    this.stdout.write(text)
  }
  exit(code = 0): void {
    this.emit('exit', code)
  }
}

// Real setImmediate: lets the fake streams deliver while the clock is faked.
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

let fake: FakeChild
let kills: number[]
let core: CoreProcess
let events: CoreEvent[]
let stops: { unexpected: boolean }[]

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  fake = new FakeChild()
  kills = []
  core = new CoreProcess(COMMAND, () => fake as unknown as ChildLike, (pid) => kills.push(pid))
  events = []
  stops = []
  core.on('event', (event: CoreEvent) => events.push(event))
  core.on('stopped', (stop: { unexpected: boolean }) => stops.push(stop))
  core.start()
})

afterEach(() => {
  vi.useRealTimers()
})

test('ready sets the link', async () => {
  expect(core.link).toBeNull()
  fake.say('{"event":"settings","settings":{"overlay_size":100}}\n{"event":"rea')
  fake.say('dy","link":"http://127.0.0.1:5000/?t=x"}\n')
  await settle()
  expect(events.map((e) => e.event)).toEqual(['settings', 'ready'])
  expect(core.link).toBe('http://127.0.0.1:5000/?t=x')
})

test('calls are answered by id', async () => {
  const first = core.call<string>('sync_now')
  const second = core.call<string>('backup_file_name')
  await settle()
  expect(fake.sent).toEqual([
    { id: 1, call: 'sync_now', args: {} },
    { id: 2, call: 'backup_file_name', args: {} },
  ])
  fake.say('{"id":2,"result":"two"}\n{"id":1,"result":"one"}\n')
  await expect(first).resolves.toBe('one')
  await expect(second).resolves.toBe('two')
})

test('a call carries its arguments', async () => {
  void core.call('map_failed', { tab_id: 3, failed: true })
  await settle()
  expect(fake.sent[0]).toEqual({ id: 1, call: 'map_failed', args: { tab_id: 3, failed: true } })
})

test('an error answer rejects with its text', async () => {
  const call = core.call('export_backup', { path: 'C:\\x' })
  fake.say('{"id":1,"error":"Not in the game\'s folders."}\n')
  await expect(call).rejects.toThrow(new Error("Not in the game's folders."))
})

test('a call times out', async () => {
  const call = expect(core.call('sync_now')).rejects.toThrow(new Error('The core did not answer.'))
  await vi.advanceTimersByTimeAsync(30_000)
  await call
  // A late answer to it is ignored.
  fake.say('{"id":1,"result":"late"}\n')
  await settle()
})

test('a core that exits unasked stops the shell once', async () => {
  const call = expect(core.call('sync_now')).rejects.toThrow('The core has stopped.')
  fake.say('{"event":"ready","link":"http://127.0.0.1:1/"}\n')
  await settle()
  fake.exit(1)
  fake.exit(1)
  await call
  expect(stops).toEqual([{ unexpected: true }])
  await expect(core.call('sync_now')).rejects.toThrow('The core is not running.')
})

test('the exit code of a core that stopped is kept, and only the console control end is Windows ending it', async () => {
  expect(core.exitCode).toBeNull()
  fake.exit(3221225786)
  expect(core.exitCode).toBe(3221225786)
  expect(endedByWindows(3221225786)).toBe(true) // 0xC000013A: sign-out, shutdown or the console closing
  expect(endedByWindows(-1073741510)).toBe(true) // the same code, signed
  for (const other of [0, 1, 2, 3221225477, null]) expect(endedByWindows(other), String(other)).toBe(false)
})

test('a core that ends before ready, with nothing said, is an unexpected stop', async () => {
  const call = expect(core.call('hello', { has_tray: true })).rejects.toThrow()
  fake.exit(2)
  await call
  expect(events).toEqual([])
  expect(stops).toEqual([{ unexpected: true }])
})

test('text outside the channel is ignored and counted', async () => {
  fake.say('--demo-now needs --demo.\n[1,2]\n"text"\n{"x":1}\n{"id":"7","result":1}\n{"event":"unheard"}\n')
  fake.say('{"event":"game","running":true}\n')
  await settle()
  expect(events).toEqual([{ event: 'game', running: true }])
  expect(core.ignoredLines).toBe(6)
  expect(stops).toEqual([])
})

test('the last plain line before the channel starts is kept for a log', async () => {
  fake.say('--demo-now needs --demo.\n')
  fake.say('not json either\n')
  await settle()
  expect(core.ignoredLines).toBe(2)
  expect(core.lastIgnoredLine).toBe('not json either')
})

test('after the first event a stray line is counted and not kept', async () => {
  fake.say('--demo-now needs --demo.\n{"event":"settings","settings":{}}\n')
  fake.say('{"id":9,"secret":"made-up-ltoken"}\n{"event":"unheard"}\n')
  await settle()
  expect(core.ignoredLines).toBe(3)
  expect(core.lastIgnoredLine).toBe('--demo-now needs --demo.')
  fake.say('{"id":1,"result":{"a":"made-up-ltoken"')
  fake.exit(0) // a partial last line is handed over when the output ends
  fake.stdout.end()
  await settle()
  expect(core.lastIgnoredLine).toBe('--demo-now needs --demo.')
})

test('an answer also starts the channel', async () => {
  fake.say('plain\n{"id":5,"result":null}\nstray\n')
  await settle()
  expect(core.ignoredLines).toBe(2)
  expect(core.lastIgnoredLine).toBe('plain')
})

test('nothing is heard after the core has stopped', async () => {
  fake.exit(0)
  fake.say('{"event":"game","running":true}\nplain\n')
  await settle()
  expect(events).toEqual([])
  expect(core.ignoredLines).toBe(0)
})

test('shutdown twice sends one message and kills once', async () => {
  const first = core.shutdown()
  const second = core.shutdown()
  expect(second).toBe(first)
  await settle()
  expect(fake.sent).toEqual([{ id: 1, call: 'shutdown', args: {} }])
  await vi.advanceTimersByTimeAsync(10_000)
  await first
  await core.shutdown()
  expect(kills).toEqual([4242])
  expect(fake.sent).toHaveLength(1)
})

test('taskkill is the system one, by its full path', () => {
  expect(TASKKILL).toMatch(/^[A-Za-z]:\\.*\\System32\\taskkill\.exe$/i)
  expect(taskkillPath({ SystemRoot: 'D:\\Win' })).toBe('D:\\Win\\System32\\taskkill.exe')
  expect(taskkillPath({})).toBe('C:\\Windows\\System32\\taskkill.exe')
  expect(taskkillPath({ SystemRoot: '' })).toBe('C:\\Windows\\System32\\taskkill.exe')
})

test('the packaged core is killed alone, and the development core with its children', () => {
  // The packaged core is one process: a tree kill would take the update installer it started, and a browser it opened.
  expect(killArgs(4242, true)).toEqual(['/PID', '4242', '/F'])
  // The venv's python.exe is a launcher that starts the real interpreter as its child.
  expect(killArgs(4242, false)).toEqual(['/PID', '4242', '/T', '/F'])
})

test('a login, a pasted login and a backup wait 120 s for the core, the other calls 30 s', async () => {
  for (const name of ['login', 'login_text', 'export_backup'] as const) {
    let settled = false
    const call = core.call(name, {}).then(
      () => (settled = true),
      (error: Error) => {
        settled = true
        expect(error.message).toBe('The core did not answer.')
      },
    )
    await vi.advanceTimersByTimeAsync(30_000)
    expect(settled, `${name} is still waiting after 30 s`).toBe(false)
    await vi.advanceTimersByTimeAsync(90_000)
    await call
    expect(settled).toBe(true)
  }
  const short = expect(core.call('sync_now')).rejects.toThrow(new Error('The core did not answer.'))
  await vi.advanceTimersByTimeAsync(30_000)
  await short
})

test('a long call can still be answered inside its time', async () => {
  const call = core.call<string>('login', { cookies: {}, uid: null })
  await vi.advanceTimersByTimeAsync(60_000)
  fake.say('{"id":1,"result":"done"}\n')
  await expect(call).resolves.toBe('done')
})

test('shutdown asks, and an exit that follows is expected', async () => {
  const done = core.shutdown()
  await settle()
  expect(fake.sent).toEqual([{ id: 1, call: 'shutdown', args: {} }])
  fake.say('{"id":1,"result":null}\n{"event":"finished"}\n')
  fake.exit(0)
  await done
  expect(kills).toEqual([])
  expect(stops).toEqual([{ unexpected: false }])
})

test('shutdown kills the tree when the core does not end', async () => {
  const done = core.shutdown()
  await settle()
  expect(kills).toEqual([])
  await vi.advanceTimersByTimeAsync(10_000)
  await done
  expect(kills).toEqual([4242])
  expect(stops).toEqual([{ unexpected: false }])
  fake.exit(1) // the exit that follows the kill says nothing more
  expect(stops).toHaveLength(1)
})

// The player's standard data folder is never used: the core gets a folder made for the test.
const REPO = path.resolve(import.meta.dirname, '..', '..')
const PYTHON = path.join(REPO, '.venv', 'Scripts', 'python.exe')

test.skipIf(!fs.existsSync(PYTHON))('a real demo core answers', { timeout: 120_000 }, async () => {
  vi.useRealTimers()
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-shell-core-'))
  const real = new CoreProcess(coreCommand(parseArgs(['--demo']), folder, false, '', REPO), spawnCore, (pid) => killCore(pid, false))
  const seen: string[] = []
  const stopped: { unexpected: boolean }[] = []
  real.on('event', (event: CoreEvent) => seen.push(event.event))
  real.on('stopped', (stop: { unexpected: boolean }) => stopped.push(stop))
  try {
    const ready = new Promise<void>((resolve, reject) => {
      real.on('event', (event: CoreEvent) => {
        if (event.event === 'ready') resolve()
        if (event.event === 'failed') reject(new Error(event.text))
      })
      real.on('stopped', () => reject(new Error('the core stopped before it was ready')))
      setTimeout(() => reject(new Error('the core was not ready in 60 s')), 60_000)
    })
    real.start()
    await ready
    expect(real.link).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//)
    expect(seen.indexOf('settings')).toBeLessThan(seen.indexOf('ready'))
    const snapshot = await real.call<{ tabs: unknown[] }>('map_snapshot')
    expect(Array.isArray(snapshot.tabs)).toBe(true)
    await real.shutdown()
    expect(stopped).toEqual([{ unexpected: false }])
  } finally {
    await real.shutdown(5_000).catch(() => {})
    fs.rmSync(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
})
