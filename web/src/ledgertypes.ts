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
  }
  /** This calendar month's primogems: earned, bought (from crystals), and spent, positive; with the largest spends. */
  month: { earned: number; bought: number; out: number; top_out: { label: string; amount: number }[] }
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
  empty: boolean
  /** The price list Settings › Extras corrects: each pack's name, and its default price in each currency. */
  prices: { packs: { id: string; label: string }[]; defaults: Record<Currency, Record<string, number>> }
}

/** One entry of a log as the game wrote it: `time` is the game's server time, "2026-10-27 05:12:00". `name` and
 * `rarity` are an artifact's ('' and 0 otherwise). The id is a string: the game's ids pass what a number can hold. */
export type LedgerEntry = { id: string; time: string; reason: string; name: string; rarity: number; amount: number }

/** GET /api/ledger/history?kind=…&before=<id>&limit=50 */
export type LedgerHistory = { entries: LedgerEntry[]; more: boolean }

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
  },
  month: {
    earned: 5880,
    bought: 1090,
    out: 4960,
    top_out: [
      { label: 'Intertwined Fates', amount: 4800 },
      { label: 'Resin', amount: 160 },
    ],
  },
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
    { id: '1761534720000000006', time: '2026-10-27 05:12:00', reason: 'Daily Commission reward', name: '', rarity: 0, amount: 60 },
    { id: '1761534060000000005', time: '2026-10-27 04:01:00', reason: 'Blessing of the Welkin Moon daily reward', name: '', rarity: 0, amount: 90 },
    { id: '1761514020000000004', time: '2026-10-26 22:47:00', reason: 'Shop purchase', name: '', rarity: 0, amount: -1600 },
    { id: '1761509400000000003', time: '2026-10-26 21:30:00', reason: 'Event reward', name: '', rarity: 0, amount: 40 },
    { id: '1761504300000000002', time: '2026-10-26 20:05:00', reason: 'Claimed reward', name: '', rarity: 0, amount: 5 },
    { id: '1761447780000000001', time: '2026-10-26 04:03:00', reason: 'Blessing of the Welkin Moon daily reward', name: '', rarity: 0, amount: 90 },
  ],
  more: true,
}

/** A page of the artifact log, for its rows: a domain's drop and a five-star fed to another. */
export const ARTIFACT_HISTORY_FIXTURE: LedgerHistory = {
  entries: [
    { id: '1761530000000000002', time: '2026-10-27 03:58:00', reason: 'Sanctum of Rainbow Spirits (Domain)', name: "Vermillion Hereafter's Thunder Clouds", rarity: 5, amount: 1 },
    { id: '1761520000000000001', time: '2026-10-26 23:10:00', reason: 'Artifact enhancement material', name: 'Flower of Accolades', rarity: 4, amount: -1 },
  ],
  more: false,
}
