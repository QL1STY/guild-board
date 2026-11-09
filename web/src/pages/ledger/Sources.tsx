import { num } from '../../format.ts'
import type { Ledger } from '../../ledgertypes.ts'
import { SOURCE_NAMES } from './ledgerdays.ts'

/** The Primogems come from five groups (`ledger/reasons.py`); each has its mark's token. */
const MARKS = {
  welkin: 'var(--src-welkin)',
  commissions: 'var(--src-commissions)',
  events: 'var(--src-events)',
  endgame: 'var(--src-endgame)',
  other: 'var(--src-other)',
} as const

/**
 * Where they came from (the Ledger revamp design, section 4.3): the month's earned primogems by group, longest first, as one
 * segmented bar and a row each with a dot, the name, the amount and its share; under a line, the Fates the month bought. Bought
 * primogems are never counted as earned.
 */
export function Sources({ month, monthName }: { month: Ledger['month']; monthName: string }) {
  const earned = month.sources.reduce((sum, source) => sum + source.amount, 0)
  const fates = month.fates_bought
  return (
    <section className="gb-panel ld-card" data-testid="ledger-sources">
      <h2 className="gb-section-h ld-h">Where they came from</h2>
      <p className="ld-sub">Earned in {monthName}</p>
      {earned > 0 && (
        <div className="ld-segbar" aria-hidden="true">
          {month.sources.map((source) => (
            <i key={source.group} style={{ flex: source.amount, background: MARKS[source.group] }} />
          ))}
        </div>
      )}
      <ul className="ld-cats">
        {month.sources.map((source) => (
          <li key={source.group} className="ld-cat">
            <i style={{ background: MARKS[source.group] }} />
            <span>{SOURCE_NAMES[source.group]}</span>
            <b className="num">{num(source.amount)}</b>
            <span className="ld-share num">{Math.round((source.amount / earned) * 100)}%</span>
          </li>
        ))}
        {month.sources.length === 0 && <li className="ld-none">Nothing earned yet this month.</li>}
      </ul>
      {fates > 0 && (
        <div className="ld-fates">
          <i />
          <span>Spent on {fates} {fates === 1 ? 'Fate' : 'Fates'}</span>
          <b className="num">−{num(fates * 160)}</b>
        </div>
      )}
    </section>
  )
}
