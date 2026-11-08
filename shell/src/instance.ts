/**
 * One Guild Board per data folder. Electron's single-instance lock is per `userData`, which is `<data folder>\shell`, so a
 * demo runs beside the player's copy. The start that holds the lock writes its process id to `<data folder>\shell\guildboard.pid`;
 * a later start hands its `Message` over as the lock's additional data, and Electron delivers it to the holder as
 * `second-instance`. This file holds the decisions; main.ts wires them to Electron (`requestSingleInstanceLock`).
 */
import type { ShellArgs } from './args.js'

export type Message = { action: 'show' } | { action: 'quit' } | { action: 'invite'; code: string }

/** What a start tells the Guild Board that holds the folder: `--quit` wins, then an invite link, then to show itself. */
export function messageFor(args: ShellArgs): Message {
  if (args.quit) return { action: 'quit' }
  if (args.invite !== null) return { action: 'invite', code: args.invite }
  return { action: 'show' }
}

export const QUIT_WAIT_MS = 30_000 // how long `--quit` waits for the Guild Board that is running to end
export const POLL_MS = 200 // how often it looks whether that process is gone

// What `--quit` says (the installer's QuitGuildBoard relies on the exit codes: 0 when nothing is left running).
export const QUIT_MESSAGES = {
  not_running: 'Guild Board is not running.',
  still_running: 'Guild Board was asked to quit, but it is still running after 30 seconds.',
} as const

export type Claim = 'run' | 'sent' | 'quit' | 'not_running' | 'still_running'

/** Everything `claim` touches outside itself, so that no test needs Electron, a file or a clock. */
export interface InstanceDeps {
  /** `app.requestSingleInstanceLock(message)`: true when this start now holds the lock, false when another does. */
  requestLock(message: Message): boolean
  /** The process id in the pid file, or null when there is none. */
  readPid(): number | null
  writePid(pid: number): void
  /**
   * Whether that process is still running. It must read the Windows process list and never open the process: the id
   * comes from a file, and a stale one may now belong to the game (the hands-off rules).
   */
  alive(pid: number): boolean
  sleep(ms: number): Promise<void>
  /** Milliseconds on any steady clock. */
  now(): number
}

/**
 * What this start does. "run": it holds the folder and writes its id. "sent": another Guild Board holds the folder
 * and has been handed this start's message. For `--quit`: "not_running" when nothing held the folder, "quit" once the
 * holder's process has ended, "still_running" when it has not after 30 seconds.
 */
export async function claim(args: ShellArgs, deps: InstanceDeps, pid: number): Promise<Claim> {
  const message = messageFor(args)
  const held = deps.requestLock(message)
  if (message.action === 'quit') {
    // The lock was free: no Guild Board ran, and this start is not one either.
    if (held) return 'not_running'
    // Another start holds the folder. It writes its id just after it takes the lock, so none may be there yet: keep
    // looking until it appears, then until that process is gone, all within one deadline. Never answer "not running"
    // here: the installer would replace the files of a copy that runs.
    const deadline = deps.now() + QUIT_WAIT_MS
    // A stale id can sit in the file for a moment after the lock has changed hands, so the same id must read dead on two
    // passes in a row before the holder counts as gone.
    let deadBefore: number | null = null
    // The Guild Board that ends deletes its pid file, so the id last read stands in for the file once it is gone: the
    // process list, not the file, tells when the holder has ended.
    let known: number | null = null
    for (;;) {
      const read = deps.readPid()
      if (read !== null) known = read
      const holder = read ?? known
      if (holder !== null && !deps.alive(holder)) {
        if (deadBefore === holder) return 'quit'
        deadBefore = holder
      } else {
        deadBefore = null
      }
      if (deps.now() >= deadline) return 'still_running'
      await deps.sleep(POLL_MS)
    }
  }
  if (!held) return 'sent'
  deps.writePid(pid)
  return 'run'
}

// An invite link's code, as the core reads it (`INVITE` in args.ts, and `invite_code` in cloud/__init__.py).
const INVITE_CODE = /^[A-Za-z0-9_-]{16,64}$/

/**
 * What `second-instance` delivered, checked: any program of the user can hand Electron's lock a message, so only the three
 * shapes of `Message` pass, with no other key, and an invite's code in the form of an invite code. Anything else is null.
 */
export function messageFrom(data: unknown): Message | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null
  const keys = Object.keys(data)
  const { action } = data as { action?: unknown }
  if ((action === 'show' || action === 'quit') && keys.length === 1 && keys[0] === 'action') return { action }
  if (action === 'invite' && keys.length === 2 && keys.includes('code')) {
    const { code } = data as { code?: unknown }
    if (typeof code === 'string' && INVITE_CODE.test(code)) return { action: 'invite', code }
  }
  return null
}

/** What `--quit` prints, if anything, and the exit code it ends with. */
export function quitReport(result: Claim): { code: number; text: string | null } {
  if (result === 'not_running') return { code: 0, text: QUIT_MESSAGES.not_running }
  if (result === 'still_running') return { code: 1, text: QUIT_MESSAGES.still_running }
  return { code: 0, text: null }
}

/**
 * Messages from later starts that arrive before the window is ready wait here and run, in order and once, when it is.
 * One that arrives after runs at once.
 */
export class PendingMessages {
  private waiting: Message[] | null = []

  /** Runs `m` through `handle` at once when the window is ready, else keeps it for `ready`. */
  take(m: Message, handle: (m: Message) => void): void {
    if (this.waiting === null) handle(m)
    else this.waiting.push(m)
  }

  /** Runs what waited through `handle`, in order. A failure of one does not stop the rest; the first is thrown at the end. */
  ready(handle: (m: Message) => void): void {
    const waiting = this.waiting ?? []
    this.waiting = null
    let failure: { error: unknown } | null = null
    for (const message of waiting) {
      try {
        handle(message)
      } catch (error) {
        failure ??= { error }
      }
    }
    if (failure) throw failure.error
  }
}
