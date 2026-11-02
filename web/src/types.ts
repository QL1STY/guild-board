/** The shapes the local API returns. They mirror src/guildboard/core.py and src/guildboard/views/. */

import type { PrimogemColumns } from './ledgertypes.ts'
import type { OnlineView } from './onlinetypes.ts'

export type SyncState =
  | 'ok' | 'syncing' | 'offline' | 'verification_needed' | 'login_needed' | 'switch_off' | 'paused' | 'error'

export type UpdateStatus = {
  state: 'none' | 'available' | 'downloading' | 'installing' | 'failed'
  version: string | null
  /** While downloading: the part done, 0 to 1. */
  progress: number | null
  message: string | null
  /** What the coming version changes (the release's notes), for the list of changes. */
  notes: ChangeItem[]
  /** The day the coming version was published, "2026-10-26", when the core knows it. */
  released: string | null
}

/** One change in a version's notes: a plain line from before kinds has no kind and no text. */
export type ChangeItem = { kind: 'new' | 'better' | 'fixed' | null; title: string; text: string }

/** The notes of one version. */
export type Changes = { version: string; items: ChangeItem[] }

export type Status = {
  version: string
  /** The notes of this version, until the player has pressed Got it; null otherwise. */
  whats_new: Changes | null
  /** Whether Your week, Endgame and the Today widget are shown; the core hides them while this is off. */
  week_and_endgame: boolean
  /** That the game's history stopped updating: what to do, and the page to do it on (freshness.py); null while it is well. */
  history_notice: { text: string; page: 'ledger' | 'settings' } | null
  /** The online account: signed in or not, and who as. */
  online: OnlineView
  mode: 'demo' | 'live'
  has_shell: boolean
  /** A tray icon keeps Guild Board running after its window closes. */
  has_tray: boolean
  /** The core's time. Everything "ago" is measured against this. */
  now: string
  data_dir: string
  restore_unfinished: boolean
  /** Guild Board's own update, for the installed copy: what it found and how far its install is. */
  update: UpdateStatus
  tracking_since: string | null
  sync: {
    state: SyncState
    message: string | null
    last_ok_at: string | null
    next_at: string | null
    manual_wait_seconds: number
    /** The syncs the core has started today; it counts them for its daily limit. */
    runs_today: number
    daily_cap: number
    /** The least time between two manual syncs. */
    manual_gap_seconds: number
  }
  game: { running: boolean; session_started_at: string | null; last_session_minutes: number | null }
  account: null | {
    nickname: string
    server: string
    uid: number | null
    adventure_rank: number | null
    days_active: number | null
    resin: number | null
    resin_max: number | null
    /** When the notes that `resin` counts on from were read; null with no notes read. */
    resin_read_at: string | null
    /** When Resin is full again, as the latest notes counted it. */
    resin_full_at: string | null
    /** The profile picture through the icon route ("/api/icon/account.picture?v=…"); null with none read. */
    picture_url: string | null
  }
  /** What the typed balance has grown to now; null while no balance is typed. */
  savings: { primogems: number; fates: number; pulls: number } | null
  /** What the redeemed gift codes gave this account. */
  codes: { primogems: number; redeemed: number }
}

/** The regions of the daily commissions (config.py, REGIONS). */
export type Region = 'mondstadt' | 'liyue' | 'inazuma' | 'sumeru' | 'fontaine' | 'natlan'
/** The regions of the fishing spots (config.py, FISHING_REGIONS): the commissions' and two more. */
export type FishingRegion = Region | 'nod_krai' | 'snezhnaya'

/** When a fishing spot comes back: guides disagree (spec 9.3), so the player sets it for every spot. */
export type FishingRule = '3_days' | 'next_reset'

export type Settings = {
  in_session_interval_min: 0 | 30 | 60
  sync_paused: boolean
  start_with_windows: boolean
  risk_acknowledged: boolean
  tray_hint_shown: boolean
  /** The region the Daily commissions open on. */
  commission_region: Region
  fishing_rule: FishingRule
  /** Windows notifications for the reminders (spec 10). */
  notifications: boolean
  /** The overlay's hotkey as text, such as "Ctrl+Alt+G" (spec 14.1). */
  overlay_hotkey: string
  /** The name of the display the overlay covers; "" is the main display. */
  overlay_display: string
  /** How opaque the pinned widgets are over the game, from 50 to 100. */
  overlay_opacity: number
  /** Show the pinned widgets over the game while the overlay is closed. */
  overlay_pinned: boolean
  /** A line over the game when a timer is ready, while the game runs (spec 10). */
  overlay_lines: boolean
  /** The Characters notices (the Characters design, 6.6), each on by default; a value left out counts as on. */
  characters_notice_weekly?: boolean
  characters_notice_domain?: boolean
  characters_notice_ready?: boolean
  /** How large the overlay draws, in percent: 100, the Board's size and the default, or 125, 150, 175 or 200. */
  overlay_size: number
  /** The screenshot gallery (the ledger design, section 7): off by default; while off, nothing of the game's is read. */
  gallery_enabled: boolean
  /** The game's ScreenShot folder, found or pasted; "" before either. */
  gallery_folder: string
  /** How large the Characters pages' big pictures are fetched (the Characters design, 11.7): the originals, at most 1,536 pixels, at most 1,024. */
  picture_quality: 'high' | 'medium' | 'low'
  /** The window's frame limit goes, from the next start: off by default. */
  smooth_animations: boolean
  /** The currency of the Ledger's "Spent on Genshin": 'PLN' (the default), 'EUR' or 'USD'. */
  spending_currency: 'PLN' | 'EUR' | 'USD'
  /** The player's corrections to the price list, by currency and then pack id; a pack left out keeps the default. */
  spending_prices: Partial<Record<'PLN' | 'EUR' | 'USD', Record<string, number>>>
  /** Sync my data (the online design, section 5): the player's own data is copied to their online account and back. On once signed in. */
  sync_my_data: boolean
}

/** A display the overlay can cover, as the shell reports it. */
export type OverlayDisplay = { name: string; label: string; primary: boolean }

/** GET /api/overlay. `available` is false until Guild Board's window has started the overlay. */
export type OverlayStatus = {
  available: boolean
  hotkey: string
  hotkey_state: 'held' | 'taken' | 'none'
  displays: OverlayDisplay[]
  display: string
}

export type BacklogRegion = {
  id: number
  name: string
  parent: string | null
  pct: number
  icon: string
  note: string
  areas: { name: string; pct: number }[]
  complete: boolean
}

export type Backlog = {
  tracking_since: string | null
  sort: 'least' | 'closest' | 'game'
  counters: {
    id: string
    label: string
    value: number
    delta: number | null
    delta_note: string | null
    text: string | null
  }[]
  regions: BacklogRegion[]
  complete: BacklogRegion[]
  closest: { label: string; remaining: number }[]
  oculi: {
    missing: { type: string; label: string; have: number; total: number }[]
    complete_count: number
    unknown: { type: string; label: string; have: number }[]
  }
  archon: { known: boolean; all_finished: boolean; open: number; chapters: { title: string; name: string; status: string }[] }
}

export type Tile =
  | { id: 'chests' | 'achievements' | 'primogems'; label: string; value: number; delta: number | null; trend: number[] }
  | { id: 'playtime'; label: string; minutes: number; delta_minutes: number | null; trend: number[] }
  | { id: 'days'; label: string; value: number; of: number; longest_run: number }

/** A column per game day (or per week past 45 days) of something that rises: the chests opened, the primogems earned. */
export type Columns = {
  unit: 'day' | 'week'
  columns: { label: string; value: number; no_data: boolean; after_gap: boolean }[]
  total: number
  max_index: number | null
}

export type Stats = {
  range: '7' | '30' | '90' | 'all'
  period: { first: string; last: string; days: number }
  coverage: { tracking_since: string | null; tracked_days: number; full: boolean; partial: boolean; compare: boolean }
  tiles: Tile[]
  exploration: { rows: { name: string; start: number; now: number }[]; unchanged: number }
  chests: Columns
  /** The primogems earned, in the shape of `chests` (by the same rules), stacked by source where the ledger reaches. */
  primogem_days: PrimogemColumns
  calendar: { weeks: number; first_day: string; cells: { day: string; minutes: number | null; level: number | null }[] }
  /**
   * Play by weekday (Monday first) and hour on this PC's clock. A cell is the minutes of that weekday's hour on an
   * average day of the weekday, or null where the part of the period Guild Board tracked holds no such weekday; a level
   * is 0 for none, 1 under 15 min, 2 under 30, 3 under 45, 4 for 45 or more. `days` is how many of each weekday the
   * tracked part holds; `empty` is true when the period holds no session.
   */
  play_hours: { cells: (number | null)[][]; levels: number[][]; days: number[]; empty: boolean }
  primogems: {
    months: { ym: string; label: string; value: number; current: boolean }[]
    sources: { name: string; amount: number }[]
  }
  endgame: { mode: string; label: string; result: string; period: string; best: string }[]
}

export type SyncLogRow = {
  id: number
  started_at: string
  finished_at: string | null
  trigger: string
  outcome: string
  error_kind: string | null
  message: string | null
}

export type AchievementStatus = 'not_started' | 'in_progress' | 'done'

/** One reward stage, with the player's progress on it (views/achievements.py). */
export type AchievementStage = {
  id: number
  name: string
  description: string
  reward: number
  version: string
  status: AchievementStatus
  done_at: string | null
  pinned: boolean
  note: string
  parts: { label: string; done_at: string | null }[]
  wiki: string
}

/**
 * One achievement: its stages together, and the count that belongs to all of them. The counter's targets are its
 * stages', one each, in order. `unit_one` is the unit after a target of 1, when the notes name one ("kill").
 */
export type AchievementGroup = {
  id: number
  name: string
  category: string
  counter: null | { value: number; unit: string; unit_one: string | null; targets: number[] }
  stages: AchievementStage[]
}

/** The installed achievement list, and the previous one that undo goes back to (achievements/updates.py). */
export type ListMeta = {
  /** "demo" is the demo's made-up newer list, which nothing downloaded. */
  source: 'bundled' | 'github' | 'demo'
  version: string
  stages: number
  installed_at: string | null
  /** The day Paimon.moe committed the bundled list; null for any other copy. */
  dated: string | null
  previous: null | { version: string; stages: number; installed_at: string | null }
}

/** The Achievements page model (views/achievements.py, with what core.py adds). */
export type Achievements = {
  /**
   * The query as answered: `category` is the one shown, chosen or not. `keep` names the achievements (by their first
   * stage's id) that stay in the list whatever the view or Pinned decides, in order.
   */
  query: {
    view: 'left' | 'done' | 'all'
    category: string | null
    pinned: boolean
    search: string
    unlisted: boolean
    keep: number[]
  }
  totals: { stages: number; done: number; left: number; primogems_left: number }
  categories: { key: string; name: string; stages: number; left: number }[]
  /** How many achievements have a pinned stage. */
  pinned: number
  /** How many stages with progress the list does not hold: a row, checklist parts or a count (spec 6.3). */
  unlisted: number
  /**
   * Those stages, filled only when the query asks for them, by id. A stage with parts or a count alone is not started
   * and has no note. `parts` is how many parts are done; `count` is the counter's value, or null when there is none.
   */
  unlisted_rows: {
    id: number
    status: AchievementStatus
    note: string
    pinned: boolean
    parts: number
    count: number | null
  }[]
  /** The label of the newest change the core can undo, which an undo would put back; null when there is none. */
  undo: string | null
  groups: AchievementGroup[]
  list: ListMeta
  hoyolab: null | { count: number; at: string }
  /** The special categories' counts: the timers ready, and the commission achievements left in the Settings region. */
  special: { timers_ready: number; commissions_left: number }
}

/**
 * When a timer the player makes comes back (timers/rules.py): a number of real hours after Cleared, after one or more
 * daily resets, or at the weekly reset, each at 04:00 server time.
 */
export type TimerRule = { kind: 'hours'; hours: number } | { kind: 'resets'; resets: number } | { kind: 'weekly' }

/**
 * A timer of the Timers category (views/timers.py). A pre-set keeps its name and rule; a fishing spot's rule follows
 * the fishing setting. `about` is a pre-set's rule in words, null for the player's own. `ready_at` is null for a timer
 * never cleared, which is ready; `started_at` is when its countdown began, null when nothing says (Set ready time on a
 * rule that waits for a reset). `achievement` is the one a pre-set serves, with what countText needs. Its counter's
 * `cleared_adds` says whether Cleared adds one to the count, as the hilichurl's does; where it does not, as for the items
 * a teapot field gives, the card counts with + and − itself.
 */
export type Timer = {
  id: number
  preset: string | null
  own: boolean
  name: string
  place: string
  rule: TimerRule | { kind: 'fishing' }
  about: string | null
  state: 'ready' | 'running' | 'finished'
  ready_at: string | null
  started_at: string | null
  cleared_at: string | null
  visits: { done: number; of: number } | null
  /** Whether a reminder comes when it is ready (spec 10). */
  bell: boolean
  /** On the Board as a One timer widget (board/layouts.py), which Pin to Board puts there. */
  pinned: boolean
  /** An address of the core, never HoYoLAB's own, or null when the timer has no picture. */
  icon: string | null
  achievement: null | {
    id: number
    name: string
    stages: { id: number; status: AchievementStatus }[]
    counter: null | (NonNullable<AchievementGroup['counter']> & { cleared_adds: boolean })
  }
}

/** A pre-set timer not in use, which "Add a pre-set timer" offers. A fishing spot names its region. */
export type PresetOffer = { key: string; name: string; group: string; region: FishingRegion | null }

/** The Timers category's model: every timer in use, and the pre-sets that can still be added, in the file's order. */
export type TimersModel = { fishing: FishingRule; timers: Timer[]; presets: PresetOffer[] }

/**
 * A commission achievement of the Daily commissions category (views/commissions.py), one stage, with the player's
 * progress on it. `quests` are the commission names to look for. `parts` are the list's, then those Guild Board's notes
 * add; `order` says they are done in order, as a chain, and `next_part` is then the first not done, otherwise null.
 * `first` is what must be done before, `how` what to choose or do. `last_appeared` is a game day.
 */
export type Commission = {
  id: number
  name: string
  description: string
  reward: number
  quests: string[]
  parts: { index: number; name: string; done_at: string | null }[]
  order: boolean
  next_part: number | null
  how: string | null
  first: string | null
  status: AchievementStatus
  pinned: boolean
  appeared_today: boolean
  last_appeared: string | null
}

/**
 * The Daily commissions category's model for one region (views/commissions.py): the six regions with how many are left
 * in each, HoYoLAB's count of the day's commissions when it was read in this game day (`today`, which turns at 04:00
 * server time), the commission names to look for, each once, and the cards still to do and those done, in the list's
 * order. `region_icon` is the address of the region's emblem in the icon cache, the exploration region of the same
 * name; null before exploration is read, or when HoYoLAB gave the region no picture.
 */
export type CommissionsModel = {
  region: Region
  region_icon: string | null
  today: string
  regions: { key: Region; name: string; left: number }[]
  hoyolab: null | { done: number; of: number; at: string }
  looking_for: string[]
  cards: Commission[]
  done: Commission[]
}

/** What a check for new achievements found (achievements/updates.py). Nothing is installed yet. */
export type ListCheck = {
  up_to_date: boolean
  sha256: string
  version: string
  stages: number
  added: { id: number; name: string; description: string; version: string; category: string }[]
  changed: { id: number; name: string; what: ('name' | 'description' | 'reward')[] }[]
  removed: { id: number; name: string }[]
}

/** What importing a file would change (achievements/importers.py). Nothing is saved yet. */
export type ImportPreview = {
  kind: 'paimon'
  file: string
  /** "" is Paimon.moe's main profile. */
  profile: string
  profiles: string[]
  fingerprint: string
  done: number
  in_progress: number
  pins: number
  notes: number
  parts: number
  /** Achievements in the file that the list does not hold. */
  unknown: number[]
  conflicts: string[]
  nothing_new: boolean
}

/**
 * One widget of a layout (board/layouts.py): an id, a type, a size in grid cells and its settings. A widget of a type
 * this version does not know, or with keys it does not know, is kept as it is (spec 13.4). On the overlay's layout a
 * widget can be pinned: it shows over the game while the overlay is closed (plan 2A-4).
 */
export type Widget = {
  id: string
  type: string
  w: number
  h: number
  settings: Record<string, unknown>
  pinned?: boolean
  [key: string]: unknown
}

/** Where a layout is shown: the Board, or the overlay over the game. */
export type Place = 'board' | 'overlay'

/** A place's layout. `saved` is false while the place shows its starting layout, at revision 0. */
export type Layout = { place: Place; revision: number; widgets: Widget[]; saved: boolean }

/** The Board model (views/board.py): what the widgets of Guild Board's and HoYoLAB's data need. */
export type BoardModel = {
  server: { key: string; utc_offset_hours: number }
  /** The next daily reset, and the next weekly one on Monday, at 04:00 server time. */
  resets: { daily_at: string; weekly_at: string }
  playtime: {
    running: boolean
    session_started_at: string | null
    today_minutes: number
    /** The minutes played on today's game day and the six before it, oldest first; `day` is "2026-10-13". */
    week: { day: string; minutes: number }[]
  }
  achievements: {
    stages: number
    done: number
    left: number
    primogems_left: number
    hoyolab: null | { count: number; at: string }
  }
  /** The Real-Time Notes as last read; null before the first read. */
  notes: null | {
    read_at: string
    /** Read since the daily reset: the commission count is today's. */
    read_today: boolean
    /** Read since Monday's reset: the boss discounts are this week's. */
    read_this_week: boolean
    resin_full_at: string | null
    /** Null for notes read before plan 2A-3 kept them. */
    expeditions: null | { icon: string | null; back_at: string | null }[]
    expeditions_max: number
    /** Null until the Parametric Transformer is obtained. */
    transformer: null | { ready_at: string | null }
    realm_currency: number
    realm_currency_max: number
    realm_currency_full_at: string | null
    commissions_done: number
    commissions_max: number
    boss_discounts_left: number
    boss_discounts_max: number
  }
  /** The newest change the core holds; the interface no longer shows it (the undo note names only this visit's changes). */
  undo: string | null
}

/** A quick timer (timers/quick.py, spec 9.5): it reminds once when ready, and stays until it is dismissed. */
export type QuickTimer = {
  id: number
  seconds: number
  /** "Quick timer · 5 min", as its reminder names it. */
  name: string
  started_at: string
  ready_at: string
  state: 'running' | 'ready'
}

export type QuickTimersModel = { quick_timers: QuickTimer[] }

// ---------------------------------------------------------------- Pulls (src/guildboard/pulls/, the Pulls design)

export type PullsPool = 'character' | 'weapon' | 'standard' | 'chronicled'
export type WishKind = 'character' | 'weapon'
export type FiveResult = 'won' | 'lost' | 'guaranteed' | 'featured' | 'path' | 'off-path' | null

export type HistoryRow = {
  id: string
  name: string
  kind: WishKind
  rank: 3 | 4 | 5
  pool: PullsPool | 'novice'
  pool_label: string
  /** The 5★'s pity, or the 4★'s; null for a 3★. */
  pity: number | null
  /** How a 5★ fell; null for a 4★ or a 3★, and for every 5★ of the standard wish. */
  result: FiveResult
  at: string
  /** The icon's address in the core, or null when the wiki has none. */
  icon: string | null
}

export type PityCard = {
  pool: PullsPool
  pity: number
  /** False when the history cannot tell: the card reads "at least". */
  known: boolean
  hard: number
  soft: number
  /** Wishes since the last 4★; with none kept and a window, the wishes kept since the window's start. */
  four: number
  /** False when the kept history holds no 4★ (nor 5★) and has a window: `four` is then a lower bound (ruling R22). */
  four_known: boolean
  /** 'none' is the standard wish's: it has no featured item to be guaranteed. */
  guarantee: 'guaranteed' | 'fifty' | 'unknown' | 'none'
  /** The weapon event's Epitomized Path or the chronicled wish's path; null for the others. `item` is "" while none is chosen. */
  path: { item: string; points: number; max: 1 } | null
  last_five: { name: string; pity: number | null; at: string } | null
  wishes: number
  correction: { pity: number; guaranteed: boolean } | null
  /**
   * Where the card's history starts, which its correction's form names: the correction is the state before it. Null
   * for a history read as complete, which the core's planner never gives.
   */
  from: string | null
}

export type Banner = {
  ann_id: number
  name: string
  pool: PullsPool | 'other'
  featured: string[]
  art: string | null
  starts_at: string
  ends_at: string
  running: boolean
  /** The player's pity card for the banner's pool; null for `other`. */
  pity: PityCard | null
}

/** A source of the next version's primogems; the ledger lists all seven, in this order (the second pass, the contracts). */
export type SavingsRowKey = 'commissions' | 'events' | 'endgame' | 'update' | 'quests' | 'welkin' | 'gnostic_hymn'

export type SavingsRow = {
  key: SavingsRowKey
  primogems: number
  fates: number
  /** False only for a switched-off Welkin Moon or Gnostic Hymn: its row stays, to show what it would add. */
  on: boolean
  /** The events and the quests are estimated from the diary; a typed events count is not. */
  estimated: boolean
}

/** What the next game version can bring: its days, its sources and their sum. */
export type NextVersion = {
  /** "7.2"; null when the calendar cannot place the version. */
  number: string | null
  /** The game day it starts, "2026-11-04". */
  starts_on: string
  /** The game day the version after it starts, "2026-12-16". */
  ends_on: string
  rows: SavingsRow[]
  /** The sum over the rows that are on. */
  primogems: number
  fates: number
  /** primogems // 160 + fates */
  pulls: number
  /** The events count the player typed for this version, or null for the estimate. */
  events_typed: number | null
}

/** The wishes of a month, by wish; the beginners' wish counts with the standard wish. `month` is "2026-10". */
export type MonthWishes = { month: string; character: number; weapon: number; standard: number; chronicled: number }

export type Pulls = {
  uid: number | null
  account_uid: number | null
  /** The start of the known window (calls, item 4); null with no import. */
  history_from: string | null
  import: {
    state: 'idle' | 'running' | 'done' | 'failed'
    last_at: string | null
    found: number
    pages: number
    pool: string | null
    message: string | null
    /** While a kept link lives (the second pass, spec 3.5): until when Import updates itself, and when it last did. */
    auto: { until: string; last_at: string | null } | null
    /** Set when HoYoverse refused the kept link, until the next press. */
    auto_stopped: 'expired' | null
    /**
     * The histories' updates with keys HoYoverse gives the HoYoLAB login, without Import: null without them; "on" while
     * the last went well (or before one), "minting" while the keys are asked for, "failed" after one that did not end
     * well, "refused" once HoYoverse refused the login.
     */
    login: 'on' | 'minting' | 'failed' | 'refused' | null
  }
  banners: Banner[]
  pity: PityCard[]
  savings: {
    set: { primogems: number; fates: number; set_at: string } | null
    pulls: number | null
    estimated: { primogems: number; fates: number; income: number; wishes: number } | null
    income_per_day: number | null
    achievements_left: number
    /** The forecast no longer adds `achievements_left` (the second pass, spec 2, item 9). */
    forecast: { by: string; pulls: number; default_by: boolean; days: number }
    /** The two purchases the player has, kept per game uid. */
    owned: { welkin: boolean; gnostic_hymn: boolean }
    next: NextVersion
    /** The pulls on `next.ends_on`; null with no balance set. */
    by_next_end: number | null
    /** `achievements_left` // 160, shown under the total and outside it. */
    achievements_pulls: number
  }
  wishlist: {
    id: number
    name: string
    kind: WishKind
    rank: number
    pool: PullsPool
    about: string
    copies: number
    icon: string | null
    chance: number
    certain_within: number | null
    pulls_by_then: number
  }[]
  planner: {
    banner: Banner
    chance: number
    second: number
    certain_within: number | null
    pulls_by_then: number
    /** The icon of the 5★ the entry is for (the charted weapon on the weapon banner), or null when the wiki has none. */
    icon: string | null
  }[]
  history: {
    count: number
    fives: number
    /** `average_pity` and `luckier_than` count the character event's 5★ with a known pity alone. */
    average_pity: number | null
    won: number
    lost: number
    luckier_than: number | null
    /** The character soft pity model's mean, one decimal (62.3). */
    typical_average: number
    /** Every month from the oldest kept wish to this one, oldest first. */
    months: MonthWishes[]
    rows: HistoryRow[]
    more: boolean
  }
}

/** The import's progress, as the core publishes it at the start, after every page and at the end. */
export type PullsImportEvent = {
  state: 'running' | 'done' | 'failed'
  pool: string | null
  pages: number
  found: number
  message: string | null
}

/** One tab of the Map page (GET /api/map). `custom` is whether the player named it; `failed`, that its map did not load. */
export type MapTab = { id: number; name: string; custom: boolean; failed: boolean }

export type MapModel = {
  tabs: MapTab[]
  active: number
  can_reopen: boolean
  /** Whether Guild Board holds a HoYoLAB login for the map views to sign in with. */
  signed_in: boolean
  /** Whether the Guild Board window is there to show the map views: a browser tab has none. */
  has_shell: boolean
}

/** The area of the page the map fills, in CSS pixels, and whether something of the page covers it for now. */
export type MapArea = { x: number; y: number; w: number; h: number; hidden: boolean }

/** One code of the history on the Codes page. */
export type CodeRow = {
  code: string
  result: string
  text: string
  primogems: number
  source: string
  at: string
}

/** GET /api/checkin (checkin.py). `icon` is the core's address of a reward's picture, empty where there is none. */
export type CheckInModel = {
  ready: boolean
  read: boolean
  read_failed: boolean
  claiming: boolean
  claimed_today: boolean
  claimed_days: number
  rewards: { name: string; amount: number; icon: string }[]
  next_reset: string
  result: string | null
  text: string | null
  website: string
}

/** GET /api/codes. `progress` is the run in hand: a result key, "waiting", "sending", or a settled code's own text. */
export type CodesModel = {
  totals: { primogems: number; redeemed: number }
  history: CodeRow[]
  live: { code: string; primogems: number }[]
  busy: boolean
  progress: { code: string; state: string; text?: string }[]
  needs_login: boolean
  /** Until a code has gone through or a login has finished, the page asks for a login before the first code. */
  login_first: boolean
}

// ---------------------------------------------------------------------------------------------------------------------
// The Characters pages (the Characters plan, "TypeScript"). The core's models match these, held by
// tests/characters_shape.py, which reads this file: keep each type to the forms it reads (objects, unions, arrays,
// tuples, Record and Partial<Record>).

export type Element = 'Pyro' | 'Hydro' | 'Anemo' | 'Electro' | 'Dendro' | 'Cryo' | 'Geo'
export type WeaponType = 'Sword' | 'Claymore' | 'Polearm' | 'Bow' | 'Catalyst'
export type Slot = 'flower' | 'plume' | 'sands' | 'goblet' | 'circlet'
export type Weight = 'wants' | 'some' | 'none'
export type Pronouns = { she: string; her: string; hers: string }   // "she"/"her"/"her", "he"/"him"/"his", "they"/"them"/"their"
export type CharSync = { can_refresh: boolean; wait_minutes: number | null; reading: boolean; read_at: string | null; calculator: 'on' | 'off' | 'unknown'; message: string | null }

export type RosterEntry = {
  key: string; name: string; element: Element; weapon: WeaponType; rarity: 4 | 5
  icon: string | null; owned: boolean; level: number | null; constellation: number | null
  readiness: number; focus: number | null; early: boolean
  banner: { starts: string; ends: string; running: boolean } | null
}
export type Roster = { owned: number; all: number; focus: string[]; entries: RosterEntry[]; sync: CharSync }

export type StatRow = { key: string; label: string; text: string; value: number; her: number; weapon: number; artifacts: number; scale: number; goal: number | null; goal_text: string | null; met: boolean | null; how: string }
export type RollRow = { key: string; label: string; rolls: number; weight: Weight; where: string }
export type SubView = { key: string; label: string; text: string; rolls: number; weight: Weight }
export type PieceView = { slot: Slot; name: string; icon: string | null; level: number; rarity: number; main: { label: string; text: string }; subs: SubView[]; verdict: 'keep' | 'level' | 'replace'; why: string; crit_value: number; rolls_wanted: number; rolls_all: number; set_name: string }
export type WeaponView = { key: string; name: string; icon: string | null; rarity: number; level: number; refinement: number; base_atk: number; sub: { label: string; text: string } | null; passive: { name: string; text: string }; verdict: string; refinements: { label: string; values: string[] }[] }
export type MaterialRow = { key: string; name: string; icon: string | null; held: number | null; held_exact: boolean; needed: number; state: 'ready' | 'missing' | 'unknown'; source: string; typed: boolean }
export type Readiness = { total: number; parts: { key: 'level' | 'talents' | 'weapon' | 'artifacts'; label: string; value: number; text: string }[] }

export type Profile = {
  key: string; name: string; title: string; element: Element; weapon_type: WeaponType; rarity: 4 | 5; pronouns: Pronouns
  owned: boolean; level: number | null; constellation: number | null
  art: string | null; chart: string | null; stars: [number, number][] | null; chart_size: [number, number] | null
  pity: { at: string; pity: number | null; result: 'won' | 'lost' | 'guaranteed' | 'featured' | null; banner: string; after: string | null }[]
  stats: StatRow[]; rolls: RollRow[]; rolls_by: { wants: number; some: number; none: number }
  weapon: WeaponView | null; sets: { name: string; pieces: number; two: string; four: string }[]; pieces: PieceView[]
  constellations: { n: number; name: string; icon: string | null; text: string; owned: boolean }[]
  talents: { kind: 'normal' | 'skill' | 'burst'; label: string; name: string; icon: string | null; level: number | null; bonus: number }[]
  next_level: { talent: string; materials: MaterialRow[] } | null
  about: { label: string; value: string }[]
  readiness: Readiness; next_steps: { text: string; gain: string }[]
  card: {
    edited: string[]; confidence: string; early: boolean
    /** The card itself, for the Card panel (cardview.ts's CardExtra): its fields by name, tuples as arrays. */
    fields: {
      roles: string[]; keeps_alive: boolean; scaling: 'atk' | 'hp' | 'def' | 'em'; damage_talent: 'normal' | 'skill' | 'burst'
      talent_priority: ('normal' | 'skill' | 'burst')[]; goals: Record<string, number>
      mains: Record<'sands' | 'goblet' | 'circlet', string[]>; weights: Record<string, Weight>
      sets: { sets: string[]; pieces: '4' | '2+2' }[]; weapons: string[]; partners: string[]; partner_roles: string[]
      pronouns: [string, string, string]
    }
    notes: string; sources: string[]; checked: string | null
    options: { weapons: { key: string; name: string }[]; sets: { key: string; name: string }[] }
  }
  sync: CharSync
}

export type Option = { key: string; name: string; icon: string | null; text: string; tag: string | null }
export type Planner = {
  key: string; name: string; element: Element; pronouns: Pronouns; icon: string | null; damage_role: boolean
  now_build: { level: number; refinement: number | null; weapon_level: number | null } | null   // null: not owned; the weapon's two are null without one
  plan: PlanBody; now: { readiness: number; damage: number }; with_plan: { readiness: number; damage: number; change: number | null }
  talents: { kind: 'normal' | 'skill' | 'burst'; label: string; name: string; icon: string | null; now: number; target: number; bonus: number; max: number }[]
  weapons: Option[]; refinement_note: string; sets: Option[]; set_text: string
  mains: { slot: 'sands' | 'goblet' | 'circlet'; icon: string | null; options: { key: string; label: string }[]; now: string; chosen: string }[]
  level_pieces: { slot: Slot; label: string; note: string; on: boolean }[]
  weights: { key: string; label: string; weight: Weight }[]
  stats: { key: string; label: string; now: number; now_text: string; plan: number; plan_text: string; scale: number; goal: number | null; change_text: string; how: string }[]
  goals_met: { label: string; text: string; met: boolean }[] | null       // supports, in place of the damage meter
  warning: string | null
  try: { crit_value: number; rolls_wanted: number; rolls_all: number; change: number | null; against: string } | null
  takes: { today_note: string; materials: MaterialRow[]; resin_today: { label: string; resin: number }[]; resin_cap: number; find: { label: string; icon: string | null; per_run: number; paths: { label: string; odds: string; best: boolean }[]; note: string }[] }
  days: { points: number[]; half: string | null; most: string | null; talents_on: string | null; summary: string }
  in_focus: number | null; sync: CharSync
}
export type PlanBody = { level: number; talents: { normal: number; skill: number; burst: number }; weapon: string | null; weapon_level: number; refinement: number; set: { sets: string[]; pieces: '4' | '2+2' } | null; mains: Partial<Record<'sands' | 'goblet' | 'circlet', string>>; level_pieces: Slot[]; typed: { slot: Slot; main: string; subs: [string, number][]; use: boolean } | null; weights: Record<string, Weight> }

export type WeekTask = { key: string; kind: 'books' | 'forgery' | 'weekly' | 'boss' | 'ley' | 'artifacts' | 'flowers' | 'enemies' | 'level'; who: string[]; title: string; why: string; material: { name: string; icon: string | null } | null; resin: number; free: boolean; done: boolean }
export type WeekDay = { day: string; label: string; today: boolean; start: number; spent: number; alert: { text: string; loud: boolean } | null; spare: string | null; tasks: WeekTask[] }
export type FocusCard = { key: string; position: number; name: string; icon: string | null; goal: string; ready_text: string; pronouns: Pronouns }
export type Week = {
  focus: FocusCard[]; characters: { key: string; name: string; icon: string | null; owned: boolean; focus: number | null }[]
  days: WeekDay[]
  ready: { key: string; until: number | null; luck: { half: number | null; label: string } | null; text: string }[]   // days from today
  resin_by: { key: string; resin: number }[]; resin_week: number; resin_week_max: number
  how: string[]
  today: WeekDay
  sync: CharSync
}

export type TeamView = { label: string; lead_element: Element; members: { key: string; name: string; icon: string | null; role: string; ready: number }[]; ready: number; note: string | null }
export type Endgame = {
  after: boolean
  modes: { key: 'abyss' | 'theater' | 'stygian'; label: string; value: string; text: string; ready: number }[]
  abyss: TeamView[]
  stygian: { name: string; does_well: Element[]; does_badly: Element[]; team: TeamView | null }[]
  theater: { month: string; elements: Element[]; /** The calendar's own, empty when it names none: shown beside a pick that is kept. */ calendar_elements: Element[]; from_calendar: boolean; cast: { element: Element; ready: number; members: { key: string; name: string; icon: string | null; ready: number; counted: boolean }[]; thinnest: boolean }[]; teams: TeamView[]; close: { key: string; name: string; icon: string | null; element: Element; ready: number; to_go: number }[] }
  clear: { key: string; icon: string | null; title: string; text: string; action: 'planner' | 'focus'; target: string }[]
  sync: CharSync
}
