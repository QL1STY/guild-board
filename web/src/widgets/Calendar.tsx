import '../styles/widget-calendar.css'
import { useModel, useTick } from '../live.ts'
import type { CalendarModel, Widget } from '../types.ts'
import { Picture } from '../ui/Picture.tsx'
import { Sign } from '../ui/Sign.tsx'
import {
  type CalendarBar, calendarFoot, calendarFrame, calendarGrid, calendarList, calendarMeta, type CalendarRow, type Words,
} from './calendarview.ts'
import { useFrameSize, useHead, type WidgetContext, type WidgetType } from './widget.ts'

/*
 * The Calendar (the widgets and Friends design, 2.3; mockup 3): the game's banners, events and endgame. On the Board at five
 * cells across and three down or more it is a grid of fourteen days with three lanes of bars, today's column tinted; at any
 * other size, and always on the overlay, a list. It reads /api/calendar, again at each core event, and counts the time on each
 * minute. The banners' faces come through the icon cache, which the core serves from HoYoverse's hosts alone. A lane, a mode
 * or a source is a data attribute: the stylesheet gives it its colour.
 */

const MINUTE_MS = 60_000
const NOT_READ = 'The calendar is read with the next HoYoLAB sync.'
const NOTHING = 'Nothing on the calendar.'

function WordsView({ words }: { words: Words }) {
  return (
    <span className="cal-words" data-tone={words.tone}>
      {words.tone === 'ok' && <Sign name="tick" />}
      {words.gem && <Sign name="gem" />}
      {words.text}
    </span>
  )
}

function Bar({ bar }: { bar: CalendarBar }) {
  const more = bar.more > 0 ? `${bar.more} more: ${bar.hidden.join(' · ')}` : null
  return (
    <div
      className="cal-bar"
      data-lane={bar.lane}
      data-mode={bar.mode ?? undefined}
      data-source={bar.source ?? undefined}
      data-from={bar.from || undefined}
      data-to={bar.to || undefined}
      data-done={bar.done || undefined}
      data-narrow={bar.end - bar.col <= 2 || undefined}
      title={bar.time === null ? undefined : `${bar.name} · ${bar.time.lead} ${bar.time.time}`}
      style={{ gridColumn: `${bar.col} / ${bar.end}`, gridRow: bar.row }}
    >
      {bar.faces.length > 0 && (
        <span className="cal-faces">
          {bar.faces.map((face, index) => (
            <Picture
              key={`${face.name}-${index}`}
              src={face.icon}
              sign="person"
              className={face.rarity < 5 ? 'cal-face s4' : 'cal-face'}
              lazy
            />
          ))}
        </span>
      )}
      <span className="cal-name" title={bar.name}>
        {bar.name}
      </span>
      {bar.words !== null && <WordsView words={bar.words} />}
      {bar.time !== null && (
        <span className="cal-end">
          {bar.time.lead} <b>{bar.time.time}</b>
        </span>
      )}
      {more !== null && (
        <span className="cal-more" title={more}>
          +{bar.more}
          <span> more</span>
        </span>
      )}
    </div>
  )
}

function Wide({ data, now, foot, wishRows }: { data: CalendarModel; now: Date; foot: string | null; wishRows: number }) {
  const grid = calendarGrid(data, now, wishRows)
  if (grid.empty) {
    return (
      <p className="wid-line" data-centre>
        {NOTHING}
      </p>
    )
  }
  return (
    <>
      <div className="cal-frame">
        <div className="cal-today" aria-hidden="true" />
        <div className="cal-days">
          {grid.days.map((day) => (
            <div key={day.key} className="cal-day" data-today={day.today || undefined}>
              {day.label}
              <b>{day.date}</b>
            </div>
          ))}
        </div>
        <div className="cal-lanes w-scroll" data-centre>
          {grid.lanes.flatMap((lane) => [
            <div key={lane.lane} className="cal-lane" style={{ gridRow: lane.head }}>
              {lane.label}
            </div>,
            ...lane.bars.map((bar) => <Bar key={bar.key} bar={bar} />),
          ])}
        </div>
      </div>
      {grid.soon.length > 0 && (
        <div className="cal-soon" title={grid.soon.join(' · ')}>
          <b>Coming soon</b>
          {grid.soon.join(' · ')}
        </div>
      )}
      {foot !== null && <p className="cal-foot">{foot}</p>}
    </>
  )
}

function Row({ row }: { row: CalendarRow }) {
  return (
    <li
      className="cl-r"
      data-lane={row.lane}
      data-mode={row.mode ?? undefined}
      data-source={row.source ?? undefined}
      data-done={row.done || undefined}
      data-soon={row.soon || undefined}
    >
      <i aria-hidden="true" />
      <div className="cl-n">
        <b title={row.name}>{row.name}</b>
        {row.sub !== null && <span className={row.ok ? 'cl-ok' : undefined}>{row.sub}</span>}
      </div>
      {row.big !== '' && (
        <div className="cl-e">
          <b>{row.big}</b>
          {row.small}
        </div>
      )}
    </li>
  )
}

function List({ data, ctx, now, foot }: { data: CalendarModel; ctx: WidgetContext; now: Date; foot: string | null }) {
  const { rows, empty } = calendarList(data, now, ctx.place)
  if (empty) {
    return (
      <p className="wid-line" data-centre>
        {NOTHING}
      </p>
    )
  }
  return (
    <>
      <ul className="cl w-scroll" data-centre>
        {rows.map((row) => (
          <Row key={row.key} row={row} />
        ))}
      </ul>
      {foot !== null && <p className="cal-foot">{foot}</p>}
    </>
  )
}

function CalendarView({ ctx }: { widget: Widget; ctx: WidgetContext }) {
  useTick(MINUTE_MS)
  const now = ctx.live.now()
  const { data, error } = useModel<CalendarModel>('/api/calendar', ctx.version)
  const { ref, width, height } = useFrameSize()
  // The Wishes lane keeps to the rows the frame has room for, so that the other two lanes stay in view.
  const { wide, wishRows } = calendarFrame(width, height, ctx.place)
  useHead({ meta: data === null ? null : calendarMeta(data, now, ctx.place) })
  let body
  if (data === null) {
    body = (
      <p className="wid-line" data-centre>
        {error ?? 'Reading the calendar…'}
      </p>
    )
  } else if (!data.read) {
    body = (
      <p className="wid-line" data-centre>
        {NOT_READ}
      </p>
    )
  } else if (wide) {
    body = <Wide data={data} now={now} foot={calendarFoot(data, now, ctx.place)} wishRows={wishRows} />
  } else {
    body = <List data={data} ctx={ctx} now={now} foot={calendarFoot(data, now, ctx.place)} />
  }
  return (
    <div className="cal" ref={ref}>
      {body}
    </div>
  )
}

export const CALENDAR: WidgetType = {
  id: 'calendar',
  name: 'Calendar',
  about: "The game's banners, events and endgame, with what you have left to do.",
  sign: 'calendar',
  min: { w: 2, h: 2 },
  max: { w: 8, h: 5 },
  start: { w: 6, h: 4 },
  settings: {},
  View: CalendarView,
}
