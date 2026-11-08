import type { CSSProperties } from 'react'
import { weekday } from '../format.ts'
import type { Stats } from '../types.ts'
import { useRoving } from '../ui/roving.ts'
import { useBox } from '../ui/useBox.ts'
import { cellSize, cellTip, lastWeeks, monthMarks, runText, weekRows, weeksThatFit } from './calendar.ts'
import { ChartCard } from './ChartCard.tsx'

const LEVELS = ['', 'l1', 'l2', 'l3', 'l4']
const ROWS = 7
/** The cell's size at least, which is today's, and at most; the gap between cells; the month names above the grid; the weekday names beside it. */
const CELL_MIN = 17
const CELL_MAX = 30
const GAP = 3
const LABELS_ABOVE = 14
const LABELS_BESIDE = 34
/** What it shows before the card has been measured. */
const WEEKS_UNMEASURED = 12

/**
 * Time in game per day: weeks as columns, five levels of one colour. It does not follow the period switch. It shows as
 * many weeks as fit the card's width, the newest at the right, and the cells grow to fill the height the card is given
 * (spec 2.1); it counts again when the card changes size.
 */
export function PlaytimeCalendar({ stats }: { stats: Stats }) {
  const { ref, width, height } = useBox<HTMLDivElement>()
  const measured = width > 0 && height > 0
  const cell = measured ? cellSize(height, GAP, LABELS_ABOVE, CELL_MIN, CELL_MAX) : CELL_MIN
  const weeks = measured ? weeksThatFit(width, cell, GAP, LABELS_BESIDE) : WEEKS_UNMEASURED
  const cells = lastWeeks(stats.calendar.cells, weeks)
  const shown = cells.length / ROWS
  // The days that have not come yet end the last week. They are left blank and cannot be focused.
  const filled = cells.findLastIndex((cell) => cell.minutes !== null) + 1
  const roving = useRoving(filled, ROWS)
  const firstWeek = cells.slice(0, ROWS)
  const run = runText(stats.calendar.run)
  return (
    <ChartCard
      title="Playtime calendar"
      subtitle={`Time in game per day, last ${shown} weeks`}
      className="hm-card"
      tables={[
        {
          head: ['Week of', ...firstWeek.map((cell) => weekday(cell.day))],
          rows: weekRows(cells),
          numeric: [1, 2, 3, 4, 5, 6, 7],
        },
      ]}
    >
      <div className="hm-box" ref={ref}>
        {measured && (
          <div className="hm" style={{ '--cell': `${cell}px` } as CSSProperties}>
            <div className="hm-m" aria-hidden="true" style={{ gridTemplateColumns: `repeat(${shown}, var(--cell))` }}>
              {monthMarks(cells).map((mark, week) => (
                <span key={week}>{mark}</span>
              ))}
            </div>
            <div className="hm-d" aria-hidden="true">
              {firstWeek.map((day, row) => (
                <span key={day.day}>{row % 2 === 0 ? weekday(day.day) : ''}</span>
              ))}
            </div>
            <div className="hm-g">
              {cells.map((day, index) =>
                index >= filled ? (
                  <i key={day.day} className="lx" />
                ) : (
                  <i
                    key={day.day}
                    className={`${LEVELS[day.level ?? 0]}${index < 4 * ROWS ? ' tip-start' : index >= cells.length - 4 * ROWS ? ' tip-end' : ''}`}
                    role="img"
                    aria-label={cellTip(day)}
                    data-tip={cellTip(day)}
                    {...roving(index)}
                  />
                ),
              )}
            </div>
          </div>
        )}
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
        {run !== '' && (
          <span className="hm-run">
            {stats.calendar.run.current > 0 && <span className="hm-dot" aria-hidden="true">●</span>}
            {run.split(/(\d+ days?)/).map((part, at) => (at % 2 === 1 ? <b key={at}>{part}</b> : part))}
          </span>
        )}
      </div>
    </ChartCard>
  )
}
