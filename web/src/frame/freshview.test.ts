import { expect, test } from 'vitest'
import ledgerSource from '../pages/Ledger.tsx?raw'
import pullsSource from '../pages/Pulls.tsx?raw'
import { ageLabel, flashChange, type FlashSource, newLabel, pressed, ringFill, withFlash, type FreshView } from './freshview.ts'

const at = (clock: string) => new Date(`2026-11-03T${clock}:00Z`)
const READ = '2026-11-03T10:00:00Z'

test('the ring is full at the read and empties over the cadence', () => {
  expect(ringFill(READ, 30, at('10:00'))).toBe(1)
  expect(ringFill(READ, 30, at('10:15'))).toBe(0.5)
  expect(ringFill(READ, 30, at('10:30'))).toBe(0)
})

test('the ring is empty once a read is overdue, and full for a read time ahead of now', () => {
  expect(ringFill(READ, 30, at('10:45'))).toBe(0)
  expect(ringFill(READ, 30, at('09:59'))).toBe(1)
})

test('the ring is empty without a cadence or without a read', () => {
  expect(ringFill(READ, null, at('10:15'))).toBe(0)
  expect(ringFill(null, 30, at('10:15'))).toBe(0)
  expect(ringFill(READ, 0, at('10:15'))).toBe(0)
})

test('the age label says when, with "just now" for a time ahead of now', () => {
  const now = at('10:10')
  expect(ageLabel(null, now)).toBe('Not read yet')
  expect(ageLabel('2026-11-03T10:08:00Z', now)).toBe('2 min ago')
  expect(ageLabel('2026-11-03T10:11:00Z', now)).toBe('just now')
})

test('an import that found something is "+N new" for a moment, and nothing else is', () => {
  const done = { state: 'done' as const, pool: null, pages: 6, found: 12, message: null }
  expect(newLabel(done)).toBe('+12 new')
  expect(newLabel({ ...done, found: 1234 })).toBe('+1,234 new')
  expect(newLabel({ ...done, found: 0 })).toBeNull()
  expect(newLabel({ ...done, state: 'running' })).toBeNull()
  expect(newLabel({ ...done, state: 'failed' })).toBeNull()
  expect(newLabel(null)).toBeNull()
})

test('the flash replaces the age, but never the progress of a run or a call to act', () => {
  const gold: FreshView = { tone: 'gold', fill: 0.5, label: '2 min ago', tip: 'tip', turning: false }
  expect(withFlash(gold, '+3 new').label).toBe('+3 new')
  expect(withFlash({ ...gold, tone: 'grey' }, '+3 new').label).toBe('+3 new')
  expect(withFlash(gold, null)).toBe(gold)
  expect(withFlash({ ...gold, turning: true, label: 'page 3 · 41 new' }, '+3 new').label).toBe('page 3 · 41 new')
  expect(withFlash({ ...gold, tone: 'amber', label: 'Log in' }, '+3 new').label).toBe('Log in')
})

/** What the flash shows at each reading of a source, as the hook walks them: the label shown after each one. */
function walk(sources: (FlashSource | null)[]): (string | null)[] {
  let seen = sources[0]?.state ?? null
  let shown: string | null = null
  return sources.map((source) => {
    const step = flashChange(seen, source)
    seen = step.seen
    if (step.changed) shown = step.label
    return shown
  })
}

test('the Ledger flashes when its own block turns done having read entries, and not for a finished wish import', () => {
  const block = (state: string, found: number): FlashSource => ({ state, found })
  expect(walk([block('idle', 0), block('running', 120), block('done', 3)])).toEqual([null, null, '+3 new'])
  // The wishes of the same press end first; the ledger's block is idle or running then, so nothing shows.
  expect(walk([block('idle', 0), block('idle', 0), block('running', 0)])).toEqual([null, null, null])
  // Done with nothing new shows nothing, and a later reading of the same state is not a new event.
  expect(walk([block('running', 5), block('done', 0), block('done', 0)])).toEqual([null, null, null])
  expect(walk([block('running', 5), block('done', 4), block('done', 4)])).toEqual([null, '+4 new', '+4 new'])
})

test('a block already done when the page opens shows nothing, however often it is read again', () => {
  const done: FlashSource = { state: 'done', found: 3 }
  expect(walk([done, { ...done }, { ...done }])).toEqual([null, null, null])
  // The next press, though, does.
  expect(walk([done, { state: 'running', found: 0 }, { state: 'done', found: 2 }])).toEqual([null, null, '+2 new'])
})

test('the Ledger gives the flash its own block and Pulls the wish stream', () => {
  expect(ledgerSource).toContain('useNewFlash(model.import.ledger)')
  expect(ledgerSource).not.toContain('useNewFlash(live.pullsImport)')
  expect(pullsSource).toContain('useNewFlash(live.pullsImport)')
})

test('a press on its way turns the ring and says Importing…, and leaves a run that already turns alone', () => {
  const resting: FreshView = { tone: 'gold', fill: 0.5, label: '2 min ago', tip: 'Imported 41 new wishes. Updates itself until 09:52 tomorrow.', turning: false }
  expect(pressed(resting)).toEqual({ ...resting, turning: true, label: 'Importing…', tip: 'Importing…' })
  const running: FreshView = { ...resting, turning: true, label: 'page 3 · 41 new', tip: 'Importing the weapon event wish, page 3 · 41 new' }
  expect(pressed(running)).toBe(running)
})

test('the Pulls and Ledger rings take the view of a press on its way from pressed()', () => {
  expect(pullsSource).toContain('pressing ? pressed(view) : view')
  expect(ledgerSource).toContain('pressing ? pressed(view) : view')
})
