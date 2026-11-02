import type { Stats } from '../types.ts'
import { ChartCard, DataTable } from './ChartCard.tsx'

/** The latest and the best result per endgame mode. It is a table already, so there is no chart to switch from. */
export function Endgame({ stats }: { stats: Stats }) {
  return (
    <ChartCard title="Endgame" subtitle="Latest result per mode. History builds up from the day tracking starts.">
      {stats.endgame.length === 0 ? (
        <p className="gb-note">No endgame results have been read yet.</p>
      ) : (
        <DataTable
          table={{
            head: ['Mode', 'Latest result', 'Period', 'Best so far'],
            rows: stats.endgame.map((row) => [row.label, row.result, row.period, row.best]),
            numeric: [3],
          }}
        />
      )}
    </ChartCard>
  )
}
