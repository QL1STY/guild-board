import { ago, duration, num, plural } from '../format.ts'
import type { Friend, FriendsModel, OnlineView, ShareKey, StatKey, Stats } from '../onlinetypes.ts'
import type { SignName } from '../ui/Sign.tsx'
import { field, figure, hoursText, priceLine } from './statvalues.ts'

/*
 * The words of the Friends pages (the online plan, Task B6; the online design, section 9), apart from their drawing. A
 * friend's numbers come from another player's PC and can be odd, so every figure here is read through statvalues.ts: what
 * cannot be shown is left out, and nothing here throws (decision 3 of the task).
 */

/** The keys a player can switch, Status first (cloud/__init__.py). */
export const SHARE_KEYS: readonly ShareKey[] = [
  'status', 'primogems', 'playtime', 'achievements', 'endgame', 'account', 'wishes', 'spending',
]
export const STAT_KEYS: readonly StatKey[] = SHARE_KEYS.slice(1) as StatKey[]
/** The stats beside a name when nothing is pinned, in this order, three at most (the online design, section 6). */
export const PIN_ORDER: readonly StatKey[] = ['primogems', 'playtime', 'endgame', 'achievements', 'account', 'wishes', 'spending']
export const MOST_PILLS = 3

/** How often the pages read the friends again while they are shown (the online design, section 7), in milliseconds. */
export const POLL_MS = 60_000

export function isStatKey(value: unknown): value is StatKey {
  return typeof value === 'string' && (STAT_KEYS as readonly string[]).includes(value)
}

export const SHARES_NOTHING = 'Shares nothing yet'

/** One stat beside a friend's name (mockup 1): the game's picture or the app's sign, the figure, and a short label. */
export type Chip = {
  key: StatKey
  sign: SignName
  /** The game's own picture, which falls back to the sign; null where the app's sign is all there is. */
  picture: string | null
  value: string
  label: string
  /** All of it in words, for the pointer and the screen reader: "36 Abyss". */
  title: string
}

const PRIMOGEM = '/api/icon/static.primogem'

type Made = Omit<Chip, 'key'>

function made(sign: SignName, value: string, label: string, picture: string | null = null): Made {
  return { sign, picture, value, label, title: `${value} ${label}` }
}

/** Each stat's chip, from the stat as it came: null where its figure is not one. */
const CHIPS: Record<StatKey, (stat: unknown) => Made | null> = {
  primogems: (stat) => {
    const now = figure(stat, 'now')
    return now === null ? null : { sign: 'gem', picture: PRIMOGEM, value: num(now), label: '', title: `${num(now)} primogems` }
  },
  playtime: (stat) => {
    const hours = figure(stat, 'week_hours')
    return hours === null ? null : made('clock', hoursText(hours), 'this week')
  },
  achievements: (stat) => {
    const ticked = figure(stat, 'ticked')
    return ticked === null ? null : made('cup', num(ticked), 'achievements')
  },
  endgame: (stat) => {
    const stars = figure(stat, 'abyss_stars')
    return stars === null ? null : made('star', num(stars), 'Abyss')
  },
  account: (stat) => {
    const days = figure(stat, 'days_active')
    return days === null ? null : made('compass', num(days), 'days active')
  },
  wishes: (stat) => {
    const pity = figure(stat, 'pity')
    return pity === null ? null : made('ring', num(pity), 'pity')
  },
  spending: (stat) => {
    const total = figure(stat, 'month_total')
    const price = total === null ? null : priceLine(total, field(stat, 'currency'))
    return price === null ? null : made('scroll', price, 'this month')
  },
}

/**
 * The chips beside a name: one for each of the pills, in their order, three at most. A pill whose stat is missing, or whose
 * figure is no figure, is left out. The same chips are the preview in Your profile, so a friend sees what the player sees.
 */
export function chipsOf(source: { pills: readonly unknown[]; stats: Stats }): Chip[] {
  const pills: unknown = source.pills
  if (!Array.isArray(pills)) return []
  const chips: Chip[] = []
  for (const key of pills) {
    if (!isStatKey(key) || chips.some((one) => one.key === key)) continue
    const chip = CHIPS[key](field(source.stats, key))
    if (chip !== null) chips.push({ key, ...chip })
    if (chips.length === MOST_PILLS) break
  }
  return chips
}

/**
 * The pills of a player's own list entry, as the core makes a friend's: their pins that they share, in the order pinned, or
 * with none the first three they share by the pin order. Each once, three at most.
 */
export function pillKeys(pins: readonly unknown[], shared: readonly unknown[]): StatKey[] {
  const have = shared.filter(isStatKey)
  const pinned = [...new Set(pins.filter(isStatKey).filter((key) => have.includes(key)))]
  const keys = pinned.length > 0 ? pinned : PIN_ORDER.filter((key) => have.includes(key))
  return keys.slice(0, MOST_PILLS)
}

function rankOf(friend: Pick<Friend, 'status'>): number {
  return friend.status === 'in_game' ? 0 : friend.status === 'open' ? 1 : 2
}

const textOf = (value: unknown): string => (typeof value === 'string' ? value : '')

/** The longest name the server allows (cloud/migrations/0001_accounts.sql, profiles_name_fits); a tag is four digits. */
const NAME_MOST = 20

/**
 * A name or a tag as the pages show it (audit M17). It comes from the online server, which can send anything, so what is
 * not text is empty, and the format characters go (Unicode's Cf: the bidi controls, which can turn the words after them
 * around, and the invisible ones). It is cut to the twenty characters the server allows, a character outside the BMP
 * counted once. The pages draw it inside <bdi>, so that a name in a right-to-left script does not move the words around it.
 */
export function nameText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return Array.from(value.replace(/\p{Cf}/gu, '')).slice(0, NAME_MOST).join('')
}

/**
 * The list's order: in game, then Guild Board open, then offline. A friend who hides their status is not called offline,
 * and sorts with those who are. Within a group by name, so that the list does not shuffle when it is read again.
 */
export function sortedFriends(friends: readonly Friend[]): Friend[] {
  const by = (a: unknown, b: unknown) => textOf(a).localeCompare(textOf(b), 'en', { sensitivity: 'base' })
  return [...friends].sort((a, b) => rankOf(a) - rankOf(b) || by(a.name, b.name) || by(a.tag, b.tag))
}

export type StatusLine = { tone: 'game' | 'open' | 'off' | 'none'; text: string; when: string }

/** An instant that may be ahead of the clock by this much is now, not a mistake. */
const SKEW_MINUTES = 5
/** A game that began longer ago than this is not told as a time. */
const LONGEST_GAME_MINUTES = 7 * 24 * 60

/**
 * The minutes from an instant to `now`, or null where the instant is no time at all ("infinity" is one), is ahead of the
 * clock by more than a little, or is older than `longest`.
 */
function elapsedMinutes(instant: unknown, now: Date, longest: number): number | null {
  if (typeof instant !== 'string') return null
  const at = Date.parse(instant)
  if (Number.isNaN(at)) return null
  const minutes = (now.getTime() - at) / 60_000
  return minutes < -SKEW_MINUTES || minutes > longest ? null : Math.max(0, minutes)
}

/** How long ago, in the words of the list: "just now", "3 min ago", "5 h ago", "2 days ago". */
export function agoText(seconds: number): string {
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return `${plural(Math.floor(hours / 24), 'day')} ago`
}

/**
 * What a friend is doing (mockup 1), from the core's clock: "In game for 42 min", "Guild Board open", "Offline 2 days ago".
 * A time that cannot be told is left out and the rest stays. A friend whose status is not shared has no line at all.
 */
export function statusLine(friend: Pick<Friend, 'status' | 'since' | 'last_seen'>, now: Date): StatusLine {
  switch (friend.status) {
    case 'in_game': {
      const minutes = elapsedMinutes(friend.since, now, LONGEST_GAME_MINUTES)
      return { tone: 'game', text: 'In game', when: minutes === null ? '' : `for ${duration(Math.floor(minutes))}` }
    }
    case 'open':
      return { tone: 'open', text: 'Guild Board open', when: '' }
    case 'offline': {
      const minutes = elapsedMinutes(friend.last_seen, now, Infinity)
      return { tone: 'off', text: 'Offline', when: minutes === null ? '' : agoText(minutes * 60) }
    }
    default:
      return { tone: 'none', text: '', when: '' }
  }
}

/** The whole line in one string. */
export function statusText(line: StatusLine): string {
  return [line.text, line.when].filter((part) => part !== '').join(' ')
}

/** The tab on a picture: "AR 58", or null for a rank that cannot be one (a friend's PC can send a negative number). */
export function arText(ar: unknown): string | null {
  return typeof ar === 'number' && Number.isInteger(ar) && ar >= 1 && ar <= 99 ? `AR ${ar}` : null
}

/** A Genshin UID as text, or null where it is not a plain whole number. */
export function uidText(uid: unknown): string | null {
  return typeof uid === 'number' && Number.isSafeInteger(uid) && uid > 0 && uid < 1e12 ? String(uid) : null
}

/** Whether Compare opens on a friend, and when it does not, why (it is on while the two of you share a stat). */
export function compareState(friend: Pick<Friend, 'compare' | 'name'>): { enabled: boolean; tip: string | null } {
  if (friend.compare === true) return { enabled: true, tip: null }
  return { enabled: false, tip: `You and ${nameText(friend.name)} share no stat in common yet.` }
}

/** How many friends are in game and how many have Guild Board open, for the top bar. */
export function summaryOf(friends: readonly Pick<Friend, 'status'>[]): { inGame: number; open: number } {
  return {
    inGame: friends.filter((one) => one.status === 'in_game').length,
    open: friends.filter((one) => one.status === 'open').length,
  }
}

type Age = Pick<FriendsModel, 'stale' | 'read_at'>

const readable = (instant: string | null): instant is string => instant !== null && !Number.isNaN(Date.parse(instant))

/**
 * The mark on friends that could not be updated: this is their last known state, and when it was read. Null for what is new.
 * After a lost session (`lost`) nothing is tried again until the player signs in, so it says that the session ended instead.
 */
export function staleText(model: Age, now: Date, lost = false): string | null {
  if (lost) {
    return readable(model.read_at)
      ? `Your online session has ended. This is your friends' last known state, read ${ago(model.read_at, now)}.`
      : 'Your online session has ended, so your friends could not be read.'
  }
  if (!model.stale) return null
  if (model.read_at === null) return 'Friends could not be read yet. Guild Board tries again in a few minutes.'
  if (!readable(model.read_at)) return 'Friends could not be updated.'
  return `Friends could not be updated. This is their last known state, read ${ago(model.read_at, now)}.`
}

/**
 * The clock a friend's status is told by. A status that is old stands as it did when it was read: "In game for 42 min" does not
 * go on counting after the list stopped being read.
 */
export function clockOf(model: Age, now: Date): Date {
  return model.stale && readable(model.read_at) ? new Date(model.read_at) : now
}

/**
 * Whether the pages of a friend have something to show. After a lost session they do: friends show their last known state,
 * marked as old (the online design, section 5). A sign-out or a new sign-in leaves nothing behind for the next account.
 */
export function showsFriends(view: Pick<OnlineView, 'state'>): boolean {
  return view.state === 'signed_in' || view.state === 'sign_in_again'
}

/**
 * What a page of Friends says in place of itself while it has nothing to show, or null when the player is signed in. Your
 * profile says it after a lost session too: none of its switches could change. Each comes with a link to Settings.
 */
export function gateText(view: Pick<OnlineView, 'state'>): string | null {
  switch (view.state) {
    case 'signed_out':
      return 'Sign in with Discord to add friends and compare your stats with theirs.'
    case 'waiting':
      return 'Finish signing in in your browser, then come back.'
    case 'sign_in_again':
      return 'Your online session has ended. Sign in again in Settings.'
    case 'signed_in':
      return null
  }
}
