/** The shapes of the online account's local API (the online plan, Contracts). They mirror src/guildboard/cloud/service.py. */

export type OnlineState = 'signed_out' | 'waiting' | 'signed_in' | 'sign_in_again'

export type OnlineView = {
  state: OnlineState
  name: string | null
  tag: string | null
  /** The last request found the server away. Everything local goes on as it was. */
  offline: boolean
  /** The core's own sentence about the last thing that did not work, or why sync is held back: the account holds another game account's data. */
  message: string | null
  /** Who an invite link that was opened comes from. Nothing is sent until the player presses Send request. */
  invite: { name: string; tag: string; has_picture: boolean; ar: number | null } | null
  /**
   * The player's own data on the account (the online plan, Part C): whether Sync my data is on, when the last sync was, and whether
   * the first sync waits for the player to choose which data to keep. Null unless signed in.
   */
  sync: { on: boolean; last_at: string | null; needs_choice: boolean } | null
  /**
   * How much room the copy of the player's data takes on the account, as the server counts it (sync_usage): rows and bytes held
   * against what one account may hold, whether this account holds a place for its copy, and whether no place is free for anyone.
   * Null until the core has read it, which it does after a sync that moved rows, or when the project has no such function yet.
   */
  usage: {
    rows_held: number; rows_limit: number; bytes_held: number; bytes_limit: number; has_place: boolean; seats_full: boolean
  } | null
}

export type StatKey = 'primogems' | 'playtime' | 'achievements' | 'endgame' | 'account' | 'wishes' | 'spending'
export type ShareKey = 'status' | StatKey

/**
 * What each stat holds. Any number is null while the PC that shares it doesn't know it, and a null is left out of Compare.
 * `week_start` is the Monday of the last of the six weeks, and `month` the month of the total. The core ages a friend's
 * against its own day each time it reads them: a friend whose Guild Board last uploaded in an earlier week has no week_hours
 * or days30_hours, with the weeks moved along to end with this one, and an earlier month's month_total is null.
 */
export type StatValues = {
  primogems: { now: number | null; months: { month: string; earned: number | null }[] }
  playtime: {
    week_hours: number | null; days30_hours: number | null; weeks: (number | null)[]; week_start: string; longest_run: number | null
  }
  achievements: { ticked: number | null; total: number | null }
  endgame: { abyss_stars: number | null; theater_act: number | null; stygian: number | null }
  account: { days_active: number | null; characters: number | null; chests: number | null }
  wishes: { pity: number | null; five_stars_90d: number | null }
  spending: { month_total: number | null; month: string; currency: string }
}
export type Stats = Partial<StatValues>

/**
 * null for a friend who doesn't share Status: they are not called offline, and sort with those who are. `not_in_game` is
 * only the player's own status, on their profile and in Compare: a friend is in game or offline, and nothing says when a
 * PC is on or Guild Board is open.
 */
export type FriendStatus = 'in_game' | 'not_in_game' | 'offline' | null

export type Card = { user_id: string; name: string; tag: string; has_picture: boolean; ar: number | null }

export type Friend = Card & {
  uid: number | null
  status: FriendStatus
  /** When the state began; null while offline. */
  since: string | null
  last_seen: string | null
  stats: Stats
  /** The pins, or the first three by PIN_ORDER. */
  pills: StatKey[]
  compare: boolean
}

export type FriendsModel = {
  me: { name: string; tag: string }
  friends: Friend[]
  incoming: Card[]
  outgoing: Card[]
  read_at: string | null
  /** The last read failed, and this is the one before. */
  stale: boolean
}

export type FriendProfile = {
  friend: Friend
  read_at: string | null
  /** As in FriendsModel: this is the friend as last read. */
  stale: boolean
}

export type YourProfile = {
  name: string
  tag: string
  uid: number | null
  server: string
  status: FriendStatus
  since: string | null
  find_by_uid: boolean
  sharing: ShareKey[]
  pins: StatKey[]
  /** This PC's own, also for the tiles that are off. */
  stats: Stats
}

export type CompareModel = {
  me: Card & { status: FriendStatus; since: string | null }
  friend: Friend
  keys: StatKey[]
  mine: Stats
  /** The Monday this game week began on, by the server's reset. A stat's weeks hold no dates: the chart is named from this. */
  week_start: string
  read_at: string | null
  /** As in FriendsModel: this is the friend as last read. */
  stale: boolean
}
