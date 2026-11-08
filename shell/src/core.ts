/**
 * The Python core as a child process: starts it, hears its events, calls it and stops it.
 * It speaks the channel of protocol.ts and nothing else; what the core prints outside the channel is counted, not read.
 */
import { spawn as spawnProcess, spawnSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import * as path from 'node:path'
import type { Readable, Writable } from 'node:stream'
import type { CoreCommand } from './paths.js'
import { type CallName, type CoreEvent, encode, LineReader } from './protocol.js'

export interface ChildLike {
  stdin: Writable
  stdout: Readable
  pid?: number
  once(event: 'exit', cb: (code: number | null) => void): void
}

export type Spawner = (command: CoreCommand) => ChildLike

const EVENT_NAMES: ReadonlySet<string> = new Set(['settings', 'ready', 'failed', 'window', 'notify', 'game', 'map', 'finished'])
const NOT_RUNNING = 'The core is not running.'
const NO_ANSWER = 'The core did not answer.'
const STOPPED = 'The core has stopped.'

/** A call waits this long for the core's answer, unless it is one of the long ones. */
const CALL_TIMEOUT_MS = 30_000
/** A login checks the account with HoYoLAB, and a backup copies the data folder: either can take longer than 30 s. */
const LONG_CALL_TIMEOUT_MS = 120_000
const LONG_CALLS: ReadonlySet<CallName> = new Set<CallName>(['login', 'login_text', 'export_backup'])

function timeoutFor(name: CallName): number {
  return LONG_CALLS.has(name) ? LONG_CALL_TIMEOUT_MS : CALL_TIMEOUT_MS
}

interface Pending {
  resolve: (value: never) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/**
 * Emits `'event'` with each CoreEvent, and `'stopped'` with `{ unexpected }` once, when the core is gone: any end that
 * `shutdown` did not ask for, before `ready` or after, is unexpected, and every call still waiting is rejected.
 */
export class CoreProcess extends EventEmitter {
  private child: ChildLike | null = null
  private linkText: string | null = null
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  private asked = false
  private stopped = false
  private ignored = 0
  private lastIgnored: string | null = null
  private channelStarted = false
  private shutdownInFlight: Promise<void> | null = null
  private code: number | null = null

  constructor(
    private readonly command: CoreCommand,
    private readonly spawn: Spawner,
    private readonly kill: (pid: number) => void,
  ) {
    super()
  }

  /** The launch link, once the core has said it is ready. */
  get link(): string | null {
    return this.linkText
  }

  /** The core's exit code, once it has exited by itself (null before, and after a kill). */
  get exitCode(): number | null {
    return this.code
  }

  /** How many lines of the core's output were not part of the channel (plain text before it starts, for one). */
  get ignoredLines(): number {
    return this.ignored
  }

  /**
   * The last such line, for a log, kept only until the channel has started (its first event or answer): the core's
   * plain-text argument errors come before it. Later lines are counted and never kept, as they could be a cut-off
   * answer with a login in it.
   */
  get lastIgnoredLine(): string | null {
    return this.lastIgnored
  }

  start(): void {
    if (this.child) throw new Error('The core was started already.')
    const child = this.spawn(this.command)
    this.child = child
    const reader = new LineReader((line) => this.onLine(line))
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => reader.push(chunk))
    child.stdout.on('end', () => reader.end())
    child.stdout.on('error', () => {})
    child.stdin.on('error', () => {}) // the core is gone: the exit tells
    child.once('exit', (code) => this.onExit(code))
  }

  call<T = unknown>(name: CallName, args: object = {}, timeoutMs = timeoutFor(name)): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (!this.child || this.stopped) {
        reject(new Error(NOT_RUNNING))
        return
      }
      const id = this.nextId++
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(NO_ANSWER))
      }, timeoutMs)
      this.pending.set(id, { resolve: resolve as (value: never) => void, reject, timer })
      try {
        this.child.stdin.write(encode({ id, call: name, args }))
      } catch {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(new Error(NOT_RUNNING))
      }
    })
  }

  /** Asks the core to stop. When it has not ended after `timeoutMs`, it is killed (`killCore`). */
  shutdown(timeoutMs = 10_000): Promise<void> {
    if (!this.child || this.stopped) return Promise.resolve()
    this.shutdownInFlight ??= this.stopCore(this.child, timeoutMs)
    return this.shutdownInFlight
  }

  private async stopCore(child: ChildLike, timeoutMs: number): Promise<void> {
    this.asked = true
    const ended = new Promise<void>((resolve) => this.once('stopped', () => resolve()))
    this.call('shutdown', {}, timeoutMs).catch(() => {})
    let timer: ReturnType<typeof setTimeout> | undefined
    const late = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs)
    })
    await Promise.race([ended, late])
    clearTimeout(timer)
    if (this.stopped) return
    if (child.pid !== undefined) this.kill(child.pid)
    this.finish()
  }

  private onLine(line: string): void {
    if (this.stopped) return // what was still in the pipe after the kill or the exit
    let message: unknown
    try {
      message = JSON.parse(line)
    } catch {
      this.ignore(line)
      return
    }
    if (typeof message !== 'object' || message === null || Array.isArray(message)) {
      this.ignore(line)
      return
    }
    const fields = message as Record<string, unknown>
    if (typeof fields.event === 'string' && EVENT_NAMES.has(fields.event)) {
      this.channelStarted = true
      if (fields.event === 'ready' && typeof fields.link === 'string') this.linkText = fields.link
      this.emit('event', fields as unknown as CoreEvent)
    } else if (typeof fields.id === 'number' && ('result' in fields || typeof fields.error === 'string')) {
      this.channelStarted = true
      this.answer(fields.id, fields)
    } else {
      this.ignore(line)
    }
  }

  private answer(id: number, fields: Record<string, unknown>): void {
    const waiting = this.pending.get(id)
    if (!waiting) return // late (after its timeout) or not ours
    this.pending.delete(id)
    clearTimeout(waiting.timer)
    if (typeof fields.error === 'string') waiting.reject(new Error(fields.error))
    else waiting.resolve(fields.result as never)
  }

  private ignore(line: string): void {
    this.ignored++
    if (!this.channelStarted) this.lastIgnored = line
  }

  private onExit(code: number | null): void {
    if (!this.stopped) this.code = code
    this.finish()
  }

  /** The core is gone, by itself or by the kill: say so once, and let no call wait. */
  private finish(): void {
    if (this.stopped) return
    this.stopped = true
    for (const [, waiting] of this.pending) {
      clearTimeout(waiting.timer)
      waiting.reject(new Error(STOPPED))
    }
    this.pending.clear()
    this.emit('stopped', { unexpected: !this.asked })
  }
}

/** The real child: pipes on its input and output, its error stream ignored (the core logs to its own file), no console window. */
export function spawnCore(command: CoreCommand): ChildLike {
  const child = spawnProcess(command.program, command.args, {
    cwd: command.cwd,
    stdio: ['pipe', 'pipe', 'ignore'],
    windowsHide: true,
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  })
  child.on('error', () => {}) // a program that cannot start is told as an exit
  return {
    stdin: child.stdin,
    stdout: child.stdout,
    pid: child.pid,
    once(_event, cb) {
      // 'close' comes after the output has been read to its end, so a last `failed` is never lost to the exit; the
      // timer is for a grandchild that keeps the pipe open after the program itself has gone.
      let done = false
      const fire = (code: number | null): void => {
        if (done) return
        done = true
        cb(code)
      }
      child.once('close', fire)
      child.once('error', () => fire(null))
      child.once('exit', (code) => setTimeout(() => fire(code), 1000).unref())
    },
  }
}

/** Windows' own taskkill by its full path (a bare name is looked for in the current folder first); an unset or empty SystemRoot gives C:\Windows. */
export function taskkillPath(env: NodeJS.ProcessEnv): string {
  return path.win32.join(env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe')
}

export const TASKKILL = taskkillPath(process.env)

/**
 * Whether Windows ended the core, not a fault of its own: the console control end (0xC000013A), which a sign-out or a
 * shutdown gives a program that has a console, as the frozen core has. Node reports it unsigned; the signed form is kept too.
 */
export function endedByWindows(code: number | null): boolean {
  return code === 0xc000013a || code === -1073741510
}

/**
 * The arguments of the kill. The packaged core is one process, and the update installer it starts (and a browser or
 * Explorer it opened) is its child but must outlive it, so nothing but the core is killed. In development the venv's
 * python.exe is a launcher that starts the real interpreter as its child, so the whole tree goes.
 */
export function killArgs(pid: number, packaged: boolean): string[] {
  return packaged ? ['/PID', String(pid), '/F'] : ['/PID', String(pid), '/T', '/F']
}

export function killCore(pid: number, packaged: boolean): void {
  spawnSync(TASKKILL, killArgs(pid, packaged), { windowsHide: true, timeout: 10_000 })
}
