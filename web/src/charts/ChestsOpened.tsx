import type { Stats } from '../types.ts'
import { ColumnsChart } from './ColumnsChart.tsx'

/** Chests opened per day, or per week over a long period. */
export function ChestsOpened({ stats }: { stats: Stats }) {
  return (
    <ColumnsChart title={`Chests opened per ${stats.chests.unit}`} noun="Chests" data={stats.chests} scope={stats} />
  )
}
