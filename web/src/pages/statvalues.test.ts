import { describe, expect, test } from 'vitest'
import { count, field, FULL_MONTHS, hoursFigure, hoursText, monthParts, monthsOf, moneyText, priceLine, weeksOf } from './statvalues.ts'

/*
 * What a friend's PC sends can be odd (the online plan, Task B6, decision 3): the server checks a stat only as a known key
 * that holds an object, so any value inside it can be missing or of the wrong type. These readers take a number only when it
 * is one, and the pages leave out what they cannot read.
 */

describe('count', () => {
  test('a count is a finite number from 0 up to a thousand million', () => {
    expect(count(0)).toBe(0)
    expect(count(16040)).toBe(16040)
    expect(count(61.5)).toBe(61.5)
    expect(count(1_000_000_000)).toBe(1_000_000_000)
  })

  test.each([null, undefined, '12', true, [], {}, NaN, Infinity, -Infinity, -1, -0.5, 1_000_000_001, 1e300])(
    '%s is no count',
    (value) => {
      expect(count(value)).toBeNull()
    },
  )
})

describe('field', () => {
  test('is the value of a plain object, and nothing of anything else', () => {
    expect(field({ now: 5 }, 'now')).toBe(5)
    expect(field({}, 'now')).toBeUndefined()
    for (const stat of [null, undefined, 7, 'text', [], [5]]) expect(field(stat, 'now')).toBeUndefined()
  })

  test('does not read what an object inherits', () => {
    expect(field({}, 'constructor')).toBeUndefined()
    expect(field({}, 'toString')).toBeUndefined()
  })
})

describe('monthsOf', () => {
  test('keeps the entries that name a month, in their order, and the earned figures that are counts', () => {
    expect(
      monthsOf({
        months: [
          { month: '2026-09', earned: 7700 },
          { month: '2026-10', earned: null },
        ],
      }),
    ).toEqual([
      { month: '2026-09', earned: 7700 },
      { month: '2026-10', earned: null },
    ])
  })

  test('leaves out what is not a month, and reads a bad figure as none', () => {
    const odd = {
      months: [
        null,
        7,
        'x',
        { earned: 5 },
        { month: 202610, earned: 5 },
        { month: '2026-13', earned: 5 },
        { month: '2026-1', earned: 5 },
        { month: '2026-09', earned: 'lots' },
        { month: '2026-10', earned: -4 },
      ],
    }
    expect(monthsOf(odd)).toEqual([
      { month: '2026-09', earned: null },
      { month: '2026-10', earned: null },
    ])
  })

  test.each([null, undefined, 5, 'x', [], {}, { months: 5 }, { months: 'x' }, { months: {} }])('%s holds no months', (stat) => {
    expect(monthsOf(stat)).toEqual([])
  })
})

describe('weeksOf', () => {
  test('is the weeks as they come, a figure that is not a count being none', () => {
    expect(weeksOf({ weeks: [12, 9.5, null, 'x', -1, 14] })).toEqual([12, 9.5, null, null, null, 14])
    expect(weeksOf({ weeks: [Infinity, NaN, 0, 1.5, '3', {}] })).toEqual([null, null, 0, 1.5, null, null])
  })

  test.each([null, undefined, 5, 'x', [], {}, { weeks: 5 }, { weeks: 'x' }, { weeks: {} }])('%s holds no weeks', (stat) => {
    expect(weeksOf(stat)).toEqual([])
  })

  test('holds the last six weeks of a longer list', () => {
    expect(weeksOf({ weeks: [1, 2, 3, 4, 5, 6, 7, 8] })).toEqual([3, 4, 5, 6, 7, 8])
  })
})

describe('hoursText', () => {
  test('is whole hours without a decimal, and one decimal otherwise', () => {
    expect(hoursText(18)).toBe('18 h')
    expect(hoursText(18.0)).toBe('18 h')
    expect(hoursText(9.5)).toBe('9.5 h')
    expect(hoursText(61.54)).toBe('61.5 h')
    expect(hoursText(0)).toBe('0 h')
    expect(hoursText(1234.5)).toBe('1,234.5 h')
  })

  test('rounds to the tenth, so that 8.96 is 9 h', () => {
    expect(hoursText(8.96)).toBe('9 h')
  })

  test('the figure alone is the same without its unit', () => {
    expect(hoursFigure(18)).toBe('18')
    expect(hoursFigure(9.5)).toBe('9.5')
    expect(hoursFigure(1234.5)).toBe('1,234.5')
  })
})

describe('moneyText', () => {
  test('is the price as the Ledger writes it', () => {
    expect(moneyText(412, 'PLN')).toEqual({ before: '', figure: '412', after: 'zł' })
    expect(moneyText(450, 'EUR')).toEqual({ before: '€', figure: '450', after: '' })
    expect(moneyText(30, 'USD')).toEqual({ before: '$', figure: '30', after: '' })
  })

  test('names another currency by its code', () => {
    expect(moneyText(30, 'gbp')).toEqual({ before: '', figure: '30', after: 'GBP' })
  })

  test.each([null, undefined, 5, '', 'zł', 'PLNX', '<b>', 'US D'])('%s is no currency, so there is no price', (currency) => {
    expect(moneyText(30, currency)).toBeNull()
    expect(priceLine(30, currency)).toBeNull()
  })

  test('a price is one line', () => {
    expect(priceLine(412, 'PLN')).toBe('412 zł')
    expect(priceLine(450, 'EUR')).toBe('€450')
    expect(priceLine(30, 'USD')).toBe('$30')
    expect(priceLine(1240.4, 'PLN')).toBe('1,240 zł')
    expect(priceLine(30, 'gbp')).toBe('30 GBP')
  })
})

describe('months', () => {
  test('a month key is a year and a month, and nothing else', () => {
    expect(monthParts('2026-10')).toEqual({ year: 2026, month: 10 })
    expect(monthParts('2026-01')).toEqual({ year: 2026, month: 1 })
    for (const key of ['2026-00', '2026-13', '2026-1', '26-10', '2026-10-01', '', 'infinity']) expect(monthParts(key), key).toBeNull()
  })

  test('has the full names, January first', () => {
    expect(FULL_MONTHS).toHaveLength(12)
    expect(FULL_MONTHS[0]).toBe('January')
    expect(FULL_MONTHS[9]).toBe('October')
  })
})
