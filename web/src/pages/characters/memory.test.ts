import { beforeEach, expect, test } from 'vitest'
import fixture from '../../fixtures/characters/roster.json'
import type { Roster } from '../../types.ts'
import {
  forgetRoster, rosterMemory, rosterOrder, rosterOrderFor, saveRosterScroll, setRosterAccount, setRosterData, setRosterView, shareRoster, takeEntrance,
} from './memory.ts'
import { NO_FILTERS } from './rosterview.ts'

const roster = fixture as unknown as Roster
const copy = (): Roster => JSON.parse(JSON.stringify(roster)) as Roster

beforeEach(forgetRoster)

test('a new read of the roster keeps every card that did not change as the very same object, and the whole roster when nothing changed', () => {
  expect(shareRoster(null, roster)).toBe(roster)
  const same = shareRoster(roster, copy())
  expect(same).toBe(roster)
  const changed = copy()
  changed.entries[3] = { ...changed.entries[3], readiness: changed.entries[3].readiness + 1 }
  const next = shareRoster(roster, changed)
  expect(next).not.toBe(roster)
  expect(next.entries[3]).toBe(changed.entries[3])
  expect(next.entries.filter((entry, index) => entry === roster.entries[index])).toHaveLength(roster.entries.length - 1)
  expect(next.focus).toBe(roster.focus)
  expect(next.sync).toBe(roster.sync)
})

test('a character who came or left, or a focus that moved, is a change', () => {
  const fewer = copy()
  fewer.entries.pop()
  const next = shareRoster(roster, fewer)
  expect(next.entries).toHaveLength(roster.entries.length - 1)
  expect(next.entries[0]).toBe(roster.entries[0])
  const moved = copy()
  moved.focus = [...moved.focus].reverse()
  expect(shareRoster(roster, moved).focus).toEqual(moved.focus)
})

test('the window remembers the roster, the search, the filters, the sort and the scroll, for as long as it lives', () => {
  expect(rosterMemory().data).toBeNull()
  setRosterData(roster)
  setRosterView({ search: 'hydro', sort: 'name' })
  setRosterView({ filters: { ...NO_FILTERS, owned: true } })
  saveRosterScroll(640)
  const kept = rosterMemory()
  expect(kept.data).toBe(roster)
  expect(kept.view).toEqual({ search: 'hydro', filters: { ...NO_FILTERS, owned: true }, sort: 'name' })
  expect(kept.scroll).toBe(640)
})

test("a logout or another account forgets the roster and its place at once, so that no one else's characters show; the player's search stays", () => {
  setRosterAccount(700000001)
  setRosterData(roster)
  setRosterView({ search: 'hydro' })
  saveRosterScroll(640)
  setRosterAccount(700000001) // the same account: nothing goes
  expect(rosterMemory().data).toBe(roster)
  setRosterAccount(null) // logged out
  expect(rosterMemory().data).toBeNull()
  expect(rosterMemory().scroll).toBe(0)
  expect(rosterMemory().view.search).toBe('hydro')
  setRosterData(roster)
  setRosterAccount(700000002)
  expect(rosterMemory().data).toBeNull()
  expect(rosterOrderFor(rosterMemory(), 'sandrone')).toEqual([])
})

test('the first time the account is known nothing is forgotten: what was read before it was known is its own', () => {
  setRosterData(roster)
  saveRosterScroll(120)
  setRosterAccount(700000001)
  expect(rosterMemory().data).toBe(roster)
  expect(rosterMemory().scroll).toBe(120)
})

test('the entrance plays once after the window opens, and never again', () => {
  expect(takeEntrance()).toBe(true)
  expect(takeEntrance()).toBe(false)
  expect(takeEntrance()).toBe(false)
})

test("the order of the cards is the roster's as the player left it: the search, the filters and the sort", () => {
  expect(rosterOrder(rosterMemory())).toEqual([])
  setRosterData(roster)
  expect(rosterOrder(rosterMemory())[0]).toBe('sandrone')
  expect(rosterOrder(rosterMemory())).toHaveLength(16)
  setRosterView({ search: 'catalyst', sort: 'name' })
  expect(rosterOrder(rosterMemory())).toEqual(['columbina', 'lan-yan', 'lauma', 'nefer', 'odette'])
})

test("a character the search or the filters leave out still has neighbours: the roster's order as sorted, whole", () => {
  setRosterData(roster)
  setRosterView({ search: 'catalyst', sort: 'name' })
  expect(rosterOrderFor(rosterMemory(), 'odette')).toEqual(['columbina', 'lan-yan', 'lauma', 'nefer', 'odette'])
  const whole = rosterOrderFor(rosterMemory(), 'sandrone')
  expect(whole).toHaveLength(16)
  expect(whole.slice(0, 3)).toEqual(['aino', 'alyosha', 'columbina'])
  expect(rosterOrderFor(rosterMemory(), 'nobody')).toEqual(whole)
  forgetRoster()
  expect(rosterOrderFor(rosterMemory(), 'sandrone')).toEqual([])
})
