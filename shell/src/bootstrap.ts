/**
 * Three small decisions of the start that `main.ts` wires: what the overlay is told about the game, how a tray Open before
 * the core is ready is kept, and the two calls made when the core says it is ready. They need no Electron.
 */
import type { Message, PendingMessages } from './instance.js'

/**
 * Whether the game runs, as the overlay is told: the latest news wins in either order. The core's watcher polls at once
 * after `ready`, so a `game` event can arrive before the overlay exists; the answer to `game_running` is older than any
 * event, so it counts only while no event has been heard.
 */
export class GameState {
  private latest: boolean | null = null
  private sink: ((running: boolean) => void) | null = null

  /** A `game` event. */
  heard(running: boolean): void {
    this.latest = running
    this.sink?.(running)
  }

  /** The answer to `game_running`: applied only when no event was heard. */
  answered(running: boolean): void {
    if (this.latest !== null) return
    this.heard(running)
  }

  /** The overlay exists: it is told what is known so far, and every later news. */
  attach(sink: (running: boolean) => void): void {
    this.sink = sink
    if (this.latest !== null) sink(this.latest)
  }
}

/** The tray's Open (and the icon's click): before the core is ready it waits with the later starts' messages, then runs. */
export function showRequest(pending: PendingMessages, handle: (message: Message) => void): () => void {
  return () => pending.take({ action: 'show' }, handle)
}

export interface PrepareDeps {
  demo: boolean
  acknowledged: boolean
  hasTray: boolean
  call(name: 'hello' | 'update_settings', args: object): Promise<unknown>
  warn(text: string): void
}

/**
 * The calls made when the core is ready, before the windows: `hello`, and in a demo started with `--acknowledged` the
 * statement as read (app.py: `_make_core`). A failure of either is told to the log and the windows are made anyway: with no
 * window, nothing would be left for the player to see.
 */
export async function prepareCore(deps: PrepareDeps): Promise<void> {
  try {
    await deps.call('hello', { has_tray: deps.hasTray })
  } catch {
    deps.warn('The core could not be told whether there is a tray.')
  }
  if (!deps.demo || !deps.acknowledged) return
  try {
    await deps.call('update_settings', { changes: { risk_acknowledged: true } })
  } catch {
    deps.warn('The demo’s risk statement could not be marked as read.')
  }
}
