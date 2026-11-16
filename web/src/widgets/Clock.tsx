import { type Ref, useEffect, useRef, useState } from 'react'
import '../styles/widget-clock.css'
import '../styles/widget-primogems.css' // the switches of Settings are its rows
import { Segmented } from '../ui/Segmented.tsx'
import { Sign } from '../ui/Sign.tsx'
import { Switch } from '../ui/Switch.tsx'
import type { Widget } from '../types.ts'
import {
  astroDay, astroTurn, CLOCK_STYLES, type ClockSettings, clockMeta, clockSettings, formatTime, msToNextTick, optionsOf,
  periodOfDay, resetLeft, type ResetLeft, resetText, serverTime, showsSeconds, timeText, type TimeParts, weeklyWords, wordsState,
} from './clockview.ts'
import { useHead, useOneCell, type WidgetContext, type WidgetType } from './widget.ts'
import { dayLine, SERVER_NAMES } from './widgetview.ts'

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
 * Re-draws the view when its words change on the core's clock: each second while seconds are shown, and else on the
 * minute, at the minute and not up to a minute after it.
 */
function useClockTick(live: WidgetContext['live'], seconds: boolean): void {
  const [, set] = useState(0)
  const latest = useRef(live.now)
  latest.current = live.now
  // The core's clock is the PC's until the first status comes, so the next tick is worked out again when it does.
  const anchor = live.status?.now
  useEffect(() => {
    let timer = 0
    const arm = () => {
      timer = window.setTimeout(() => {
        set((count) => count + 1)
        arm()
      }, Math.max(1, msToNextTick(latest.current(), seconds)))
    }
    arm()
    return () => window.clearTimeout(timer)
  }, [seconds, anchor])
}

/** What a clock says, apart from its settings: the core's time, the account's server and the next resets. */
type Moment = {
  now: Date
  server: { offset: number; name: string } | null
  daily: string | null
  weekly: string | null
}

/** The frame's size as the styles lay out: one cell wide, one cell tall and wider, and two cells tall and wider. */
type Layout = '11' | '21' | '22'

/** The time in tabular figures with the seconds and AM or PM small after it. */
function Figures({ parts }: { parts: TimeParts }) {
  return (
    <>
      {parts.hours}:{parts.minutes}
      {parts.seconds !== null && <small className="ck-s">{parts.seconds}</small>}
      {parts.ampm !== null && <small className="ck-ap">{parts.ampm}</small>}
    </>
  )
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

/** The Astrolabe: a 24-hour dial, night at the bottom and noon at the top, the sun or the moon where this PC's time is. */
function Astrolabe({ now, reset, big, how, size }: { now: Date; reset: ResetLeft | null; big: boolean; how: ClockHow; size: number }) {
  const hours = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600
  const turn = (hour: number) => astroTurn(hour)
  const marker = round(turn(hours), 82.5)
  const inner = round(turn(hours), 66)
  const day = astroDay(hours)
  const parts = formatTime(now.getHours(), now.getMinutes(), now.getSeconds(), how)
  return (
    <span className="ck-dial" data-centre style={{ width: size, height: size }}>
      <svg viewBox="0 0 200 200" aria-hidden="true">
        <path className="ast-day" d="M5 100A95 95 0 0 1 195 100L170 100A70 70 0 0 0 30 100Z" />
        <path className="ast-night" d="M5 100A95 95 0 0 0 195 100L170 100A70 70 0 0 1 30 100Z" />
        <circle className="ast-ring" cx="100" cy="100" r="95" />
        <circle className="ast-ring thin" cx="100" cy="100" r="70" />
        {Array.from({ length: 24 }, (_, hour) => {
          if (hour % 6 === 0) return null
          const from = round(turn(hour), 95)
          const to = round(turn(hour), 89)
          return <line key={hour} className="ast-tick" x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
        })}
        {[0, 6, 12, 18].map((hour) => {
          const at = round(turn(hour), big ? 80 : 82.5)
          return big ? (
            <text key={hour} className="ast-lbl" x={at.x} y={at.y}>
              {hour}
            </text>
          ) : (
            <path key={hour} className="ast-gold" d={diamond(at, 5)} />
          )
        })}
        {reset !== null && <path className="ast-reset" d={diamond(round(turn(reset.localHour), 82.5), 4.5)} />}
        <line className="ast-hand" x1="100" y1="100" x2={inner.x} y2={inner.y} />
        {day ? (
          <>
            {Array.from({ length: 8 }, (_, ray) => {
              const angle = (ray / 8) * 2 * Math.PI
              return (
                <line
                  key={ray}
                  className="ast-ray"
                  x1={marker.x + 12 * Math.cos(angle)}
                  y1={marker.y + 12 * Math.sin(angle)}
                  x2={marker.x + 16 * Math.cos(angle)}
                  y2={marker.y + 16 * Math.sin(angle)}
                />
              )
            })}
            <circle className="ast-sun" cx={marker.x} cy={marker.y} r="8.5" />
          </>
        ) : (
          <path className="ast-moon" d={`M${marker.x + 3} ${marker.y - 9}a9 9 0 1 0 6 15 7 7 0 0 1-6-15z`} />
        )}
        {big && (
          <>
            <text className={`ast-time${parts.seconds !== null ? ' long' : ''}`} x="100" y="94">
              {parts.hours}:{parts.minutes}
              {parts.seconds !== null && `:${parts.seconds}`}
              {parts.ampm !== null && <tspan className="ast-ap"> {parts.ampm}</tspan>}
            </text>
            <text className="ast-sub" x="100" y="122">
              {periodOfDay(now.getHours())}
            </text>
          </>
        )}
      </svg>
    </span>
  )
}

/** A flip clock: a tile for each of the hours, the minutes and, if asked, the seconds. */
function Flip({ parts, height, font }: { parts: TimeParts; height: number; font: number }) {
  const tile = (text: string, className = '') => (
    <span className={`ck-tile ${className}`} style={{ height, minWidth: Math.round(height * 1.05), fontSize: font }}>
      {text}
    </span>
  )
  return (
    <span className="ck-flip" aria-hidden="true">
      {tile(parts.hours)}
      <span className="ck-colon" />
      {tile(parts.minutes)}
      {parts.seconds !== null && (
        <>
          <span className="ck-colon" />
          {tile(parts.seconds, 'sec')}
        </>
      )}
    </span>
  )
}

/** The words of the time: eleven letters across, ten rows, and the ones that say the time lit; a dot for each minute after. */
function WordGrid({ now }: { now: Date }) {
  const { cells, extra } = wordsState(now)
  return (
    <div className="ck-words-box" aria-hidden="true">
      <div className="ck-words">
        {cells.map((cell, index) => (
          <span key={index} className={cell.on ? (cell.gold ? 'on gold' : 'on') : undefined}>
            {cell.ch}
          </span>
        ))}
      </div>
      <div className="ck-dots">
        {[1, 2, 3, 4].map((dot) => (
          <i key={dot} className={dot <= extra ? 'on' : undefined} />
        ))}
      </div>
    </div>
  )
}

type ClockHow = { twelve: boolean; seconds: boolean }

/** The time as a sentence, the hour in gold: "five past ten". */
function Phrase({ now, lead }: { now: Date; lead: string }) {
  const { phrase } = wordsState(now)
  return (
    <span className="ck-phrase">
      <small>{lead}</small>
      {phrase.lead}
      <em>{phrase.hour}</em>
      {phrase.tail}
    </span>
  )
}

/** Where the server's time goes: in the heading where the body has no room for a line of it. */
function serverInHeading(settings: ClockSettings, layout: Layout): boolean {
  return layout === '11' || (layout === '21' && (settings.style === 'astro' || settings.style === 'reset'))
}

/** The time to the reset a style draws on its own, and so does not repeat as a line. */
function drawsReset(settings: ClockSettings): boolean {
  return settings.style === 'astro' || settings.style === 'reset'
}

/**
 * The clock's body in a style and at a size, on a moment; the widget draws it at its frame's size and the settings draw
 * it again at 2 × 2 for each style's picture. One cell tall or wide a style says less, and what does not fit goes to the
 * heading (`serverInHeading`).
 */
function ClockBody({ settings, layout, moment, rootRef }: { settings: ClockSettings; layout: Layout; moment: Moment; rootRef?: Ref<HTMLDivElement> }) {
  const { now, server, daily, weekly } = moment
  const seconds = showsSeconds(settings)
  const how: ClockHow = { twelve: settings.twelve, seconds }
  const parts = formatTime(now.getHours(), now.getMinutes(), now.getSeconds(), how)
  const reset = daily === null ? null : resetLeft(daily, now)
  const date = settings.date ? <span>{dayLine(now)}</span> : null
  const serverLine =
    server !== null && settings.server && !serverInHeading(settings, layout) ? (
      <span className="srv">
        Server <b>{serverTime(now, server.offset, how)}</b> · {server.name}
      </span>
    ) : null
  const resetLine =
    reset !== null && settings.reset && !drawsReset(settings) && layout !== '11' ? (
      <span className="rst">
        Reset in <b>{resetText(reset)}</b>
      </span>
    ) : null
  const sideText = (
    <>
      {date}
      {serverLine}
      {resetLine}
    </>
  )
  const hasSide = settings.date || serverLine !== null || resetLine !== null
  const sr = <span className="sr-only">{timeText(now, how)}</span>
  const wide = layout === '21'

  if (settings.style === 'digital') {
    const extras = (parts.seconds !== null ? 1 : 0) + (parts.ampm !== null ? 1 : 0)
    const font = layout === '11' ? 36 - 6 * extras : wide ? 44 - 3 * extras : 66 - 6 * extras
    return (
      <div ref={rootRef} className={`ck${layout === '21' ? '' : ' ck-stack'}`}>
        {sr}
        <span className="ck-dg" data-centre style={{ fontSize: font }} aria-hidden="true">
          <Figures parts={parts} />
        </span>
        {hasSide && <div className="ck-side">{layout === '11' ? date : sideText}</div>}
      </div>
    )
  }

  if (settings.style === 'flip') {
    const tiles = parts.seconds !== null ? 3 : 2
    const flipHeight = layout === '11' ? 34 : wide ? (tiles === 3 ? 42 : 50) : tiles === 3 ? 64 : 74
    const flipFont = layout === '11' ? 24 : wide ? (tiles === 3 ? 28 : 34) : tiles === 3 ? 44 : 52
    // One cell wide the seconds are left out, and AM or PM stands under the tiles.
    const flipParts = layout === '11' ? { ...parts, seconds: null } : parts
    return (
      <div ref={rootRef} className={`ck${layout === '21' ? '' : ' ck-stack'}`}>
        {sr}
        <span className="ck-flip-row" data-centre>
          <Flip parts={flipParts} height={flipHeight} font={flipFont} />
          {layout !== '11' && parts.ampm !== null && (
            <span className="ck-dg ck-ampm" aria-hidden="true" style={{ fontSize: Math.round(flipFont * 0.42) }}>
              {parts.ampm}
            </span>
          )}
        </span>
        {layout === '11' ? parts.ampm !== null && <span className="ck-line">{parts.ampm}</span> : hasSide && <div className="ck-side">{sideText}</div>}
      </div>
    )
  }

  if (settings.style === 'astro') {
    const big = layout === '22'
    const periodWord = periodOfDay(now.getHours())
    if (big) {
      return (
        <div ref={rootRef} className="ck">
          <Astrolabe now={now} reset={reset} big how={how} size={150} />
          <div className="ck-side">
            {settings.date && <b>{dayLine(now)}</b>}
            {serverLine}
            {reset !== null && daily !== null && (
              <span className="mut ck-gap">
                Daily reset at {timeText(new Date(daily), { twelve: settings.twelve, seconds: false })}
                <br />
                in <b>{resetText(reset)}</b>
              </span>
            )}
          </div>
        </div>
      )
    }
    return (
      <div ref={rootRef} className="ck">
        <Astrolabe now={now} reset={reset} big={false} how={how} size={52} />
        <div className="ck-side">
          <span>
            <b className="ck-dg" style={{ fontSize: layout === '11' ? 20 : 24 }}>
              <Figures parts={{ ...parts, seconds: null }} />
            </b>
            {layout === '21' && <> </>}
            {layout === '21' && <span className="mut">{periodWord.toLowerCase()}</span>}
          </span>
          {layout === '11' && <span className="mut">{periodWord}</span>}
          {layout === '21' && date}
        </div>
      </div>
    )
  }

  if (settings.style === 'reset') {
    const countdown = reset === null ? null : resetText(reset)
    const gameDay = daily === null ? null : timeText(new Date(daily), { twelve: settings.twelve, seconds: false })
    if (layout === '11') {
      return (
        <div ref={rootRef} className="ck ck-stack ck-flush">
          {sr}
          <span className="ck-dg" data-centre style={{ fontSize: 24 - 3 * (parts.ampm !== null ? 1 : 0) }} aria-hidden="true">
            <Figures parts={{ ...parts, seconds: null }} />
          </span>
          {reset !== null && (
            <>
              <span className="ck-bar" role="img" aria-label="How much of the game day has gone">
                <u style={{ width: `${reset.share * 100}%` }} />
              </span>
              <span className="ck-line">
                reset in <b>{countdown}</b>
              </span>
            </>
          )}
        </div>
      )
    }
    if (layout === '21') {
      return (
        <div ref={rootRef} className="ck-two" data-centre>
          <div>
            <div className="ck-lbl">{settings.date ? `Here · ${dayLine(now)}` : 'Here'}</div>
            {sr}
            <span className="ck-dg" style={{ fontSize: 34 - 3 * (parts.ampm !== null ? 1 : 0) }} aria-hidden="true">
              <Figures parts={{ ...parts, seconds: null }} />
            </span>
          </div>
          <i />
          <div className="ck-rs">
            <span className="ck-lbl">Daily reset in</span>
            {reset !== null && (
              <>
                <span className="ck-big">
                  {reset.hours}
                  <small>h</small> {reset.minutes}
                  <small>min</small>
                </span>
                <span className="ck-bar" role="img" aria-label="How much of the game day has gone">
                  <u style={{ width: `${reset.share * 100}%` }} />
                </span>
              </>
            )}
          </div>
        </div>
      )
    }
    return (
      <div ref={rootRef} className="ck ck-stack ck-flush ck-tall">
        <div className="ck-top" data-centre>
          {sr}
          <span className="ck-dg" style={{ fontSize: 52 - 4 * ((parts.ampm !== null ? 1 : 0) + (parts.seconds !== null ? 1 : 0)) }} aria-hidden="true">
            <Figures parts={parts} />
          </span>
          {(settings.date || serverLine !== null) && (
            <span className="ck-side">
              {date}
              {serverLine}
            </span>
          )}
        </div>
        {reset !== null && (
          <div className="ck-block">
            <div className="ck-row">
              <span>Daily reset in</span>
              <b>{countdown}</b>
            </div>
            <span className="ck-bar" role="img" aria-label="How much of the game day has gone">
              <u style={{ width: `${reset.share * 100}%` }} />
            </span>
            <div className="ck-row small">
              <span>The game day, {gameDay} to {gameDay}</span>
              {weekly !== null && <span>Weekly reset {weeklyWords(weekly, now)}</span>}
            </div>
          </div>
        )}
      </div>
    )
  }

  if (settings.style === 'words') {
    const sentence = wordsState(now).phrase
    const said = `It's ${sentence.lead}${sentence.hour}${sentence.tail}`
    if (layout === '22') {
      return (
        <div ref={rootRef} className="ck">
          <span className="sr-only">{said}</span>
          <span data-centre>
            <WordGrid now={now} />
          </span>
          <div className="ck-side">
            {settings.date && <b>{dayLine(now)}</b>}
            {serverLine}
            {resetLine}
            <span className="mut ck-gap">A dot for each minute past</span>
          </div>
        </div>
      )
    }
    return (
      <div ref={rootRef} className={`ck${layout === '11' ? ' ck-stack' : ''}`}>
        <span className="sr-only">{said}</span>
        <span data-centre aria-hidden="true">
          <Phrase now={now} lead={layout === '11' ? "It's" : "IT'S"} />
        </span>
        {layout === '21' && hasSide && <div className="ck-side">{sideText}</div>}
      </div>
    )
  }

  // Istaroth, as it always was; the options only change what it writes.
  return (
    <div ref={rootRef} className={`clock${resetLine === null ? '' : ' rst-on'}`}>
      <div className="clock-dial" data-centre>
        <Dial now={now} seconds={seconds} />
        <p className="fig">
          {parts.hours}:{parts.minutes}
          {parts.seconds !== null && `:${parts.seconds}`}
          {parts.ampm !== null && <small>{parts.ampm}</small>}
        </p>
      </div>
      {hasSide && <div className="side">{sideText}</div>}
    </div>
  )
}

/** The moment a clock draws, from the core's clock and the Board model. */
function momentOf(ctx: WidgetContext): Moment {
  const board = ctx.board
  return {
    now: ctx.live.now(),
    server: board === null ? null : { offset: board.server.utc_offset_hours, name: SERVER_NAMES.get(board.server.key) ?? board.server.key },
    daily: board === null ? null : board.resets.daily_at,
    weekly: board === null ? null : board.resets.weekly_at,
  }
}

/**
 * This PC's time (look pass spec 9.13), in the style the widget is set to (the widgets polish mockup): the Istaroth dial
 * it has always been, large Figures, Flip tiles, an Astrolabe of the whole day, the time beside the daily reset, or the
 * time in Words. All on the core's clock. One cell tall the day and the server stand beside the time; at one cell wide
 * the server's time is in the heading instead, and the body keeps the time and the day.
 */
function ClockView({ widget, ctx }: { widget: Widget; ctx: WidgetContext }) {
  const settings = clockSettings(widget.settings)
  const seconds = showsSeconds(settings)
  useClockTick(ctx.live, seconds)
  const { ref, narrow, short } = useOneCell()
  const moment = momentOf(ctx)
  const layout: Layout = narrow ? '11' : short ? '21' : '22'
  const how: ClockHow = { twelve: settings.twelve, seconds }
  const inHeading = serverInHeading(settings, layout)
  const reset = moment.daily === null ? null : resetLeft(moment.daily, moment.now)
  useHead({
    meta: clockMeta({
      narrow: inHeading,
      server: moment.server !== null && settings.server ? `Server ${serverTime(moment.now, moment.server.offset, how)}` : null,
      reset: settings.reset && !drawsReset(settings) && reset !== null ? resetText(reset) : null,
    }),
  })
  return <ClockBody settings={settings} layout={layout} moment={moment} rootRef={ref as Ref<HTMLDivElement>} />
}

const OPTION_ROWS: readonly { key: 'seconds' | 'date' | 'server' | 'reset'; name: string; about: string }[] = [
  { key: 'seconds', name: 'Seconds', about: 'A second hand, or the seconds beside the minutes' },
  { key: 'date', name: 'The date', about: 'The day under or beside the time' },
  { key: 'server', name: "The server's time", about: "With the server's name; in the heading when narrow" },
  { key: 'reset', name: 'Time to the daily reset', about: 'A line of it under the time' },
]

/** The style of the clock, each with its picture drawn live, and what it shows. */
function ClockSettingsForm({ widget, ctx, change }: { widget: Widget; ctx: WidgetContext; change: (settings: Record<string, unknown>) => void }) {
  const settings = clockSettings(widget.settings)
  useClockTick(ctx.live, settings.seconds)
  const moment = momentOf(ctx)
  const reasons = optionsOf(settings.style)
  const set = (next: Partial<ClockSettings>) => change({ ...widget.settings, ...next })
  return (
    <div className="ck-set">
      <fieldset className="ck-styles">
        <legend>Style</legend>
        <div className="ck-picks" role="radiogroup" aria-label="Style">
          {CLOCK_STYLES.map((one) => (
            <button
              key={one.id}
              type="button"
              role="radio"
              aria-checked={settings.style === one.id}
              className={`ck-pick${settings.style === one.id ? ' on' : ''}`}
              onClick={() => set({ style: one.id })}
            >
              <span className="ck-thumb" aria-hidden="true">
                <span className="w ck-thumb-w">
                  <span className="w-head">
                    <Sign name="clock" />
                    <span className="w-name">Clock</span>
                  </span>
                  <span className="w-body">
                    <ClockBody settings={{ ...settings, style: one.id }} layout="22" moment={moment} />
                  </span>
                </span>
              </span>
              <span className="ck-pick-name">
                {one.name}
                <small>{one.about}</small>
              </span>
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="pm-set">
        <legend>Shows</legend>
        <div className={`pm-set-row${reasons.twelve === null ? '' : ' ck-off'}`}>
          <span>
            Hours
            <small>{reasons.twelve ?? 'How the time is written'}</small>
          </span>
          {reasons.twelve === null ? (
            <Segmented
              label="Hours"
              options={[
                { value: '24', label: '24 h' },
                { value: '12', label: '12 h' },
              ]}
              value={settings.twelve ? '12' : '24'}
              onChange={(value) => set({ twelve: value === '12' })}
            />
          ) : null}
        </div>
        {OPTION_ROWS.map((row) => {
          const reason = reasons[row.key]
          const locked = reason !== null
          // A row a style draws on its own stays on, with the reason under it.
          const on = locked && row.key === 'reset' ? true : settings[row.key]
          return (
            <div key={row.key} className={`pm-set-row${locked ? ' ck-off' : ''}`}>
              <span>
                {row.name}
                <small>{reason ?? row.about}</small>
              </span>
              <Switch
                on={on}
                label={row.name}
                className="pm-switch"
                locked={locked}
                title={reason ?? undefined}
                onPress={() => {
                  if (!locked) set({ [row.key]: !settings[row.key] })
                }}
              />
            </div>
          )
        })}
      </fieldset>
    </div>
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
  settings: { seconds: false },
  View: ClockView,
  Settings: ClockSettingsForm,
}
