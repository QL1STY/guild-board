import { describe, expect, it } from 'vitest'
import type { PrimogemsModel } from '../types.ts'
import {
  barHeights, DEFAULT_PARTS, lockedPart, metaOf, partsOf, segmentWidths, sourceName, titleOf, wantsLedger, wantsPulls,
} from './primogemsview.ts'

const NOW = new Date(2026, 10, 15, 12, 0)
const days = (earned: number[]): NonNullable<PrimogemsModel['days']> =>
  earned.map((value, index) => ({ day: `2026-11-${String(9 + index).padStart(2, '0')}`, earned: value, known: true }))

describe('the parts that are on', () => {
  it('are the defaults for a widget saved with no settings', () => {
    expect(DEFAULT_PARTS).toEqual({ savings: true, pulls: true, earned: false, sources: false })
    expect(partsOf({})).toEqual(DEFAULT_PARTS)
  })

  it('take what the settings say, and the defaults for what they leave out or what is no switch', () => {
    expect(partsOf({ earned: true, sources: true })).toEqual({ savings: true, pulls: true, earned: true, sources: true })
    expect(partsOf({ pulls: false, earned: true })).toEqual({ savings: true, pulls: false, earned: true, sources: false })
    expect(partsOf({ savings: 'no', earned: 1 })).toEqual(DEFAULT_PARTS)
  })

  it('are never none: settings that turn every part off give the savings back', () => {
    expect(partsOf({ savings: false, pulls: false, earned: false, sources: false })).toEqual({
      savings: true, pulls: false, earned: false, sources: false,
    })
  })

  it('say which models are read: the Ledger only while Earned or By source is on, Pulls only for Savings or Pulls', () => {
    expect(wantsLedger(DEFAULT_PARTS)).toBe(false)
    expect(wantsLedger({ ...DEFAULT_PARTS, sources: true })).toBe(true)
    expect(wantsLedger({ ...DEFAULT_PARTS, earned: true })).toBe(true)
    expect(wantsPulls(DEFAULT_PARTS)).toBe(true)
    expect(wantsPulls({ savings: false, pulls: false, earned: true, sources: false })).toBe(false)
  })
})

describe('the switch that cannot go off', () => {
  it('is the last one on, and none while two are on', () => {
    expect(lockedPart(DEFAULT_PARTS)).toBeNull()
    expect(lockedPart({ savings: false, pulls: true, earned: false, sources: false })).toBe('pulls')
    expect(lockedPart({ savings: false, pulls: false, earned: false, sources: true })).toBe('sources')
  })
})

describe('the heading', () => {
  it('says Savings while Earned and By source are both off, and leaves the type name (Primogems) otherwise', () => {
    expect(titleOf(DEFAULT_PARTS)).toBe('Savings')
    expect(titleOf({ ...DEFAULT_PARTS, earned: true })).toBeUndefined()
    expect(titleOf({ ...DEFAULT_PARTS, sources: true })).toBeUndefined()
  })

  it('has the balance\'s "set today" meta, or the Ledger\'s read time once Earned or By source is on and it is imported', () => {
    const imported = { imported: true, read_at: new Date(2026, 10, 15, 10, 0).toISOString() }
    expect(metaOf(DEFAULT_PARTS, 'set today', null, NOW)).toBe('set today')
    expect(metaOf(DEFAULT_PARTS, 'set today', imported, NOW)).toBe('set today') // the ledger is not drawn: its time is not said
    expect(metaOf({ ...DEFAULT_PARTS, earned: true }, 'set today', imported, NOW)).toBe('ledger read at 10:00')
    expect(metaOf({ ...DEFAULT_PARTS, sources: true }, null, imported, NOW)).toBe('ledger read at 10:00')
  })

  it('falls back to the balance\'s meta before an import, while it reads and when the read time is not known', () => {
    const parts = { ...DEFAULT_PARTS, earned: true }
    expect(metaOf(parts, 'set today', { imported: false, read_at: null }, NOW)).toBe('set today')
    expect(metaOf(parts, null, null, NOW)).toBeNull()
    expect(metaOf(parts, 'set today', { imported: true, read_at: null }, NOW)).toBe('set today')
  })

  it('names an older read by its day', () => {
    const parts = { ...DEFAULT_PARTS, earned: true }
    const older = { imported: true, read_at: new Date(2026, 10, 13, 23, 10).toISOString() }
    expect(metaOf(parts, null, older, NOW)).toBe('ledger read Fri 23:10')
  })
})

describe('the seven bars', () => {
  it('are in percent of the best day, which is full', () => {
    expect(barHeights(days([38, 30, 100, 30, 62, 45, 36]))).toEqual([38, 30, 100, 30, 62, 45, 36])
    expect(barHeights(days([60, 0, 120, 0, 0, 0, 60]))).toEqual([50, 0, 100, 0, 0, 0, 50])
  })

  it('give a small day a bar that can be seen, and a day with nothing none', () => {
    expect(barHeights(days([1000, 10, 0, 0, 0, 0, 0]))).toEqual([100, 6, 0, 0, 0, 0, 0])
  })

  it('are all none while nothing was earned, and for a day that is not known', () => {
    expect(barHeights(days([0, 0, 0, 0, 0, 0, 0]))).toEqual([0, 0, 0, 0, 0, 0, 0])
    const mixed = days([200, 100, 0, 0, 0, 0, 0])
    mixed[0] = { ...mixed[0], known: false }
    expect(barHeights(mixed)).toEqual([0, 100, 0, 0, 0, 0, 0])
  })
})

describe('the month by source', () => {
  const sources = [
    { group: 'events' as const, label: 'Events', amount: 1690 },
    { group: 'welkin' as const, label: 'Blessing of the Welkin Moon', amount: 1170 },
    { group: 'other' as const, label: 'Other', amount: 590 },
  ]

  it('has a segment of each source as wide as its share of the month, in percent', () => {
    expect(segmentWidths(sources, 3450)).toEqual([48.99, 33.91, 17.1])
  })

  it('has none for a month of nothing', () => {
    expect(segmentWidths([], 0)).toEqual([])
  })

  it('says each source by a short name in its legend', () => {
    expect(sourceName('events')).toBe('Events')
    expect(sourceName('welkin')).toBe('Welkin')
    expect(sourceName('commissions')).toBe('Commissions')
    expect(sourceName('endgame')).toBe('Endgame')
    expect(sourceName('other')).toBe('Other')
  })
})
