import type { CSSProperties } from 'react'
import { change, pct, plural } from '../format.ts'
import { inPeriod, startLabel } from '../pages/statsview.ts'
import type { Stats } from '../types.ts'
import { useRoving } from '../ui/roving.ts'
import { ChartCard } from './ChartCard.tsx'

const AXIS = [0, 25, 50, 75, 100]

/** Where each region that changed stood at the start of the period, and where it stands now. */
export function ExplorationGained({ stats }: { stats: Stats }) {
  const { rows, unchanged } = stats.exploration
  const roving = useRoving(rows.length)
  const from = startLabel(stats)
  if (rows.length === 0) {
    // No region at all, changed or unchanged, means that exploration has not been read.
    const read = unchanged > 0
    return (
      <ChartCard
        title="Exploration gained"
        subtitle={read ? `No region changed ${inPeriod(stats)}` : 'Exploration has not been read yet.'}
      >
        {read && <p className="gb-note">Explore a little and sync, and the gain shows here.</p>}
      </ChartCard>
    )
  }
  const others = unchanged > 0 ? ` · ${plural(unchanged, 'other')} unchanged` : ''
  return (
    <ChartCard
      title="Exploration gained"
      subtitle={`Regions that changed ${inPeriod(stats)}${others}`}
      tables={[
        {
          head: ['Region', from, 'Now', 'Gained'],
          rows: rows.map((row) => [
            row.name,
            pct(row.start, 1),
            pct(row.now, 1),
            change(row.now - row.start, (gain) => pct(gain, 1)),
          ]),
          numeric: [1, 2, 3],
        },
      ]}
    >
      <div className="lg">
        <span>
          <i className="a" />
          {from}
        </span>
        <span>
          <i className="b" />
          Now
        </span>
      </div>
      {rows.map((row, index) => {
        const span = `${pct(row.start, 1)} to ${pct(row.now, 1)}`
        return (
          <div key={row.name} className="db-row">
            <span className="n" title={row.name}>
              {row.name}
            </span>
            <div className="db-track" role="img" aria-label={`${row.name}: ${span}`} data-tip={span} {...roving(index)}>
              <div
                className="db-line"
                style={{ left: `${Math.min(row.start, row.now)}%`, width: `${Math.abs(row.now - row.start)}%` }}
              />
              <div className="db-dot a" style={{ left: `${row.start}%` }} />
              {/* It slides out from the dot it started at (--from) to where it is now, along the line. */}
              <div className="db-dot b" style={{ left: `${row.now}%`, '--from': `${row.start}%` } as CSSProperties} />
            </div>
            <span className="v">{pct(row.now, 1)}</span>
          </div>
        )
      })}
      <div className="db-axis" aria-hidden="true">
        <span />
        <div>
          {AXIS.map((tick) => (
            <span key={tick}>{tick}%</span>
          ))}
        </div>
        <span />
      </div>
    </ChartCard>
  )
}
