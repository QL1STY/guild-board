import { describe, expect, test } from 'vitest'

import { LEDGER_FIXTURE } from '../../ledgertypes.ts'
import { compareRows, wishesCard } from './ledgercards.ts'

describe('wishesCard', () => {
  test('three numbers, each with its own sign', () => {
    expect(wishesCard(LEDGER_FIXTURE.wishes)).toEqual({
      earned: '+48',
      made: '−11',
      inHand: '37',
      reach: 78,
      line: 'Enough to carry your character pity from 41 past soft pity.',
    })
  })

  test('wishesCard without a balance leaves out in hand', () => {
    expect(wishesCard({ earned: 48, made: 11, in_hand: null, pity: { now: 41, soft: 74, hard: 90 } })).toEqual({
      earned: '+48',
      made: '−11',
      inHand: null,
      reach: null,
      line: 'Set your balance in Pulls to see how far your wishes go.',
    })
  })

  test('wishesCard says enough past soft pity', () => {
    expect(wishesCard({ earned: 48, made: 11, in_hand: 37, pity: { now: 41, soft: 74, hard: 90 } }).line).toBe('Enough to carry your character pity from 41 past soft pity.')
  })

  test('wishesCard says how many short', () => {
    const card = wishesCard({ earned: 20, made: 5, in_hand: 21, pity: { now: 41, soft: 74, hard: 90 } })
    expect(card.line).toBe('12 short of soft pity on the character banner.')
    expect(card.reach).toBe(62)
  })

  test('the reach stops at the hard pity', () => {
    expect(wishesCard({ earned: 0, made: 0, in_hand: 200, pity: { now: 41, soft: 74, hard: 90 } }).reach).toBe(90)
  })

  test('nothing earned or made is a plain 0', () => {
    const card = wishesCard({ earned: 0, made: 0, in_hand: 0, pity: { now: 10, soft: 74, hard: 90 } })
    expect([card.earned, card.made]).toEqual(['0', '0'])
    expect(card.line).toBe('64 short of soft pity on the character banner.')
  })

  test('without a pity from Pulls the card has no track and says why', () => {
    const card = wishesCard({ earned: 48, made: 11, in_hand: 37, pity: null })
    expect(card.reach).toBeNull()
    expect(card.inHand).toBe('37')
    expect(card.line).toBe('Import your wish history in Pulls to see your character pity.')
  })
})

describe('compareRows', () => {
  const month = LEDGER_FIXTURE.month

  test('compareRows', () => {
    const compared = compareRows(month)
    expect(compared.line).toBe('You earned 8% more this month.')
    expect(compared.rows).toContainEqual({ label: 'Events', change: '▲ +620', way: 'up' })
    expect(compared.rows).toContainEqual({ label: 'Welkin Moon', change: 'same', way: 'same' })
    expect(compared.rows).toContainEqual({ label: 'Abyss and Theater', change: '▼ −200', way: 'down' })
    expect(compared.rows).toContainEqual({ label: 'Daily commissions', change: '▲ +60', way: 'up' })
    expect(compared.rows).toContainEqual({ label: 'Chests and other', change: '▲ +99', way: 'up' })
    expect(compared.note).toBe('Most of it from events.')
  })

  test('the biggest rise comes first and the falls last', () => {
    expect(compareRows(month).rows.map((row) => row.label)).toEqual(['Events', 'Chests and other', 'Daily commissions', 'Welkin Moon', 'Abyss and Theater'])
  })

  test('less than last month', () => {
    const less = {
      ...month,
      earned: 6800,
      previous: { earned: 8000, sources: { welkin: 2790, commissions: 1740, events: 2000, endgame: 1400, other: 70 } },
      sources: [
        { group: 'welkin' as const, label: 'x', amount: 2790 },
        { group: 'commissions' as const, label: 'x', amount: 1740 },
        { group: 'events' as const, label: 'x', amount: 800 },
        { group: 'endgame' as const, label: 'x', amount: 1400 },
        { group: 'other' as const, label: 'x', amount: 70 },
      ],
    }
    const compared = compareRows(less)
    expect(compared.line).toBe('You earned 15% less this month.')
    expect(compared.note).toBe('Most of it from events.')
    expect(compared.rows.at(-1)).toEqual({ label: 'Events', change: '▼ −1,200', way: 'down' })
  })

  test('a source that was earned last month and is nothing now is a fall', () => {
    const compared = compareRows({ ...month, sources: month.sources.filter((source) => source.group !== 'endgame') })
    expect(compared.rows.find((row) => row.label === 'Abyss and Theater')).toEqual({ label: 'Abyss and Theater', change: '▼ −1,600', way: 'down' })
  })

  test('about the same is said so and names nothing', () => {
    const same = {
      ...month,
      earned: 1000,
      previous: { earned: 1000, sources: { welkin: 1000, commissions: 0, events: 0, endgame: 0, other: 0 } },
      sources: [{ group: 'welkin' as const, label: 'x', amount: 1000 }],
    }
    const compared = compareRows(same)
    expect(compared.line).toBe('You earned about as much as last month.')
    expect(compared.note).toBe('')
    expect(compared.rows).toEqual([{ label: 'Welkin Moon', change: 'same', way: 'same' }])
  })

  test('with nothing known of last month there is nothing to compare', () => {
    const none = { ...month, previous: { earned: 0, sources: { welkin: 0, commissions: 0, events: 0, endgame: 0, other: 0 } } }
    expect(compareRows(none)).toEqual({ line: 'Nothing to compare with last month yet.', rows: [], note: '' })
  })
})
