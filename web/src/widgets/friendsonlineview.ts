import { plural } from '../format.ts'
import type { Friend, OnlineView } from '../onlinetypes.ts'
import { nameText, statusLine, type StatusLine } from '../pages/friendsview.ts'

/*
 * The words of the Friends online widget (the widgets and Friends design, 2.5), apart from its drawing. A friend's name and
 * times come from another player's PC, so they are read as the Friends page reads them (nameText, statusLine): what cannot be
 * told is left out, and nothing here throws. The clock is the one the Friends page tells by (clockOf), given in.
 */

const isInGame = (friend: Pick<Friend, 'status'>): boolean => friend.status === 'in_game'

/** A friend who shares their status and is not in game: "not_in_game" is only the player's own, but is counted if it comes. */
const isOffline = (friend: Pick<Friend, 'status'>): boolean => friend.status === 'offline' || friend.status === 'not_in_game'

/** The instant as milliseconds, or null where it is no time at all. */
function atOf(instant: unknown): number | null {
  if (typeof instant !== 'string') return null
  const at = Date.parse(instant)
  return Number.isNaN(at) ? null : at
}

const byName = (a: Friend, b: Friend): number => nameText(a.name).localeCompare(nameText(b.name), 'en', { sensitivity: 'base' })

/**
 * The rows' order: those in game first, the longest in game first (the earliest start), then the rest by when they were last
 * seen, the newest first. A time that cannot be told comes after the ones that can, and ties go by name, so that the rows do not
 * shuffle when the list is read again.
 */
export function orderedFriends(friends: readonly Friend[]): Friend[] {
  const early = (a: Friend, b: Friend): number => {
    const [one, other] = [atOf(a.since), atOf(b.since)]
    if (one === null || other === null) return one === other ? 0 : one === null ? 1 : -1
    return one - other
  }
  const recent = (a: Friend, b: Friend): number => {
    const [one, other] = [atOf(a.last_seen), atOf(b.last_seen)]
    if (one === null || other === null) return one === other ? 0 : one === null ? 1 : -1
    return other - one
  }
  return [...friends].sort((a, b) => {
    if (isInGame(a) !== isInGame(b)) return isInGame(a) ? -1 : 1
    return (isInGame(a) ? early(a, b) : recent(a, b)) || byName(a, b)
  })
}

/** The widget's heading at its right: "1 in game", or nothing where no friend is. */
export function metaOf(friends: readonly Pick<Friend, 'status'>[]): string | null {
  const inGame = friends.filter(isInGame).length
  return inGame === 0 ? null : `${inGame} in game`
}

export type Line = {
  title: string
  /** The second line; null where there is nothing to add. */
  detail: string | null
  /** The one friend the line is about, for the link to their profile; null for none or for several. */
  who: Friend | null
}

/**
 * The line at one cell tall: "Riley is in game" with "for 42 min · 2 friends offline"; "Riley and Kira are in game"; or "No
 * friends in game". How many are offline counts those who share their status and are not in game.
 */
export function lineOf(friends: readonly Friend[], now: Date): Line {
  const here = orderedFriends(friends).filter(isInGame)
  const away = friends.filter(isOffline).length
  const awayText = away === 0 ? null : `${plural(away, 'friend')} offline`
  if (friends.length === 0) return { title: 'No friends yet', detail: null, who: null }
  if (here.length === 0) return { title: 'No friends in game', detail: awayText, who: null }
  const names = here.map((one) => nameText(one.name))
  if (here.length === 1) {
    const when = statusLine(here[0], now).when
    const detail = [when, awayText].filter((part) => part !== null && part !== '').join(' · ')
    return { title: `${names[0]} is in game`, detail: detail === '' ? null : detail, who: here[0] }
  }
  const title = here.length === 2 ? `${names[0]} and ${names[1]} are in game` : `${names[0]} and ${here.length - 1} more are in game`
  return { title, detail: awayText, who: null }
}

export type Row = {
  user: string
  name: string
  /** The friend's picture, or null where they have none and the sign shows. */
  picture: string | null
  tone: StatusLine['tone']
  /** "In game" or "Offline"; empty for a friend who shares no status. */
  text: string
  /** "for 42 min" or "3 h ago"; empty where it cannot be told. */
  when: string
  /** Dimmed: offline. */
  off: boolean
}

/** A friend's row, told by `now`, which is the clock the Friends page uses (clockOf). */
export function rowOf(friend: Friend, now: Date): Row {
  const line = statusLine(friend, now)
  return {
    user: friend.user_id,
    name: nameText(friend.name),
    picture: friend.has_picture === true ? `/api/friends/${encodeURIComponent(friend.user_id)}/picture` : null,
    tone: line.tone,
    text: line.text,
    when: line.when,
    off: friend.status === 'offline' || friend.status === 'not_in_game',
  }
}

/** What the widget says while there is nothing to show, or null once the player is signed in (or must sign in again: the friends stay). */
export function gateLine(view: Pick<OnlineView, 'state'>): string | null {
  switch (view.state) {
    case 'signed_out':
      return 'Sign in with Discord in Settings to see your friends.'
    case 'waiting':
      return 'Finish signing in in your browser, then come back.'
    default:
      return null
  }
}
