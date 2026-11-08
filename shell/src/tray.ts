/**
 * The tray icon's menu (tray.py): Open, Sync now, Pause syncing, Show pinned widgets, Move the overlay to the main display,
 * and Quit. The pause item reads Resume syncing while paused, and the pinned check follows the settings. A demo has no overlay, so it has neither overlay item.
 * Nothing here touches Electron: `main.ts` turns the items into a native menu in `setMenu`.
 */
import type { Settings } from './protocol.js'

export interface TrayItem {
  label?: string
  type?: 'normal' | 'separator' | 'checkbox'
  checked?: boolean
  click?: (item: { checked: boolean }) => void
}

export interface TrayDeps {
  demo: boolean
  openWindow(): void
  syncNow(): void | Promise<unknown>
  setPaused(paused: boolean): void | Promise<unknown>
  setPinned(pinned: boolean): void | Promise<unknown>
  toMainDisplay(): void | Promise<unknown>
  quit(): void
  /** Puts these items in the tray icon's menu, in place of the ones before. */
  setMenu(items: TrayItem[]): void
  /** `cb` runs when the icon is clicked. */
  onClick(cb: () => void): void
  /** A line for the log. */
  warn?(text: string): void
}

// The pause item's text and the pinned check as the settings have them by default, until the settings arrive (tray.py).
const DEFAULTS = { paused: false, pinned: true }

export class TrayMenu {
  private paused = DEFAULTS.paused
  private pinned = DEFAULTS.pinned

  constructor(private readonly deps: TrayDeps) {
    deps.onClick(() => this.run('Open', deps.openWindow))
    this.draw()
  }

  /** The settings, once before the window and after every change: the pause item's text and the pinned check follow them. */
  update(settings: Settings): void {
    const paused = settings.sync_paused === true
    const pinned = settings.overlay_pinned !== false
    if (paused === this.paused && pinned === this.pinned) return
    this.paused = paused
    this.pinned = pinned
    this.draw()
  }

  private draw(): void {
    const { deps } = this
    const items: TrayItem[] = [
      { label: 'Open', click: () => this.run('Open', deps.openWindow) },
      { label: 'Sync now', click: () => this.run('Sync now', deps.syncNow) },
      // A plain item as Qt had it (tray.py): its text says what a click does, and a click sends the opposite of the state.
      { label: this.paused ? 'Resume syncing' : 'Pause syncing', click: () => this.run('Pause syncing', () => deps.setPaused(!this.paused)) },
      { type: 'separator' },
    ]
    if (!deps.demo) {
      items.push(
        { label: 'Show pinned widgets', type: 'checkbox', checked: this.pinned, click: (item) => this.run('Show pinned widgets', () => deps.setPinned(item.checked)) },
        { label: 'Move the overlay to the main display', click: () => this.run('Move the overlay to the main display', deps.toMainDisplay) },
        { type: 'separator' },
      )
    }
    items.push({ label: 'Quit', click: () => this.run('Quit', deps.quit) })
    deps.setMenu(items)
  }

  /**
   * A failure goes into the log and no further. The check that was clicked has flipped natively and the setting may not
   * have, so the menu is drawn again from what the settings said last.
   */
  private run(name: string, fn: () => void | Promise<unknown>): void {
    const failed = (): void => {
      this.deps.warn?.(`The tray item ${name} failed.`)
      if (name === 'Show pinned widgets') this.draw() // the check flipped natively, and the setting did not
    }
    try {
      const result = fn()
      if (result instanceof Promise) result.catch(failed)
    } catch {
      failed()
    }
  }
}
