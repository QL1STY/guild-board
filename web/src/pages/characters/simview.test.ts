import { expect, test } from 'vitest'
import type { PlannerHits, PlannerSim } from '../../types.ts'
import { atkHeadline, mainChoices, raiseKinds, raiseMains, rollsText, statRows, typedValue, valueText, weaponSubText } from './simview.ts'

const panel: PlannerSim['panel'] = { hp: 20152.4, atk: 2964.1, def: 814, em: 59, er: 122.7, cr: 79.4, cd: 176.5, dmg: 0, heal: 0, physical: 0 }

test('a value shows as the game shows it: whole numbers for flat stats, one decimal for percentages', () => {
  expect(valueText('atk', 2964.1)).toBe('2,964')
  expect(valueText('em', 58.6)).toBe('59')
  expect(valueText('cr', 79.44)).toBe('79.4%')
  expect(valueText('dmg', 0)).toBe('0.0%')
})

test('a typed substat takes whole numbers for flat stats and one decimal for percentages, and says what it refuses', () => {
  expect(typedValue('cd', '')).toBeNull()
  expect(typedValue('cd', '21.8')).toEqual({ value: 21.8 })
  expect(typedValue('cd', '21')).toEqual({ value: 21 })
  expect(typedValue('cd', '21.85')).toEqual({ problem: 'One decimal at most' })
  expect(typedValue('cd', '21.')).toEqual({ unfinished: true }) // still being typed: no message yet
  expect(typedValue('hp', '538.')).toEqual({ problem: 'Whole numbers only' })
  expect(typedValue('hp', '538')).toEqual({ value: 538 })
  expect(typedValue('hp', '538.5')).toEqual({ problem: 'Whole numbers only' })
  expect(typedValue('hp', 'abc')).toEqual({ problem: 'Whole numbers only' })
})

test('the rolls a value can be made of read "1 roll", "3 rolls" or "3 or 4 rolls"', () => {
  expect(rollsText([1])).toBe('1 roll')
  expect(rollsText([3])).toBe('3 rolls')
  expect(rollsText([3, 4])).toBe('3 or 4 rolls')
})

test('the stats table rounds as the game does, writes the change with a true minus, and marks what did not move', () => {
  const rows = statRows(panel, { ...panel, atk: 2491.2, dmg: 46.6, cr: 79.44 }, 'Cryo')
  const by = Object.fromEntries(rows.map((row) => [row.key, row]))
  expect(rows.map((row) => row.key)).toEqual(['atk', 'hp', 'def', 'em', 'er', 'cr', 'cd', 'dmg'])
  expect(by.atk).toMatchObject({ now: '2,964', tested: '2,491', change: '−473', same: false, up: false })
  expect(by.dmg).toMatchObject({ label: 'Cryo DMG Bonus', now: '0.0%', tested: '46.6%', change: '+46.6%', up: true })
  expect(by.cr).toMatchObject({ change: '·', same: true }) // 79.4 and 79.44 show the same
  expect(by.hp).toMatchObject({ change: '·', same: true })
})

test('Physical DMG and Healing Bonus show only when she or the test has some', () => {
  expect(statRows(panel, { ...panel, physical: 20.7 }, 'Cryo').map((row) => row.key)).toContain('physical')
  expect(statRows({ ...panel, heal: 12 }, panel, 'Cryo').map((row) => row.key)).toContain('heal')
})

test('the header says the ATK change of the test, or that there is none', () => {
  expect(atkHeadline(panel, panel)).toEqual({ text: 'No change', same: true, up: false })
  expect(atkHeadline(panel, { ...panel, atk: 3100 })).toEqual({ text: '+136 ATK', same: false, up: true })
  expect(atkHeadline(panel, { ...panel, atk: 2491 })).toEqual({ text: '−473 ATK', same: false, up: false })
})

test('"Raise" marks a talent within a level of her highest and below 10, and none when all are at 10', () => {
  const talent = (kind: 'normal' | 'skill' | 'burst', now: number) => ({ kind, label: '', name: '', icon: null, now, target: now, bonus: 0, max: 10 })
  expect([...raiseKinds([talent('normal', 9), talent('skill', 10), talent('burst', 10)])]).toEqual(['normal'])
  expect([...raiseKinds([talent('normal', 6), talent('skill', 8), talent('burst', 7)])]).toEqual(['skill', 'burst'])
  expect([...raiseKinds([talent('normal', 10), talent('skill', 10), talent('burst', 10)])]).toEqual([])
})

test('with the verdict, "Raise" marks a main talent below 10, however far below, and no other', () => {
  const talent = (kind: 'normal' | 'skill' | 'burst', now: number) => ({ kind, label: '', name: '', icon: null, now, target: now, bonus: 0, max: 10 })
  const hits = (mains: Record<'normal' | 'skill' | 'burst', boolean>) =>
    ({ talents: (['normal', 'skill', 'burst'] as const).map((key) => ({ key, main: mains[key] })) }) as unknown as PlannerHits
  const all = hits({ normal: true, skill: true, burst: true })
  expect([...raiseMains([talent('normal', 5), talent('skill', 10), talent('burst', 9)], all)]).toEqual(['normal', 'burst'])
  expect([...raiseMains([talent('normal', 10), talent('skill', 10), talent('burst', 10)], all)]).toEqual([])
  // a talent that is not a main one never gets the mark
  expect([...raiseMains([talent('normal', 5), talent('skill', 8), talent('burst', 7)], hits({ normal: false, skill: true, burst: false }))]).toEqual(['skill'])
})

test('a slot offers its own main stats, and the one a piece has now when it is none of them', () => {
  expect(mainChoices('flower', 'hp')).toEqual(['hp'])
  expect(mainChoices('goblet', 'dmg')).toContain('physical')
  expect(mainChoices('goblet', 'dmg_other').at(-1)).toBe('dmg_other')
})

test("a weapon's second stat reads with its value, and is empty until the weapon is read", () => {
  expect(weaponSubText('cd', 44.1)).toBe('Crit DMG 44.1%')
  expect(weaponSubText('em', 221)).toBe('Elemental Mastery 221')
  expect(weaponSubText('atk_pct', null)).toBe('')
  expect(weaponSubText(null, null)).toBe('')
})
