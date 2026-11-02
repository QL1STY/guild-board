import { useState } from 'react'
import { duration } from '../format.ts'
import { useTick } from '../live.ts'
import { readyTime, timeLeft } from '../pages/timersview.ts'
import type { Widget } from '../types.ts'
import { Bar, Seal } from '../ui/marks.tsx'
import { useRoving } from '../ui/roving.ts'
import { useHead, type WidgetContext, type WidgetType } from './widget.ts'
import { periodProgress, playColumns, playFigure, playSession } from './widgetview.ts'

const DAY_MS = 86_400_000
/** The days of a week: its bar has a notch for each. */
const WEEK_DAYS = 7

/**
 * The daily reset and the weekly one (look pass spec 9.9), each a bar across the period that ends at it: the game day
 * from one 04:00 server time to the next, the week from one Monday 04:00 to the next with a notch at each day. Both are
 * exact from the next reset times. With the time left beside its bar, and with room, the clock time of the reset. On the
 * core's clock.
 */
function ResetsView({ ctx }: { widget: Widget; ctx: WidgetContext }) {
  useTick(1000)
  if (ctx.board === null) return <p className="wid-line">Reading the resets…</p>
  const { daily_at: daily, weekly_at: weekly } = ctx.board.resets
  const now = ctx.live.now()
  const left = (at: string) => timeLeft((Date.parse(at) - now.getTime()) / 1000)
  return (
    <div className="resets">
      <div className="reset-bars" data-centre>
        <div className="reset">
          <span className="reset-name">Daily reset</span>
          <Bar value={periodProgress(daily, DAY_MS, now)} max={1} />
          <span className="reset-at">{readyTime(daily, now)}</span>
          <span className="reset-left">{left(daily)}</span>
        </div>
        <div className="reset">
          <span className="reset-name">Weekly reset</span>
          <Bar value={periodProgress(weekly, WEEK_DAYS * DAY_MS, now)} max={1} notches={WEEK_DAYS} />
          <span className="reset-at">{readyTime(weekly, now)}</span>
          <span className="reset-left">{left(weekly)}</span>
        </div>
      </div>
    </div>
  )
}

/** A length of play in strong figures with its units small: "1h 33min". A screen reader is given the length in words. */
function PlayFigure({ minutes }: { minutes: number }) {
  const { hours, minutes: rest } = playFigure(minutes)
  return (
    <span className="fig">
      <span className="sr-only">{duration(minutes)}</span>
      <span aria-hidden="true">
        {hours > 0 && (
          <>
            {hours}
            <small>h</small>{' '}
          </>
        )}
        {rest}
        <small>min</small>
      </span>
    </span>
  )
}

/**
 * Whether the game runs, as Guild Board sees it from the process list, and for how long (look pass spec 9.10). The visual
 * centre is a seal, "Playing now" in the ready green or a quiet "Not playing", and under it the session so far in large
 * figures while the game runs and the last session's length when it does not. Today's play is in the heading. From a
 * width of three cells, or two cells tall, the last seven game days come as columns, today's last and in the accent gold:
 * one series on a baseline, each named by its day and minutes for a screen reader (the playtime calendar's words), and one
 * tab stop for the keyboard, whose arrows move between them. While a column is pointed at or has the focus, the heading
 * says that day's minutes instead of today's: a tooltip would be cut off by the frame. It ticks every 15 seconds.
 */
function PlaytimeView({ ctx }: { widget: Widget; ctx: WidgetContext }) {
  useTick(15_000)
  const playtime = ctx.board === null ? null : ctx.board.playtime
  const columns = playColumns(playtime === null ? [] : playtime.week)
  const roving = useRoving(columns.length)
  // The column the pointer or the focus came to last; each leaves it only when it is the one that is on it.
  const [pointed, setPointed] = useState<number | null>(null)
  const leave = (index: number) => setPointed((current) => (current === index ? null : current))
  useHead({
    meta:
      playtime === null
        ? null
        : pointed !== null && pointed < columns.length
          ? columns[pointed].tip
          : `Today ${duration(playtime.today_minutes)}`,
  })
  if (playtime === null) return <p className="wid-line">Reading the play time…</p>
  const session = playSession(playtime, ctx.live.status?.game.last_session_minutes ?? null, ctx.live.now())
  return (
    <div className="play">
      <div className="play-now" data-centre>
        <p>
          <Seal quiet={!session.playing}>{session.playing ? 'Playing now' : 'Not playing'}</Seal>
        </p>
        <p className="play-session">
          {session.minutes === null ? (
            <span className="play-what">No session yet</span>
          ) : (
            <>
              <PlayFigure minutes={session.minutes} />
              <span className="play-what">{session.playing ? 'this session' : 'last session'}</span>
            </>
          )}
        </p>
      </div>
      {columns.length > 0 && (
        <div className="play-week" role="group" aria-label="Playtime of the last seven days">
          {columns.map((column, index) => {
            const own = roving(index)
            return (
              <div
                key={column.day}
                className={`pw-col${column.today ? ' today' : ''}${column.none ? ' none' : ''}`}
                role="img"
                aria-label={column.tip}
                {...own}
                onFocus={() => {
                  own.onFocus()
                  setPointed(index)
                }}
                onBlur={() => leave(index)}
                onPointerEnter={() => setPointed(index)}
                onPointerLeave={() => leave(index)}
              >
                <span className="pw-plot">
                  <span className="pw-bar" style={{ height: `${Number((column.share * 100).toFixed(2))}%` }} />
                </span>
                <span className="pw-day">{column.label}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export const RESETS: WidgetType = {
  id: 'resets',
  name: 'Resets',
  about: 'Time to the daily and the weekly reset.',
  sign: 'cycle',
  min: { w: 2, h: 1 },
  max: { w: 4, h: 2 },
  start: { w: 2, h: 1 },
  settings: {},
  View: ResetsView,
}

export const PLAYTIME: WidgetType = {
  id: 'playtime',
  name: 'Playtime',
  about: 'Whether the game runs, this session and today.',
  sign: 'play',
  min: { w: 2, h: 1 },
  max: { w: 4, h: 2 },
  start: { w: 2, h: 1 },
  settings: {},
  View: PlaytimeView,
}
