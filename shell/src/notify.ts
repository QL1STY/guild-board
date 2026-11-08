/**
 * Balloons from the tray icon (app.py: _on_notify, _on_message_clicked): the core's reminders and notices, and the one-off
 * hint that closing the window keeps Guild Board running. A click on a balloon opens the place of the last one shown.
 * Nothing here touches Electron: `main.ts` hands the tray in through `TrayLike`.
 */

/** The hint at the first close of the window (app.py: STILL_RUNNING), with a title of its own. */
export const STILL_RUNNING = {
  title: 'Guild Board is still running',
  text: 'It keeps syncing from the tray. Right-click the tray icon to quit.',
} as const

const TITLE = 'Guild Board'

/** The part of Electron's `Tray` that balloons use. */
export interface TrayLike {
  displayBalloon(options: { title: string; content: string }): void
  on(event: 'balloon-click', listener: () => void): unknown
  isDestroyed?(): boolean
}

export class Notifier {
  // Where a click on the balloon on show goes: a place such as "achievements/timers", or null for the window as it is.
  // `undefined` until a balloon has been shown.
  private last: string | null | undefined = undefined

  constructor(
    private readonly tray: TrayLike,
    private readonly open: (place: string | null) => void,
  ) {
    tray.on('balloon-click', () => {
      if (this.last !== undefined) this.open(this.last)
    })
  }

  /** Shows `text` as a balloon. False when the tray is gone or Windows refused it. `kind` only names it for the caller. */
  show(_kind: string, text: string, place: string | null): boolean {
    return this.display(TITLE, text, place)
  }

  /** The hint at the first close of the window: a click on it opens the window. */
  hint(): boolean {
    return this.display(STILL_RUNNING.title, STILL_RUNNING.text, null)
  }

  private display(title: string, content: string, place: string | null): boolean {
    if (this.tray.isDestroyed?.() === true) return false
    try {
      this.tray.displayBalloon({ title, content })
    } catch {
      return false
    }
    this.last = place
    return true
  }
}
