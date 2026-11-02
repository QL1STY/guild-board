import type { CSSProperties } from 'react'
import { num } from '../format.ts'
import type { Group } from '../ledgertypes.ts'
import { periodTitle } from '../pages/statsview.ts'
import type { Stats } from '../types.ts'
import { useRoving } from '../ui/roving.ts'
import { ChartCard } from './ChartCard.tsx'
import { ColumnsChart } from './ColumnsChart.tsx'
import { GROUP_COLOURS, stacked } from './stack.ts'

type Month = Stats['primogems']['months'][number]

const TITLE = 'Primogems by month'
const SUBTITLE = 'Per month, and this month by source'
const nameOf = (month: Month) => (month.current ? `${month.label} so far` : month.label)

/**
 * Primogems earned per day, or per week over a long period. Where the game's own primogem history or the diary's detail
 * reaches, the core splits each column by source and they are stacked (the ledger plan, Task 7); days before are the
 * rises of the diary's running total, striped as estimates. A core without the ledger sends no groups: the columns stay
 * one colour, as they were.
 */
export function PrimogemsPerDay({ stats }: { stats: Stats }) {
  const data = stats.primogem_days
  const order = data.groups_order
  const stack =
    stacked(data) && order !== undefined
      ? { order, labels: { ...DEFAULT_LABELS, ...data.group_labels }, colours: GROUP_COLOURS }
      : undefined
  return (
    <ColumnsChart
      title={`Primogems earned per ${data.unit}`}
      noun="Primogems"
      data={data}
      scope={stats}
      stack={stack}
      subtitle={
        stack === undefined
          ? undefined
          : `${periodTitle(stats)} · ${num(data.total)} earned · from the game's own primogem history`
      }
      note={stack === undefined ? undefined : 'Spent primogems are not taken off here. They are on the Ledger page.'}
    />
  )
}

/** The groups' names, should the core send none (`ledger/reasons.py` GROUP_LABELS). */
const DEFAULT_LABELS: Record<Group, string> = {
  commissions: 'Daily commissions',
  welkin: 'Blessing of the Welkin Moon',
  events: 'Events',
  endgame: 'Spiral Abyss and Theater',
  other: 'Other',
}

/** Primogems per month, and this month by source. It does not follow the period switch. */
export function PrimogemsEarned({ stats }: { stats: Stats }) {
  const { months, sources } = stats.primogems
  const monthKeys = useRoving(months.length)
  const sourceKeys = useRoving(sources.length)
  if (months.length === 0) {
    return (
      <ChartCard title={TITLE} subtitle={SUBTITLE}>
        <p className="gb-note">No primogem income has been read yet.</p>
      </ChartCard>
    )
  }
  const highest = Math.max(1, ...months.map((month) => month.value))
  const largest = Math.max(1, ...sources.map((source) => source.amount))
  const thisMonth = Math.max(1, sources.reduce((sum, source) => sum + source.amount, 0))
  return (
    <ChartCard
      title={TITLE}
      subtitle={SUBTITLE}
      tables={[
        {
          caption: 'Per month',
          head: ['Month', 'Primogems'],
          rows: months.map((month) => [nameOf(month), num(month.value)]),
          numeric: [1],
        },
        {
          caption: 'This month by source',
          head: ['Source', 'Primogems'],
          rows: sources.map((source) => [source.name, num(source.amount)]),
          numeric: [1],
        },
      ]}
    >
      <div className="pm">
        <div>
          <div className="pm-cols">
            {months.map((month, index) => {
              const label = `${nameOf(month)}: ${num(month.value)}`
              return (
                <div key={month.ym} className="pm-col" role="img" aria-label={label} data-tip={label} {...monthKeys(index)}>
                  <i className={month.current ? 'now' : undefined} style={{ height: `${(month.value / highest) * 100}%` }}>
                    <b>{num(month.value)}</b>
                  </i>
                </div>
              )
            })}
          </div>
          <div className="pm-x" aria-hidden="true">
            {months.map((month) => (
              <span key={month.ym}>{nameOf(month)}</span>
            ))}
          </div>
        </div>
        <div className="pm-sources">
          {sources.length === 0 && <p className="gb-note">Nothing earned yet this month.</p>}
          {sources.map((source, index) => (
            <div
              key={source.name}
              className="hb tip-end"
              role="img"
              aria-label={`${source.name}: ${num(source.amount)}`}
              data-tip={`${Math.round((source.amount / thisMonth) * 100)}% of this month`}
              {...sourceKeys(index)}
            >
              <span>{source.name}</span>
              <div className="b">
                <i style={{ '--w': source.amount / largest } as CSSProperties} />
                <b>{num(source.amount)}</b>
              </div>
            </div>
          ))}
        </div>
      </div>
    </ChartCard>
  )
}
