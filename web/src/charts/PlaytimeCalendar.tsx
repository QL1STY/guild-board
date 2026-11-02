import { weekday } from '../format.ts'
import type { Stats } from '../types.ts'
import { useRoving } from '../ui/roving.ts'
import { cellTip, monthMarks, weekRows } from './calendar.ts'
import { ChartCard } from './ChartCard.tsx'

const LEVELS = ['', 'l1', 'l2', 'l3', 'l4']
const ROWS = 7

/** Time in game per day: weeks as columns, five levels of one colour. It does not follow the period switch. */
export function PlaytimeCalendar({ stats }: { stats: Stats }) {
  const { cells, weeks } = stats.calendar
  // The days that have not come yet end the last week. They are left blank and cannot be focused.
  const filled = cells.findLastIndex((cell) => cell.minutes !== null) + 1
  const roving = useRoving(filled, ROWS)
  const firstWeek = cells.slice(0, ROWS)
  return (
    <ChartCard
      title="Playtime calendar"
      subtitle={`Time in game per day, last ${weeks} weeks`}
      tables={[
        {
          head: ['Week of', ...firstWeek.map((cell) => weekday(cell.day))],
          rows: weekRows(cells),
          numeric: [1, 2, 3, 4, 5, 6, 7],
        },
      ]}
    >
      <div className="hm">
        <div className="hm-m" aria-hidden="true" style={{ gridTemplateColumns: `repeat(${weeks}, 17px)` }}>
          {monthMarks(cells).map((mark, week) => (
            <span key={week}>{mark}</span>
          ))}
        </div>
        <div className="hm-d" aria-hidden="true">
          {firstWeek.map((cell, row) => (
            <span key={cell.day}>{row % 2 === 0 ? weekday(cell.day) : ''}</span>
          ))}
        </div>
        <div className="hm-g">
          {cells.map((cell, index) =>
            index >= filled ? (
              <i key={cell.day} className="lx" />
            ) : (
              <i
                key={cell.day}
                className={`${LEVELS[cell.level ?? 0]}${index >= cells.length - 4 * ROWS ? ' tip-end' : ''}`}
                role="img"
                aria-label={cellTip(cell)}
                data-tip={cellTip(cell)}
                {...roving(index)}
              />
            ),
          )}
        </div>
      </div>
      <div className="hm-lg" aria-hidden="true">
        <span>None</span>
        <i />
        <i className="l1" />
        <i className="l2" />
        <i className="l3" />
        <i className="l4" />
        <span>2 h or more</span>
      </div>
    </ChartCard>
  )
}
