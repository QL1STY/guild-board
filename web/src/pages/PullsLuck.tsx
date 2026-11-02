import { type CSSProperties, type ReactNode, type RefObject, useId, useLayoutEffect, useRef, useState } from 'react'
import { DataTable } from '../charts/ChartCard.tsx'
import {
  ALL_BANNERS, monthsLayout, monthsTable, monthTitle, monthTotal, segmentPath, segmentWords, wishesShown,
} from '../charts/months.ts'
import { num } from '../format.ts'
import type { MonthWishes, Pulls, PullsPool } from '../types.ts'
import { useRoving } from '../ui/roving.ts'
import { type LuckTile, luckTiles, POOL_LABELS } from './pullsview.ts'

/**
 * One of the three tiles (spec 3.3): its label, its figure with what it is of, and its note against a typical player. A
 * tile with nothing to show yet says so in its note and has no figure. `bar` goes under the figure.
 */
function Tile({ id, tile, bar }: { id: string; tile: LuckTile; bar?: ReactNode }) {
  return (
    <div className="pl-tile" role="group" aria-label={tile.label} data-testid={`luck-${id}`}>
      <div className="pl-tile-k">{tile.label}</div>
      {tile.value !== null && (
        <div className="pl-tile-v" data-testid="tile-value">
          {tile.value}
          {tile.of !== null && (
            <>
              {' '}
              <small>{tile.of}</small>
            </>
          )}
        </div>
      )}
      {bar}
      <p className="pl-tile-n" data-testid="tile-note">{tile.note}</p>
    </div>
  )
}

/**
 * The legend over the graph: a small square of each wish's colour and its name in the ink, the wishes in the order the
 * columns stack them, bottom up.
 */
function Legend({ shown }: { shown: readonly PullsPool[] }) {
  return (
    <p className="pl-legend" data-testid="months-legend">
      {shown.map((wish) => (
        <span key={wish}>
          <i className={`pl-sw ${wish}`} />
          {POOL_LABELS[wish]}
        </span>
      ))}
    </p>
  )
}

/** The size of an element in whole pixels, followed as it changes: the plot is drawn at the size it has. */
function useSize(): [RefObject<HTMLDivElement | null>, { width: number; height: number }] {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 640, height: 200 })
  useLayoutEffect(() => {
    const element = ref.current
    if (element === null) return
    const measure = () => {
      const width = Math.round(element.clientWidth)
      const height = Math.round(element.clientHeight)
      if (width > 0 && height > 0) setSize((was) => (was.width === width && was.height === height ? was : { width, height }))
    }
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(element)
    return () => watch.disconnect()
  }, [])
  return [ref, size]
}

/**
 * The columns: SVG drawn at the size the plot has, with a hit layer of HTML over it, so that the pointer and the keyboard
 * reach each segment (one tab stop for all, the arrow keys move along them). A segment's tooltip, on hover and on focus,
 * says its month, its wish with the wishes of it, and the month's total. The busiest month carries its total.
 */
function Plot({ months, shown }: { months: readonly MonthWishes[]; shown: readonly PullsPool[] }) {
  const [ref, size] = useSize()
  const layout = monthsLayout(months, shown, size)
  const segments = layout.columns.flatMap((column, month) => column.segments.map((segment) => ({ column, month, segment })))
  const roving = useRoving(segments.length)
  // The segment the pointer is on or the keyboard has reached, and whether it was the keyboard that reached it.
  const [active, setActive] = useState<number | null>(null)
  const [byKeyboard, setByKeyboard] = useState(false)
  const leave = (at: number) => setActive((now) => (now === at ? null : now))
  const { box } = layout
  const peak = layout.busiest === null ? null : layout.columns[layout.busiest]
  // The model read again can leave fewer segments than the one that was active.
  const tip = active === null ? null : (segments[active] ?? null)
  // A tooltip near an edge opens towards the middle, so that it stays inside the plot.
  const place = (cx: number): { left: number; transform: string } =>
    cx < 90
      ? { left: Math.max(0, cx - 14), transform: 'translate(0, -100%)' }
      : cx > size.width - 90
        ? { left: Math.min(size.width, cx + 14), transform: 'translate(-100%, -100%)' }
        : { left: cx, transform: 'translate(-50%, -100%)' }
  return (
    <div ref={ref} className="pl-plot" data-testid="months-plot">
      <svg className="pl-svg" width={size.width} height={size.height} aria-hidden="true" focusable="false">
        {layout.ticks.map((tick) => (
          <g key={tick.value}>
            {tick.value > 0 && <line className="pl-grid" x1={box.left} x2={box.right} y1={tick.y} y2={tick.y} />}
            <text className="pl-tick" x={box.left - 8} y={tick.y} dy="0.32em" textAnchor="end">
              {num(tick.value)}
            </text>
          </g>
        ))}
        <line className="pl-base" x1={box.left} x2={box.right} y1={box.bottom} y2={box.bottom} />
        {layout.columns.map((column, month) => (
          <g key={column.month.month} className="pl-col" style={{ '--n': month } as CSSProperties}>
            {column.segments.map((segment) => (
              <path
                key={segment.wish}
                className={`pl-seg ${segment.wish}${tip !== null && tip.segment === segment ? (byKeyboard ? ' on ring' : ' on') : ''}`}
                data-month={column.month.month}
                data-wish={segment.wish}
                d={segmentPath(segment)}
              />
            ))}
          </g>
        ))}
        {peak !== null && (
          <text className="pl-peak" data-testid="months-peak" x={peak.cx} y={peak.top - 5} textAnchor="middle">
            {num(peak.total)}
          </text>
        )}
        {layout.labels.map((label) => (
          <text key={label.index} className="pl-tick" data-testid="months-label" x={label.x} y={box.bottom + 15} textAnchor="middle">
            {label.text}
            {label.year !== null && (
              <tspan className="pl-year" x={label.x} dy="12">
                {label.year}
              </tspan>
            )}
          </text>
        ))}
      </svg>
      <div className="pl-hits">
        {segments.map(({ column, segment }, at) => {
          const say = segmentWords(column.month, segment.wish)
          const mark = roving(at)
          return (
            <div
              key={`${column.month.month}-${segment.wish}`}
              className="pl-hit"
              data-testid="months-hit"
              role="img"
              aria-label={`${say.title}, ${say.line}, ${say.all.toLowerCase()}`}
              data-wish={segment.wish}
              data-month={column.month.month}
              style={{ left: segment.hit.x, top: segment.hit.y, width: segment.hit.width, height: segment.hit.height }}
              {...mark}
              onMouseEnter={() => {
                setByKeyboard(false)
                setActive(at)
              }}
              onMouseLeave={() => leave(at)}
              onFocus={(event) => {
                mark.onFocus()
                setByKeyboard(event.currentTarget.matches(':focus-visible'))
                setActive(at)
              }}
              onBlur={() => leave(at)}
            />
          )
        })}
      </div>
      {tip !== null && (
        // Above the column's top, and above its total where the column carries it, so that the stack stays in view.
        <div
          className="pl-tip"
          data-testid="months-tip"
          style={{ top: tip.column.top - (layout.busiest === tip.month ? 22 : 8), ...place(tip.column.cx) }}
        >
          <b className="pl-tip-title">{monthTitle(tip.column.month.month)}</b>
          <span className="pl-tip-row">
            <i className={`pl-sw ${tip.segment.wish}`} />
            {POOL_LABELS[tip.segment.wish]}: <b>{num(tip.segment.count)}</b>
          </span>
          <span className="pl-tip-row">
            {ALL_BANNERS}: <b>{num(tip.column.total)}</b>
          </span>
        </div>
      )}
    </div>
  )
}

/**
 * Wishes each month (spec 3.3): a column a month from the oldest kept wish to this one, stacked by wish, with its legend
 * above, and a table of the same numbers behind "Show as a table". Months with no wish are gaps; with no wish in any
 * month it says so.
 */
function MonthsGraph({ months }: { months: readonly MonthWishes[] }) {
  const titleId = useId()
  const [asTable, setAsTable] = useState(false)
  const shown = wishesShown(months)
  const empty = months.every((month) => monthTotal(month) === 0)
  return (
    <section className="pl-months" aria-labelledby={titleId} data-testid="pulls-months">
      <div className="pl-months-head">
        <h3 id={titleId} className="gb-h">
          Wishes each month
        </h3>
        {!empty && (
          <button type="button" className="gb-link" onClick={() => setAsTable(!asTable)}>
            {asTable ? 'Show as a graph' : 'Show as a table'}
          </button>
        )}
      </div>
      {!empty && !asTable && <Legend shown={shown} />}
      <div className="pl-months-body">
        {empty ? (
          <p className="pl-muted">No wishes kept yet.</p>
        ) : asTable ? (
          <div className="pl-months-table" data-testid="months-table" tabIndex={0}>
            <DataTable table={monthsTable(months, shown)} />
          </div>
        ) : (
          <Plot months={months} shown={shown} />
        )}
      </div>
    </section>
  )
}

/**
 * The history's first row (the second pass, spec 3.3 and 3.4): the three luck tiles stacked in the left third, the
 * graph of the wishes each month in the right two thirds, both as tall as the taller.
 */
export function PullsLuck({ history }: { history: Pulls['history'] }) {
  const tiles = luckTiles(history)
  return (
    <div className="pl-glance" data-testid="pulls-luck">
      <div className="pl-tiles" data-testid="luck-tiles">
        <Tile id="average" tile={tiles.average} />
        <Tile
          id="fifty"
          tile={tiles.fifty}
          bar={
            tiles.fifty.value === null ? undefined : (
              <div className="pl-split" aria-hidden="true">
                <i className="won" style={{ flexGrow: tiles.fifty.won }} />
                <i className="lost" style={{ flexGrow: tiles.fifty.lost }} />
              </div>
            )
          }
        />
        <Tile id="kept" tile={tiles.kept} />
      </div>
      <MonthsGraph months={history.months} />
    </div>
  )
}
