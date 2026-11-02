import { useTick } from '../live.ts'
import type { Widget } from '../types.ts'
import { settingsOf, useHead, useOneCell, type WidgetContext, type WidgetType } from './widget.ts'
import { clockText, dayLine, SERVER_NAMES, serverClock } from './widgetview.ts'

type ClockSettings = { seconds: boolean }
const DEFAULTS: ClockSettings = { seconds: false }

/** The point at `radius` from the dial's centre, `turn` of the way round from twelve o'clock (0 to 1). */
function round(turn: number, radius: number): { x: number; y: number } {
  const angle = turn * 2 * Math.PI
  return { x: 100 + radius * Math.sin(angle), y: 100 - radius * Math.cos(angle) }
}

/** A diamond, the app's mark, at a point. */
function diamond({ x, y }: { x: number; y: number }, size: number): string {
  return `M${x} ${y - size}L${x + size} ${y}L${x} ${y + size}L${x - size} ${y}Z`
}

/**
 * The dial, drawn after the clock of Istaroth, the Aeon of Time (an own drawing, not the game's art): a double gold ring,
 * the hours as ticks with diamonds at the quarters, an inner orbit with four small stars between them, and the hands of
 * this PC's time on the core's clock. The hands step with the time; nothing turns by itself.
 */
function Dial({ now, seconds }: { now: Date; seconds: boolean }) {
  const minutes = now.getMinutes() + (seconds ? now.getSeconds() / 60 : 0)
  const hours = (now.getHours() % 12) + minutes / 60
  const hand = (turn: number, length: number, className: string) => {
    const tip = round(turn, length)
    const tail = round(turn + 0.5, length * 0.18)
    return <line className={className} x1={tail.x} y1={tail.y} x2={tip.x} y2={tip.y} />
  }
  return (
    <svg className="clock-face" viewBox="0 0 200 200" aria-hidden="true">
      <circle className="cf-plate" cx="100" cy="100" r="95" />
      <circle className="cf-ring" cx="100" cy="100" r="95" />
      <circle className="cf-ring thin" cx="100" cy="100" r="88" />
      <circle className="cf-orbit" cx="100" cy="100" r="62" />
      {Array.from({ length: 12 }, (_, hour) =>
        hour % 3 === 0 ? (
          <path key={hour} className="cf-quarter" d={diamond(round(hour / 12, 79), 6)} />
        ) : (
          <line
            key={hour}
            className="cf-tick"
            x1={round(hour / 12, 74).x}
            y1={round(hour / 12, 74).y}
            x2={round(hour / 12, 84).x}
            y2={round(hour / 12, 84).y}
          />
        ),
      )}
      {[1, 3, 5, 7].map((eighth) => (
        <path key={eighth} className="cf-star" d={diamond(round(eighth / 8, 62), 3.2)} />
      ))}
      {hand(hours / 12, 46, 'cf-hour')}
      {hand(minutes / 60, 70, 'cf-minute')}
      {seconds && hand(now.getSeconds() / 60, 78, 'cf-second')}
      <path className="cf-pin" d={diamond({ x: 100, y: 100 }, 7)} />
      <circle className="cf-pin-dot" cx="100" cy="100" r="2.2" />
    </svg>
  )
}

/**
 * This PC's time (look pass spec 9.13, as the player asked after its check): a gold dial with its hands and the time in
 * tabular figures on a plate inside it, and under it the day and the server's time with its name, on the core's clock.
 * One cell tall the day and the server stand beside the dial; at one cell wide the server's time is in the heading
 * instead, and the body keeps the dial and the day.
 */
function ClockView({ widget, ctx }: { widget: Widget; ctx: WidgetContext }) {
  const { seconds } = settingsOf(widget, DEFAULTS)
  useTick(1000)
  const { ref, narrow } = useOneCell()
  const now = ctx.live.now()
  const server = ctx.board?.server
  const serverTime = server === undefined ? null : serverClock(now, server.utc_offset_hours, seconds)
  useHead({ meta: narrow && serverTime !== null ? `Server ${serverTime}` : null })
  return (
    <div ref={ref} className="clock">
      <div className="clock-dial" data-centre>
        <Dial now={now} seconds={seconds} />
        <p className="fig">{clockText(now, seconds)}</p>
      </div>
      <div className="side">
        <span>{dayLine(now)}</span>
        {server !== undefined && (
          <span className="srv">
            Server <b>{serverTime}</b> · {SERVER_NAMES.get(server.key) ?? server.key}
          </span>
        )}
      </div>
    </div>
  )
}

function ClockSettingsForm({ widget, change }: { widget: Widget; change: (settings: Record<string, unknown>) => void }) {
  const { seconds } = settingsOf(widget, DEFAULTS)
  return (
    <label className="wid-check">
      <input
        type="checkbox"
        checked={seconds}
        onChange={(event) => change({ ...widget.settings, seconds: event.target.checked })}
      />
      Show seconds
    </label>
  )
}

export const CLOCK: WidgetType = {
  id: 'clock',
  name: 'Clock',
  about: "Your time and the server's.",
  sign: 'clock',
  min: { w: 1, h: 1 },
  max: { w: 3, h: 2 },
  start: { w: 2, h: 1 },
  settings: DEFAULTS,
  View: ClockView,
  Settings: ClockSettingsForm,
}
