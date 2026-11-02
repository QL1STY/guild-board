import { expect, test } from 'vitest'
import { contrast } from '../styles/contrast.ts'
import { EMBLEM_SLATE, emblemColour } from './emblem.ts'

test("a region takes its nation's colour, an area its nation's, and anything else the slate", () => {
  const nations = ['mondstadt', 'liyue', 'inazuma', 'sumeru', 'fontaine', 'natlan'].map((name) => emblemColour(name))
  expect(new Set(nations).size).toBe(6)
  expect(emblemColour('Mondstadt')).toBe(emblemColour('mondstadt'))
  expect(emblemColour('The Chasm', 'Liyue')).toBe(emblemColour('Liyue'))
  expect(emblemColour('Some new area', 'Fontaine')).toBe(emblemColour('fontaine'))
  expect(emblemColour('Somewhere new', null)).toBe(EMBLEM_SLATE)
})

test('the white emblem stands out on every disc', () => {
  for (const name of ['mondstadt', 'dragonspine', 'liyue', 'inazuma', 'sumeru', 'fontaine', 'natlan', 'elsewhere']) {
    expect(contrast('#FFFFFF', emblemColour(name)), name).toBeGreaterThanOrEqual(4)
  }
})
