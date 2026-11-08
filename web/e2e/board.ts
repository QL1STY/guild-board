import type { Locator, Page } from '@playwright/test'
import type { BoardModel, Layout, Status, Widget } from '../src/types.ts'
import { changeAnswer } from './answers.ts'
import type { Api } from './fixtures.ts'

/** A widget on the Board, by its id. Browser tests find widgets by their ids or names, never by their places. */
export const widgetById = (page: Page, id: string): Locator => page.locator(`[data-widget="${id}"]`)

/** The ids of the Board's widgets, in their order. */
export async function widgetIds(page: Page): Promise<string[]> {
  return page
    .getByTestId('board')
    .locator('[data-widget]')
    .evaluateAll((all) => all.map((one) => one.getAttribute('data-widget') ?? ''))
}

/** The Board's layout as the core holds it. */
export async function layoutOf(api: Api): Promise<Layout> {
  return api.get<Layout>('/api/layouts/board')
}

/** Puts these widgets on the Board through the core, over the revision it has, and reads the page again. */
export async function setBoard(api: Api, page: Page, widgets: Widget[]): Promise<void> {
  const { revision } = await layoutOf(api)
  await api.put('/api/layouts/board', { revision, widgets })
  await page.reload()
}

/** A clock widget at its first size. */
export const clockWidget = (id: string): Widget => ({ id, type: 'clock', w: 2, h: 1, settings: {} })

/** The width of each of the Board's columns, which share its width: at least 168 pixels. */
export async function columnOf(page: Page): Promise<number> {
  return page.getByTestId('board').evaluate((grid) => parseFloat(getComputedStyle(grid).gridTemplateColumns))
}

/** A cell of the Board's grid with its gap after it: a column and 12 pixels across, 96 and 12 down. */
export async function pitchOf(page: Page): Promise<{ x: number; y: number }> {
  return { x: (await columnOf(page)) + 12, y: 108 }
}

/** The cell where a widget shows, its column and row from 0: from the widget's box against the Board's. */
export async function cellOf(page: Page, id: string): Promise<{ x: number; y: number }> {
  const [box, board, pitch] = await Promise.all([
    widgetById(page, id).boundingBox(),
    page.getByTestId('board').boundingBox(),
    pitchOf(page),
  ])
  if (box === null || board === null) throw new Error(`The widget ${id} is not on the Board.`)
  return { x: Math.round((box.x - board.x) / pitch.x), y: Math.round((box.y - board.y) / pitch.y) }
}

/** How a drag with the mouse ends: let go (the default), or `hold` the button, for a test to look or press Escape. */
type Release = { hold?: boolean }

/**
 * A widget's box, once it is at its place: a widget that a move before pushed aside glides back (useGlide), and the
 * mouse is to take it, or its grip, where it stays.
 */
async function boxOf(page: Page, id: string) {
  await widgetById(page, id).evaluate((one) => Promise.allSettled(one.getAnimations().map((animation) => animation.finished)))
  const box = await widgetById(page, id).boundingBox()
  if (box === null) throw new Error(`The widget ${id} is not on the Board.`)
  return box
}

/** Drags a widget in Edit with the mouse: down on its heading, a few moves, and up over the cell it is to take. */
export async function dragTo(page: Page, id: string, cell: { x: number; y: number }, { hold = false }: Release = {}) {
  const box = await boxOf(page, id)
  const [head, board, pitch] = await Promise.all([
    widgetById(page, id).locator('.w-head').boundingBox(),
    page.getByTestId('board').boundingBox(),
    pitchOf(page),
  ])
  // A point of the heading left of its buttons, which keeps its place on the widget as the widget follows the mouse.
  const grab = { x: head!.x + 12, y: head!.y + head!.height / 2 }
  await page.mouse.move(grab.x, grab.y)
  await page.mouse.down()
  await page.mouse.move(board!.x + cell.x * pitch.x + grab.x - box.x, board!.y + cell.y * pitch.y + grab.y - box.y, { steps: 8 })
  if (!hold) await page.mouse.up()
}

/**
 * Resizes a widget in Edit with the mouse by one of its grips, the right edge (`e`), the bottom edge (`s`) or the
 * corner (`se`): down on the grip, a few moves, and up where the widget would be `size` cells.
 */
export async function dragGrip(
  page: Page,
  id: string,
  grip: 'e' | 's' | 'se',
  size: { w: number; h: number },
  { hold = false }: Release = {},
) {
  const [box, pitch] = await Promise.all([boxOf(page, id), pitchOf(page)])
  const now = { w: Math.round((box.width + 12) / pitch.x), h: Math.round((box.height + 12) / pitch.y) }
  const right = box.x + box.width
  const bottom = box.y + box.height
  const at = { e: { x: right - 5, y: box.y + box.height / 2 }, s: { x: box.x + box.width / 2, y: bottom - 5 }, se: { x: right - 8, y: bottom - 8 } }[grip]
  const dx = grip === 's' ? 0 : (size.w - now.w) * pitch.x
  const dy = grip === 'e' ? 0 : (size.h - now.h) * pitch.y
  await page.mouse.move(at.x, at.y)
  await page.mouse.down()
  await page.mouse.move(at.x + dx, at.y + dy, { steps: 8 })
  if (!hold) await page.mouse.up()
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** The time of day of an instant in this PC's time: "20:00". */
export function clockOf(instant: string): string {
  const at = new Date(instant)
  return [at.getHours(), at.getMinutes()].map((part) => String(part).padStart(2, '0')).join(':')
}

/** A time less than a week away as the widgets show it, in this PC's time: "Tue 20:00". */
export function shownAt(instant: string): string {
  return `${WEEKDAYS[new Date(instant).getDay()]} ${clockOf(instant)}`
}

/** What a counting number has come to on the screen. The copy that screen readers get sits beside it, out of sight. */
export const counted = (parent: Locator): Locator => parent.locator('[aria-hidden="true"]').first()

/** The numbers of a circle's stroke-dasharray, as the page set it: the style attribute writes them with a comma. */
export async function dashesOf(circle: Locator): Promise<number[]> {
  const style = (await circle.getAttribute('style')) ?? ''
  return (/stroke-dasharray:\s*([^;]+)/.exec(style)?.[1] ?? '').split(/[\s,]+/).filter(Boolean).map(Number)
}

/** A week of play ending on the demo's game day, Tuesday 13 October: Wednesday 7 to Tuesday 13, today's 45 minutes last. */
export const PLAY_WEEK: BoardModel['playtime']['week'] = [0, 95, 0, 179, 92, 93, 45].map((minutes, index) => ({
  day: `2026-10-${String(7 + index).padStart(2, '0')}`,
  minutes,
}))

/** The game as a page is shown it: whether it runs and since when, the last session, and the last seven game days. */
export type GameState = {
  running: boolean
  /** When the session that runs began; null when none does. */
  started: string | null
  /** The length of the last session in minutes, which the status gives; null before the first. */
  last: number | null
  week: BoardModel['playtime']['week']
}

/**
 * Shows the page this state of the game, whatever the player's PC is doing: the demo core reads the real Windows process
 * list, and the player may be playing while the tests run, which would put a running game and a session of the demo
 * core's own into the answers. The answers of the Board model and of the status are edited, and the event stream is cut,
 * so that only the edited answers reach the page (it reads the status again each time the stream tries to reconnect).
 * Reload the page afterwards.
 */
export async function playAs(page: Page, state: GameState): Promise<void> {
  await page.route('**/api/events', (route) => route.abort())
  await changeAnswer<BoardModel>(page, '/api/board', (board) => {
    board.playtime = {
      running: state.running,
      session_started_at: state.started,
      today_minutes: state.week.at(-1)?.minutes ?? 0,
      week: state.week,
    }
  })
  await changeAnswer<Status>(page, '/api/status', (status) => {
    status.game = { running: state.running, session_started_at: state.started, last_session_minutes: state.last }
  })
}
