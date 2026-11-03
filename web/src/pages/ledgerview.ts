import { MONTHS, localTime, num, plural } from '../format.ts'
import type { Currency, Ledger, LedgerEntry, LedgerImportState, LedgerKind } from '../ledgertypes.ts'
import type { PullsImportEvent } from '../types.ts'
import { ageLabel, type FreshView, ringFill } from '../frame/freshview.ts'
import { LOGIN_FAILED, LOGIN_MINTING, PRESS_IMPORT, importWithAuto, loginRefused } from './pullsview.ts'

/** The words of the Ledger page (the ledger design, sections 0 and 6), apart from its drawing. */

/** Each log by its name in a sentence and on the history's switch. */
export const KIND_NAMES: Record<LedgerKind, string> = {
  primogem: 'primogem',
  crystal: 'Genesis Crystal',
  resin: 'resin',
  artifact: 'artifact',
}
export const KIND_LABELS: Record<LedgerKind, string> = {
  primogem: 'Primogems',
  crystal: 'Crystals',
  resin: 'Resin',
  artifact: 'Artifacts',
}

export const CURRENCY_NAMES: Record<Currency, string> = { PLN: 'Polish złoty', EUR: 'euros', USD: 'US dollars' }

const MINUS = '−'

/** A price's parts, the figure rounded to whole units: "€" "1,240" "" or "" "1,240" "zł". */
export function priceParts(amount: number, currency: Currency): { before: string; figure: string; after: string } {
  const figure = num(amount)
  if (currency === 'EUR') return { before: '€', figure, after: '' }
  if (currency === 'USD') return { before: '$', figure, after: '' }
  return { before: '', figure, after: 'zł' }
}

/** An estimated price: "about 1,240 zł", "about €450". Nothing spent is exact: "0 zł". */
export function money(amount: number, currency: Currency): string {
  const { before, figure, after } = priceParts(amount, currency)
  const text = `${before}${figure}${after === '' ? '' : ` ${after}`}`
  return amount === 0 ? text : `about ${text}`
}

/** The Spent tile's figure. */
export function spentLine(spent: Ledger['spent']): string {
  return money(spent.total, spent.currency)
}

/** "4 Jun 2025" from "2025-06-04". */
function longDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number)
  return `${date} ${MONTHS[month - 1]} ${year}`
}

/** "since 4 Jun 2025 · 10 Welkins, 6 crystal packs, 1 Gnostic Hymn", naming only what was bought. */
export function sinceLine(spent: Ledger['spent']): string {
  const parts = [
    spent.welkins > 0 ? plural(spent.welkins, 'Welkin') : '',
    spent.packs > 0 ? plural(spent.packs, 'crystal pack') : '',
    spent.gnostic_hymns > 0 ? plural(spent.gnostic_hymns, 'Gnostic Hymn') : '',
  ].filter((part) => part !== '')
  if (parts.length === 0) return 'No purchases in the history the game keeps'
  const counts = parts.join(', ')
  return spent.since === null ? counts : `since ${longDay(spent.since)} · ${counts}`
}

/** A signed amount with a true minus: "+60", "−1,600", "0". */
export function signed(amount: number): string {
  if (amount === 0) return '0'
  return amount > 0 ? `+${num(amount)}` : `${MINUS}${num(-amount)}`
}

/** "+5,880 earned · +1,090 from crystals · −4,960 out": bought primogems are not earned (the ledger design, section 4). */
export function monthLine(month: Ledger['month']): string {
  const parts = [`${signed(month.earned)} earned`]
  if (month.bought > 0) parts.push(`${signed(month.bought)} from crystals`)
  parts.push(`${signed(-month.out)} out`)
  return parts.join(' · ')
}

/** The month's largest spends: "Intertwined Fates −4,800 · Resin −160". */
export function topOutLine(month: Ledger['month']): string {
  if (month.top_out.length === 0) return 'Nothing spent this month'
  return month.top_out.map((spend) => `${spend.label} ${signed(-spend.amount)}`).join(' · ')
}

/**
 * What the five-star tile's count is made of, beside it: "from 32 domain runs" when every one came from a domain, else
 * "· 36 from 32 domain runs, 5 elsewhere", so the luck line under it (domains only) and the Artifacts panel agree with
 * it. Empty when no domain run can be told.
 */
export function fivesNote(artifacts: Ledger['artifacts']): string {
  if (artifacts.runs <= 0) return ''
  const runs = plural(artifacts.runs, 'domain run')
  if (artifacts.five_other <= 0) return `from ${runs}`
  return `· ${num(artifacts.five_domain)} from ${runs}, ${num(artifacts.five_other)} elsewhere`
}

/** "Luck: 1.13 five-stars per domain run · a typical run gives about 1.07"; null when the runs cannot be told. */
export function luckLine(artifacts: Ledger['artifacts']): string | null {
  if (artifacts.per_run === null) return null
  return `Luck: ${artifacts.per_run.toFixed(2)} five-stars per domain run · a typical run gives about ${artifacts.typical.toFixed(2)}`
}

/** An entry's time as the game wrote it, server time, with no zone: "2026-10-27 05:12:00" -> "27 Oct 05:12". */
export function entryTime(time: string): string {
  const [day, clock = ''] = time.split(' ')
  const [, month, date] = day.split('-').map(Number)
  return `${date} ${MONTHS[month - 1]} ${clock.slice(0, 5)}`.trim()
}

export type HistoryRowView = {
  time: string
  /** The game's reason; for an artifact, its name, with the reason as `note`. */
  text: string
  note?: string
  stars: number
  amount: string
  tone: 'plus' | 'minus'
}

/** A row of the history: time, the game's reason (an artifact's name and stars), and the signed amount. */
export function historyRow(entry: LedgerEntry, kind: LedgerKind): HistoryRowView {
  const amount = signed(entry.amount)
  const tone = entry.amount < 0 ? 'minus' : 'plus'
  if (kind === 'artifact' && entry.name !== '') {
    return { time: entryTime(entry.time), text: entry.name, note: entry.reason, stars: entry.rarity, amount, tone }
  }
  return { time: entryTime(entry.time), text: entry.reason, stars: 0, amount, tone }
}

/** The calendar day of a Date in this PC's time, to compare two. */
function dayKey(instant: Date): string {
  return `${instant.getFullYear()}-${instant.getMonth()}-${instant.getDate()}`
}

/** "today 09:41", or "13 Oct, 09:41" on another day, by the core's time `now`. */
function whenLine(instant: string, now: Date): string {
  const then = new Date(instant)
  if (dayKey(then) !== dayKey(now)) return localTime(instant)
  return `today ${String(then.getHours()).padStart(2, '0')}:${String(then.getMinutes()).padStart(2, '0')}`
}

/** "History from the game up to today 09:41", by the core's time `now`; '' before any import. */
export function upToLine(lastImport: string | null, now: Date): string {
  return lastImport === null ? '' : `History from the game up to ${whenLine(lastImport, now)}`
}

/**
 * The same line while the game's history updates itself with the HoYoLAB login: "Updated automatically with your HoYoLAB
 * login · last today 09:41"; before any reading, that it updates itself.
 */
export function loginUpToLine(lastImport: string | null, now: Date): string {
  if (lastImport === null) return 'Updates automatically with your HoYoLAB login'
  return `Updated automatically with your HoYoLAB login · last ${whenLine(lastImport, now)}`
}

/**
 * The line beside Import at rest, by how the updates with the HoYoLAB login go (`login`, the import block's): without
 * them, up to when the game's history is read; while they go well, loginUpToLine; while a key is asked for, after one
 * that did not end well, or once the login was refused, a plain notice of that.
 */
export function restLine(login: LedgerImportState['login'], lastImport: string | null, now: Date): string {
  switch (login) {
    case 'on':
      return loginUpToLine(lastImport, now)
    case 'minting':
      return LOGIN_MINTING
    case 'failed':
      return LOGIN_FAILED
    case 'refused':
      return loginRefused('Feedback')
    default:
      return upToLine(lastImport, now)
  }
}

/**
 * The line beside Import: the ledger block's progress, "Reading primogem history… 340 entries"; while the wishes of the
 * same press are read, that they come first; then the outcome, the core's own sentence first.
 */
export function importLine(state: LedgerImportState, event: PullsImportEvent | null): string {
  const ledger = state.ledger
  if (ledger.state === 'running') {
    return ledger.kind === null
      ? "Reading the game's history…"
      : `Reading ${KIND_NAMES[ledger.kind]} history… ${plural(ledger.found, 'entry', 'entries')}`
  }
  if (event?.state === 'running' || state.state === 'running') return 'Reading the wish history first…'
  if (ledger.message !== null) return ledger.message
  if (ledger.state === 'done') {
    return ledger.found === 0
      ? 'Nothing new. The history is up to date.'
      : `Read ${plural(ledger.found, 'new entry', 'new entries')} of your game history.`
  }
  if (ledger.state === 'failed') return "Guild Board could not read the game's history. Press Import to try again."
  return ''
}

/**
 * Whether an import or an update goes now, for the Import button and the ring: the wishes or the logs are read, or the keys
 * for an update with the login are asked for, when the core already holds the importer and refuses a second press as busy.
 */
export function ledgerRunning(state: LedgerImportState, event: PullsImportEvent | null): boolean {
  return state.ledger.state === 'running' || event?.state === 'running' || state.state === 'running' || state.login === 'minting'
}

/**
 * The freshness ring of the Ledger page (freshness design, section 1). The tip is the sentence the top bar used to show
 * (`refusal`, else the import's progress, else the line at rest); this adds the tone, the fill, the few words beside the
 * ring, and whether it turns. While the logs are read the words are the entries so far ("340 entries"); amber where the
 * player has to act (the login was refused, or the link from Feedback is gone) or a read failed; gold while the history
 * updates itself (`every_minutes` set, which a Feedback link kept from a press counts for), else grey with a tip that says
 * to press Import. The age is that of `lastImport`. `now` is the core's time.
 */
export function ledgerFresh(
  state: LedgerImportState,
  lastImport: string | null,
  event: PullsImportEvent | null,
  refusal: string | null,
  now: Date,
): FreshView {
  const ledger = state.ledger
  const progress = importLine(state, event)
  const sentence = progress !== '' ? progress : restLine(state.login, lastImport, now)
  const tip = (rest: string): string => refusal ?? rest
  const fill = ringFill(lastImport, state.every_minutes, now)
  const age = ageLabel(lastImport, now)
  if (ledger.state === 'running' || event?.state === 'running' || state.state === 'running') {
    const label =
      ledger.state !== 'running'
        ? 'Reading wishes…'
        : ledger.kind === null
          ? 'Reading…'
          : plural(ledger.found, 'entry', 'entries')
    return { tone: 'gold', fill, label, tip: tip(sentence), turning: true }
  }
  if (state.login === 'minting') return { tone: 'gold', fill, label: 'Importing…', tip: tip(sentence), turning: true }
  if (state.login === 'refused') return { tone: 'amber', fill, label: 'Open Feedback', tip: tip(sentence), turning: false }
  if (state.login === 'failed') return { tone: 'amber', fill, label: 'Will retry', tip: tip(sentence), turning: false }
  if (ledger.state === 'failed') {
    const label = ledger.message?.includes('Feedback') ? 'Open Feedback' : 'Import failed'
    return { tone: 'amber', fill, label, tip: tip(sentence), turning: false }
  }
  if (state.every_minutes === null) {
    return { tone: 'grey', fill, label: age, tip: refusal ?? importWithAuto(sentence, PRESS_IMPORT), turning: false }
  }
  return { tone: 'gold', fill, label: age, tip: tip(sentence), turning: false }
}
