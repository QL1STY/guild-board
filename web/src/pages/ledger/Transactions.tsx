import { useEffect, useMemo, useState } from 'react'
import { ledgerApi, messageOf } from '../../api.ts'
import { plural } from '../../format.ts'
import type { LedgerEntry, LedgerKind } from '../../ledgertypes.ts'
import { signed } from '../ledgerview.ts'
import { type DayGroup, type IconName, type Row, groupByDay } from './ledgerdays.ts'

const ICONS: Record<IconName, string> = {
  welkin: 'M12.5 4.5a6.5 6.5 0 1 0 5 10.6A5.6 5.6 0 0 1 12.5 4.5z',
  commissions: 'M6 4h8l3 3v11H6z M9 9h5 M9 12.5h5',
  events: 'M11.5 3.5l2.2 4.6 5 .6-3.7 3.4 1 5-4.5-2.5L7 17.1l1-5-3.7-3.4 5-.6z',
  endgame: 'M11.5 4.5a7 7 0 1 1-7 7 M11.5 8a3.5 3.5 0 1 1-3.5 3.5',
  other: 'M4.5 10h14v8h-14z M4.5 10l2-4h10l2 4 M10 10v3h3v-3',
  shop: 'M5.5 8.5h12l-1.2 9.5H6.7z M9 8.5a2.5 2.5 0 0 1 5 0',
  // Crystals: a gem, and two arrows for crystals exchanged for primogems.
  gem: 'M7.5 5.5h8l3.5 4.2-7.5 8.3L4 9.7z M4 9.7h15 M9.5 5.5l2 4.2 2-4.2',
  swap: 'M5 9h12.5 M14.5 6l3 3-3 3 M18 15H5.5 M8.5 12l-3 3 3 3',
  // Resin: a domain's door, a ley line's leaf, a boss's shield, a weekly boss's crown, a drop for Condensed Resin.
  dom: 'M5 18.5V10a6.5 6.5 0 0 1 13 0v8.5 M4 18.5h15 M9 18.5v-5h5v5',
  ley: 'M6 17.5c0-6.5 4-10.5 11-11.5 0 7.5-4 11.5-11 11.5z M6 17.5l6-6',
  boss: 'M11.5 4l6 2.5v5.2c0 3.5-2.5 6-6 7.3-3.5-1.3-6-3.8-6-7.3V6.5z',
  week: 'M5 16.5L4 8l4.5 3.5L11.5 6l3 5.5L19 8l-1 8.5z M5.5 19h12',
  cond: 'M11.5 4c3 4 5 6.5 5 9a5 5 0 0 1-10 0c0-2.5 2-5 5-9z',
  // Artifacts: an arrow up for one fed to enhance others, a basket for one salvaged.
  fed: 'M11.5 18V6 M6.5 11l5-5 5 5',
  salv: 'M6 7h11l-1 11H7z M9 7V5h5v2',
}

/** The Welkin a crescent, commissions a page, events a star, the Abyss and Theater a spiral, chests and the rest a chest, the shop a bag. */
export function SourceIcon({ name }: { name: IconName }) {
  return (
    <span className="ld-av" data-icon={name} aria-hidden="true">
      <svg viewBox="0 0 23 23" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round">
        <path d={ICONS[name]} />
      </svg>
    </span>
  )
}

function Amount({ amount, wishes }: { amount: number; wishes: number | null }) {
  return (
    <div className={amount > 0 ? 'ld-amt in num' : 'ld-amt num'}>
      {signed(amount)}
      {wishes !== null && <small>{plural(wishes, 'wish', 'wishes')}</small>}
    </div>
  )
}

function TxRow({ row }: { row: Row }) {
  const [open, setOpen] = useState(false)
  const body = (
    <>
      <SourceIcon name={row.icon} />
      <div className="ld-what">
        <div className="ld-t">{row.title}</div>
        <div className="ld-s num">{row.second}</div>
      </div>
      <Amount amount={row.amount} wishes={row.wishes} />
    </>
  )
  if (row.folded === undefined) return <li className="ld-row">{body}</li>
  return (
    <li className="ld-row folded">
      <button type="button" className="ld-fold" aria-expanded={open} onClick={() => setOpen((was) => !was)}>
        {body}
      </button>
      {open && (
        <ul className="ld-folded">
          {row.folded.map((entry) => (
            <li key={entry.id}>
              <span className="num">{entry.time.slice(11, 16)}</span>
              <span>{entry.name === '' ? entry.title : entry.name}</span>
              <span className={entry.amount > 0 ? 'num ld-in' : 'num'}>{signed(entry.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

function Day({ group }: { group: DayGroup }) {
  return (
    <section className="ld-daygroup">
      <h3 className="ld-day">
        <span>{group.label}</span>
        <span className="num">{group.summary}</span>
      </h3>
      <ul className="ld-rows">
        {group.rows.map((row) => (
          <TxRow key={row.id} row={row} />
        ))}
      </ul>
    </section>
  )
}

/** Only the five-star artifacts are listed on the Artifacts view (the design, section 6): the log holds hundreds of fours. */
const RANK: Record<LedgerKind, number> = { primogem: 0, crystal: 0, resin: 0, artifact: 5 }

/**
 * The transactions (the Ledger revamp design, section 4.2): the log of the chosen kind, newest first, grouped by day,
 * "Today", "Yesterday", then "Tuesday, 20 October", each with what it came to. The primogems fold a day's treasure chests into
 * one row, the resin a run of one domain, the artifacts a run of those fed or salvaged; a folded row opens on a click. "Show
 * earlier days" reads the entries before the last one shown. The feed stands where the page puts it: under the chart, or down
 * the right as tall as the left side.
 */
export function Transactions({ kind, today }: { kind: LedgerKind; today: string }) {
  const [entries, setEntries] = useState<LedgerEntry[] | null>(null)
  const [more, setMore] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    let current = true
    setEntries(null)
    setProblem(null)
    ledgerApi.history(kind, null, 50, RANK[kind]).then(
      (page) => {
        if (!current) return
        setEntries(page.entries)
        setMore(page.more)
      },
      (failure: unknown) => {
        if (current) setProblem(messageOf(failure))
      },
    )
    return () => {
      current = false
    }
  }, [kind])
  const days = useMemo(() => (entries === null ? [] : groupByDay(entries, today, kind)), [kind, entries, today])
  const showMore = async () => {
    const last = entries?.[entries.length - 1]
    if (last === undefined || loading) return
    setLoading(true)
    try {
      const page = await ledgerApi.history(kind, last.id, 50, RANK[kind])
      setEntries((shown) => [...(shown ?? []), ...page.entries])
      setMore(page.more)
    } catch (failure) {
      setProblem(messageOf(failure))
    } finally {
      setLoading(false)
    }
  }
  return (
    <section className="gb-panel ld-card ld-tx" data-testid="ledger-tx">
      <div className="ld-txin">
        <h2 className="gb-section-h ld-h">Transactions</h2>
        <p className="ld-sub">{kind === 'artifact' ? 'Five-stars, newest first, a day at a time' : 'Newest first, a day at a time'}</p>
        <div className="ld-scroll">
          {entries === null ? (
            <p className="ld-empty">{problem ?? 'Reading the history…'}</p>
          ) : entries.length === 0 ? (
            <p className="ld-empty">Nothing in this history yet.</p>
          ) : (
            days.map((group) => <Day key={group.day} group={group} />)
          )}
          {entries !== null && problem !== null && <p className="ld-empty">{problem}</p>}
        </div>
        {entries !== null && more && (
          <button type="button" className="ld-more" aria-disabled={loading} onClick={() => void showMore()}>
            Show earlier days
          </button>
        )}
      </div>
    </section>
  )
}
