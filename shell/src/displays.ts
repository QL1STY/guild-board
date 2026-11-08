/** The displays as the Overlay settings offer them, and the one the overlay covers (app.py: `display_list`, `screen_for`). */
import type { Bounds } from './placement.js'

export interface DisplayInfo {
  id: number
  bounds: Bounds
  scaleFactor: number
  primary: boolean
}

/** What the core's Overlay settings are told: `overlay_shell`'s `displays`. */
export interface DisplayEntry {
  name: string
  label: string
  primary: boolean
}

/**
 * Each display by the name the settings keep, its id, with a label the player reads, such as "Display 1, 3440 × 1440,
 * main". Displays are numbered from the left (then from the top), and the size is in the display's own pixels, as
 * Windows' display settings give it: Electron's size times the display's scaling.
 */
export function displayList(displays: DisplayInfo[]): DisplayEntry[] {
  const ordered = [...displays].sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y)
  return ordered.map((display, index) => {
    const width = Math.round(display.bounds.width * display.scaleFactor)
    const height = Math.round(display.bounds.height * display.scaleFactor)
    const label = `Display ${index + 1}, ${width} × ${height}`
    return { name: String(display.id), label: display.primary ? `${label}, main` : label, primary: display.primary }
  })
}

/**
 * The display the player chose, by its name. The main display when none was chosen (""), and when the chosen one is gone,
 * unplugged or named otherwise after a change of setup (the Qt shell kept names such as `\\.\DISPLAY2`): the overlay is
 * never off screen. `displays` is not empty.
 */
export function displayFor(displays: DisplayInfo[], name: string): DisplayInfo {
  if (name !== '') {
    const named = displays.find((display) => String(display.id) === name)
    if (named !== undefined) return named
  }
  return displays.find((display) => display.primary) ?? displays[0]
}
