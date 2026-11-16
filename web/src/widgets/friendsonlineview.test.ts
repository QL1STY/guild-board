import { describe, expect, it } from 'vitest'
import type { Friend } from '../onlinetypes.ts'
import { clockOf } from '../pages/friendsview.ts'
import { gateLine, lineOf, metaOf, orderedFriends, rowOf } from './friendsonlineview.ts'

const NOW = new Date('2026-11-11T12:00:00Z')
const minutesAgo = (minutes: number): string => new Date(NOW.getTime() - minutes * 60_000).toISOString()

function friend(name: string, status: Friend['status'], when: { since?: string | null; seen?: string | null } = {}): Friend {
  return {
    user_id: `id-${name}`, name, tag: '0001', has_picture: false, ar: 50, uid: null, status,
    since: when.since ?? null, last_seen: when.seen ?? null, stats: {}, pills: [], compare: false,
  }
}

const riley = friend('Riley', 'in_game', { since: minutesAgo(42) })
const kira = friend('Kira', 'offline', { seen: minutesAgo(180) })
const milo = friend('Milo', 'offline', { seen: minutesAgo(2 * 24 * 60) })

describe('the order of the rows', () => {
  it('puts those in game first, the longest in game first, then the rest by last seen, newest first', () => {
    const early = friend('Early', 'in_game', { since: minutesAgo(300) })
    const order = orderedFriends([milo, kira, riley, early])
    expect(order.map((one) => one.name)).toEqual(['Early', 'Riley', 'Kira', 'Milo'])
  })

  it('leaves a friend whose time cannot be read after those whose time can, and by name among themselves', () => {
    const odd = friend('Odd', 'in_game', { since: 'not a time' })
    const hidden = friend('Hidden', null)
    const order = orderedFriends([hidden, odd, milo, riley, friend('Abel', null)])
    expect(order.map((one) => one.name)).toEqual(['Riley', 'Odd', 'Milo', 'Abel', 'Hidden'])
  })

  it('does not change the list it is given', () => {
    const given = [milo, riley]
    orderedFriends(given)
    expect(given.map((one) => one.name)).toEqual(['Milo', 'Riley'])
  })
})

describe('the line at one cell tall', () => {
  it('names the one in game, with how long and how many are offline', () => {
    expect(lineOf([riley, kira, milo], NOW)).toMatchObject({
      title: 'Riley is in game', detail: 'for 42 min · 2 friends offline', who: riley,
    })
  })

  it('says one friend offline in the singular, and nothing of offline when none is', () => {
    expect(lineOf([riley, kira], NOW).detail).toBe('for 42 min · 1 friend offline')
    expect(lineOf([riley], NOW).detail).toBe('for 42 min')
  })

  it('names two, and says how many more past two', () => {
    const kai = friend('Kai', 'in_game', { since: minutesAgo(10) })
    expect(lineOf([riley, kai, milo], NOW)).toMatchObject({ title: 'Riley and Kai are in game', detail: '1 friend offline', who: null })
    const third = friend('Zed', 'in_game', { since: minutesAgo(5) })
    expect(lineOf([riley, kai, third], NOW)).toMatchObject({ title: 'Riley and 2 more are in game', detail: null })
  })

  it('says no friends in game, with how many there are offline', () => {
    expect(lineOf([kira, milo], NOW)).toMatchObject({ title: 'No friends in game', detail: '2 friends offline', who: null })
  })

  it('says there are no friends yet, when there are none', () => {
    expect(lineOf([], NOW)).toMatchObject({ title: 'No friends yet', detail: null, who: null })
  })

  it('leaves out the time a game began at when it cannot be told, and does not call a friend who shares no status offline', () => {
    const odd = friend('Odd', 'in_game', { since: 'later' })
    expect(lineOf([odd, friend('Quiet', null)], NOW).detail).toBeNull()
  })

  it('draws a name as nameText does: the format characters go', () => {
    expect(lineOf([friend('Ri‮ley', 'in_game', { since: minutesAgo(1) })], NOW).title).toBe('Riley is in game')
  })
})

describe('the heading', () => {
  it('counts those in game, and says nothing when none is', () => {
    expect(metaOf([riley, kira])).toBe('1 in game')
    expect(metaOf([riley, friend('Kai', 'in_game', { since: minutesAgo(3) }), kira])).toBe('2 in game')
    expect(metaOf([kira, milo])).toBeNull()
    expect(metaOf([])).toBeNull()
  })
})

describe('a row', () => {
  it("tells a friend's status with the words and the clock of the Friends page", () => {
    expect(rowOf(riley, NOW)).toMatchObject({ name: 'Riley', tone: 'game', text: 'In game', when: 'for 42 min', off: false })
    expect(rowOf(kira, NOW)).toMatchObject({ name: 'Kira', tone: 'off', text: 'Offline', when: '3 h ago', off: true })
    expect(rowOf(milo, NOW)).toMatchObject({ text: 'Offline', when: '2 days ago' })
  })

  it('tells it by the clock the Friends page uses: a list that is old stands as it was read', () => {
    const clock = clockOf({ stale: true, read_at: minutesAgo(60) }, NOW)
    const early = friend('Early', 'in_game', { since: minutesAgo(100) })
    expect(rowOf(early, clock).when).toBe('for 40 min') // not for 100: the list stopped being read an hour ago
    expect(rowOf(kira, clock).when).toBe('2 h ago')
  })

  it('has no status for a friend who shares none, and does not dim them as offline', () => {
    expect(rowOf(friend('Quiet', null), NOW)).toMatchObject({ tone: 'none', text: '', when: '', off: false })
  })

  it("goes to the friend's profile and takes the friend's picture only when there is one", () => {
    expect(rowOf(riley, NOW).picture).toBeNull()
    const pictured = { ...riley, has_picture: true }
    expect(rowOf(pictured, NOW).picture).toBe('/api/friends/id-Riley/picture')
    expect(rowOf(riley, NOW).user).toBe('id-Riley')
  })
})

describe('what it says while the player is not signed in', () => {
  it('points to Settings, where the sign-in is', () => {
    expect(gateLine({ state: 'signed_out' })).toBe('Sign in with Discord in Settings to see your friends.')
  })

  it('says to finish a sign-in that has begun', () => {
    expect(gateLine({ state: 'waiting' })).toBe('Finish signing in in your browser, then come back.')
  })

  it('says nothing once there are friends to show', () => {
    expect(gateLine({ state: 'signed_in' })).toBeNull()
    expect(gateLine({ state: 'sign_in_again' })).toBeNull()
  })
})
