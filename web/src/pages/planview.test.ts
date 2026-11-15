import { describe, expect, it } from 'vitest'
import fixture from '../fixtures/characters/plan.json'
import type { PlanModel } from '../types.ts'
import {
  bossLine, dayName, idleCards, idleEmpty, nextLine, NOT_READ, notReadNote, searchAddable, summaryLine, tagsOf, turnsLine, weaponSub, weaponLine,
  withKey, withoutKey,
} from './planview.ts'

const plan = fixture as unknown as PlanModel
const row = (key: string) => plan.rows.find((one) => one.key === key)!

describe('the day and its line', () => {
  it('names the weekday from Monday, 0', () => {
    expect([0, 3, 6].map(dayName)).toEqual(['Monday', 'Thursday', 'Sunday'])
  })

  it('says the date, and how many characters are in the plan', () => {
    expect(summaryLine(plan)).toBe('11 November · 4 characters in the plan')
    expect(summaryLine({ ...plan, count: 1 })).toBe('11 November · 1 character in the plan')
    expect(summaryLine({ ...plan, count: 0 })).toBe('11 November · nobody in the plan yet')
  })

  it("says the time to the next 04:00 from the core's time, never the browser's", () => {
    expect(turnsLine(plan.turns_at, new Date('2026-11-11T13:40:00+00:00'))).toBe('Domains change at 04:00 server time, in 13 h 20 min')
    expect(turnsLine(plan.turns_at, new Date('2026-11-12T02:59:30+00:00'))).toBe('Domains change at 04:00 server time, in 1 min')
    expect(turnsLine(plan.turns_at, new Date('2026-11-12T03:00:00+00:00'))).toBe('Domains change at 04:00 server time, in 0 min')
    expect(turnsLine(plan.turns_at, new Date('2026-11-12T05:00:00+00:00'))).toBe('Domains change at 04:00 server time, in 0 min')
  })
})

describe('a character who is idle today', () => {
  it('names the next day of her book and of her weapon material', () => {
    expect(nextLine({ book_next: 5, weapon_next: 1 })).toBe('Book on Saturday · weapon on Tuesday')
  })

  it('says what is not read yet, and never guesses a day', () => {
    expect(nextLine({ book_next: 3, weapon_next: null })).toBe('Book on Thursday · weapon material not read yet')
    expect(nextLine({ book_next: null, weapon_next: null })).toBe('Not read from the wiki yet')
  })

  it('lists only the characters whose days are known, and counts those that are not read at all', () => {
    expect(idleCards(plan).map((one) => one.key)).toEqual(['neuvillette'])
    expect(idleCards({ ...plan, idle: [{ key: 'x', book_next: null, weapon_next: 2 }] }).map((one) => one.key)).toEqual(['x'])
  })

  it('says plainly why the card is empty: unread characters are not claimed to have nothing, and the rest have something open', () => {
    expect(idleEmpty(plan)).toBeNull() // there is a card to show
    const onlyUnread = { ...plan, idle: plan.idle.filter((one) => one.book_next === null) }
    expect(idleEmpty(onlyUnread)).toBe('2 planned characters are not read from the wiki yet.')
    expect(idleEmpty({ ...onlyUnread, idle: onlyUnread.idle.slice(0, 1) })).toBe('1 planned character is not read from the wiki yet.')
    expect(idleEmpty({ ...plan, idle: [] })).toBe('Every planned character has something open today.')
  })
})

describe('the week grid', () => {
  it('puts a book and a weapon material in the cell of each day they are open, Sunday holding both', () => {
    expect(tagsOf(row('sandrone'), 2).map((tag) => [tag.kind, tag.series])).toEqual([['book', 'Vagrancy'], ['weapon', 'Far-North Scions']])
    expect(tagsOf(row('neuvillette'), 3).map((tag) => [tag.kind, tag.series])).toEqual([['book', 'Equity']])
    expect(tagsOf(row('neuvillette'), 4).map((tag) => [tag.kind, tag.series])).toEqual([['weapon', 'Pure Sacred Dewdrop']])
    expect(tagsOf(row('neuvillette'), 6).map((tag) => [tag.kind, tag.series])).toEqual([['book', 'Equity'], ['weapon', 'Pure Sacred Dewdrop']])
    expect(tagsOf(row('sandrone'), 1)).toEqual([])
  })

  it('has no tag for what is not read from the wiki', () => {
    expect(tagsOf(row('odette'), 2)).toEqual([])
    expect(tagsOf(row('odette'), 6)).toEqual([])
  })

  it('says what a row is missing from the wiki in plain words, and says nothing of a weapon she has none of', () => {
    expect(NOT_READ).toBe('Not read from the wiki yet')
    expect(notReadNote(row('sandrone'))).toBeNull()
    expect(notReadNote(row('odette'))).toBe('Not read from the wiki yet')
    expect(notReadNote({ ...row('sandrone'), material: null })).toBe('Weapon material not read from the wiki yet')
    expect(notReadNote({ ...row('odette'), book: row('sandrone').book })).toBe('Weapon material not read from the wiki yet')
    expect(notReadNote({ ...row('jahoda'), book: row('sandrone').book })).toBeNull() // her book is read, and she has no weapon to read a material for
    expect(notReadNote(row('jahoda'))).toBe('Talent book not read from the wiki yet')
  })

  it('names the weapon, or says she has none', () => {
    expect(weaponLine(row('odette'))).toBe('Exaiphanes Blade')
    expect(weaponLine(row('jahoda'))).toBe('No weapon yet')
  })

  it("names the characters beside their weapons in a weapon material's line, so that no face stands alone", () => {
    expect(weaponSub('Sandrone', ['A Teaspoon of Transcendence'])).toBe('Sandrone · A Teaspoon of Transcendence')
    expect(weaponSub('Sandrone, Odette', ['A Teaspoon of Transcendence', 'Exaiphanes Blade'])).toBe('Sandrone, Odette · A Teaspoon of Transcendence, Exaiphanes Blade')
  })
})

describe('the weekly bosses line', () => {
  it('says the reset, and the discounted runs left when the Notes read gave them', () => {
    expect(bossLine(plan)).toBe('Reset on Monday at 04:00 · 2 of 3 discounted runs left')
    expect(bossLine({ ...plan, discounts_left: null })).toBe('Reset on Monday at 04:00')
    expect(bossLine({ ...plan, discounts_left: 1 })).toBe('Reset on Monday at 04:00 · 1 of 3 discounted runs left')
  })
})

describe('who is planned', () => {
  it('adds a character after the others, once, and takes one off leaving the rest in order', () => {
    const keys = plan.rows.map((one) => one.key)
    expect(withKey(keys, 'aino')).toEqual(['sandrone', 'neuvillette', 'odette', 'jahoda', 'aino'])
    expect(withKey(keys, 'odette')).toEqual(keys)
    expect(withoutKey(keys, 'odette')).toEqual(['sandrone', 'neuvillette', 'jahoda'])
  })

  it('searches the characters to add by name, in any case', () => {
    expect(searchAddable(plan.addable, '').map((one) => one.key)).toEqual(['aino', 'columbina'])
    expect(searchAddable(plan.addable, ' COL ').map((one) => one.key)).toEqual(['columbina'])
    expect(searchAddable(plan.addable, 'zzz')).toEqual([])
  })
})
