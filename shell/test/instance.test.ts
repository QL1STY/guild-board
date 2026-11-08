import { expect, test } from 'vitest'
import { parseArgs } from '../src/args.js'
import { claim, type InstanceDeps, messageFor, messageFrom, type Message, PendingMessages, QUIT_MESSAGES, quitReport } from '../src/instance.js'

const INVITE = 'guildboard://invite/abcdefghijklmnop'

test('the message a start hands over: quit wins, then an invite, then show', () => {
  expect(messageFor(parseArgs([]))).toEqual({ action: 'show' })
  expect(messageFor(parseArgs(['--hidden', '--demo']))).toEqual({ action: 'show' })
  expect(messageFor(parseArgs([INVITE]))).toEqual({ action: 'invite', code: 'abcdefghijklmnop' })
  expect(messageFor(parseArgs(['--quit']))).toEqual({ action: 'quit' })
  expect(messageFor(parseArgs(['--quit', INVITE]))).toEqual({ action: 'quit' })
})

test('the quit messages are the Qt shell’s', () => {
  expect(QUIT_MESSAGES).toEqual({
    not_running: 'Guild Board is not running.',
    still_running: 'Guild Board was asked to quit, but it is still running after 30 seconds.',
  })
})

// Stand-ins for the lock, the pid file, the process list and the clock; the fake clock moves only when a start sleeps.
function fake(options: { gets?: boolean; pid?: number | null; alivePolls?: number; pidAfter?: number } = {}) {
  let time = 1_000
  const log: string[] = []
  const sent: Message[] = []
  const written: number[] = []
  let polls = 0
  let reads = 0
  const deps: InstanceDeps = {
    requestLock(message) {
      log.push('lock')
      sent.push(message)
      return options.gets ?? false
    },
    readPid() {
      reads += 1
      return reads <= (options.pidAfter ?? 0) || options.pid === undefined ? null : options.pid
    },
    writePid(pid) { log.push('pid'); written.push(pid) },
    alive(pid) {
      log.push(`alive ${pid}`)
      polls += 1
      return polls <= (options.alivePolls ?? Infinity)
    },
    async sleep(ms) { log.push(`sleep ${ms}`); time += ms },
    now: () => time,
  }
  return { deps, log, sent, written, elapsed: () => time - 1_000 }
}

test('a start that gets the lock runs and writes its pid', async () => {
  const f = fake({ gets: true })
  expect(await claim(parseArgs([]), f.deps, 4242)).toBe('run')
  expect(f.written).toEqual([4242])
  expect(f.sent).toEqual([{ action: 'show' }])
})

test('a start that does not get the lock hands its message over and does not run', async () => {
  const f = fake({ gets: false, pid: 77 })
  expect(await claim(parseArgs([]), f.deps, 4242)).toBe('sent')
  expect(f.written).toEqual([])
  expect(f.sent).toEqual([{ action: 'show' }])
  const invite = fake({ gets: false, pid: 77 })
  expect(await claim(parseArgs([INVITE]), invite.deps, 4242)).toBe('sent')
  expect(invite.sent).toEqual([{ action: 'invite', code: 'abcdefghijklmnop' }])
  expect(invite.log.some((line) => line.startsWith('alive'))).toBe(false)
})

test('--quit that finds the lock free and no pid file is not running', async () => {
  const f = fake({ gets: true, pid: null })
  expect(await claim(parseArgs(['--quit']), f.deps, 4242)).toBe('not_running')
  expect(f.sent).toEqual([{ action: 'quit' }])
  expect(f.written).toEqual([])
})

test('--quit with the lock held and a pid that appears after two reads waits for it, then for the pid to go', async () => {
  const f = fake({ gets: false, pid: 77, pidAfter: 2, alivePolls: 1 })
  expect(await claim(parseArgs(['--quit']), f.deps, 4242)).toBe('quit')
  expect(f.log.filter((line) => line === 'alive 77')).toHaveLength(3) // alive once, then dead on two passes in a row
  expect(f.log.filter((line) => line === 'sleep 200')).toHaveLength(4) // two reads with none, one poll that found it alive, one to confirm
})

test('--quit with the lock held and no pid ever is still running, not "not running"', async () => {
  const f = fake({ gets: false, pid: null })
  expect(await claim(parseArgs(['--quit']), f.deps, 4242)).toBe('still_running')
  expect(f.elapsed()).toBe(30_000)
  expect(f.log.some((line) => line.startsWith('alive'))).toBe(false)
})

test('--quit that gets the lock found no holder, and writes no pid', async () => {
  const f = fake({ gets: true, pid: 77 })
  expect(await claim(parseArgs(['--quit']), f.deps, 4242)).toBe('not_running')
  expect(f.written).toEqual([])
})

test('--quit waits for the holder’s pid to go, polling every 200 ms', async () => {
  const f = fake({ gets: false, pid: 77, alivePolls: 3 })
  expect(await claim(parseArgs(['--quit']), f.deps, 4242)).toBe('quit')
  expect(f.sent).toEqual([{ action: 'quit' }])
  expect(f.log.filter((line) => line === 'alive 77')).toHaveLength(5)
  expect(f.log.filter((line) => line === 'sleep 200')).toHaveLength(4)
  expect(f.written).toEqual([])
})

test('--quit with a holder that is gone at once reads it dead on a second pass before it answers', async () => {
  const f = fake({ gets: false, pid: 77, alivePolls: 0 })
  expect(await claim(parseArgs(['--quit']), f.deps, 4242)).toBe('quit')
  expect(f.log.filter((line) => line === 'alive 77')).toHaveLength(2)
  expect(f.log.filter((line) => line.startsWith('sleep'))).toEqual(['sleep 200'])
})

test('--quit does not answer for a stale pid that the next holder replaced a moment later', async () => {
  // The file first holds a dead id, then the new holder writes its own, which runs and later ends.
  const pids = [77, 88, 88, 88, 88]
  const alive = new Map<number, number>([[77, 0], [88, 1]]) // polls each id answers "alive" for
  const asked: string[] = []
  // The fake clock moves when a start sleeps. With a clock that stands still, a regressed `claim` would loop on microtasks
  // for ever, and no test timeout could end it; here it reaches its deadline and the test fails.
  let time = 0
  const deps: InstanceDeps = {
    requestLock: () => false,
    readPid: () => pids.shift() ?? 88,
    writePid: () => undefined,
    alive(pid) {
      const left = alive.get(pid) ?? 0
      alive.set(pid, left - 1)
      asked.push(`alive ${pid}`)
      return left > 0
    },
    async sleep(ms) { time += ms },
    now: () => time,
  }
  expect(await claim(parseArgs(['--quit']), deps, 4242)).toBe('quit')
  expect(asked).toEqual(['alive 77', 'alive 88', 'alive 88', 'alive 88'])
})

test('--quit with a holder that never goes is still running after 30 seconds', async () => {
  const f = fake({ gets: false, pid: 77 })
  expect(await claim(parseArgs(['--quit']), f.deps, 4242)).toBe('still_running')
  expect(f.elapsed()).toBe(30_000)
})

test('--quit keeps asking about the holder it read when the holder removes its pid file as it ends', async () => {
  // The Guild Board that ends deletes guildboard.pid; the process list still tells when it is gone.
  const reads = [77, 77, null, null, null, null, null]
  const alive = [true, true, true, false, false]
  const asked: number[] = []
  let time = 0
  const deps: InstanceDeps = {
    requestLock: () => false,
    readPid: () => reads.shift() ?? null,
    writePid: () => undefined,
    alive(pid) {
      asked.push(pid)
      return alive.shift() ?? false
    },
    async sleep(ms) {
      time += ms
    },
    now: () => time,
  }
  expect(await claim(parseArgs(['--quit']), deps, 4242)).toBe('quit')
  expect(asked).toEqual([77, 77, 77, 77, 77])
})

test('the exit code and text for each answer of --quit', () => {
  expect(quitReport('not_running')).toEqual({ code: 0, text: QUIT_MESSAGES.not_running })
  expect(quitReport('quit')).toEqual({ code: 0, text: null })
  expect(quitReport('still_running')).toEqual({ code: 1, text: QUIT_MESSAGES.still_running })
  expect(quitReport('run')).toEqual({ code: 0, text: null })
  expect(quitReport('sent')).toEqual({ code: 0, text: null })
})

test('messages before ready wait and run once', () => {
  const pending = new PendingMessages()
  const ran: Message[] = []
  const handle = (m: Message) => { ran.push(m) }
  pending.take({ action: 'show' }, handle)
  pending.take({ action: 'invite', code: 'abcdefghijklmnop' }, handle)
  expect(ran).toEqual([])
  pending.ready(handle)
  expect(ran).toEqual([{ action: 'show' }, { action: 'invite', code: 'abcdefghijklmnop' }])
  pending.ready(handle) // a second ready runs nothing again
  expect(ran).toHaveLength(2)
  pending.take({ action: 'quit' }, handle)
  expect(ran).toHaveLength(3)
  expect(ran[2]).toEqual({ action: 'quit' })
})

test('a message that fails to run does not stop the ones after it', () => {
  const pending = new PendingMessages()
  const ran: string[] = []
  const handle = (m: Message) => {
    ran.push(m.action)
    if (m.action === 'show') throw new Error('boom')
  }
  pending.take({ action: 'show' }, handle)
  pending.take({ action: 'quit' }, handle)
  expect(() => pending.ready(handle)).toThrow('boom')
  expect(ran).toEqual(['show', 'quit'])
  pending.ready(handle)
  expect(ran).toEqual(['show', 'quit'])
})

test('what second-instance delivers is checked: three shapes, and the invite code’s form', () => {
  const code = 'abcdefghijklmnop'
  expect(messageFrom({ action: 'show' })).toEqual({ action: 'show' })
  expect(messageFrom({ action: 'quit' })).toEqual({ action: 'quit' })
  expect(messageFrom({ action: 'invite', code })).toEqual({ action: 'invite', code })
  expect(messageFrom({ action: 'invite', code: 'A-_9'.repeat(16) })).toEqual({ action: 'invite', code: 'A-_9'.repeat(16) })
  expect(messageFrom({ action: 'invite', code: 'a'.repeat(64) })).not.toBeNull()
  // the code
  expect(messageFrom({ action: 'invite', code: 'a'.repeat(15) })).toBeNull()
  expect(messageFrom({ action: 'invite', code: 'a'.repeat(65) })).toBeNull()
  expect(messageFrom({ action: 'invite', code: 'abcdefghijklmno/' })).toBeNull()
  expect(messageFrom({ action: 'invite', code: `${code}
` })).toBeNull()
  expect(messageFrom({ action: 'invite', code: '../../x../../xxxx' })).toBeNull()
  expect(messageFrom({ action: 'invite', code: 12345678901234567 })).toBeNull()
  expect(messageFrom({ action: 'invite' })).toBeNull()
  // extra keys, wrong actions and wrong types
  expect(messageFrom({ action: 'show', extra: 1 })).toBeNull()
  expect(messageFrom({ action: 'quit', code })).toBeNull()
  expect(messageFrom({ action: 'show', code })).toBeNull()
  expect(messageFrom({ action: 'invite', code, url: 'x' })).toBeNull()
  expect(messageFrom({ action: 'open' })).toBeNull()
  expect(messageFrom({ action: 1 })).toBeNull()
  expect(messageFrom({})).toBeNull()
  // not objects
  for (const bad of [null, undefined, 'show', 7, true, [], ['show'], [{ action: 'show' }]]) expect(messageFrom(bad)).toBeNull()
  expect(messageFrom(Object.create({ action: 'show' }))).toBeNull() // inherited keys do not count
})
