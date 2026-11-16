/** The shapes the local API returns. They mirror src/guildboard/core.py and src/guildboard/views/. */
import type { ThemeSetting } from './theme.ts'

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
  /** Whether the Endgame tab is shown; it is hidden on its own too, to be rebuilt. */
  endgame: boolean
  /** Whether the planner shows its verdict (and the core sends the hits it is computed from); off in a shipped build. */
  verdict: boolean
  /** That the game's history stopped updating: what to do, and the page to do it on (freshness.py); null while it is well. */
  history_notice: { text: string; page: 'ledger' | 'settings' } | null
  /** The online account: signed in or not, and who as. */
  online: OnlineView
  mode: 'demo' | 'live'
  has_shell: boolean
  /**
   * Guild Board's window is maximized, as its shell reports it: the Board shows its arrangement for a maximized window.
   * Left out by a recording made before it.
   */
  window_maximized?: boolean
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
  /** The window's look: a theme, or Match Windows. A recording made before themes lacks it, which counts as Parchment. */
  theme: ThemeSetting
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
  /** How large the overlay draws, in percent: 100, the Board's size and the default, or 125, 150, 175 or 200. */
  overlay_size: number
  /** The game runs in full screen: the open overlay takes the clicks but never the focus, so the game is not minimized. */
  overlay_full_screen: boolean
  /**
   * How large Guild Board's window draws its page, in percent of the size it grows to with the window: 70 to 130 in steps
   * of 10, 100 by default. One size while the window is not maximized, and one while it is. The window steps the size of
   * its state with Ctrl and + or -, and with Ctrl and the mouse wheel.
   */
  page_size: number
  page_size_maximized: number
  /** The Ledger's "Spent on Genshin" is covered (the revamp design, section 5). It stays on this PC, and is shown the first time. */
  ledger_spent_hidden: boolean
  /** The screenshot gallery (the ledger design, section 7): off by default; while off, nothing of the game's is read. */
  gallery_enabled: boolean
  /** The game's ScreenShot folder, found or pasted; "" before either. */
  gallery_folder: string
  /** The folders the player added to the gallery; changed only by adding and removing one (POST /api/gallery/folders). */
  gallery_folders: string[]
  /** How large the Characters pages' big pictures are fetched (the Characters design, 11.7): the originals, at most 1,536 pixels, at most 1,024. */
  picture_quality: 'high' | 'medium' | 'low'
  /** The currency of the Ledger's "Spent on Genshin": 'USD' (the default), 'EUR' or 'PLN'. */
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
  calendar: { weeks: number; first_day: string; cells: { day: string; minutes: number | null; level: number | null }[]; run: { current: number; best: number } }
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
    /** The minutes in all that Guild Board counted from the process list, and when it began counting; null before any session. */
    total_minutes: number | null
    counting_since: string | null
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
/** One choice of Add a wish (pulls/choices.py), in its group: coming soon, on the banners now, every 5★, every 4★. */
export type WishChoice = {
  name: string
  kind: WishKind
  rank: number
  group: 'soon' | 'now' | 'five' | 'four'
  /** Its face in the core's icon cache, or null where the wiki has none. */
  icon: string | null
  /** The end of the running banner that features it, which the form takes as its day; null for one on no banner now. */
  ends_at: string | null
}

/** GET /api/pulls/choices. */
export type WishChoices = { characters: WishChoice[]; weapons: WishChoice[] }

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
    /** Minutes between the history's updates by itself: with the login's keys, or while a link kept from a press lives; null otherwise. */
    every_minutes: number | null
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
    /** A character announced and not out yet (reference/upcoming.json), until the wiki lists them. */
    soon: boolean
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
export type CharSync = { can_refresh: boolean; wait_minutes: number | null; reading: boolean; /** What stops the sync until the player acts: paused, the login to give again, or a check to pass. */ blocked: 'paused' | 'login_needed' | 'verification_needed' | null; read_at: string | null; calculator: 'on' | 'off' | 'unknown'; message: string | null; /** Minutes between the reads it makes by itself. */ every_minutes: number }

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
export type PieceView = { slot: Slot; name: string; icon: string | null; level: number; rarity: number; main: { label: string; text: string }; subs: SubView[]; verdict: 'keep' | 'level' | 'replace'; why: string; crit_value: number; cv_tier: number; rolls_wanted: number; rolls_all: number; set_name: string }
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
      roles: string[]; keeps_alive: boolean; damage_talent: 'normal' | 'skill' | 'burst'
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
  now_build: { level: number; constellation: number; refinement: number | null; weapon_level: number | null } | null   // null: not owned; the weapon's two are null without one
  plan: PlanBody
  talents: { kind: 'normal' | 'skill' | 'burst'; label: string; name: string; icon: string | null; now: number; target: number; bonus: number; max: number }[]
  weapons: Option[]; refinement_note: string; sets: Option[]; set_text: string
  mains: { slot: 'sands' | 'goblet' | 'circlet'; icon: string | null; options: { key: string; label: string }[]; now: string; chosen: string }[]
  level_pieces: { slot: Slot; label: string; note: string; on: boolean }[]
  weights: { key: string; label: string; weight: Weight }[]
  warning: string | null
  sync: CharSync
  sim: PlannerSim | null                                                  // null: not owned
}
export type PlannerSim = {
  panel: Record<'hp' | 'atk' | 'def' | 'em' | 'er' | 'cr' | 'cd' | 'dmg' | 'heal' | 'physical', number>      // HoYoLAB's final values
  base: Record<'hp' | 'atk' | 'def', number>; char_base_atk: number                              // base ATK less her weapon's
  weapon: SimWeapon | null; sets: SimSet[]; pieces: SimPiece[]; cv_total: number; cv_set_tier: number
  tables: {
    rolls: Record<string, Record<string, number[]>>; mains: Record<string, Record<string, number[]>>; weights: Record<string, number>; start4_odds: number
    /** The damage engine's constants (tables.json): the level multipliers (index: level - 1), the amplifying and additive reactions'
     *  constants (by name), Lunar's and Stellar's reaction multipliers, Stellar-Conduct's by recorded hits (0 to 12), the Polestar field's Cryo and Electro DMG Bonus by the same count and the enemy. */
    level_mult: number[]; amplifying: Record<string, number>; additive: Record<string, number>; lunar: Record<string, number>
    stellar_conduct: number[]; polestar_dmg: number[]; enemy: { level: number; res: number }
  }
  /** Her hits and kit for the verdict; null while the verdict switch is off (Status.verdict). */
  hits: PlannerHits | null
}
/** A hit's scaling stat (atk, hp, def or em) and its multiplier (185.76% is 1.8576). */
export type HitTerm = { stat: string; mult: number }
/** One damage row of a talent. `kind`: physical, elemental, lunar-bloom, lunar-charged, lunar-crystallize, stellar-conduct or
 *  stellar-swirl. `move`: normal, charged, plunging, skill or burst. `element` is a Stellar hit's own, else null.
 *  `alternative`: the name of the source row when a slash printed several hits (the rows share it; Low/High plunge keeps its first only), else null. `main`:
 *  the kit names it among her main rows (every row of a kit that names none). A row that prints two hits with a slash is two rows.
 *  `instances`: how many hits one landing of the row is (`47.4%+88.1%` is 2; a sum of ATK and Elemental Mastery is 1), so that a
 *  flat bonus per hit (Aggravate, Spread) is added that often. */
export type HitRow = {
  name: string; kind: string; terms: HitTerm[]; flat: number; count: number; instances: number; move: string; element: Element | null; alternative: string | null; main: boolean
  /** Only for a character whose damage depends on her team (`PlannerHits.party`): the row takes the team's element, dealt once for each element of the team shape; */
  takes?: boolean
  /** and the team shapes that deal the row (null: every one). */
  only?: string[] | null
}
export type HitTalent = {
  key: 'normal' | 'skill' | 'burst'; name: string; icon: string | null; level: number; main: boolean
  /** Where the rows are from: HoYoLAB's own list, the wiki's table at her level, or none (no table, or a level past its last). */
  source: 'hoyolab' | 'wiki' | null; rows: HitRow[]
}
/** An effect of the kit data: it adds min(rate x max(stat - over, 0), cap) to the bucket `to` while its gates hold (kits.schema.json).
 *  The elements named inside a bucket (`dmg:cryo`) are the kit's lowercase names; every `element` field of the block is an `Element`.
 *  A `row` effect's rate is already at the level of the talent it is a row of. A weapon's `rate` and `cap` are lists by refinement. */
export type Effect = {
  from: string | null; reads: 'premod' | 'final' | null; to: string; rate: number | number[]; cap: number | number[] | null
  cap_from: 'base_atk' | null; over: number | null; pieces: 2 | 4 | null; from_ascension: number | null; from_constellation: number | null
  talents: string[] | null; weapon_types: string[] | null; hits: string[] | null; row: { talent: 'normal' | 'skill' | 'burst'; name: string } | null
  while: string | null; in_stats: boolean
  /** Only for a character whose damage depends on her team: the team shapes the effect holds in (missing or null: every one). */
  party?: string[] | null
  /** Only for an effect that also multiplies by a second stat of hers, read as `reads` says (Kokomi's A4: 15% of Max HP times her Healing Bonus). */
  times?: 'heal' | null
  /** Only for an effect whose `hits` are rows of one talent when another talent has rows of the same names (Skirk's Normal Attack and her Skill both have a "1-Hit DMG"). */
  in_talent?: 'normal' | 'skill' | 'burst' | null
  /** Only for an effect that reads two or more of her states (Kaveh's A4: after his Burst, by its stacks): the toggles besides `while` that must be on too. */
  also?: string[] | null
}
/** A team shape a character's damage depends on (kits.json `party`): its words and the elements the rows that take the team's element deal. */
export type PartyOption = { id: string; label: string; elements: string[] }
/** The team shapes a character's damage depends on: the usual one (`default`, and why), the rest, and the rows of the kit that take the team's
 *  element or are dealt only by some shapes (by talent). */
export type PartyBlock = {
  default: string; reason: string; options: PartyOption[]
  element_rows: Partial<Record<'normal' | 'skill' | 'burst', string[]>>
  only_rows: Partial<Record<'normal' | 'skill' | 'burst', Record<string, string[]>>>
}
/** A state the kit data counts when it is on: `on` is the decided default, `state` what an effect reads it as when on. */
export type Toggle = { name: string; label: string; on: boolean; covers: string[]; state: string }
/** Her moves that deal `element` while `while` is on (always, with none). `party`: only for a character whose damage depends on her team,
 *  the team shapes the infusion holds in (missing: every one). */
export type Infusion = { talents: string[]; element: Element; while: string | null; party?: string[] }
export type GearEffects = { effects: Effect[]; toggles: Toggle[] }
export type PlannerHits = {
  element: Element; weapon_type: string; level: number
  /** Whether a person has gone through her kit's states (kits.json `checked`); false: "Her passives are not counted yet". */
  checked: boolean
  /** Why the comparison with Genshin Optimizer could not prove her kit (kits.json `unsure`): her verdict is "It depends" with it. */
  unsure: string | null
  /** The team shapes her damage depends on, or null (kits.json `party`). */
  party: PartyBlock | null
  /** The stats HoYoverse recommends for her, in the simulator's keys (subs first, then the three mains). */
  recommended: string[]
  talents: HitTalent[]
  /** Her own effects, her constellations and ascension already held; her weapon's and sets' are in the two maps below. */
  effects: Effect[]; toggles: Toggle[]; infused: Infusion[]
  /** The effects of her own weapon, by weapon key (none with none), and of the sets she wears, by set key. The effects of a weapon or a set the
   *  player tests come with the picker's choice (`WeaponChoice.gear`, `SetChoice.gear`); `simWithGear` puts them here for the engine. */
  weapon_effects: Record<string, GearEffects>; set_effects: Record<string, GearEffects>
}
export type SimWeapon = { key: string; name: string; icon: string | null; type: string; rarity: number; level: number; refinement: number; base_atk: number; sub: string | null; sub_value: number }
export type SimSet = { key: string; name: string; icon: string | null; pieces: number; two: { stat: string; value: number }[]; two_text: string; four_text: string }
export type WeaponChoice = { key: string; name: string; icon: string | null; rarity: number; base_atk: number | null; sub: string | null; sub_value: number | null; gear?: GearEffects }     // /api/characters/{key}/weapons; gear: its effects and toggles for her, with none it is missing
export type SetChoice = { key: string; name: string; icon: string | null; two_text: string; four_text: string; two: { stat: string; value: number }[]; gear?: GearEffects }                // /api/artifact-sets?character=<key>; gear: as WeaponChoice's
export type SimPiece = { slot: Slot; icon: string | null; name: string; set_key: string; level: number; rarity: number; main: string; main_value: number; subs: { stat: string; value: number; tiers: number[] }[]; crit_value: number; cv_tier: number }
export type PlanBody = { level: number; talents: { normal: number; skill: number; burst: number }; weapon: string | null; weapon_level: number; refinement: number; set: { sets: string[]; pieces: '4' | '2+2' } | null; mains: Partial<Record<'sands' | 'goblet' | 'circlet', string>>; level_pieces: Slot[]; typed: { slot: Slot; main: string; subs: [string, number][]; use: boolean } | null; weights: Record<string, Weight> }

/** A series of talent books or of a weapon material, with the weekdays its domain is open (Monday is 0; Sunday is always one). */
export type PlanSeries = { series: string; icon: string | null; days: number[] }
/** A series of books open today and the keys of the planned characters who need it. */
export type PlanBook = { series: string; icon: string | null; days: number[]; who: string[] }
/** A weapon material open today, the planned characters who need it and their weapons' names. */
export type PlanWeaponSeries = { series: string; icon: string | null; days: number[]; who: string[]; weapons: string[] }
/** A planned character with nothing open today, and the next weekday her book and her weapon's material open (null: not known). */
export type PlanIdle = { key: string; book_next: number | null; weapon_next: number | null }
/** One planned character: her face, her weapon, and her book's and weapon material's days (null: not read from the wiki yet). */
export type PlanRow = { key: string; name: string; icon: string | null; weapon: { name: string | null; icon: string | null }; book: PlanSeries | null; material: PlanSeries | null }
export type PlanWeekly = { material: string; icon: string | null; who: string[] }
export type PlanAddable = { key: string; name: string; icon: string | null }
/** GET /api/plan and PUT /api/plan/characters: the Plan page (the Plan design, section 4). Weekdays count from Monday, 0. */
export type PlanModel = {
  weekday: number; date: string
  /** The next 04:00 server time, as an instant: the day the page shows turns then. */
  turns_at: string
  count: number
  books: PlanBook[]
  weapons: PlanWeaponSeries[]
  idle: PlanIdle[]
  rows: PlanRow[]
  weekly: PlanWeekly[]
  /** Discounted weekly boss runs left this week, from the Notes read; null while there is none. */
  discounts_left: number | null
  addable: PlanAddable[]
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

/** GET /api/stats/endgame: the Overview's Endgame card (the Stats months and Wrapped design, section 3). */
export type EndgameHeader = {
  /** The mode's icon and its header picture, as `/api/art/<key>` addresses; null where the art cache has none. */
  icon: string | null
  picture: string | null
  /** The part of the picture to show, as fractions (x, y, width, height) of it; null shows all of it. */
  crop: [number, number, number, number] | null
}
export type EndgameRank = {
  kind: string
  label: string
  value: number
  face: string | null
  name: string | null
  element: Element | null
}
export type EndgameFoe = { name: string; level: number; icon: string | null }
export type EndgameFoeGroup = { chamber: string; half: number; foes: EndgameFoe[] }
export type EndgameBoss = { name: string; short: string; icon: string | null; seconds: number | null }
type EndgameBase = {
  label: string
  header: EndgameHeader
  period: string
  /** The latest result as the table says it, and the best so far. */
  result: string
  best: string
  played: boolean
  /** The header's line, ready to show. */
  line: string
}
/*
 * A null among the fields below is a field the endgame detail kept does not carry: one kept by 1.0.1, until the next sync reads
 * the endgame again. The card shows nothing for it, never a 0; a 0 or an empty list is a real one.
 */
export type EndgameAbyss = EndgameBase & {
  mode: 'abyss'
  stars: number
  battles: number | null
  wins: number | null
  chambers: { name: string; stars: number }[] | null
  floor_shown: number
  foes: EndgameFoeGroup[]
  ranks: EndgameRank[] | null
}
export type EndgameTheater = EndgameBase & {
  mode: 'theater'
  month: string
  difficulty: string
  /** The season shown has ended: last month's, on the 1st before the new season's first try. */
  ended: boolean
  act: number
  medals: boolean[] | null
  medal_count: number | null
  /** The Arcana fights cleared; null in a detail kept before it was read. */
  arcana: number | null
  /** The season's heraldry as HoYoLAB numbers it; null in a detail kept before it was read. */
  heraldry: number | null
  /** HoYoLAB's own pictures, each null until the art cache keeps it: the card then draws its own. */
  marks: { medal: string | null; cleared: string | null; flower: string | null; heraldry: string | null }
  ranks: EndgameRank[] | null
  flowers: number | null
  seconds: number | null
}
export type EndgameStygian = EndgameBase & {
  mode: 'stygian'
  season: string
  ended: boolean
  difficulty: number | null
  medal: string | null
  seconds: number | null
  bosses: EndgameBoss[]
  next: { name: string; starts: string } | null
  next_started: boolean
  dimmed: boolean
}
export type EndgameMode = EndgameAbyss | EndgameTheater | EndgameStygian
export type EndgameCardModel = { modes: EndgameMode[] }

/** One month of the strip: `GET /api/stats/month` (the Months and Wrapped design, section 5). `thin` is a month with little data. */
export type MonthChip = { ym: string; label: string; year: number; thin: boolean; current: boolean }
export type MonthFace = { name: string; icon: string | null }
export type MonthTile = {
  id: 'time' | 'days' | 'primogems' | 'wishes' | 'achievements'
  label: string
  value: number
  /** "minutes" for the time; the rest count what their id says. */
  unit: string
  /** Against the month before (the same days of it, for the month so far); null when it cannot be compared. */
  delta: number | null
  /** The 5-stars of the month, on the Wishes tile only. */
  faces?: MonthFace[]
}
export type MonthRecord = {
  id: 'longest_session' | 'best_primogem_day' | 'longest_run' | 'luckiest'
  label: string
  value: number
  unit: string
  when: string
  /** The luckiest 5-star's name and picture. */
  name?: string
  icon?: string | null
}
export type MonthDay = { day: string; minutes: number | null; level: number | null }
export type MonthAmount = { name: string; amount: number }
export type MonthEndgame = { mode: string; label: string; result: string }
export type MonthFive = { name: string; icon: string | null; pool: string; pity: number | null; result: FiveResult }
export type MonthBanner = { label: string; /** The pool's own name: character, weapon, standard, chronicled or novice. */ kind: string; wishes: number }
/** A quiet note on a part kept from a day on: its name, the day with its year, and the sentence the page shows. */
export type MonthSince = { part: string; since: string; text: string }
export type MonthModel = {
  ym: string
  label: string
  so_far: boolean
  compare_label: string
  tiles: MonthTile[]
  records: MonthRecord[]
  /** The month's days in the Playtime calendar's levels; null where no time is kept for the month. */
  days: MonthDay[] | null
  sources: MonthAmount[]
  resin: MonthAmount[]
  endgame: MonthEndgame[]
  pulls: { banners: MonthBanner[]; fives: MonthFive[] } | null
  /** Quiet notes on parts that begin inside or after the month. */
  since: MonthSince[]
}
export type MonthsModel = { months: MonthChip[]; month: MonthModel | null }

/** One card of the Year tab: `GET /api/stats/year` (the Months and Wrapped design, section 6). `numbers` are the figures the card is made of. */
export type YearCard = {
  kind: string
  /** Plain label; "· since 19 Oct" is in it where the card covers part of the year. */
  heading: string
  big: string
  line: string
  /** Addresses of the art cache or the icon cache. */
  faces: string[]
  numbers: Record<string, unknown>
}
export type YearCounter = { label: string; value: number; since: string | null }
/**
 * What the Wrapped picture says (spec 6.4): the player by in-game name, AR and server alone, never the UID; the character of the
 * year; and 6 numbers, or 4 in a thin year, each with "since Apr" where it covers part of the year.
 */
export type YearPoster = {
  name: string
  ar: number | null
  server: string
  character: { name: string; picture: string | null } | null
  numbers: { label: string; value: string; since: string | null }[]
}
export type YearModel = {
  year: number
  so_far: boolean
  hero: { line: string; counters: YearCounter[]; character: { name: string; picture: string | null } | null }
  cards: YearCard[]
  poster: YearPoster
}
/** The years that have enough to tell, and the chosen one; both empty while there is nothing. */
export type YearAnswer = { years: number[]; /** The core's own year, the one still going. */ current_year: number; year: YearModel | null }

/** The groups of earned primogems, as the Ledger sorts them (ledger/reasons.py, GROUPS). */
export type SourceGroup = 'commissions' | 'welkin' | 'events' | 'endgame' | 'other'

/**
 * `GET /api/primogems` (views/primogems.py): what the Primogems widget draws besides the balance. `imported` is false until
 * the game's primogem log was read, and the other fields are then null; `today` and `week` are null while today is not known;
 * `month` is null while no day of it is known.
 */
export type PrimogemsModel = {
  imported: boolean
  read_at: string | null
  today: number | null
  week: number | null
  /** The last seven game days, today last. A day that is not `known` is not covered by the log or the diary: 0 there is not "none earned". */
  days: { day: string; earned: number; known: boolean }[] | null
  month: {
    ym: string
    name: string
    total: number
    sources: { group: SourceGroup; label: string; amount: number }[]
  } | null
}

/** One thing in `GET /api/next-up` (views/nextup.py): what is ready, or what happens at `at`. */
export type NextUpItem = {
  kind: 'timer' | 'resin' | 'expedition' | 'realm' | 'transformer' | 'daily' | 'weekly' | 'banner' | 'endgame' | 'event'
  name: string
  /** When it happens; for a ready item, when it became ready where that is known. */
  at: string | null
  ready: boolean
  /** How many things the row stands for: 3 expeditions that are back are one row. */
  count: number
  /** The endgame mode of an endgame row; null for any other. */
  mode: 'abyss' | 'theater' | 'stygian' | null
  /** The endgame mode's icon, as the Stats card has it (`/api/art/<key>`); null for any other row and until the cache has one. */
  icon: string | null
  /** When the wait began, for the styles that draw how far along it is; null where it cannot be known (an expedition's). */
  started_at: string | null
}

/** `GET /api/next-up`: the timeline, ready items first, then the rest by time; `ready` counts each ready thing. */
export type NextUpModel = { items: NextUpItem[]; ready: number }

/** One endgame mode in `GET /api/endgame-resets` (views/endgame_resets.py). */
export type ResetMode = {
  mode: 'abyss' | 'theater' | 'stygian'
  label: string
  short: string
  /** Played this cycle, as the last read tells; false for a stale mode. */
  played: boolean
  stars: number | null
  acts: number | null
  /** The acts of the season, where the read carries them; null otherwise. */
  acts_of: number | null
  difficulty: number | null
  /** When this cycle ends; null where the period ended since the read. */
  ends_at: string | null
  /** When the next season starts (the Stygian's, between seasons); null where unknown. */
  next_starts_at: string | null
  /** The period ended since the read: the result says nothing of the new cycle. */
  stale: boolean
  /** When this cycle began; null for a stale mode and for the Stygian once its season is over. */
  starts_at: string | null
  /** HoYoLAB's count of the Theater's medals, where the read carries it; null otherwise. */
  medals: number | null
  /** The mode's icon and picture as the Stats card has them (`/api/art/<key>`; the picture is null until the art cache keeps it) and the part of the picture to show. */
  header: { icon: string | null; picture: string | null; crop: [number, number, number, number] | null }
  /** HoYoLAB's medal, an address of the art cache: the Theater's mark once kept, and for the Stygian played this season the medal of its difficulty, the picture the Stats card draws; null for the Abyss and where there is none. */
  medal: string | null
}

/** `GET /api/endgame-resets`: the three modes in the order Abyss, Theater, Stygian, or none before any endgame read. */
export type EndgameResetsModel = { read_at: string | null; modes: ResetMode[]; not_played: number }

/** A face on a banner (`GET /api/calendar`): `icon` is the picture's address in the icon cache, null where the answer gave none. */
export type CalendarFace = { name: string; rarity: number; icon: string | null }

/** A banner of the calendar answer; `kind` is "character", "weapon" or "chronicled", `starts` and `ends` UTC ISO text or null. */
export type CalendarBanner = {
  id: string
  kind: string
  name: string
  starts: string | null
  ends: string | null
  faces: CalendarFace[]
}

/**
 * An event of the calendar answer. `soon` is an event the answer gives no dates ("Coming soon": no start, no end); `source` says
 * whose dates it has, HoYoLAB's or the Genshin Impact Wiki on Fandom's. `finished` is the player's own completion.
 */
export type CalendarEvent = {
  id: number | string | null
  name: string
  starts: string | null
  ends: string | null
  finished: boolean
  primogems: number | null
  explored: number | null
  double: { left: number; total: number } | null
  soon: boolean
  status: number
  source: string
}

/** `GET /api/calendar` (views/calendar.py): `read` is false until a read kept the calendar's board. */
export type CalendarModel = {
  read_at: string | null
  read: boolean
  banners: CalendarBanner[]
  events: CalendarEvent[]
  endgame: ResetMode[]
  /** The events started, not finished and ending after now. */
  left: number
  /** The wiki the upcoming dates came from, for the foot, where an event has them. */
  upcoming_from: string | null
}
