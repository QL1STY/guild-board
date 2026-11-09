import { type PointerEvent, useState } from 'react'
import { dayMonth } from '../../format.ts'
import { Segmented } from '../../ui/Segmented.tsx'
import { BAR_BOX, BAR_MARGINS, type BarDay, barAt, barScale, barsGeometry } from './ledgerbars.ts'
import { type Range, labelIndexes, rangeDays } from './ledgerchart.ts'
import type { KindHead, Seg } from './ledgerkinds.ts'

const RANGES: readonly { value: Range; label: string }[] = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'month3', label: '3 months' },
  { value: 'month6', label: '6 months' },
]

/** A sentence made of runs: what came in in green, what went out in ink, a figure in bold. */
export function Segs({ line }: { line: Seg[] }) {
  return (
    <>
      {line.map((seg, index) =>
        seg.tone === undefined ? (
          seg.text
        ) : seg.tone === 'in' ? (
          <b key={index} className="ld-in">
            {seg.text}
          </b>
        ) : seg.tone === 'out' ? (
          <span key={index} className="ld-out">
            {seg.text}
          </span>
        ) : (
          <b key={index}>{seg.text}</b>
        ),
      )}
    </>
  )
}

/** A line of the key under a chart: a colour and what it stands for, or the dashed reference line. */
export type ChartKey = { color: string; text: string } | { ref: true; text: string }

/**
 * The bar chart of a kind that keeps no balance (the Ledger revamp design, section 6), in the frame of the Primogems chart:
 * the big number, the range pills that change only this card, a bar a day (what came in up, what went out down), a key under
 * it, and a band on the day under the pointer, whose figures the big number shows.
 */
export function KindChart<T extends { day: string }>({
  days, today, bars, head, keys, label, minHi, ref,
}: {
  days: T[]
  today: string
  bars: (days: T[]) => BarDay[]
  head: (shown: T[], at: number | null, range: Range) => KindHead
  keys: ChartKey[]
  label: string
  minHi?: number
  /** A line that must show whatever the bars, and its label: the 180 resin a day regrows. */
  ref?: { value: number; label: string }
}) {
  const [range, setRange] = useState<Range>('month')
  const [at, setAt] = useState<number | null>(null)
  const shown = rangeDays(days, range, today)
  const drawn = bars(shown)
  const scale = barScale(drawn, { ref: ref?.value, minHi })
  const drawing = barsGeometry(drawn, scale, ref?.value ?? null)
  const words = head(shown, at, range)
  // The note under the number is the resting one, kept while the pointer is on a day: the card never changes height.
  const resting = at === null ? words : head(shown, null, range)
  const { left, right, top } = BAR_MARGINS
  const indexes = labelIndexes(shown.length)

  const over = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width === 0) return
    const index = barAt(shown.length, ((event.clientX - rect.left) / rect.width) * BAR_BOX.w)
    setAt(index < 0 ? null : index)
  }

  return (
    <section className="gb-panel ld-card ld-chart" data-testid="ledger-chart">
      <div className="ld-head">
        <div className="ld-bal">
          <span className="ld-label" data-testid="ledger-chart-label">
            {words.label}
          </span>
          <span className="ld-amount num" data-testid="ledger-chart-amount">
            {words.amount}
            {words.unit !== '' && <small>{words.unit}</small>}
          </span>
          <span className="ld-delta num" data-testid="ledger-chart-line">
            <Segs line={words.line} />
          </span>
          {resting.luck !== null && (
            <span className="ld-luck num" data-testid="ledger-chart-luck">
              <Segs line={words.luck ?? resting.luck} />
            </span>
          )}
          {resting.note !== '' && (
            <span className="ld-bnote" data-testid="ledger-chart-note">
              {resting.note}
            </span>
          )}
        </div>
        <Segmented
          label="Chart range"
          options={RANGES}
          value={range}
          onChange={(next) => {
            setRange(next)
            setAt(null)
          }}
        />
      </div>
      <div className="ld-chartbox">
        <svg
          className="ld-svg"
          viewBox={`0 0 ${BAR_BOX.w} ${BAR_BOX.h}`}
          width="100%"
          role="img"
          aria-label={label}
          data-points={shown.length}
          onPointerMove={over}
          onPointerLeave={() => setAt(null)}
        >
          <rect
            className="ld-band"
            x={left + (at ?? 0) * drawing.slot}
            y={top}
            width={drawing.slot}
            height={drawing.floor - top}
            style={{ opacity: at === null ? 0 : 0.1 }}
          />
          {drawing.grid.map((line) => (
            <g key={line.label}>
              <line className="ld-grid" x1={left} x2={BAR_BOX.w - right} y1={line.y} y2={line.y} />
              <text className="ld-axis-text ld-halo" x={BAR_BOX.w - right} y={line.y - 5} textAnchor="end">
                {line.label}
              </text>
            </g>
          ))}
          {drawing.ref !== null && ref !== undefined && (
            <g>
              <line className="ld-ref" x1={left} x2={BAR_BOX.w - right} y1={drawing.ref} y2={drawing.ref} />
              <text className="ld-axis-text ld-halo" x={BAR_BOX.w - right} y={drawing.ref - 5} textAnchor="end">
                {ref.label}
              </text>
            </g>
          )}
          <line className="ld-zero" x1={left} x2={BAR_BOX.w - right} y1={drawing.zero} y2={drawing.zero} />
          {drawing.rects.map((rect, index) => (
            <rect key={index} className="ld-bar" x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx="2" style={{ fill: rect.color }} />
          ))}
          {indexes.map((index) => (
            <text
              key={shown[index].day}
              className="ld-axis-text"
              x={index === 0 ? left : drawing.centers[index]}
              y={BAR_BOX.h - 6}
              textAnchor={index === 0 ? 'start' : drawing.centers[index] > BAR_BOX.w - 40 ? 'end' : 'middle'}
            >
              {dayMonth(shown[index].day)}
            </text>
          ))}
          <rect x="0" y="0" width={BAR_BOX.w} height={BAR_BOX.h} fill="transparent" />
        </svg>
      </div>
      <div className="ld-keyline">
        {keys.map((key) => (
          <span key={key.text}>
            {'ref' in key ? <span className="ld-refkey" /> : <i style={{ background: key.color }} />}
            {key.text}
          </span>
        ))}
      </div>
    </section>
  )
}
