import { useState } from 'react'
import '../styles/widget-playtime.css'
import '../styles/widget-primogems.css' // the switches of Settings are its rows
import { duration } from '../format.ts'
import { useTick } from '../live.ts'
import { readyTime, timeLeft } from '../pages/timersview.ts'
import type { Widget } from '../types.ts'
import { Bar, Seal } from '../ui/marks.tsx'
import { useRoving } from '../ui/roving.ts'
import { Segmented } from '../ui/Segmented.tsx'
import { Sign } from '../ui/Sign.tsx'
import { PLAY_STYLES, playStyle, playTotal, type PlayStyle } from './playtimeview.ts'
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
function PlaytimeView({ widget, ctx }: { widget: Widget; ctx: WidgetContext }) {
  useTick(15_000)
  const style = playStyle(widget.settings)
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
  const total = playTotal(playtime)
  const sessionWords = session.minutes === null ? null : session.playing ? 'this session' : 'last session'
  const week =
    columns.length > 0 ? (
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
    ) : null
  if (style === 'plate') {
    return (
      <div className="play play-plate">
        <div className="play-plates" data-centre>
          <div className="pl">
            <p>
              <Seal quiet={!session.playing}>{session.playing ? 'Playing now' : 'Not playing'}</Seal>
            </p>
            {session.minutes === null ? (
              <span className="play-what">No session yet</span>
            ) : (
              <>
                <PlayFigure minutes={session.minutes} />
                <span className="sr-only">{sessionWords}</span>
              </>
            )}
          </div>
          {total !== null && (
            <div className="pl gold" aria-label={total.spoken} role="group">
              <span className="lbl" aria-hidden="true">
                <Sign name="hourglass" />
                In all
              </span>
              <span className="fig" aria-hidden="true">
                {total.value}
                <small>{total.unit}</small>
              </span>
            </div>
          )}
        </div>
        {week}
        {total !== null && <p className="play-foot">Counted by Guild Board since {total.since}</p>}
      </div>
    )
  }
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
              <span className="play-what">{sessionWords}</span>
            </>
          )}
        </p>
      </div>
      {week}
      {total !== null && (
        <div className="play-total">
          <span className="sr-only">{total.spoken}</span>
          <span className="fig" aria-hidden="true">
            {total.value}
            <small>{total.unit}</small>
          </span>
          <span aria-hidden="true">in all</span>
          <span aria-hidden="true">
            since <b>{total.since}</b>
          </span>
        </div>
      )}
      {total !== null && (
        <p className="play-foot">
          <span className="sr-only">{total.spoken}</span>
          <span aria-hidden="true">
            <b>
              {total.value} {total.unit}
            </b>{' '}
            in all · counted since {total.since}
          </span>
        </p>
      )}
    </div>
  )
}

/** Its style: the total beside the rest in quiet figures, or on a gold plate. */
function PlaytimeSettingsForm({
  widget, change,
}: { widget: Widget; ctx: WidgetContext; change: (settings: Record<string, unknown>) => void }) {
  const style = playStyle(widget.settings)
  return (
    <fieldset className="pm-set">
      <legend>Style</legend>
      <div className="pm-set-row">
        <span>
          The total in all
          <small>{PLAY_STYLES.find((one) => one.id === style)?.about}</small>
        </span>
        <span className="play-styles">
          <Segmented<PlayStyle>
            label="Style"
            options={PLAY_STYLES.map((one) => ({ value: one.id, label: one.name }))}
            value={style}
            onChange={(value) => change({ ...widget.settings, style: value })}
          />
        </span>
      </div>
    </fieldset>
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
  about: 'Whether the game runs, this session, today and the time in all.',
  sign: 'play',
  min: { w: 2, h: 1 },
  max: { w: 4, h: 2 },
  start: { w: 2, h: 1 },
  settings: {},
  View: PlaytimeView,
  Settings: PlaytimeSettingsForm,
}
