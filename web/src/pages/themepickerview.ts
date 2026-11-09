import { type ThemeName, type ThemeSetting } from '../theme.ts'
import { nextIndex } from '../ui/roving.ts'

/** One tile of the theme picker (the themes design, section 2): the value it chooses, its name and its two words. */
export type ThemeOption = { value: ThemeSetting; name: string; words: string }

/** The thirteen tiles in the order they sit in: the five looks, Match Windows, then the seven nations (the themes design, section 12). */
export const THEME_OPTIONS: readonly ThemeOption[] = [
  { value: 'parchment', name: 'Parchment', words: 'Warm light' },
  { value: 'midnight', name: 'Midnight', words: 'True dark' },
  { value: 'slate', name: 'Slate', words: 'Soft dark' },
  { value: 'dusk', name: 'Dusk', words: 'Warm dark' },
  { value: 'mist', name: 'Mist', words: 'Cool light' },
  { value: 'system', name: 'Match Windows', words: 'Day and night' },
  { value: 'mondstadt', name: 'Mondstadt', words: 'Sky light' },
  { value: 'liyue', name: 'Liyue', words: 'Lacquer dark' },
  { value: 'inazuma', name: 'Inazuma', words: 'Sakura night' },
  { value: 'sumeru', name: 'Sumeru', words: 'Forest light' },
  { value: 'fontaine', name: 'Fontaine', words: 'Court blue' },
  { value: 'natlan', name: 'Natlan', words: 'Basalt dark' },
  { value: 'snezhnaya', name: 'Snezhnaya', words: 'Frost light' },
]

/** The small "Nations" mark in the row stands before this tile, the first of the seven. It is a label only: no tab stop, no radio. */
export const NATIONS_FROM: ThemeSetting = 'mondstadt'
export const NATIONS_LABEL = 'Nations'

/** The air kept between a tile and the edge of the row when it is scrolled into view. */
const TILE_MARGIN = 12

/** The row's `scroll-padding-inline` (themepicker.css): where a tile that the row snaps to stands from the row's edge. */
export const SNAP_PADDING = 8

/** What the row's scroll shows: how far it has scrolled, how wide it is and how wide all its tiles are. */
export type RowScroll = { scrollLeft: number; viewWidth: number; scrollWidth: number }

/**
 * Where the row must scroll to show a tile that sits at `tileLeft` for `tileWidth` (measured from the row's own left edge,
 * scrolled content included): the new `scrollLeft`, or null when the tile already shows with its margin. Never below 0 and never
 * past the end.
 *
 * The row snaps to the start of a tile (scroll-snap-type: x proximity), and a scroll that ends between two snap points is pulled
 * to one and can cut the tile again. So `snaps`, the scroll positions at which a tile stands at the row's edge (ascending), lets
 * the target be one of them: the first one that shows the tile whole when it is cut off on the right, and the tile's own when it
 * is cut off on the left.
 */
export function scrollLeftToShow(row: RowScroll & { tileLeft: number; tileWidth: number; snaps?: readonly number[] }): number | null {
  const max = Math.max(0, row.scrollWidth - row.viewWidth)
  const left = row.tileLeft - TILE_MARGIN
  const right = row.tileLeft + row.tileWidth + TILE_MARGIN
  let target = row.scrollLeft
  if (left < row.scrollLeft) {
    target = row.snaps === undefined ? left : row.tileLeft - SNAP_PADDING
  } else if (right > row.scrollLeft + row.viewWidth) {
    target = right - row.viewWidth
    if (row.snaps !== undefined) target = row.snaps.find((snap) => snap >= target) ?? target
  }
  target = Math.min(max, Math.max(0, target))
  return target === row.scrollLeft ? null : target
}

/** Whether more of the row lies to the right of what shows: the fade at the right edge stands while it does. */
export function moreToTheRight(row: RowScroll): boolean {
  return row.scrollLeft + row.viewWidth < row.scrollWidth - 1
}

/** A wheel turn in pixels: `deltaMode` 0 counts pixels, 1 lines (16 pixels each) and 2 pages (the row's width). */
export function wheelPixels(delta: number, deltaMode: number, viewWidth: number): number {
  if (deltaMode === 1) return delta * 16
  if (deltaMode === 2) return delta * viewWidth
  return delta
}

/**
 * How far a mouse wheel over the row scrolls it sideways: the wheel's vertical turn, or null when the browser should have the
 * event (a gesture that is already sideways, a row with nowhere to go, or the row at the end the wheel turns toward, so the page
 * keeps its own wheel there).
 */
export function sidewaysWheel(wheel: RowScroll & { deltaX: number; deltaY: number }): number | null {
  if (wheel.deltaY === 0 || Math.abs(wheel.deltaX) >= Math.abs(wheel.deltaY)) return null
  const max = wheel.scrollWidth - wheel.viewWidth
  if (max <= 0) return null
  if (wheel.deltaY < 0 && wheel.scrollLeft <= 0) return null
  if (wheel.deltaY > 0 && wheel.scrollLeft >= max - 1) return null
  return wheel.deltaY
}

/** A tile's accessible name: "Midnight, True dark". */
export function optionLabel(option: ThemeOption): string {
  return `${option.name}, ${option.words}`
}

/**
 * The themes whose tiny Boards a tile draws, the one underneath first: a theme draws its own, and Match Windows draws
 * Parchment with Midnight cut over it on the diagonal, day and night.
 */
export function boardsOf(value: ThemeSetting): ThemeName[] {
  return value === 'system' ? ['parchment', 'midnight'] : [value]
}

/**
 * The choice a key makes from the tile of `current`: the next tile's value, the same one at an end of the row (as the
 * Segmented control does), or null when the key is not one of the arrows, Home or End.
 */
export function themeAfterKey(key: string, current: ThemeSetting): ThemeSetting | null {
  const index = Math.max(0, THEME_OPTIONS.findIndex((option) => option.value === current))
  const next = nextIndex(key, index, THEME_OPTIONS.length)
  return next === null ? null : THEME_OPTIONS[next].value
}

/** Where a choice is kept: the core's setting, or, in the site's browser demo (which has no core to write to), the visitor's own choice. */
export function choiceGoesTo(siteDemo: boolean): 'setting' | 'site' {
  return siteDemo ? 'site' : 'setting'
}

/** The tile that shows as chosen: the setting, or in the site demo the visitor's choice; Parchment when there is none or it is unknown. */
export function shownTheme(siteDemo: boolean, setting: ThemeSetting | undefined, visitor: ThemeSetting | null): ThemeSetting {
  const chosen = siteDemo ? visitor : (setting ?? null)
  return THEME_OPTIONS.find((option) => option.value === chosen)?.value ?? 'parchment'
}
