import { type CSSProperties, type ReactNode, useLayoutEffect, useMemo, useRef, useState } from 'react'
import '../../styles/stats.css'
import '../../styles/months.css'
import { ChartCard } from '../../charts/ChartCard.tsx'
import { cellTip } from '../../charts/calendar.ts'
import { dayMonth, duration, num, plural, weekday } from '../../format.ts'
import { Frame } from '../../frame/Frame.tsx'
import { type Live, useModel } from '../../live.ts'
import { hashOf } from '../../route.ts'
import type { MonthAmount, MonthChip, MonthModel, MonthsModel, MonthTile } from '../../types.ts'
import { Picture } from '../../ui/Picture.tsx'
import { useRoving } from '../../ui/roving.ts'
import {
  calendarDays,
  deltaParts,
  fiveWords,
  layoutParts,
  monthParts,
  noCompareText,
  partShape,
  recordText,
  stripYears,
  tileFigure,
} from './monthsview.ts'
import { StatsTabs } from './StatsTabs.tsx'

/** The Months tab: one month at a time, with the month before beside every number (the Months and Wrapped design, section 5). */
export function Months({ live, ym }: { live: Live; ym: string | null }) {
  const { data, error } = useModel<MonthsModel>(
    ym === null ? '/api/stats/month' : `/api/stats/month?ym=${ym}`,
    live.version,
  )
  return (
    <Frame page="stats" live={live} beside={<StatsTabs view="months" />}>
      {data === null ? (
        <div className="gb-panel gb-empty">{error ?? 'Reading the months…'}</div>
      ) : data.month === null ? (
        <div className="gb-panel gb-empty">Nothing to show yet. The months fill in as Guild Board keeps data.</div>
      ) : (
        <div className="gb-page mo">
          <Strip months={data.months} selected={data.month.ym} />
          <Month key={data.month.ym} month={data.month} />
        </div>
      )}
    </Frame>
  )
}

/** The months by year. The chosen one is filled and a month with little data is lighter; the strip opens scrolled to the chosen one. */
function Strip({ months, selected }: { months: MonthChip[]; selected: string }) {
  const box = useRef<HTMLElement>(null)
  // The strip centres the chosen month when the month or the list of months changes, not on every refresh of the same list.
  const ids = months.map((month) => month.ym).join()
  useLayoutEffect(() => {
    const strip = box.current
    const on = strip?.querySelector<HTMLElement>('[aria-current="page"]')
    if (strip === null || on === null || on === undefined) return
    strip.scrollLeft = Math.max(0, on.offsetLeft - (strip.clientWidth - on.offsetWidth) / 2)
  }, [selected, ids])
  return (
    <nav className="mo-strip" aria-label="Months" ref={box} data-testid="month-strip">
      {stripYears(months).map((group) => (
        <div key={group.year} className="mo-year" role="group" aria-label={String(group.year)}>
          <span className="mo-yr" aria-hidden="true">
            {group.year}
          </span>
          {group.months.map((month) => (
            <a
              key={month.ym}
              href={hashOf({ page: 'stats', view: 'months', ym: month.ym })}
              className={`mo-chip${month.ym === selected ? ' on' : ''}${month.thin ? ' thin' : ''}`}
              aria-current={month.ym === selected ? 'page' : undefined}
              aria-label={`${month.label} ${month.year}${month.current ? ' so far' : ''}${month.thin ? ', little data' : ''}`}
            >
              {month.current ? `${month.label} so far` : month.label}
            </a>
          ))}
        </div>
      ))}
    </nav>
  )
}

/** The width the month's parts are laid out in until the page has measured its own: .gb-page's most (frame.css). */
const PAGE_WIDTH = 1440

/** The width of an element, measured before the page is drawn and again whenever it changes. */
function useWidth(box: { current: HTMLElement | null }): number {
  const [width, setWidth] = useState(PAGE_WIDTH)
  useLayoutEffect(() => {
    const element = box.current
    if (element === null) return
    const measure = () => setWidth(Math.round(element.clientWidth) || PAGE_WIDTH)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [box])
  return width
}

/** What a part of the month shows. */
function partNode(id: string, month: MonthModel): ReactNode {
  switch (id) {
    case 'records':
      return <Records month={month} />
    case 'days':
      return <Calendar month={month} />
    case 'flow':
      return <Flow month={month} />
    case 'endgame':
      return <Endgame month={month} />
    default:
      return <Pulls month={month} />
  }
}

function Month({ month }: { month: MonthModel }) {
  const daysKept = month.days === null ? null : month.days.filter((day) => day.minutes !== null).length
  const box = useRef<HTMLElement>(null)
  const width = useWidth(box)
  const rows = useMemo(
    () => layoutParts(monthParts(month).map(({ id, wide }) => ({ id, wide, shape: partShape(id, month) })), width),
    [month, width],
  )
  return (
    <section aria-label={month.label} ref={box}>
      <h2 className="sr-only">{month.label}</h2>
      {month.tiles.length > 0 && (
        <div className="mo-tiles" style={{ '--n': month.tiles.length } as CSSProperties}>
          {month.tiles.map((tile) => (
            <Tile key={tile.id} tile={tile} compare={month.compare_label} daysKept={daysKept} />
          ))}
        </div>
      )}
      {rows.length > 0 && (
        <div className="mo-grid">
          {rows.map((row) => (
            <div key={row.parts.map((part) => part.id).join()} className={row.alone ? 'mo-row alone' : 'mo-row'}>
              {row.parts.map((part) => {
                // The calendar is as wide as its cells make it; a part alone keeps its own width; the others share the rest.
                const style =
                  part.cell !== null
                    ? ({ flex: 'none', width: part.width, '--cell': `${part.cell}px` } as CSSProperties)
                    : row.alone
                      ? { flex: 'none', width: part.width }
                      : { flex: `${part.width} 1 0px` }
                return (
                  <div key={part.id} className="mo-part" style={style} data-part={part.id}>
                    {partNode(part.id, month)}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}
      {month.tiles.length === 0 && rows.length === 0 && (
        <div className="gb-panel gb-empty">Nothing was kept for this month.</div>
      )}
      {month.since.length > 0 && (
        <div className="mo-since">
          {month.since.map((note) => (
            <p key={note.part} className="gb-note">
              {note.text}
            </p>
          ))}
        </div>
      )}
    </section>
  )
}

/** The Overview's tile for one of the month's numbers; the 5-stars' faces sit under the Wishes. */
function Tile({ tile, compare, daysKept }: { tile: MonthTile; compare: string; daysKept: number | null }) {
  const change = deltaParts(tile.delta, tile.unit, compare)
  const figure = tileFigure(tile, daysKept)
  const faces = tile.faces ?? []
  return (
    <div className="gb-panel st" role="group" aria-label={tile.label} data-testid={`month-tile-${tile.id}`}>
      <div className="k">{tile.label}</div>
      <div className="v mo-v">
        <span>
          {figure.map((part, at) => (
            <span key={at}>
              {at > 0 && ' '}
              {part.small ? <small>{part.text}</small> : part.text}
            </span>
          ))}
        </span>
        {faces.length > 0 && (
          <span className="mo-faces" role="group" aria-label="5-stars">
            {faces.slice(0, 4).map((face, at) => (
              <span key={at} className="mo-tipbox" role="img" aria-label={face.name} data-tip={face.name}>
                <Picture src={face.icon} sign="star" className="mo-face" lazy />
              </span>
            ))}
            {faces.length > 4 && <span className="mo-more">+{faces.length - 4}</span>}
          </span>
        )}
      </div>
      <div className="d">
        {change === null ? (
          noCompareText(compare)
        ) : (
          <>
            <b className={change.gain ? undefined : 'flat'}>{change.change}</b> {change.rest}
          </>
        )}
      </div>
    </div>
  )
}

function Records({ month }: { month: MonthModel }) {
  return (
    <section className="gb-panel ch mo-card" aria-label="Records of the month" data-testid="month-records">
      <div className="ch-head">
        <h2>Records of the month</h2>
      </div>
      <div className="cs">The month's bests and when they happened</div>
      <div className="mo-recs">
        {month.records.map((record) => (
          <div key={record.id} className="mo-rec" data-testid={`record-${record.id}`}>
            <span>{record.label}</span>
            <b>
              {record.id === 'luckiest' && <Picture src={record.icon ?? null} sign="star" className="mo-face sm" lazy />}
              {recordText(record)}
            </b>
          </div>
        ))}
      </div>
    </section>
  )
}

/** The month's days in the Playtime calendar's colours, a week to a row beginning on Monday. */
function Calendar({ month }: { month: MonthModel }) {
  const days = month.days ?? []
  const filled = days.findLastIndex((day) => day.minutes !== null) + 1
  const roving = useRoving(filled)
  // The month so far shows its days to the end of the week it has reached; the days still to come take no room.
  const { blanks, shown } = calendarDays(month)
  const name = month.label.split(' ')[0]
  const total = blanks + shown.length
  return (
    <ChartCard
      title={`${name}, day by day`}
      subtitle="Time in game per day"
      className="mo-card mo-calcard"
      tables={[
        {
          head: ['Day', 'Time'],
          rows: days.map((day) => [
            `${weekday(day.day)} ${dayMonth(day.day)}`,
            day.minutes === null ? 'no data' : day.minutes === 0 ? '–' : duration(day.minutes),
          ]),
          numeric: [1],
        },
      ]}
    >
      <div className="mo-calbox" data-testid="month-calendar">
        <div className="mo-wd" aria-hidden="true">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
        <div className="mo-cal">
          {Array.from({ length: blanks }, (_, at) => (
            <i key={`pad${at}`} className="pad" />
          ))}
          {shown.map((day, index) => {
            const column = (blanks + index) % 7
            const where = column < 2 ? ' tip-start' : column > 4 ? ' tip-end' : ''
            // A day before the sessions began has no time kept: an empty outline.
            const level = day.minutes !== null ? ['', 'l1', 'l2', 'l3', 'l4'][day.level ?? 0] : 'lx'
            return (
              <i
                key={day.day}
                className={`${level}${where}`}
                role="img"
                aria-label={cellTip(day)}
                data-tip={cellTip(day)}
                {...roving(index)}
              />
            )
          })}
          {total % 7 !== 0 && Array.from({ length: 7 - (total % 7) }, (_, at) => <i key={`end${at}`} className="pad" />)}
        </div>
      </div>
      <div className="hm-lg">
        <span className="hm-key" aria-hidden="true">
          <span>None</span>
          <i />
          <i className="l1" />
          <i className="l2" />
          <i className="l3" />
          <i className="l4" />
          <span>2 h or more</span>
        </span>
      </div>
    </ChartCard>
  )
}

/** A list of bars: primogems by source, or resin by use. */
function Bars({ title, rows, unit, className }: { title: string; rows: MonthAmount[]; unit: string; className?: string }) {
  const keys = useRoving(rows.length)
  const largest = Math.max(1, ...rows.map((row) => row.amount))
  const total = Math.max(1, rows.reduce((sum, row) => sum + row.amount, 0))
  return (
    <div className={className === undefined ? 'mo-list' : `mo-list ${className}`}>
      <h3>{title}</h3>
      <div className="mo-rows">
      {rows.map((row, index) => (
        <div
          key={row.name}
          className="hb tip-end"
          role="img"
          aria-label={`${row.name}: ${num(row.amount)}`}
          data-tip={`${Math.round((row.amount / total) * 100)}% of the month's ${unit}`}
          {...keys(index)}
        >
          <span>{row.name}</span>
          <div className="b">
            <i style={{ '--w': row.amount / largest } as CSSProperties} />
            <b>{num(row.amount)}</b>
          </div>
        </div>
      ))}
      </div>
    </div>
  )
}

function Flow({ month }: { month: MonthModel }) {
  return (
    <ChartCard
      title="Where it came from, where it went"
      subtitle="Primogems earned by source · Resin spent by use"
      className="mo-card mo-flowcard"
      tables={[
        { caption: 'Primogems by source', head: ['Source', 'Primogems'], rows: month.sources.map((row) => [row.name, num(row.amount)]), numeric: [1] },
        { caption: 'Resin spent', head: ['Use', 'Resin'], rows: month.resin.map((row) => [row.name, num(row.amount)]), numeric: [1] },
      ]}
    >
      <div className={`mo-flow ${month.sources.length > 0 && month.resin.length > 0 ? 'pair' : 'solo'}`} data-testid="month-flow">
        {month.sources.length > 0 && <Bars title="Primogems earned" rows={month.sources} unit="primogems" />}
        {month.resin.length > 0 && <Bars title="Resin spent" rows={month.resin} unit="resin" className="mo-resin" />}
      </div>
    </ChartCard>
  )
}

function Endgame({ month }: { month: MonthModel }) {
  return (
    <section className="gb-panel ch mo-card" aria-label="Endgame that month" data-testid="month-endgame">
      <div className="ch-head">
        <h2>Endgame that month</h2>
      </div>
      <div className="cs">Cycles that ended in the month</div>
      <div className="mo-recs">
        {month.endgame.map((cycle) => (
          <div key={cycle.mode} className="mo-rec">
            <span>
              <i className={`mo-mode ${cycle.mode}`} aria-hidden="true" />
              {cycle.label}
            </span>
            <b>{cycle.result}</b>
          </div>
        ))}
      </div>
    </section>
  )
}

/** The colour of a banner's bar, the Pulls history's, by the banner's pool. */
function bannerColour(kind: string): string {
  if (kind === 'character') return 'var(--wish-character)'
  if (kind === 'weapon') return 'var(--wish-weapon)'
  if (kind === 'chronicled') return 'var(--wish-chronicled)'
  return 'var(--wish-standard)'
}

function Pulls({ month }: { month: MonthModel }) {
  const pulls = month.pulls!
  const keys = useRoving(pulls.banners.length)
  const total = pulls.banners.reduce((sum, banner) => sum + banner.wishes, 0)
  const largest = Math.max(1, ...pulls.banners.map((banner) => banner.wishes))
  return (
    <section className="gb-panel ch mo-card mo-pullscard" aria-label="Pulls that month" data-testid="month-pulls">
      <div className="ch-head">
        <h2>Pulls that month</h2>
      </div>
      <div className="cs">{plural(total, 'wish', 'wishes')}</div>
      <div className={`mo-flow ${pulls.fives.length > 0 ? 'pair' : 'solo'}`}>
        <div className="mo-list">
          <h3>Wishes per banner</h3>
          <div className="mo-rows">
          {pulls.banners.map((banner, index) => (
            <div
              key={banner.label}
              className="hb tip-end"
              role="img"
              aria-label={`${banner.label}: ${plural(banner.wishes, 'wish', 'wishes')}`}
              data-tip={`${Math.round((banner.wishes / Math.max(1, total)) * 100)}% of the month's wishes`}
              {...keys(index)}
            >
              <span>{banner.label}</span>
              <div className="b">
                <i style={{ '--w': banner.wishes / largest, background: bannerColour(banner.kind) } as CSSProperties} />
                <b>{num(banner.wishes)}</b>
              </div>
            </div>
          ))}
          </div>
        </div>
        {pulls.fives.length > 0 && (
          <div className="mo-list">
            <h3>5-stars</h3>
            <div className="mo-rows">
            {pulls.fives.map((five, at) => (
              <div key={at} className="mo-five">
                <Picture src={five.icon} sign="star" className="mo-face lg" lazy />
                <b>{five.name}</b>
                <span>{fiveWords(five.pity, five.result, five.pool)}</span>
              </div>
            ))}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
