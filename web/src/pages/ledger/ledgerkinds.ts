import { dayMonth, num, plural } from '../../format.ts'
import type { ArtifactDay, CrystalDay, CrystalUse, Ledger, LedgerDay, ResinDay, ResinUse, Welkin } from '../../ledgertypes.ts'
import { signed } from '../ledgerview.ts'
import type { BarDay } from './ledgerbars.ts'
import { type ChartWords, type Range, UNKNOWN, periodOf } from './ledgerchart.ts'
import { addDays, longDate, monthTitle } from './ledgerdays.ts'

/**
 * The words and numbers of the Crystals, Resin and Artifacts views (the Ledger revamp design, section 6), with no DOM: the
 * bars of each kind, the big number above them, and the cards beside them. Every figure is worked out from the days the core
 * sends, so the cards and the chart cannot disagree; only what a day cannot hold (the month's domains, the Welkin Moon)
 * comes from the core's month blocks. These kinds keep no balance, so the big number says what came in and went out.
 */

/** The colours of the marks: tokens already in every theme (`--fill` is the chart's gold, the `--src-*` the sources'). */
export const MARK = {
  gold: 'var(--fill)',
  violet: 'var(--src-welkin)',
  blue: 'var(--src-commissions)',
  teal: 'var(--src-endgame)',
  amber: 'var(--src-events)',
  taupe: 'var(--src-other)',
  ink: 'var(--ink2)',
} as const

/** One run of a sentence, with the tone it is drawn in: the green of what came in, the ink of what went out, or bold. */
export type Seg = { text: string; tone?: 'in' | 'out' | 'strong' }

/** The big number above a chart, and what it says: `line` under it, `note` for what the kind does not keep, `luck` last. */
export type KindHead = { label: string; amount: string; unit: string; line: Seg[]; note: string; luck: Seg[] | null }

const MINUS = '−'
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)
const plain = (text: string): Seg => ({ text })
/** A figure with its sign, and a true 0 for nothing: never "+0" or "−0". */
const plus = (amount: number): string => (amount === 0 ? '0' : `+${num(amount)}`)
const minus = (amount: number): string => (amount === 0 ? '0' : `${MINUS}${num(amount)}`)
const inn = (amount: number): Seg => ({ text: plus(amount), tone: 'in' })
const out = (amount: number): Seg => ({ text: minus(amount), tone: 'out' })
const NO_RECORD: Seg[] = [plain('No record of this day')]
const NO_RECORDS: Seg[] = [plain('No record of these days')]

// ---------------------------------------------------------------------------------------------- the months of the days

/** The days of the calendar month `today` is in, up to today. */
export function monthOf<T extends { day: string }>(days: T[], today: string): T[] {
  return days.filter((day) => day.day.slice(0, 7) === today.slice(0, 7) && day.day <= today)
}

/** The same days of the month before: from its 1st to the day of the month today is. */
export function lastMonthSameDays<T extends { day: string }>(days: T[], today: string): T[] {
  const before = addDays(`${today.slice(0, 8)}01`, -1).slice(0, 7)
  return days.filter((day) => day.day.slice(0, 7) === before && Number(day.day.slice(8)) <= Number(today.slice(8)))
}

// ---------------------------------------------------------------------------------------------- Crystals

const CRYSTAL_USES: Record<CrystalUse, { name: string; color: string }> = {
  exchange: { name: 'Exchanged for primogems', color: MARK.blue },
  shop: { name: 'Shop', color: MARK.taupe },
}

export function crystalBars(days: CrystalDay[]): BarDay[] {
  return days.map((day) => ({
    day: day.day,
    known: day.known,
    up: [{ value: day.bought, color: MARK.gold }],
    down: [
      { value: day.by_use.exchange ?? 0, color: CRYSTAL_USES.exchange.color },
      { value: day.by_use.shop ?? 0, color: CRYSTAL_USES.shop.color },
    ],
  }))
}

/** Whether any day of the crystals has a balance (the design, 8a): then the view draws what is held, as the primogems', and not what came and went. */
export function crystalsHeld(days: CrystalDay[]): boolean {
  return days.some((day) => day.held !== null)
}

/** The crystals' days as the balance chart draws them: what was bought is what came in. */
export function crystalBalanceDays(days: CrystalDay[]): LedgerDay[] {
  return days.map((day) => ({ day: day.day, earned: day.bought, spent: day.spent, held: day.held, known: day.known, moments: [] }))
}

export const CRYSTAL_WORDS: ChartWords = {
  held: 'Genesis Crystals held',
  came: 'bought',
  unit: () => 'crystals',
  aria: { held: 'Genesis Crystals held each day', net: 'Net Genesis Crystals each day' },
}

const NO_CRYSTAL_BALANCE = 'No crystal balance is kept. The game’s history says what came and went, not what is held.'

/** The big number of the Crystals view: the crystals bought over the range, or the day under the pointer. */
export function crystalHead(shown: CrystalDay[], at: number | null, range: Range, monthName: string): KindHead {
  const point = at === null ? undefined : shown[at]
  if (point !== undefined) {
    const label = longDate(point.day)
    if (!point.known) return { label, amount: UNKNOWN, unit: '', line: NO_RECORD, note: '', luck: null }
    const went: Seg[][] = []
    if (point.by_use.exchange) went.push([out(point.by_use.exchange), plain(' exchanged for primogems')])
    if (point.by_use.shop) went.push([out(point.by_use.shop), plain(' in the shop')])
    const line: Seg[] = []
    if (point.bought > 0) line.push(inn(point.bought), plain(' bought'))
    else if (went.length > 0) line.push(plain('Nothing bought'))
    for (const part of went) line.push(plain(' · '), ...part)
    if (line.length === 0) line.push(plain('No crystals came or went that day.'))
    return { label, amount: num(point.bought), unit: 'bought', line, note: '', luck: null }
  }
  if (!shown.some((day) => day.known)) {
    return { label: 'Genesis Crystals bought', amount: UNKNOWN, unit: '', line: NO_RECORDS, note: NO_CRYSTAL_BALANCE, luck: null }
  }
  const bought = sum(shown.map((day) => day.bought))
  const spent = sum(shown.map((day) => day.spent))
  const period = periodOf(range, monthName)
  const line: Seg[] =
    bought === 0 && spent === 0
        ? [plain(`Nothing bought or spent ${period}`)]
        : spent === 0
          ? [inn(bought), plain(` bought ${period}`)]
          : [inn(bought), plain(' bought and '), out(spent), plain(` spent ${period}`)]
  return { label: 'Genesis Crystals bought', amount: num(bought), unit: 'crystals', line, note: NO_CRYSTAL_BALANCE, luck: null }
}

/** A line of a card's rows: a name and the change in a figure, "▲ +620", "▼ −200" or "same". */
export type ChangeRow = { label: string; change: string; way: 'up' | 'down' | 'same' }

function change(label: string, now: number, before: number): ChangeRow {
  const diff = now - before
  return { label, change: diff === 0 ? 'same' : `${diff > 0 ? '▲' : '▼'} ${signed(diff)}`, way: diff > 0 ? 'up' : diff < 0 ? 'down' : 'same' }
}

/** "Where it went": one segmented bar and a row for each part, the largest first, a note, and the account's own line at the foot. */
export type WhereCard = {
  title: string
  sub: string
  items: { key: string; name: string; color: string; value: number }[]
  total: number
  note: string
  foot: { ring: 'gold' | 'plain' | 'bad'; label: string; value: string }
}

export function crystalWhere(days: CrystalDay[], today: string): WhereCard {
  const month = monthOf(days, today)
  const name = monthTitle(today)
  const items = (Object.keys(CRYSTAL_USES) as CrystalUse[])
    .map((use) => ({ key: use, name: CRYSTAL_USES[use].name, color: CRYSTAL_USES[use].color, value: sum(month.map((day) => day.by_use[use] ?? 0)) }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value)
  const exchanged = items.find((item) => item.key === 'exchange')?.value ?? 0
  const wishes = Math.floor(exchanged / 160)
  const worth = wishes === 1 ? '1 wish’s worth' : `${num(wishes)} wishes’ worth`
  return {
    title: 'Where they went',
    sub: `Spent in ${name}`,
    items,
    total: sum(items.map((item) => item.value)),
    note: exchanged > 0 ? `The ${num(exchanged)} crystals became ${num(exchanged)} primogems, ${worth}.` : '',
    foot: { ring: 'gold', label: `Bought in ${name}`, value: plus(sum(month.map((day) => day.bought))) },
  }
}

/** A card with two bars (the month before, this month), the change in each part and one line. */
export type CompareCard = {
  title: string
  line: string
  bars: { name: string; value: number; width: number; now: boolean }[]
  rows: ChangeRow[]
  note: string
}

const NUMBER_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten']

export function crystalCompare(days: CrystalDay[], today: string, packs: Ledger['crystal_month']['packs']): CompareCard {
  const name = monthTitle(today)
  const previous = monthTitle(addDays(`${today.slice(0, 8)}01`, -1))
  const now = monthOf(days, today)
  const before = lastMonthSameDays(days, today)
  const boughtNow = sum(now.map((day) => day.bought))
  const boughtBefore = sum(before.map((day) => day.bought))
  const welkinNow = sum(now.map((day) => day.welkin))
  const welkinBefore = sum(before.map((day) => day.welkin))
  const diff = boughtNow - boughtBefore
  const line =
    boughtNow === 0 && boughtBefore === 0
      ? 'Nothing bought this month or last.'
      : diff === 0
        ? 'You bought as many crystals as last month.'
        : `You bought ${num(Math.abs(diff))} ${diff > 0 ? 'more' : 'fewer'} crystals.`
  const widest = Math.max(boughtNow, boughtBefore, 1)
  return {
    title: `Compared with ${previous}`,
    line,
    bars: [
      { name: previous, value: boughtBefore, width: (boughtBefore / widest) * 100, now: false },
      { name, value: boughtNow, width: (boughtNow / widest) * 100, now: true },
    ],
    rows: [change('Welkin Moon', welkinNow, welkinBefore), change('Packs', boughtNow - welkinNow, boughtBefore - welkinBefore)],
    note: packsNote(packs),
  }
}

/** "One 980 + 110 pack, on 9 October." or "Two packs: 980 + 110 on 9 October and 3280 + 600 on 20 October." */
export function packsNote(packs: Ledger['crystal_month']['packs']): string {
  if (packs.length === 0) return 'No packs this month.'
  const short = (label: string) => label.replace(' Genesis Crystals', '')
  const on = (day: string) => `${Number(day.slice(8))} ${monthTitle(day)}`
  if (packs.length === 1) return `One ${short(packs[0].label)} pack, on ${on(packs[0].day)}.`
  const count = NUMBER_WORDS[packs.length] ?? String(packs.length)
  return `${count} packs: ${packs.map((pack) => `${short(pack.label)} on ${on(pack.day)}`).join(' and ')}.`
}

/** The Welkin Moon card: the 30 days of the Blessing, and which one today is. `cells` is null with none running. */
export type WelkinCard = { head: string; cells: { state: 'passed' | 'today' | 'to-come' }[] | null; note: string }

function daysBetween(first: string, last: string): number {
  const [fy, fm, fd] = first.split('-').map(Number)
  const [ly, lm, ld] = last.split('-').map(Number)
  return Math.round((Date.UTC(ly, lm - 1, ld) - Date.UTC(fy, fm - 1, fd)) / 86_400_000)
}

export function welkinCard(welkin: Welkin | null, today: string): WelkinCard {
  const into = welkin === null ? -1 : daysBetween(welkin.start, today)
  if (welkin === null || into < 0 || daysBetween(today, welkin.end) < 0) {
    return { head: 'No Welkin Moon running.', cells: null, note: 'The history shows no Welkin Moon bought that still pays out.' }
  }
  // A Welkin pays for 30 days; ones bought while another runs follow it, so the card counts the 30 that today is in.
  const day = (into % 30) + 1
  const long = (date: string) => `${Number(date.slice(8))} ${monthTitle(date)}`
  const slotEnd = addDays(welkin.start, Math.floor(into / 30) * 30 + 29)
  const first = `Bought on ${long(welkin.start)}: 300 crystals then, and 90 primogems every day until ${long(slotEnd)}.`
  const more = welkin.end > slotEnd ? ` Another follows it: 90 primogems a day until ${long(welkin.end)}.` : ''
  return {
    head: `Day ${day} of 30.`,
    cells: Array.from({ length: 30 }, (_, index) => ({ state: index === day - 1 ? ('today' as const) : index < day - 1 ? ('passed' as const) : ('to-come' as const) })),
    note: welkin.days > 30 && into >= 30 ? `Running since ${long(welkin.start)}: 90 primogems every day until ${long(welkin.end)}.` : `${first}${more}`,
  }
}

// ---------------------------------------------------------------------------------------------- Resin

export const RESIN_USES: Record<ResinUse, { name: string; color: string; one: string; many: string }> = {
  domain: { name: 'Domains', color: MARK.amber, one: 'domain run', many: 'domain runs' },
  ley: { name: 'Ley Lines', color: MARK.teal, one: 'ley line', many: 'ley lines' },
  boss: { name: 'Bosses', color: MARK.violet, one: 'boss', many: 'bosses' },
  weekly: { name: 'Weekly bosses', color: MARK.blue, one: 'weekly boss', many: 'weekly bosses' },
  condensed: { name: 'Condensed Resin', color: MARK.taupe, one: 'condensed craft', many: 'condensed crafts' },
  other: { name: 'Other', color: MARK.ink, one: 'other use', many: 'other uses' },
}
const RESIN_ORDER: ResinUse[] = ['domain', 'ley', 'boss', 'weekly', 'condensed', 'other']

/** What a full refill regrows in a day: 1 resin every 8 minutes. */
export const REGROWN_A_DAY = 180

export function resinBars(days: ResinDay[]): BarDay[] {
  return days.map((day) => ({ day: day.day, known: day.known, up: [{ value: day.spent, color: MARK.gold }], down: [] }))
}

const NO_RESIN_BALANCE = 'No resin balance is kept. The game’s history says what was spent, not what is held.'

/** The runs of a day in words: "2 domain runs, 1 ley line". */
export function runsWords(day: ResinDay): string {
  return RESIN_ORDER.filter((use) => (day.runs[use] ?? 0) > 0)
    .map((use) => plural(day.runs[use] ?? 0, RESIN_USES[use].one, RESIN_USES[use].many))
    .join(', ')
}

export function resinHead(shown: ResinDay[], at: number | null, range: Range, monthName: string): KindHead {
  const point = at === null ? undefined : shown[at]
  if (point !== undefined) {
    const label = longDate(point.day)
    if (!point.known) return { label, amount: UNKNOWN, unit: '', line: NO_RECORD, note: '', luck: null }
    const line = point.spent > 0 ? [out(point.spent), plain(` spent that day · ${runsWords(point)}`)] : [plain('No resin spent that day.')]
    return { label, amount: num(point.spent), unit: 'resin', line, note: '', luck: null }
  }
  const known = shown.filter((day) => day.known)
  const total = sum(known.map((day) => day.spent))
  const average = known.length === 0 ? 0 : Math.round(total / known.length)
  const over = range === 'month' ? `${plural(known.length, 'day')} of ${monthName}` : `${periodOf(range, monthName).slice(3)}`
  if (known.length === 0) return { label: 'Resin spent', amount: UNKNOWN, unit: '', line: NO_RECORDS, note: NO_RESIN_BALANCE, luck: null }
  const line: Seg[] = [out(total), plain(` over ${over}, about ${num(average)} a day`)]
  return { label: 'Resin spent', amount: num(total), unit: 'resin', line, note: NO_RESIN_BALANCE, luck: null }
}

export function resinWhere(days: ResinDay[], today: string): WhereCard {
  const month = monthOf(days, today).filter((day) => day.known)
  const name = monthTitle(today)
  const items = RESIN_ORDER.map((use) => ({ key: use, name: RESIN_USES[use].name, color: RESIN_USES[use].color, value: sum(month.map((day) => day.by_use[use] ?? 0)) }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value)
  const total = sum(items.map((item) => item.value))
  return {
    title: 'Where it went',
    sub: `Spent in ${name}`,
    items,
    total,
    note: '',
    foot: { ring: 'plain', label: `${plural(month.length, 'day')} of ${name}`, value: minus(total) },
  }
}

/** A short list of names with a bar each, the longest full: the domains run most, the domains that gave the most. */
export type RankCard = { title: string; head: string; rows: { name: string; value: number; width: number }[]; note: string }

export function resinMost(month: Ledger['resin_month']): RankCard {
  const top = month.domains[0]
  const widest = Math.max(top?.runs ?? 1, 1)
  return {
    title: 'Domain run most',
    head: top === undefined ? 'No domain run this month.' : `${top.name}, ${plural(top.runs, 'run')}.`,
    rows: month.domains.slice(0, 6).map((domain) => ({ name: domain.name, value: domain.runs, width: (domain.runs / widest) * 100 })),
    note:
      top === undefined
        ? ''
        : `${plural(month.domain_runs, 'domain run')} in all, ${num(month.domain_runs * 20)} resin. ${num(month.artifact_runs)} of them were artifact domains.`,
  }
}

/** The month's resin set against the 180 a day that regrows. */
export type AgainstCard = {
  head: string
  percent: number
  spent: number
  regrown: number
  days: number
  rows: { label: string; value: string }[]
  note: string
}

const NO_OVERFLOW = 'The history keeps no resin balance, so this cannot say whether any overflowed. It sets what was spent against the 180 a day that regrows.'

export function resinAgainst(days: ResinDay[], today: string): AgainstCard {
  const month = monthOf(days, today).filter((day) => day.known)
  const spent = sum(month.map((day) => day.spent))
  const regrown = REGROWN_A_DAY * month.length
  const percent = regrown === 0 ? 0 : Math.round((spent / regrown) * 100)
  const busiest = month.reduce<ResinDay | null>((best, day) => (best === null || day.spent > best.spent ? day : best), null)
  const of = (count: number) => `${count} of ${month.length}`
  return {
    head: month.length === 0 ? 'Nothing recorded this month yet.' : `You spent ${percent}% of what regrew.`,
    percent,
    spent,
    regrown,
    days: month.length,
    rows:
      busiest === null
        ? []
        : [
            { label: 'Busiest day', value: `${busiest.spent} · ${dayMonth(busiest.day)}` },
            { label: 'Days at 140 or more', value: of(month.filter((day) => day.spent >= 140).length) },
            { label: 'Days under 100', value: of(month.filter((day) => day.spent < 100).length) },
          ],
    note: NO_OVERFLOW,
  }
}

/** The bosses: the normal ones (40 resin) and the weekly ones (30 resin for the first three each week, then 60), each with its runs, its resin and its share of the month's resin. */
export type BossesCard = { head: string; rows: { label: string; value: string }[]; note: string }

export function resinBosses(days: ResinDay[], weekly: Ledger['resin_month']['weekly'], today: string): BossesCard {
  const month = monthOf(days, today).filter((day) => day.known)
  const total = sum(month.map((day) => day.spent))
  const part = (use: 'boss' | 'weekly') => ({
    runs: sum(month.map((day) => day.runs[use] ?? 0)),
    resin: sum(month.map((day) => day.by_use[use] ?? 0)),
  })
  const normal = part('boss')
  const week = part('weekly')
  const row = (label: string, found: { runs: number; resin: number }) => ({
    label,
    value: `${plural(found.runs, 'run')} · ${num(found.resin)} resin · ${total === 0 ? 0 : Math.round((found.resin / total) * 100)}%`,
  })
  const runs = normal.runs + week.runs
  return {
    head: runs === 0 ? 'No boss run this month yet.' : `${plural(runs, 'boss run')}, ${num(normal.resin + week.resin)} resin.`,
    rows: [row('Bosses, 40 resin each', normal), row('Weekly bosses, 30 or 60', week)],
    note:
      weekly.cheap > 0
        ? `${weekly.cheap} of the weekly runs cost 30 instead of 60, ${num(weekly.cheap * 30)} resin less than the full price.`
        : '',
  }
}

// ---------------------------------------------------------------------------------------------- Artifacts

export function artifactBars(days: ArtifactDay[]): BarDay[] {
  return days.map((day) => ({
    day: day.day,
    known: day.known,
    up: [
      { value: day.five_domain, color: MARK.gold },
      { value: day.five_other, color: MARK.taupe },
    ],
    down: [],
  }))
}

/** "five-star artifacts" seen by a day or a range: those that came in, and those fed or salvaged. */
function fives(days: ArtifactDay[]) {
  return {
    domain: sum(days.map((day) => day.five_domain)),
    other: sum(days.map((day) => day.five_other)),
    used: sum(days.map((day) => day.fed + day.salvaged)),
    fed: sum(days.map((day) => day.fed)),
    salvaged: sum(days.map((day) => day.salvaged)),
  }
}

export function artifactHead(shown: ArtifactDay[], at: number | null, range: Range, monthName: string, month: Ledger['artifact_month']): KindHead {
  const luck: Seg[] | null =
    month.per_run === null
      ? null
      : [{ text: month.per_run.toFixed(2), tone: 'strong' }, plain(` five-stars per domain run this month · a typical run gives about ${month.typical.toFixed(2)}`)]
  const point = at === null ? undefined : shown[at]
  if (point !== undefined) {
    const label = longDate(point.day)
    if (!point.known) return { label, amount: UNKNOWN, unit: '', line: NO_RECORD, note: '', luck }
    const count = point.five_domain + point.five_other
    const line: Seg[] = []
    if (point.five_domain > 0) line.push(inn(point.five_domain), plain(' from domains'))
    if (point.five_domain > 0 && point.five_other > 0) line.push(plain(' and '))
    if (point.five_other > 0) line.push(inn(point.five_other), plain(' from elsewhere'))
    if (count > 0) {
      const names = point.names.slice(0, 2).join(', ')
      const more = point.names.length > 2 ? ` and ${point.names.length - 2} more` : ''
      if (names !== '') line.push(plain(` · ${names}${more}`))
    } else {
      line.push(plain('No five-star artifacts that day.'))
    }
    return { label, amount: String(count), unit: 'five-stars', line, note: '', luck }
  }
  if (!shown.some((day) => day.known)) return { label: 'Five-star artifacts', amount: UNKNOWN, unit: '', line: NO_RECORDS, note: '', luck }
  const total = fives(shown)
  const line: Seg[] = [
    inn(total.domain), plain(' from domains, '), inn(total.other), plain(' from elsewhere and '), out(total.used),
    plain(` fed or salvaged ${periodOf(range, monthName)}`),
  ]
  return { label: 'Five-star artifacts', amount: String(total.domain + total.other), unit: 'five-stars', line, note: '', luck }
}

const DOMAIN_COLORS = [MARK.violet, MARK.blue, MARK.teal, MARK.amber]

export function artifactWhere(days: ArtifactDay[], month: Ledger['artifact_month'], today: string): WhereCard {
  const name = monthTitle(today)
  const total = fives(monthOf(days, today))
  const items: WhereCard['items'] = month.domains
    .filter((domain) => domain.five > 0)
    .map((domain, index) => ({ key: domain.name, name: domain.name, color: DOMAIN_COLORS[index % DOMAIN_COLORS.length], value: domain.five }))
  if (total.other > 0) items.push({ key: 'elsewhere', name: 'Elsewhere', color: MARK.taupe, value: total.other })
  return {
    title: 'Where they came from',
    sub: `Five-stars in ${name}`,
    items,
    total: sum(items.map((item) => item.value)),
    note: '',
    foot: { ring: 'bad', label: 'Fed or salvaged', value: minus(total.used) },
  }
}

/** What became of the month's five-stars: those that came, those used up, and what is left of the first after the second. */
export type BecameCard = {
  sub: string
  got: number
  used: number
  kept: number
  items: { key: string; name: string; color: string; value: number; share: number }[]
  note: string
}

export function artifactBecame(days: ArtifactDay[], today: string): BecameCard {
  const total = fives(monthOf(days, today))
  const got = total.domain + total.other
  const kept = Math.max(0, got - total.used)
  const whole = Math.max(1, kept + total.fed + total.salvaged)
  const item = (key: string, name: string, color: string, value: number) => ({ key, name, color, value, share: Math.round((value / whole) * 100) })
  return {
    sub: `The ${plural(got, 'five-star')} of ${monthTitle(today)}`,
    got,
    used: total.used,
    kept,
    items: [item('kept', 'Kept', MARK.gold, kept), item('fed', 'Fed to enhance others', MARK.blue, total.fed), item('salvaged', 'Salvaged', MARK.taupe, total.salvaged)],
    note:
      total.used > got
        ? 'More were used up than came in this month: older ones were fed or salvaged too.'
        : 'Fed artifacts and salvaged ones are the ones the game says were used up.',
  }
}

export function artifactTop(month: Ledger['artifact_month']): RankCard {
  const given = month.domains.filter((domain) => domain.five > 0)
  const top = given[0]
  const widest = Math.max(top?.five ?? 1, 1)
  return {
    title: 'The domain that gave the most',
    head: top === undefined ? 'No five-star from a domain yet.' : `${top.name}, ${plural(top.five, 'five-star')}.`,
    rows: given.slice(0, 4).map((domain) => ({ name: domain.name, value: domain.five, width: (domain.five / widest) * 100 })),
    note: top === undefined || top.runs === 0 ? '' : `${plural(top.runs, 'run')}, ${(top.five / top.runs).toFixed(2)} five-stars a run.`,
  }
}

export type LuckCard = {
  head: string
  bars: { name: string; value: string; width: number; typical: boolean }[]
  rows: { label: string; value: string }[]
  note: string
}

export function artifactLuck(days: ArtifactDay[], month: Ledger['artifact_month'], today: string): LuckCard {
  const elsewhere = fives(monthOf(days, today)).other
  if (month.per_run === null) return { head: 'No artifact domain run this month.', bars: [], rows: [], note: '' }
  const widest = Math.max(month.per_run, month.typical) * 1.12
  return {
    head: `${month.per_run.toFixed(2)} five-stars per run.`,
    bars: [
      { name: 'This month', value: month.per_run.toFixed(2), width: (month.per_run / widest) * 100, typical: false },
      { name: 'A typical run', value: month.typical.toFixed(2), width: (month.typical / widest) * 100, typical: true },
    ],
    rows: [
      { label: 'Runs of artifact domains', value: num(month.runs) },
      { label: 'Five-stars from them', value: num(month.five_domain) },
      { label: 'Five-stars from elsewhere', value: num(elsewhere) },
    ],
    note: `${plural(month.runs, 'typical run')} give about ${num(Math.round(month.runs * month.typical))}.`,
  }
}

export type CostCard = { head: string; rows: { label: string; value: string }[]; note: string }

export function artifactCost(month: Ledger['artifact_month'], resin: ResinDay[], today: string): CostCard {
  const onDomains = sum(monthOf(resin, today).map((day) => day.by_use.domain ?? 0))
  if (month.five_domain === 0) return { head: 'No five-star from a domain yet.', rows: [], note: '' }
  return {
    head: `About ${num(Math.round((month.runs * 20) / month.five_domain))} resin for each.`,
    rows: [
      { label: 'Artifact domain runs', value: num(month.runs) },
      { label: 'Resin they cost', value: num(month.runs * 20) },
      { label: 'Five-stars from them', value: num(month.five_domain) },
    ],
    note: `Counted in Resin too, among the ${num(onDomains)} resin spent on domains.`,
  }
}
