/** The overlay's hotkey: the settings' text, such as "Ctrl+Alt+G", as an Electron accelerator, and its global registration. */

// The modifiers in the order the settings name them, each with Electron's name for it (hotkeys.py: MODIFIERS).
const MODIFIERS: readonly (readonly [string, string])[] = [
  ['ctrl', 'Control'],
  ['alt', 'Alt'],
  ['shift', 'Shift'],
  ['win', 'Super'],
]
// The keys the settings can hold: A to Z, 0 to 9 and F1 to F12.
const KEY = /^(?:[A-Z0-9]|F(?:[1-9]|1[0-2]))$/

/**
 * The accelerator a hotkey text names, or null when it names none: modifiers named once each, in any case and order,
 * then one key. Beyond `parse_hotkey`, a hotkey with none of Ctrl, Alt or Win is null too: registered globally it would
 * take that key from everything the player types (`hotkey_problem`'s second rule).
 */
export function toAccelerator(hotkey: string): string | null {
  const parts = hotkey.split('+').map((part) => part.trim())
  const key = parts.pop()?.toUpperCase() ?? ''
  if (!KEY.test(key)) return null
  const named = new Set<string>()
  for (const part of parts) {
    const found = MODIFIERS.find(([name]) => name === part.toLowerCase())
    if (found === undefined || named.has(found[0])) return null
    named.add(found[0])
  }
  if (!named.has('ctrl') && !named.has('alt') && !named.has('win')) return null
  return [...MODIFIERS.filter(([name]) => named.has(name)).map(([, accelerator]) => accelerator), key].join('+')
}

/** Whether the hotkey is registered: held by Guild Board, refused because another program holds it, or none to hold. */
export type HotkeyState = 'held' | 'taken' | 'none'

export class Hotkey {
  private accelerator: string | null = null // the one this object registered, and so the only one it lets go of
  private current: HotkeyState = 'none'

  /** `register` is `globalShortcut.register` and `unregister` is `globalShortcut.unregister`. */
  constructor(
    private readonly register: (accelerator: string, cb: () => void) => boolean,
    private readonly unregister: (accelerator: string) => void,
  ) {}

  get state(): HotkeyState {
    return this.current
  }

  /**
   * Asks Windows for the hotkey, letting go of the one held before. 'taken' when another program holds it, and it is
   * asked for again with every call; 'none' when the text names no hotkey.
   */
  hold(hotkey: string, cb: () => void): HotkeyState {
    this.release()
    const accelerator = toAccelerator(hotkey)
    if (accelerator === null) return this.current
    let ok: boolean
    try {
      ok = this.register(accelerator, cb)
    } catch {
      ok = false
    }
    if (ok) this.accelerator = accelerator
    this.current = ok ? 'held' : 'taken'
    return this.current
  }

  /** Lets go of the hotkey held, if any. */
  release(): void {
    if (this.accelerator !== null) this.unregister(this.accelerator)
    this.accelerator = null
    this.current = 'none'
  }
}
