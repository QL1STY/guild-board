import { num } from '../../format.ts'
import type { Group, Ledger } from '../../ledgertypes.ts'
import { signed } from '../ledgerview.ts'

/** The words and numbers of the Ledger's cards (the Ledger revamp design, sections 4.4 and 4.5), with no DOM. */

const ORDER: Group[] = ['welkin', 'commissions', 'events', 'endgame', 'other']

/** A source in the comparison's rows, and in the line that names the biggest change. */
const COMPARED: Record<Group, { label: string; named: string }> = {
  welkin: { label: 'Welkin Moon', named: 'the Welkin Moon' },
  commissions: { label: 'Daily commissions', named: 'daily commissions' },
  events: { label: 'Events', named: 'events' },
  endgame: { label: 'Abyss and Theater', named: 'the Abyss and Theater' },
  other: { label: 'Chests and other', named: 'chests and other' },
}

/**
 * This month so far against the same days of last month: one sentence, a row a source (the biggest rise first, the falls
 * last) and one line naming the source that moved the total most. Without anything known of last month there is nothing to
 * compare and the rows are left out.
 */
export function compareRows(month: Ledger['month']): {
  line: string
  rows: { label: string; change: string; way: 'up' | 'down' | 'same' }[]
  note: string
} {
  const { previous } = month
  if (previous.earned === 0) return { line: 'Nothing to compare with last month yet.', rows: [], note: '' }
  const total = month.earned - previous.earned
  const percent = Math.round((Math.abs(total) / previous.earned) * 100)
  const line = percent === 0 ? 'You earned about as much as last month.' : `You earned ${percent}% ${total > 0 ? 'more' : 'less'} this month.`

  const now: Record<Group, number> = { welkin: 0, commissions: 0, events: 0, endgame: 0, other: 0 }
  for (const source of month.sources) now[source.group] = source.amount
  const moves = ORDER.filter((group) => now[group] > 0 || (previous.sources[group] ?? 0) > 0).map((group, order) => ({
    group,
    order,
    change: now[group] - (previous.sources[group] ?? 0),
  }))
  moves.sort((a, b) => b.change - a.change || a.order - b.order)
  const rows = moves.map(({ group, change }) => ({
    label: COMPARED[group].label,
    change: change === 0 ? 'same' : `${change > 0 ? '▲' : '▼'} ${signed(change)}`,
    way: change > 0 ? ('up' as const) : change < 0 ? ('down' as const) : ('same' as const),
  }))

  // The source that moved most in the direction the total moved; nothing is named when the total did not move.
  const biggest = percent === 0 ? undefined : moves.filter((move) => Math.sign(move.change) === Math.sign(total)).sort((a, b) => Math.abs(b.change) - Math.abs(a.change))[0]
  return { line, rows, note: biggest === undefined ? '' : `Most of it from ${COMPARED[biggest.group].named}.` }
}

/**
 * The wishes card: the month's wishes earned and made, the wishes in hand now (Pulls' own count, never worked out a second
 * way), how far they carry the character banner's pity, and one line. With no balance typed in Pulls the wishes in hand and
 * the reach are left out.
 */
export function wishesCard(w: Ledger['wishes']): { earned: string; made: string; inHand: string | null; reach: number | null; line: string } {
  const earned = w.earned === 0 ? '0' : `+${num(w.earned)}`
  const made = w.made === 0 ? '0' : `−${num(w.made)}`
  const inHand = w.in_hand === null ? null : num(w.in_hand)
  if (w.in_hand === null) {
    return { earned, made, inHand, reach: null, line: 'Set your balance in Pulls to see how far your wishes go.' }
  }
  if (w.pity === null) {
    return { earned, made, inHand, reach: null, line: 'Import your wish history in Pulls to see your character pity.' }
  }
  const reach = Math.min(w.pity.hard, w.pity.now + w.in_hand)
  const line =
    reach >= w.pity.soft
      ? `Enough to carry your character pity from ${w.pity.now} past soft pity.`
      : `${w.pity.soft - reach} short of soft pity on the character banner.`
  return { earned, made, inHand, reach, line }
}
