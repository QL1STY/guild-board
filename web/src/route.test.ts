import { expect, test } from 'vitest'
import { hashOf, hashOfPlace, PAGE_TITLES, pageOf, placeOfHash, routeOf, type Route } from './route.ts'

test('the address names the page', () => {
  expect(pageOf('#/achievements')).toBe('achievements')
  expect(pageOf('#/stats')).toBe('stats')
  expect(pageOf('#/settings')).toBe('settings')
  expect(pageOf('#settings')).toBe('settings')
  expect(pageOf('#/stats?range=7')).toBe('stats')
  expect(pageOf('#/pulls')).toBe('pulls') // the Pulls plan, calls item 18
  expect(pageOf('#/map')).toBe('map') // the Map design
  expect(pageOf('#/ledger')).toBe('ledger') // the ledger plan, Task 8
})

test('anything unknown is the Board, which Guild Board opens on', () => {
  expect(pageOf('')).toBe('board')
  expect(pageOf('#/')).toBe('board')
  expect(pageOf('#/nowhere')).toBe('board')
  expect(pageOf('#/board')).toBe('board')
  expect(pageOf('#/backlog')).toBe('backlog')
})

test('a page has one address', () => {
  expect(hashOf('stats')).toBe('#/stats')
  expect(pageOf(hashOf('settings'))).toBe('settings')
  expect(hashOf('pulls')).toBe('#/pulls')
  expect(pageOf(hashOf('pulls'))).toBe('pulls')
})

test('the Pulls page has its title', () => {
  expect(PAGE_TITLES.pulls).toBe('Pulls')
  expect(PAGE_TITLES.ledger).toBe('Ledger')
})

test("the Achievements page's special categories have addresses of their own", () => {
  expect(placeOfHash('#/achievements/timers')).toBe('timers')
  expect(placeOfHash('#/achievements/commissions')).toBe('commissions')
  expect(placeOfHash('#achievements/timers')).toBe('timers')
  expect(pageOf('#/achievements/timers')).toBe('achievements') // on the Achievements page
  // Anything else names none.
  expect(placeOfHash('#/achievements')).toBeNull()
  expect(placeOfHash('#/achievements/pinned')).toBeNull()
  expect(placeOfHash('#/achievements/timers/1')).toBeNull()
  expect(placeOfHash('#/timers')).toBeNull()
  expect(placeOfHash('#/stats')).toBeNull()
  expect(placeOfHash('')).toBeNull()
})

test('a special category has one address, and the rest of the Achievements page the page\'s own', () => {
  expect(hashOfPlace('timers')).toBe('#/achievements/timers')
  expect(placeOfHash(hashOfPlace('commissions'))).toBe('commissions')
  expect(hashOfPlace(null)).toBe('#/achievements')
  expect(placeOfHash(hashOfPlace(null))).toBeNull()
})

// The Characters plan, Task U1: five addresses on two pages.
test('the Characters pages and Your week are pages of the rail', () => {
  expect(pageOf('#/characters')).toBe('characters')
  expect(pageOf('#/characters/endgame')).toBe('characters')
  expect(pageOf('#/characters/sandrone')).toBe('characters')
  expect(pageOf('#/characters/sandrone/plan')).toBe('characters')
  expect(pageOf('#/week')).toBe('week')
  expect(PAGE_TITLES.characters).toBe('Characters')
  expect(PAGE_TITLES.week).toBe('Your week')
  expect(hashOf('characters')).toBe('#/characters')
  expect(hashOf('week')).toBe('#/week')
})

test('each Characters address names its view, and the character it is about', () => {
  expect(routeOf('#/characters')).toEqual({ page: 'characters', view: 'roster' })
  expect(routeOf('#/characters/')).toEqual({ page: 'characters', view: 'roster' })
  expect(routeOf('#/characters/endgame')).toEqual({ page: 'characters', view: 'endgame' })
  expect(routeOf('#/characters/sandrone')).toEqual({ page: 'characters', view: 'profile', key: 'sandrone' })
  expect(routeOf('#/characters/lan-yan/plan')).toEqual({ page: 'characters', view: 'plan', key: 'lan-yan' })
  expect(routeOf('#characters/lan-yan')).toEqual({ page: 'characters', view: 'profile', key: 'lan-yan' })
  expect(routeOf('#/characters/sandrone?pane=story')).toEqual({ page: 'characters', view: 'profile', key: 'sandrone' })
  expect(routeOf('#/week')).toEqual({ page: 'week' })
  expect(routeOf('#/stats')).toEqual({ page: 'stats' })
  expect(routeOf('')).toEqual({ page: 'board' })
})

test('an address that is not one of the five is the roster, never a page that is not there', () => {
  expect(routeOf('#/characters/sandrone/talents')).toEqual({ page: 'characters', view: 'roster' })
  expect(routeOf('#/characters/endgame/plan')).toEqual({ page: 'characters', view: 'roster' })
  expect(routeOf('#/characters/Not A Slug')).toEqual({ page: 'characters', view: 'roster' })
  expect(routeOf('#/characters/a/plan/more')).toEqual({ page: 'characters', view: 'roster' })
})

test('every route round-trips through its address, and a page still has the address it had', () => {
  const routes: Route[] = [
    { page: 'characters', view: 'roster' },
    { page: 'characters', view: 'endgame' },
    { page: 'characters', view: 'profile', key: 'sandrone' },
    { page: 'characters', view: 'plan', key: 'lan-yan' },
    { page: 'week' },
    { page: 'board' },
    { page: 'ledger' },
  ]
  for (const route of routes) expect(routeOf(hashOf(route)), hashOf(route)).toEqual(route)
  expect(hashOf({ page: 'characters', view: 'roster' })).toBe('#/characters')
  expect(hashOf({ page: 'characters', view: 'endgame' })).toBe('#/characters/endgame')
  expect(hashOf({ page: 'characters', view: 'profile', key: 'sandrone' })).toBe('#/characters/sandrone')
  expect(hashOf({ page: 'characters', view: 'plan', key: 'sandrone' })).toBe('#/characters/sandrone/plan')
  expect(hashOf('stats')).toBe('#/stats')
})

// The online plan, Task B6: Friends is a page of the rail, with a place for Your profile, for a friend's profile and for Compare.
const RILEY = '00000000-0000-4000-8000-000000007687'

test('Friends is a page of the rail, with its title and its address', () => {
  expect(pageOf('#/friends')).toBe('friends')
  expect(pageOf('#/friends/me')).toBe('friends')
  expect(pageOf(`#/friends/${RILEY}/compare`)).toBe('friends')
  expect(PAGE_TITLES.friends).toBe('Friends')
  expect(hashOf('friends')).toBe('#/friends')
})

test('each address of Friends names its view, and the friend it is about', () => {
  expect(routeOf('#/friends')).toEqual({ page: 'friends', view: 'list' })
  expect(routeOf('#/friends/')).toEqual({ page: 'friends', view: 'list' })
  expect(routeOf('#/friends/me')).toEqual({ page: 'friends', view: 'me' })
  expect(routeOf(`#/friends/${RILEY}`)).toEqual({ page: 'friends', view: 'friend', user: RILEY })
  expect(routeOf(`#/friends/${RILEY}/compare`)).toEqual({ page: 'friends', view: 'compare', user: RILEY })
  expect(routeOf(`#friends/${RILEY}?x=1`)).toEqual({ page: 'friends', view: 'friend', user: RILEY })
})

test('an address of Friends that is not one of the four is the list, never a page that is not there', () => {
  expect(routeOf('#/friends/me/compare')).toEqual({ page: 'friends', view: 'list' })
  expect(routeOf('#/friends/someone')).toEqual({ page: 'friends', view: 'list' })
  expect(routeOf('#/friends/abcdef12-0000-4000-8000-00000000abcd')).toEqual({
    page: 'friends',
    view: 'friend',
    user: 'abcdef12-0000-4000-8000-00000000abcd',
  })
  expect(routeOf('#/friends/ABCDEF12-0000-4000-8000-00000000ABCD')).toEqual({ page: 'friends', view: 'list' }) // the core takes lower case
  expect(routeOf(`#/friends/${RILEY}/profile`)).toEqual({ page: 'friends', view: 'list' })
  expect(routeOf(`#/friends/${RILEY}/compare/more`)).toEqual({ page: 'friends', view: 'list' })
  expect(routeOf(`#/friends/${RILEY}x`)).toEqual({ page: 'friends', view: 'list' })
  expect(routeOf('#/friends/../settings')).toEqual({ page: 'friends', view: 'list' })
})

test('every route of Friends round-trips through its address', () => {
  const routes: Route[] = [
    { page: 'friends', view: 'list' },
    { page: 'friends', view: 'me' },
    { page: 'friends', view: 'friend', user: RILEY },
    { page: 'friends', view: 'compare', user: RILEY },
  ]
  for (const route of routes) expect(routeOf(hashOf(route)), hashOf(route)).toEqual(route)
  expect(hashOf({ page: 'friends', view: 'me' })).toBe('#/friends/me')
  expect(hashOf({ page: 'friends', view: 'friend', user: RILEY })).toBe(`#/friends/${RILEY}`)
  expect(hashOf({ page: 'friends', view: 'compare', user: RILEY })).toBe(`#/friends/${RILEY}/compare`)
})
