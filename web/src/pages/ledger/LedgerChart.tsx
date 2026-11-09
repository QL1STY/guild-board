import { type PointerEvent, useId, useState } from 'react'
import { dayMonth, num } from '../../format.ts'
import type { LedgerDay } from '../../ledgertypes.ts'
import { Segmented } from '../../ui/Segmented.tsx'
import { CHART_MARGINS, type ChartWords, PRIMOGEM_WORDS, type Range, chartGeometry, dayAt, headline, labelIndexes, rangeDays } from './ledgerchart.ts'
import { monthTitle } from './ledgerdays.ts'

/** The chart's drawing, in the units of its viewBox: it scales to the card's width, as the mockup's does. */
const BOX = { w: 760, h: 230 }

const RANGES: readonly { value: Range; label: string }[] = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'month3', label: '3 months' },
  { value: 'month6', label: '6 months' },
]

/**
 * The headline's second line, with its earned figure in green and its spent figure in ink: "+7,815 earned and −1,760 spent
 * in October". A line of another shape is drawn as it is.
 */
function Movement({ line, came }: { line: string; came: string }) {
  const found = new RegExp(String.raw`^(\S+) ${came}(?: and (−\S+) spent)?(.*)$`, 's').exec(line)
  if (found === null) return <>{line}</>
  const [, earned, spent, rest] = found
  return (
    <>
      <b className="ld-in">{earned}</b> {came}
      {spent !== undefined && (
        <>
          {' '}
          and <span className="ld-out">{spent}</span> spent
        </>
      )}
      {rest}
    </>
  )
}

/**
 * The balance and its chart (the Ledger revamp design, section 4.1): the big number, the range pills that change only this
 * card, and one gold line of the primogems held each day, with a dashed line where the period began and a small hollow dot on
 * each day with a big moment. The pointer along the chart shows that day in the big number.
 */
export function LedgerChart({ days, today, words = PRIMOGEM_WORDS }: { days: LedgerDay[]; today: string; words?: ChartWords }) {
  const [range, setRange] = useState<Range>('month')
  const [at, setAt] = useState<number | null>(null)
  const gradient = useId()
  const shown = rangeDays(days, range, today)
  const monthName = monthTitle(today)
  const head = headline(shown, at, range, monthName, words)
  const drawing = chartGeometry(shown, BOX)
  const point = at === null ? undefined : drawing.points[at]
  const last = drawing.points[drawing.points.length - 1]
  const first = shown[0]
  const noBalance = shown.length > 0 && shown[shown.length - 1].held === null

  const over = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width === 0) return
    const index = dayAt(drawing.points, ((event.clientX - rect.left) / rect.width) * BOX.w)
    setAt(index < 0 ? null : index)
  }

  return (
    <section className="gb-panel ld-card ld-chart" data-testid="ledger-chart">
      <div className="ld-head">
        <div className="ld-bal">
          <span className="ld-label" data-testid="ledger-chart-label">
            {head.label}
          </span>
          <span className="ld-amount num" data-testid="ledger-chart-amount">
            {head.amount}
            {head.wishes !== '' && <small>{head.wishes}</small>}
          </span>
          <span className="ld-delta num" data-testid="ledger-chart-line">
            <Movement line={head.line} came={words.came} />
          </span>
          {noBalance && (
            // Kept in its place while the pointer is on a day, only hidden, so the card keeps its height.
            <a className="ld-link" href="#/pulls" style={at === null ? undefined : { visibility: 'hidden' }} tabIndex={at === null ? undefined : -1}>
              Set your balance in Pulls
            </a>
          )}
        </div>
        <Segmented label="Chart range" options={RANGES} value={range} onChange={(next) => { setRange(next); setAt(null) }} />
      </div>
      <div className="ld-chartbox">
        <svg
          className="ld-svg"
          viewBox={`0 0 ${BOX.w} ${BOX.h}`}
          width="100%"
          role="img"
          aria-label={noBalance ? words.aria.net : words.aria.held}
          data-points={shown.length}
          onPointerMove={over}
          onPointerLeave={() => setAt(null)}
        >
          <defs>
            <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" className="ld-g0" />
              <stop offset="1" className="ld-g1" />
            </linearGradient>
          </defs>
          {first !== undefined && (
            <>
              <line className="ld-start-line" x1={CHART_MARGINS.left} x2={BOX.w - CHART_MARGINS.right} y1={drawing.start.y} y2={drawing.start.y} />
              <text className="ld-axis-text" x={BOX.w - CHART_MARGINS.right} y={drawing.start.y - 6} textAnchor="end">
                {dayMonth(first.day)} {drawing.start.value < 0 ? `−${num(-drawing.start.value)}` : num(drawing.start.value)}
              </text>
              <path d={drawing.area} fill={`url(#${gradient})`} />
              <path className="ld-line" d={drawing.line} />
              {labelIndexes(shown.length).map((index) => (
                <text
                  key={shown[index].day}
                  className="ld-axis-text"
                  x={drawing.points[index].x}
                  y={BOX.h - 6}
                  textAnchor={index === 0 ? 'start' : drawing.points[index].x > BOX.w - 40 ? 'end' : 'middle'}
                >
                  {dayMonth(shown[index].day)}
                </text>
              ))}
              {drawing.moments.map((moment) => (
                <circle key={moment.x} className="ld-moment" cx={moment.x} cy={moment.y} r="3" />
              ))}
              {last !== undefined && <circle className="ld-now" cx={last.x - 1} cy={last.y} r="4" />}
            </>
          )}
          <line
            className="ld-xline"
            x1={point?.x ?? 0}
            x2={point?.x ?? 0}
            y1={CHART_MARGINS.top}
            y2={BOX.h - CHART_MARGINS.bottom}
            style={{ opacity: point === undefined ? 0 : 0.18 }}
          />
          <circle className="ld-dot" cx={point?.x ?? 0} cy={point?.y ?? 0} r="5" style={{ opacity: point === undefined ? 0 : 1 }} />
          <rect x="0" y="0" width={BOX.w} height={BOX.h} fill="transparent" />
        </svg>
      </div>
    </section>
  )
}
