import { inPeriod } from '../pages/statsview.ts'
import type { Stats } from '../types.ts'
import { useRoving } from '../ui/roving.ts'
import { ChartCard } from './ChartCard.tsx'
import { HOUR_LEVELS, HOURS, hourCells, hourRows, notTracked, WEEKDAY_SHORT } from './hours.ts'

const LEVELS = ['', 'l1', 'l2', 'l3', 'l4']
const ROWS = 7
const TITLE = 'When you play'
const SUBTITLE = 'Minutes on an average day, by the hour on this PC'
/** An hour is named over every third column. */
const LABEL_EVERY = 3
const TABLE_NOTE = 'An empty row is a weekday that Guild Board was not tracking.'

/**
 * Play by weekday and hour: seven rows (Monday to Sunday) of 24 hours, five levels of the calendar's gold. Each cell is
 * the minutes of that weekday's hour on an average day of that weekday, over the part of the period Guild Board was
 * tracking. It follows the period switch. The cells are drawn and walked column by column, an hour at a time.
 */
export function WhenYouPlay({ stats }: { stats: Stats }) {
  const play = stats.play_hours
  const roving = useRoving(ROWS * HOURS.length, ROWS)
  if (play.empty) {
    return (
      <ChartCard title={TITLE} subtitle={SUBTITLE}>
        <p className="gb-note">No session was recorded {inPeriod(stats)}.</p>
      </ChartCard>
    )
  }
  const missing = notTracked(play)
  return (
    <ChartCard
      title={TITLE}
      subtitle={SUBTITLE}
      className="wy-card"
      tables={[
        {
          caption: `Minutes on an average day${missing ? `. ${TABLE_NOTE}` : ''}`,
          head: ['Weekday', ...HOURS],
          rows: hourRows(play),
          numeric: HOURS.map((_, hour) => hour + 1),
        },
      ]}
    >
      <div className="wy">
        <div className="wy-h" aria-hidden="true">
          {HOURS.map((hour, index) => (
            <span key={hour}>{index % LABEL_EVERY === 0 ? hour : ''}</span>
          ))}
        </div>
        <div className="wy-d" aria-hidden="true">
          {WEEKDAY_SHORT.map((name) => (
            <span key={name}>{name}</span>
          ))}
        </div>
        <div className="wy-g">
          {hourCells(play).map((cell, index) => {
            // A tooltip near an edge opens towards the middle, so that it stays inside the card.
            const edge = cell.hour < 6 ? ' tip-start' : cell.hour >= 18 ? ' tip-end' : ''
            const look = cell.minutes === null ? 'nt' : LEVELS[cell.level]
            return (
              <i
                key={index}
                className={`${look}${edge}`.trim()}
                role="img"
                aria-label={cell.tip}
                data-tip={cell.tip}
                {...roving(index)}
              />
            )
          })}
        </div>
      </div>
      <div className="wy-lg" aria-hidden="true">
        {HOUR_LEVELS.map((name, level) => (
          <span key={name}>
            <i className={LEVELS[level]} />
            {name}
          </span>
        ))}
        {missing && (
          <span>
            <i className="nt" />
            Not tracked
          </span>
        )}
      </div>
    </ChartCard>
  )
}
