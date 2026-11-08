/** Where the dashboard window opens: on the second display the first time, then where it was left (placement.py). */
import { readFileSync, renameSync, writeFileSync } from 'node:fs'

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

export interface Placement extends Bounds {
  maximized: boolean
}

// A window can be dragged back only when this much of it lies on one display.
export const GRAB_WIDTH = 100
export const GRAB_HEIGHT = 100

// The window of a start with nothing to place it on (no display at all).
const FALLBACK: Bounds = { x: 0, y: 0, width: 1440, height: 900 }

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * The place last saved, or null: no file, JSON that does not read, or an object without numeric x, y, width and height.
 * The Qt shell kept `{"geometry": "<base64>"}` in the same file; that is null too, so the first start after the update
 * opens at the first-run place.
 */
export function readPlacement(file: string): Placement | null {
  let value: unknown
  try {
    value = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const { x, y, width, height, maximized } = value as Record<string, unknown>
  if (!finite(x) || !finite(y) || !finite(width) || !finite(height)) return null
  return { x, y, width, height, maximized: maximized === true }
}

/** Keeps the place; a write cut short leaves the last one as it was. Throws when the folder cannot be written. */
export function writePlacement(file: string, p: Placement): void {
  const part = `${file}.part`
  const text = JSON.stringify({ x: p.x, y: p.y, width: p.width, height: p.height, maximized: p.maximized })
  writeFileSync(part, text, 'utf8')
  renameSync(part, file)
}

function onSomeDisplay(frame: Bounds, workAreas: Bounds[]): boolean {
  return workAreas.some((area) => {
    const width = Math.min(frame.x + frame.width, area.x + area.width) - Math.max(frame.x, area.x)
    const height = Math.min(frame.y + frame.height, area.y + area.height) - Math.max(frame.y, area.y)
    return width >= GRAB_WIDTH && height >= GRAB_HEIGHT
  })
}

/** The first display that is not the main one, or the main one when it is alone. */
function firstRunDisplay(count: number, primary: number): number {
  for (let index = 0; index < count; index++) if (index !== primary) return index
  return primary
}

/**
 * Where the window opens: the saved place when at least 100 by 100 pixels of it lie on one display, otherwise the
 * first-run place: the first display that is not the main one, maximized.
 */
export function restoredBounds(
  saved: Placement | null,
  workAreas: Bounds[],
  primary: number,
): { bounds: Bounds; maximized: boolean } {
  if (saved !== null && onSomeDisplay(saved, workAreas)) {
    const { maximized, ...bounds } = saved
    return { bounds, maximized }
  }
  if (workAreas.length === 0) return { bounds: { ...FALLBACK }, maximized: false }
  const area = workAreas[firstRunDisplay(workAreas.length, primary)]
  return { bounds: { x: area.x, y: area.y, width: area.width, height: area.height }, maximized: true }
}
