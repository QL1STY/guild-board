import { num, plural } from '../format.ts'
import type { FriendStatus, ShareKey, StatKey, Stats, YourProfile } from '../onlinetypes.ts'
import { SERVER_NAMES } from '../widgets/widgetview.ts'
import { type Chip, chipsOf, pillKeys, SHARE_KEYS, STAT_KEYS, uidText } from './friendsview.ts'
import { field, figure, FULL_MONTHS, hoursFigure, isRecord, monthParts, monthsOf, moneyText } from './statvalues.ts'

/*
 * The words of Your profile and of a friend's (the online plan, Task B7; the online design, sections 6 and 9, mockup 2), apart
 * from their drawing. What a friend shares comes from another player's PC, so every figure is read through statvalues.ts:
 * a tile that cannot be shown is a dash for the player and is left out for a friend, and nothing here throws.
 */

export const TILE_NAMES: Record<ShareKey, string> = {
  status: 'Status',
  primogems: 'Primogems',
  playtime: 'Play time',
  achievements: 'Achievements',
  endgame: 'Endgame',
  account: 'Account',
  wishes: 'Wishes',
  spending: 'Spending',
}

/** What a tile that is switched off says in place of its words: it stays on this PC. */
export const ONLY_YOU = 'Only you'

const DASH = '—'
const UNKNOWN = 'Not known yet'

/** One tile of the grid: its name, a figure with its unit, and a line under it. */
export type Tile = {
  key: ShareKey
  name: string
  value: string
  unit: string
  detail: string
  /** Whether the figure is one; a tile whose figure is not shows a dash. */
  known: boolean
}

/** What a tile is made from: the stats, and for Status what the player is doing. `own` is the player's own PC. */
export type TileContext = { stats: Stats; status: FriendStatus; own: boolean }

function tile(key: ShareKey, value: string | null, unit: string, detail: string): Tile {
  const name = TILE_NAMES[key]
  if (value === null) return { key, name, value: DASH, unit: '', detail: detail === '' ? UNKNOWN : detail, known: false }
  return { key, name, value, unit, detail, known: true }
}

const joined = (parts: readonly (string | null)[]): string => parts.filter((part): part is string => part !== null).join(', ')

/** Each tile's words, from the stat as the contract has it. `detail` is the line a friend reads. */
const TILES: Record<StatKey, (stat: unknown, own: boolean) => Tile> = {
  primogems: (stat) => {
    const now = figure(stat, 'now')
    const last = monthsOf(stat).at(-1)
    const month = last === undefined ? null : monthParts(last.month)
    const earned = last?.earned ?? null
    const detail =
      now === null ? '' : earned !== null && month !== null ? `now, and ${num(earned)} earned in ${FULL_MONTHS[month.month - 1]}` : 'now'
    return tile('primogems', now === null ? null : num(now), '', detail)
  },
  playtime: (stat, own) => {
    const hours = figure(stat, 'week_hours')
    return tile('playtime', hours === null ? null : hoursFigure(hours), 'h', own ? 'this week, from this PC' : 'this week')
  },
  achievements: (stat) => {
    const ticked = figure(stat, 'ticked')
    const total = figure(stat, 'total')
    return tile('achievements', ticked === null ? null : num(ticked), total === null ? '' : `of ${num(total)}`, 'ticked in Guild Board')
  },
  endgame: (stat) => {
    const abyss = figure(stat, 'abyss_stars')
    const theater = figure(stat, 'theater_act')
    const stygian = figure(stat, 'stygian')
    const detail = joined([
      abyss === null ? null : 'Abyss',
      theater === null ? null : `Theater Act ${num(theater)}`,
      stygian === null ? null : `Stygian ${num(stygian)}`,
    ])
    return tile('endgame', abyss === null ? null : num(abyss), abyss === 1 ? 'star' : 'stars', detail)
  },
  account: (stat) => {
    const days = figure(stat, 'days_active')
    const characters = figure(stat, 'characters')
    const withCharacters = characters === null ? null : `with ${plural(characters, 'character')}`
    const detail = days === null ? (withCharacters ?? '') : joined(['active', withCharacters])
    return tile('account', days === null ? null : num(days), days === 1 ? 'day' : 'days', detail)
  },
  wishes: (stat) => {
    const pity = figure(stat, 'pity')
    const five = figure(stat, 'five_stars_90d')
    const lately = five === null ? null : `${plural(five, 'five-star')} in 90 days`
    const detail = pity === null ? (lately ?? '') : joined(['on the character banner', lately])
    return tile('wishes', pity === null ? null : num(pity), 'pity', detail)
  },
  spending: (stat) => {
    const total = figure(stat, 'month_total')
    const price = total === null ? null : moneyText(total, field(stat, 'currency'))
    return tile('spending', price === null ? null : `${price.before}${price.figure}`, price === null ? '' : price.after, 'spent this month, estimated')
  },
}

const DOING: Record<NonNullable<FriendStatus>, string> = { in_game: 'In game', not_in_game: 'Not in game', offline: 'Offline' }

/** One tile, from what it is made of. */
export function tileOf(key: ShareKey, context: TileContext): Tile {
  if (key === 'status') {
    const doing = context.status === null ? null : (DOING[context.status] ?? null)
    return tile('status', doing, '', 'and when you were last seen')
  }
  return TILES[key](field(context.stats, key), context.own)
}

/** The line under a tile's figure: its words while it is on, and that it stays on this PC while it is off. */
export function detailOf(item: Pick<Tile, 'detail'>, on: boolean): string {
  return on ? item.detail : ONLY_YOU
}

/**
 * The tiles of a friend's profile: the stats they share, in the order of the switches, each read-only. A stat that holds no
 * figure that can be shown is left out, and a friend who shares none has no tiles.
 */
export function tilesOfFriend(stats: Stats): Tile[] {
  if (!isRecord(stats)) return []
  return STAT_KEYS.filter((key) => isRecord(stats[key]))
    .map((key) => tileOf(key, { stats, status: null, own: false }))
    .filter((one) => one.known)
}

export const PIN_LIMIT = 'You can pin three stats at most.'
export const PIN_NOT_SHARED = 'Only a stat you share can be pinned.'
export const PIN_STATUS = 'Status always shows beside your name, so it has no pin.'

/**
 * The pins after a press on a tile's pin: a pinned stat is unpinned, and one that is shared is pinned after those before
 * it. Status has no pin, a stat that is off cannot be pinned, and a fourth is refused with the core's own sentence.
 */
export function pinsAfter(
  pins: readonly StatKey[],
  key: ShareKey,
  sharing: readonly ShareKey[],
): { pins: StatKey[] } | { refused: string } {
  if (key === 'status') return { refused: PIN_STATUS }
  if (pins.includes(key)) return { pins: pins.filter((pinned) => pinned !== key) }
  if (!sharing.includes(key)) return { refused: PIN_NOT_SHARED }
  if (pins.length >= 3) return { refused: PIN_LIMIT }
  return { pins: [...pins, key] }
}

/** The pins that are left when the switches are as `sharing` says: a stat that goes off takes its pin with it. */
export function pinsKept(pins: readonly StatKey[], sharing: readonly ShareKey[]): StatKey[] {
  return pins.filter((pin) => sharing.includes(pin))
}

/** The switches after a press on one: it turns on or off, and the keys stay in the order of the tiles. */
export function sharingAfter(sharing: readonly ShareKey[], key: ShareKey): ShareKey[] {
  const on = new Set(sharing)
  if (on.has(key)) on.delete(key)
  else on.add(key)
  return SHARE_KEYS.filter((one) => on.has(one))
}

/** What friends read beside the player's name on their lists: the same chips a row of Friends has, from the player's pins. */
export function previewOf(profile: Pick<YourProfile, 'sharing' | 'pins' | 'stats'>): Chip[] {
  return chipsOf({ pills: pillKeys(profile.pins, profile.sharing), stats: profile.stats })
}

/**
 * The line under the player's name: the server and the UID, as the HoYoLAB login gave it. It says "checked with your HoYoLAB
 * login" and nothing stronger: Guild Board takes the UID from that login, and HoYoverse does not vouch for it to anyone else.
 */
export function headerLine(server: string, uid: number | null): string {
  const place = server === '' ? null : (SERVER_NAMES.get(server) ?? server)
  const id = uidText(uid)
  const sentence = id === null ? 'UID not known yet.' : `UID ${id}, checked with your HoYoLAB login.`
  return place === null ? sentence : `${place}. ${sentence}`
}
