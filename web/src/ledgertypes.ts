/**
 * The shapes of the Ledger's local API (the ledger plan, Task 6 as revised after the checks) and of the primogem
 * columns on Stats stacked by source (Task 5), with fixtures for the page's unit tests. The numbers are realistic and the
 * reasons are the game's own (the ledger design, section 0).
 */
import type { Columns, Pulls } from './types.ts'

/** The game's four history logs, in the order the import reads them. */
export type LedgerKind = 'primogem' | 'crystal' | 'resin' | 'artifact'

/** The five sources of earned primogems (`ledger/reasons.py` GROUPS). Bought primogems are not among them. */
export type Group = 'commissions' | 'welkin' | 'events' | 'endgame' | 'other'

export type Currency = 'PLN' | 'EUR' | 'USD'

/** One column of "Primogems earned per day": `groups` where the game's log or the diary's detail covers the day, and
 * `no_data` where neither does. A week sums its days' groups; `after_gap` marks a week with some days of neither. */
export type PrimogemColumn = Columns['columns'][number] & { groups?: Record<Group, number> }

export type PrimogemColumns = Omit<Columns, 'columns'> & {
  columns: PrimogemColumn[]
  /** The order the groups stack in, from the bottom; absent from a core without the ledger. */
  groups_order?: Group[]
  group_labels?: Record<Group, string>
}

/** The importer's ledger block (Task 4): how the reading of the four logs goes or last went. */
export type LedgerImport = {
  state: 'idle' | 'running' | 'done' | 'failed'
  /** The log being read while it runs. */
  kind: LedgerKind | null
  /** New entries kept, this run so far or in the last. */
  found: number
  /** The core's own sentence of the outcome, such as how to get a link from Feedback. */
  message: string | null
  last_at: string | null
}

/** The importer's state, as the Pulls model gives it, with its ledger block. */
export type LedgerImportState = Pulls['import'] & { ledger: LedgerImport }

/** One pack of Genesis Crystals, the Welkin or the Gnostic Hymn, counted, with its estimated price in the currency. */
export type SpentRow = { id: string; label: string; count: number; each: number; total: number }

/** A commissions day: done, missed (a day the log or diary knows, with none), unknown, or still to come. */
export type CommissionState = 'done' | 'missed' | 'unknown' | 'future'

/** One game day ("2026-10-27") of the Primogems chart. `held` is the balance at its end, null with no balance typed in
 * Pulls; `known` is false where neither the game's log nor the diary covers the day (then `earned` and `spent` are 0 and
 * there are no moments). A moment is an entry of 300 primogems or more, in (+) or out (−). */
export type LedgerDay = {
  day: string
  earned: number
  spent: number
  held: number | null
  known: boolean
  moments: { title: string; amount: number }[]
}

/** Where crystals went (`ledger/reasons.py` `crystal_source`), and what resin was spent on (`resin_use`). */
export type CrystalUse = 'exchange' | 'shop'
export type ResinUse = 'domain' | 'ley' | 'boss' | 'weekly' | 'condensed' | 'other'

/** One game day of a kind with no balance (the revamp design, 8a). `known` is false where the kind's log does not cover the
 * day whole (then every figure is 0). */
export type CrystalDay = {
  day: string
  known: boolean
  /** Crystals bought, the Welkin Moon's among them (`welkin`), and crystals spent, by where they went. */
  bought: number
  welkin: number
  spent: number
  by_use: Partial<Record<CrystalUse, number>>
  /** The crystals held at the day's end where a balance is known (none is kept today: null); a view then draws the balance. */
  held: number | null
}
export type ResinDay = {
  day: string
  known: boolean
  spent: number
  by_use: Partial<Record<ResinUse, number>>
  /** The runs of each use (a condensed domain run counts two). */
  runs: Partial<Record<ResinUse, number>>
}
/** Five-star artifacts only: those that came from domains and from elsewhere, those fed to enhance others and those salvaged. */
export type ArtifactDay = {
  day: string
  known: boolean
  five_domain: number
  five_other: number
  fed: number
  salvaged: number
  names: string[]
}

/** The Welkin Moon running today: the block of Welkins bought back to back (one bought while another runs adds 30 days after
 * it), its first and last day and how many days it holds in all. */
export type Welkin = { start: string; end: string; days: number }

/** GET /api/ledger */
export type Ledger = {
  uid: number | null
  /** When the logs were last read well; null before any. */
  last_import: string | null
  import: LedgerImportState
  spent: {
    currency: Currency
    total: number
    /** The day of the first top-up kept; null with none. */
    since: string | null
    welkins: number
    packs: number
    gnostic_hymns: number
    /** Every kind bought, the Gnostic Hymn among them once counted. */
    rows: SpentRow[]
    /** What this calendar month's packs came to, by the price list, and in words: "one Welkin", "nothing". */
    month_total: number
    month_note: string
  }
  /** This calendar month's primogems: earned, bought (from crystals), and spent, positive; with the largest spends. */
  month: {
    earned: number
    bought: number
    out: number
    top_out: { label: string; amount: number }[]
    /** The earned primogems by source, longest first; a source with none is left out. */
    sources: { group: Group; label: string; amount: number }[]
    /** The same days of last month: what was earned, in all and by source. 0 where no day of it is known. */
    previous: { earned: number; sources: Record<Group, number> }
    /** The Intertwined Fates bought with primogems this month. */
    fates_bought: number
  }
  /** Each game day of the last six calendar months to today, oldest first. */
  days: LedgerDay[]
  /** This month's daily commissions, a day each. */
  commissions: {
    /** "2026-10" */
    month: string
    days: { day: string; state: CommissionState }[]
    streak_now: number
    longest: number
    missed: number
  }
  /** The month's wishes. `earned` is this month's earned primogems ÷ 160, `made` the wishes in every banner's history,
   * `in_hand` Pulls' own count (null with no balance typed there), `pity` the character banner's, as Pulls has it. */
  wishes: { earned: number; made: number; in_hand: number | null; pity: { now: number; soft: number; hard: number } | null }
  /** The last 30 days. `per_run` is null when the runs cannot be told. */
  artifacts: {
    five_domain: number
    top_domain: string | null
    five_other: number
    four_other: number
    fed: number
    fed_five: number
    per_run: number | null
    typical: number
    runs: number
  }
  /** The other three views' days, over the same six months as `days`. */
  crystal_days: CrystalDay[]
  resin_days: ResinDay[]
  artifact_days: ArtifactDay[]
  /** The Welkin Moon bought in the last 30 days (its day) and this calendar month's packs. */
  crystal_month: { welkin: Welkin | null; packs: { day: string; label: string }[] }
  /** This month's domain runs by domain, those of them that gave artifacts, and the weekly bosses at 30 resin and at 60. */
  resin_month: {
    domains: { name: string; runs: number; artifacts: boolean }[]
    domain_runs: number
    artifact_runs: number
    weekly: { cheap: number; full: number; other: number }
  }
  /** This month's artifact domains with their five-stars and runs, longest first, and the five-stars per run. */
  artifact_month: {
    domains: { name: string; five: number; runs: number }[]
    runs: number
    five_domain: number
    per_run: number | null
    typical: number
  }
  empty: boolean
  /** The price list Settings › Extras corrects: each pack's name, and its default price in each currency. */
  prices: { packs: { id: string; label: string }[]; defaults: Record<Currency, Record<string, number>> }
}

/** One entry of a log as the game wrote it: `time` is the game's server time, "2026-10-27 05:12:00". `name` and
 * `rarity` are an artifact's ('' and 0 otherwise). The id is a string: the game's ids pass what a number can hold. */
export type LedgerEntry = {
  id: string
  time: string
  reason: string
  name: string
  rarity: number
  amount: number
  /** The reason made plain ("Daily commissions", "Imaginarium Theater"); the reason itself when it is not known. */
  title: string
  /** Where it came from or went to. A primogem entry: a group of earned primogems (`Group`), "bought" (paid for), "shop"
   * (primogems spent in the shop) or "resin" (primogems spent on a refill). A crystal's: "bought", "exchange", "shop" or
   * "other". A resin's: a `ResinUse`. An artifact's: "domain", "elsewhere", "fed", "salvaged" or "other". */
  source: Group | 'bought' | 'shop' | 'resin' | 'exchange' | 'domain' | 'ley' | 'boss' | 'weekly' | 'condensed' | 'elsewhere' | 'fed' | 'salvaged'
  /** A crystal top-up's pack ("980 + 110 Genesis Crystals"); empty for any other entry. */
  detail: string
}

/** GET /api/ledger/history?kind=…&before=<id>&limit=50 */
export type LedgerHistory = { entries: LedgerEntry[]; more: boolean }

const OCTOBER_MISSED = [9, 25]
const OCTOBER_EVENTS: Record<number, [string, number]> = {
  3: ['Event reward', 420], 4: ['Event reward', 120], 12: ['Event reward', 420], 20: ['Event reward', 300], 21: ['Event reward', 160],
}

/** The fixture's October, a day each to the 31st: the balance held at the end of the 31st is 10,255 (64 wishes), the Ledger mockup's, and the month started on 4,200. */
function octoberDays(): LedgerDay[] {
  const days = Array.from({ length: 31 }, (_, index): LedgerDay => {
    const date = index + 1
    const moments: LedgerDay['moments'] = []
    const event = OCTOBER_EVENTS[date]
    if (event && event[1] >= 300) moments.push({ title: event[0], amount: event[1] })
    if (date === 1) moments.push({ title: 'Imaginarium Theater', amount: 800 })
    if (date === 16) moments.push({ title: 'Spiral Abyss', amount: 600 })
    if (date === 22) moments.push({ title: 'Shop purchase', amount: -1600 })
    const earned = 90 + 15 + (OCTOBER_MISSED.includes(date) ? 0 : 60) + (event ? event[1] : 0) + (date === 1 ? 800 : date === 16 ? 600 : 0)
    return {
      day: `2026-10-${String(date).padStart(2, '0')}`,
      earned,
      spent: date === 22 ? 1600 : date === 8 ? 160 : 0,
      held: null,
      known: true,
      moments,
    }
  })
  let held = 10255
  for (let index = days.length - 1; index >= 0; index -= 1) {
    days[index].held = held
    held -= days[index].earned - days[index].spent
  }
  return days
}

/** September and October 2026, a day each: the fixture's other three views run over both so that October has a month to be compared with. */
const TWO_MONTHS = Array.from({ length: 61 }, (_, index) => (index < 30 ? `2026-09-${String(index + 1).padStart(2, '0')}` : `2026-10-${String(index - 29).padStart(2, '0')}`))

/** Crystals: the Welkin Moon bought on the 5th of each month and exchanged for primogems, a 980 + 110 pack on 9 October and
 * exchanged too, and two refills of resin bought in the shop. */
function crystalDays(): CrystalDay[] {
  return TWO_MONTHS.map((day) => {
    const welkin = day.endsWith('-05') ? 300 : 0
    const pack = day === '2026-10-09' ? 1090 : 0
    const exchange = welkin + pack
    const shop = day === '2026-10-12' || day === '2026-10-19' ? 60 : 0
    return {
      day, known: true, bought: welkin + pack, welkin, spent: exchange + shop,
      by_use: { ...(exchange > 0 ? { exchange } : {}), ...(shop > 0 ? { shop } : {}) },
      held: null,
    }
  })
}

/** Resin: domain runs most days, a ley line every other day, a boss every fifth, a weekly boss and a condensed craft now and then. */
function resinDays(): ResinDay[] {
  return TWO_MONTHS.map((day) => {
    const date = Number(day.slice(8))
    const runs: ResinDay['runs'] = {}
    const by_use: ResinDay['by_use'] = {}
    const add = (use: ResinUse, count: number, each: number) => {
      if (count <= 0) return
      runs[use] = count
      by_use[use] = count * each
    }
    add('domain', date % 6 === 0 ? 0 : 2 + (date % 3), 20)
    add('ley', date % 2, 20)
    add('boss', date % 5 === 0 ? 1 : 0, 40)
    add('weekly', date % 7 === 5 ? 1 : 0, date === 26 ? 60 : 30) // the first three of a week cost 30, the fourth 60
    add('condensed', date % 9 === 4 ? 1 : 0, 40)
    return { day, known: true, spent: Object.values(by_use).reduce((sum, value) => sum + value, 0), by_use, runs }
  })
}

/** Artifacts: five-stars from domains on some days, one from elsewhere, and a few fed or salvaged. */
function artifactDays(): ArtifactDay[] {
  const pieces = ['Flower of Life', 'Plume of Death', 'Sands of Eon', 'Goblet of Eonothem', 'Circlet of Logos']
  return TWO_MONTHS.map((day) => {
    const date = Number(day.slice(8))
    const five_domain = date % 3 === 0 ? 1 : date % 7 === 2 ? 2 : 0
    const five_other = date === 20 ? 1 : 0
    return {
      day, known: true, five_domain, five_other, fed: date % 5 === 3 ? 2 : 0, salvaged: date % 9 === 7 ? 1 : 0,
      names: Array.from({ length: five_domain + five_other }, (_, index) => pieces[(date + index) % pieces.length]),
    }
  })
}

export const LEDGER_FIXTURE: Ledger = {
  uid: 700000001,
  last_import: '2026-10-27T09:41:00+01:00',
  import: {
    state: 'idle',
    last_at: '2026-10-27T09:41:00+01:00',
    found: 0,
    pages: 0,
    pool: null,
    message: null,
    auto: null,
    auto_stopped: null,
    login: null,
    every_minutes: null,
    ledger: { state: 'idle', kind: null, found: 0, message: null, last_at: '2026-10-27T09:41:00+01:00' },
  },
  spent: {
    currency: 'PLN',
    total: 1239.83,
    since: '2025-06-04',
    welkins: 10,
    packs: 6,
    gnostic_hymns: 1,
    rows: [
      { id: 'welkin', label: 'Blessing of the Welkin Moon', count: 10, each: 22.99, total: 229.9 },
      { id: 'c6480', label: '6,480 Genesis Crystals', count: 1, each: 449.99, total: 449.99 },
      { id: 'c3280', label: '3,280 Genesis Crystals', count: 1, each: 224.99, total: 224.99 },
      { id: 'c980', label: '980 Genesis Crystals', count: 4, each: 72.99, total: 291.96 },
      { id: 'gnostic_hymn', label: 'Gnostic Hymn', count: 1, each: 42.99, total: 42.99 },
    ],
    month_total: 22.99,
    month_note: 'one Welkin',
  },
  // October 2026, the mockup's: 7,815 earned (31 Welkin days, 29 commission days, five events, the Theater and the Abyss,
  // and 15 from chests each day), 11 Fates bought for 1,760, last month's same days 7,236.
  month: {
    earned: 7815,
    bought: 1090,
    out: 1760,
    top_out: [{ label: 'Intertwined Fates', amount: 1760 }],
    sources: [
      { group: 'welkin', label: 'Blessing of the Welkin Moon', amount: 2790 },
      { group: 'commissions', label: 'Daily commissions', amount: 1740 },
      { group: 'events', label: 'Events', amount: 1420 },
      { group: 'endgame', label: 'Spiral Abyss and Theater', amount: 1400 },
      { group: 'other', label: 'Other', amount: 465 },
    ],
    previous: { earned: 7236, sources: { welkin: 2790, commissions: 1680, events: 800, endgame: 1600, other: 366 } },
    fates_bought: 11,
  },
  days: octoberDays(),
  commissions: {
    month: '2026-10',
    days: Array.from({ length: 31 }, (_, index) => ({
      day: `2026-10-${String(index + 1).padStart(2, '0')}`,
      state: OCTOBER_MISSED.includes(index + 1) ? ('missed' as const) : ('done' as const),
    })),
    streak_now: 6,
    longest: 15,
    missed: 2,
  },
  wishes: { earned: 48, made: 11, in_hand: 37, pity: { now: 41, soft: 74, hard: 90 } },
  artifacts: {
    five_domain: 36,
    top_domain: 'Sanctum of Rainbow Spirits',
    five_other: 5,
    four_other: 212,
    fed: 188,
    fed_five: 27,
    per_run: 1.13,
    typical: 1.07,
    runs: 32,
  },
  crystal_days: crystalDays(),
  resin_days: resinDays(),
  artifact_days: artifactDays(),
  crystal_month: { welkin: { start: '2026-10-05', end: '2026-11-03', days: 30 }, packs: [{ day: '2026-10-09', label: '980 + 110 Genesis Crystals' }] },
  // October's domain runs, 83 in all (what `resinDays` makes of the month), shared between four domains.
  resin_month: {
    domains: [
      { name: 'Valley of Remembrance', runs: 32, artifacts: true },
      { name: 'Momiji-Dyed Court', runs: 24, artifacts: true },
      { name: 'Slumbering Court', runs: 15, artifacts: true },
      { name: 'Violet Court', runs: 12, artifacts: false },
    ],
    domain_runs: 83,
    artifact_runs: 71,
    weekly: { cheap: 3, full: 1, other: 0 },
  },
  artifact_month: {
    domains: [
      { name: 'Valley of Remembrance', five: 8, runs: 32 },
      { name: 'Momiji-Dyed Court', five: 5, runs: 24 },
      { name: 'Slumbering Court', five: 3, runs: 15 },
    ],
    runs: 71,
    five_domain: 16,
    per_run: 0.23,
    typical: 1.07,
  },
  empty: false,
  prices: {
    packs: [
      { id: 'welkin', label: 'Blessing of the Welkin Moon' },
      { id: 'c60', label: '60 Genesis Crystals' },
      { id: 'c300', label: '300 + 30 Genesis Crystals' },
      { id: 'c980', label: '980 + 110 Genesis Crystals' },
      { id: 'c1980', label: '1980 + 260 Genesis Crystals' },
      { id: 'c3280', label: '3280 + 600 Genesis Crystals' },
      { id: 'c6480', label: '6480 + 1600 Genesis Crystals' },
      { id: 'gnostic_hymn', label: 'Gnostic Hymn' },
    ],
    defaults: {
      USD: { welkin: 4.99, c60: 0.99, c300: 4.99, c980: 14.99, c1980: 29.99, c3280: 49.99, c6480: 99.99, gnostic_hymn: 9.99 },
      EUR: { welkin: 4.99, c60: 0.99, c300: 4.99, c980: 14.99, c1980: 29.99, c3280: 49.99, c6480: 99.99, gnostic_hymn: 9.99 },
      PLN: { welkin: 25.99, c60: 4.99, c300: 23.99, c980: 69.99, c1980: 139.99, c3280: 239.99, c6480: 479.99, gnostic_hymn: 46.99 },
    },
  },
}

export const HISTORY_FIXTURE: LedgerHistory = {
  entries: [
    { id: '1761534720000000006', time: '2026-10-27 05:12:00', reason: 'Daily Commission reward', name: '', rarity: 0, amount: 60, title: 'Daily commissions', source: 'commissions', detail: '' },
    { id: '1761534060000000005', time: '2026-10-27 04:01:00', reason: 'Blessing of the Welkin Moon daily reward', name: '', rarity: 0, amount: 90, title: 'Blessing of the Welkin Moon', source: 'welkin', detail: '' },
    { id: '1761514020000000004', time: '2026-10-26 22:47:00', reason: 'Shop purchase', name: '', rarity: 0, amount: -1600, title: 'Shop purchase', source: 'shop', detail: '' },
    { id: '1761509400000000003', time: '2026-10-26 21:30:00', reason: 'Event reward', name: '', rarity: 0, amount: 40, title: 'Event reward', source: 'events', detail: '' },
    { id: '1761504300000000002', time: '2026-10-26 20:05:00', reason: 'Claimed reward', name: '', rarity: 0, amount: 5, title: 'Claimed reward', source: 'other', detail: '' },
    { id: '1761447780000000001', time: '2026-10-26 04:03:00', reason: 'Blessing of the Welkin Moon daily reward', name: '', rarity: 0, amount: 90, title: 'Blessing of the Welkin Moon', source: 'welkin', detail: '' },
  ],
  more: true,
}

/** A page of the artifact log, for its rows: a domain's drop and a five-star fed to another. */
export const ARTIFACT_HISTORY_FIXTURE: LedgerHistory = {
  entries: [
    { id: '1761530000000000002', time: '2026-10-27 03:58:00', reason: 'Sanctum of Rainbow Spirits (Domain)', name: "Vermillion Hereafter's Thunder Clouds", rarity: 5, amount: 1, title: 'Sanctum of Rainbow Spirits', source: 'domain', detail: '' },
    { id: '1761520000000000001', time: '2026-10-26 23:10:00', reason: 'Artifact enhancement material', name: 'Flower of Accolades', rarity: 4, amount: -1, title: 'Artifact enhancement material', source: 'fed', detail: '' },
  ],
  more: false,
}
