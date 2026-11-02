import '../styles/friends.css'
import { type Column, columnTip, tickText } from '../pages/compareview.ts'
import { useRoving } from '../ui/roving.ts'
import { ChartCard, type TableData } from './ChartCard.tsx'
import { axis } from './scale.ts'

/**
 * Compare's two charts (the online design, section 9, mockup 3): a pair of columns for each week or month, the player's in
 * the gold of progress and the friend's in the series blue, with an axis of numbers, a legend, a tooltip on hover and on
 * focus, and Show as table, as the charts of Stats have. A figure that is not known is a column of no height, and the
 * tooltip says there is no data. The arrow keys, Home and End move between the groups.
 */
export function GroupedColumns({
  title,
  subtitle,
  columns,
  name,
  show,
  table,
}: {
  title: string
  subtitle: string
  columns: readonly Column[]
  /** The friend's name, for the legend and the tooltips. */
  name: string
  /** A figure as the tooltip writes it. */
  show: (value: number) => string
  table: TableData
}) {
  const roving = useRoving(columns.length)
  const scale = axis(Math.max(0, ...columns.flatMap((column) => [column.me ?? 0, column.friend ?? 0])))
  const height = (value: number | null) => `${((value ?? 0) / scale.top) * 100}%`
  // A tooltip near an edge opens towards the middle, so that it stays inside the card.
  const edge = (index: number) => (index < columns.length / 4 ? ' start' : index >= (columns.length * 3) / 4 ? ' end' : '')
  return (
    <ChartCard title={title} subtitle={subtitle} tables={[table]}>
      <div className="cmp-legend">
        <span className="m">You</span>
        <span className="f">{name}</span>
      </div>
      <div className="cmp-plot">
        <div className="cmp-y" aria-hidden="true">
          {scale.ticks.map((tick) => (
            <span key={tick} style={{ bottom: height(tick) }}>
              {tickText(tick)}
            </span>
          ))}
        </div>
        <div className="cmp-area">
          {scale.ticks.slice(1).map((tick) => (
            <span key={tick} className="cmp-line" style={{ bottom: height(tick) }} />
          ))}
          <div className="cmp-cols">
            {columns.map((column, index) => {
              const tip = columnTip(column, name, show)
              return (
                <div
                  key={column.title}
                  className={`cmp-col${edge(index)}`}
                  role="img"
                  aria-label={`${tip.title}: ${tip.lines.map((line) => line.join(' ')).join(', ')}`}
                  {...roving(index)}
                >
                  <i className="m" style={{ height: height(column.me) }} />
                  <i className="f" style={{ height: height(column.friend) }} />
                  <span className="cmp-tip" aria-hidden="true">
                    <b>{tip.title}</b>
                    {tip.lines.map(([who, text]) => (
                      <span key={who}>
                        {who}
                        <em>{text}</em>
                      </span>
                    ))}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
        <div className="cmp-x" aria-hidden="true">
          {columns.map((column) => (
            <span key={column.title}>{column.label}</span>
          ))}
        </div>
      </div>
    </ChartCard>
  )
}
