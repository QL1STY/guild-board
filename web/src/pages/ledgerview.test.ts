import { expect, test } from 'vitest'
import { ringFill } from '../frame/freshview.ts'
import { ARTIFACT_HISTORY_FIXTURE, HISTORY_FIXTURE, LEDGER_FIXTURE, type Ledger } from '../ledgertypes.ts'
import {
  entryTime, fivesNote, historyRow, importLine, ledgerFresh, ledgerRunning, loginUpToLine, luckLine, money, restLine, signed, spentSub, upToLine,
} from './ledgerview.ts'

const ledger = (change: (data: Ledger) => void = () => {}): Ledger => {
  const copy = structuredClone(LEDGER_FIXTURE)
  change(copy)
  return copy
}

test('prices read "about 1,240 zł"', () => {
  expect(money(LEDGER_FIXTURE.spent.total, 'PLN')).toBe('about 1,240 zł')
  expect(money(449.99, 'EUR')).toBe('about €450')
  expect(money(4.99, 'USD')).toBe('about $5')
  expect(money(0, 'PLN')).toBe('0 zł')
})

test("the line under Spent on Genshin's total says since when, and what this month cost", () => {
  expect(spentSub(LEDGER_FIXTURE.spent)).toBe('since 4 June 2025 · this month about 23 zł, one Welkin')
  const quiet = ledger((data) => Object.assign(data.spent, { month_total: 0, month_note: 'nothing' }))
  expect(spentSub(quiet.spent)).toBe('since 4 June 2025 · nothing this month')
  const none = ledger((data) => {
    Object.assign(data.spent, { since: null, welkins: 0, packs: 0, gnostic_hymns: 0, rows: [], total: 0 })
  })
  expect(spentSub(none.spent)).toBe('No purchases in the history the game keeps')
})

test('the five-star tile says what its count is made of', () => {
  // 36 from domains and 5 from elsewhere make the tile's 41; the luck line, 36 over 32 runs, is of the domains alone.
  expect(fivesNote(LEDGER_FIXTURE.artifacts)).toBe('· 36 from 32 domain runs, 5 elsewhere')
  expect(fivesNote(ledger((data) => (data.artifacts.five_other = 0)).artifacts)).toBe('from 32 domain runs')
  expect(fivesNote(ledger((data) => (data.artifacts.runs = 0)).artifacts)).toBe('')
})

test('luck line hidden when per_run is null', () => {
  expect(luckLine(LEDGER_FIXTURE.artifacts)).toBe('Luck: 1.13 five-stars per domain run · a typical run gives about 1.07')
  expect(luckLine(ledger((data) => (data.artifacts.per_run = null)).artifacts)).toBeNull()
})

test('history rows sign and colour amounts', () => {
  const [commission, , fates] = HISTORY_FIXTURE.entries
  expect(historyRow(commission, 'primogem')).toEqual({
    time: '27 Oct 05:12', text: 'Daily Commission reward', stars: 0, amount: '+60', tone: 'plus',
  })
  expect(historyRow(fates, 'primogem')).toEqual({
    time: '26 Oct 22:47', text: 'Shop purchase', stars: 0, amount: '−1,600', tone: 'minus',
  })
  // An artifact: its name and stars, then where it came from or went.
  const [drop, fed] = ARTIFACT_HISTORY_FIXTURE.entries
  expect(historyRow(drop, 'artifact')).toEqual({
    time: '27 Oct 03:58', text: "Vermillion Hereafter's Thunder Clouds", note: 'Sanctum of Rainbow Spirits (Domain)',
    stars: 5, amount: '+1', tone: 'plus',
  })
  expect(historyRow(fed, 'artifact').tone).toBe('minus')
  expect(signed(0)).toBe('0')
  expect(entryTime('2026-01-05 00:07:59')).toBe('5 Jan 00:07')
})

test("the top line says up to when the game's history is read, by the core's time", () => {
  const now = new Date('2026-10-27T15:00:00')
  expect(upToLine('2026-10-27T09:41:00', now)).toBe('History from the game up to today 09:41')
  expect(upToLine('2026-10-13T10:02:00', now)).toBe('History from the game up to 13 Oct, 10:02')
  expect(upToLine(null, now)).toBe('')
})

test('with the HoYoLAB login the top line says the history updates itself, and when it last did', () => {
  const now = new Date('2026-10-27T15:00:00')
  expect(loginUpToLine('2026-10-27T09:41:00', now)).toBe('Updated automatically with your HoYoLAB login · last today 09:41')
  expect(loginUpToLine('2026-10-13T10:02:00', now)).toBe('Updated automatically with your HoYoLAB login · last 13 Oct, 10:02')
  expect(loginUpToLine(null, now)).toBe('Updates automatically with your HoYoLAB login')
})

test('the line at rest follows how the updates with the login go', () => {
  const now = new Date('2026-10-27T15:00:00')
  const at = '2026-10-27T09:41:00'
  expect(restLine(null, at, now)).toBe('History from the game up to today 09:41')
  expect(restLine('on', at, now)).toBe('Updated automatically with your HoYoLAB login · last today 09:41')
  expect(restLine('minting', at, now)).toBe('Getting a key from HoYoLAB…')
  expect(restLine('failed', at, now)).toBe('The last automatic update did not finish. Guild Board tries again in half an hour.')
  expect(restLine('refused', at, now)).toBe(
    'Automatic updates need a fresh HoYoLAB login. Log in again, or open Feedback in the game and press Import.',
  )
})

test('the import line follows the ledger block, after the wishes', () => {
  const block = LEDGER_FIXTURE.import
  const running = { ...block, ledger: { ...block.ledger, state: 'running' as const, kind: 'primogem' as const, found: 340 } }
  expect(importLine(running, null)).toBe('Reading primogem history… 340 entries')
  expect(importLine({ ...running, ledger: { ...running.ledger, kind: 'crystal' } }, null)).toBe(
    'Reading Genesis Crystal history… 340 entries',
  )
  // The wishes come first, in the same press.
  const wishes = { state: 'running' as const, pool: 'character', pages: 2, found: 0, message: null }
  expect(importLine(block, wishes)).toBe('Reading the wish history first…')
  expect(importLine({ ...block, state: 'running' }, null)).toBe('Reading the wish history first…')
  const done = { ...block, ledger: { ...block.ledger, state: 'done' as const, found: 12 } }
  expect(importLine(done, null)).toBe('Read 12 new entries of your game history.')
  expect(importLine({ ...done, ledger: { ...done.ledger, found: 0 } }, null)).toBe(
    'Nothing new. The history is up to date.',
  )
  // The core's own sentence wins, such as how to get a link from Feedback.
  const failed = {
    ...block,
    ledger: { ...block.ledger, state: 'failed' as const, message: 'The history link from Feedback has expired.' },
  }
  expect(importLine(failed, null)).toBe('The history link from Feedback has expired.')
  expect(importLine(block, null)).toBe('')
})

test('the freshness ring follows the ledger block while the logs are read', () => {
  const now = new Date('2026-10-27T15:00:00')
  const block = { ...LEDGER_FIXTURE.import, login: 'on' as const, every_minutes: 30 }
  const reading = { ...block, ledger: { ...block.ledger, state: 'running' as const, kind: 'primogem' as const, found: 340 } }
  const view = ledgerFresh(reading, '2026-10-27T14:50:00', null, null, now)
  expect(view).toMatchObject({ tone: 'gold', label: '340 entries', turning: true })
  expect(view.tip).toBe('Reading primogem history… 340 entries')
  expect(ledgerFresh({ ...reading, ledger: { ...reading.ledger, found: 1 } }, null, null, null, now).label).toBe('1 entry')
  expect(ledgerFresh({ ...reading, ledger: { ...reading.ledger, kind: null } }, null, null, null, now).label).toBe('Reading…')
  // The wishes come first in the same press.
  const wishes = { state: 'running' as const, pool: 'character', pages: 2, found: 0, message: null }
  expect(ledgerFresh(block, null, wishes, null, now)).toMatchObject({ label: 'Reading wishes…', turning: true, tip: 'Reading the wish history first…' })
})

test('the freshness ring keeps turning while the key is asked for after a press, and the page counts it as running', () => {
  const now = new Date('2026-10-27T15:00:00')
  const block = { ...LEDGER_FIXTURE.import, login: 'minting' as const, every_minutes: 30 }
  expect(ledgerFresh(block, '2026-10-27T14:40:00', null, null, now)).toMatchObject({
    tone: 'gold', label: 'Importing…', turning: true, tip: 'Getting a key from HoYoLAB…',
  })
  expect(ledgerRunning(block, null)).toBe(true)
  expect(ledgerRunning({ ...block, login: 'on' }, null)).toBe(false)
  expect(ledgerRunning({ ...block, login: 'on', ledger: { ...block.ledger, state: 'running' } }, null)).toBe(true)
})

test('the freshness ring is gold with the age of the last import when the login updates the history', () => {
  const now = new Date('2026-10-27T15:00:00')
  const block = { ...LEDGER_FIXTURE.import, login: 'on' as const, every_minutes: 30 }
  const view = ledgerFresh(block, '2026-10-27T14:40:00', null, null, now)
  expect(view).toMatchObject({ tone: 'gold', label: '20 min ago', turning: false })
  expect(view.fill).toBe(ringFill('2026-10-27T14:40:00', 30, now))
  expect(view.tip).toBe('Updated automatically with your HoYoLAB login · last today 14:40')
  expect(ledgerFresh(block, null, null, null, now)).toMatchObject({ tone: 'gold', fill: 0, label: 'Not read yet' })
})

test('without an update by itself the ring is grey and the tip says to press Import', () => {
  const now = new Date('2026-10-27T15:00:00')
  const block = { ...LEDGER_FIXTURE.import, login: null, every_minutes: null }
  const view = ledgerFresh(block, '2026-10-27T14:40:00', null, null, now)
  expect(view).toMatchObject({ tone: 'grey', fill: 0, label: '20 min ago' })
  expect(view.tip).toBe('History from the game up to today 14:40. Press Import to update it.')
  expect(ledgerFresh(block, null, null, null, now)).toMatchObject({ tone: 'grey', label: 'Not read yet', tip: 'Press Import to update it.' })
  // A link kept from a press counts as an update by itself: the core says so in every_minutes.
  expect(ledgerFresh({ ...block, every_minutes: 30 }, '2026-10-27T14:40:00', null, null, now).tone).toBe('gold')
})

test('the freshness ring turns amber when the login is refused, or an update did not finish', () => {
  const now = new Date('2026-10-27T15:00:00')
  const block = { ...LEDGER_FIXTURE.import, every_minutes: 30 }
  const refused = ledgerFresh({ ...block, login: 'refused' }, '2026-10-27T14:40:00', null, null, now)
  expect(refused).toMatchObject({ tone: 'amber', label: 'Open Feedback' })
  expect(refused.tip).toBe(restLine('refused', '2026-10-27T14:40:00', now))
  const failed = ledgerFresh({ ...block, login: 'failed' }, '2026-10-27T14:40:00', null, null, now)
  expect(failed).toMatchObject({ tone: 'amber', label: 'Will retry' })
  expect(failed.tip).toBe(restLine('failed', '2026-10-27T14:40:00', now))
})

test('the freshness ring turns amber when the Feedback link is gone, and when the logs failed for another reason', () => {
  const now = new Date('2026-10-27T15:00:00')
  const block = { ...LEDGER_FIXTURE.import, login: null, every_minutes: null }
  const expired = { ...block, ledger: { ...block.ledger, state: 'failed' as const, message: 'The history link from Feedback has expired.' } }
  expect(ledgerFresh(expired, null, null, null, now)).toMatchObject({
    tone: 'amber', label: 'Open Feedback', tip: 'The history link from Feedback has expired.',
  })
  const other = { ...block, ledger: { ...block.ledger, state: 'failed' as const, message: 'The import failed unexpectedly. See the log file.' } }
  expect(ledgerFresh(other, null, null, null, now)).toMatchObject({ tone: 'amber', label: 'Import failed' })
})

test('a refusal of a press is the tip of the ring, and the rest stays', () => {
  const now = new Date('2026-10-27T15:00:00')
  const block = { ...LEDGER_FIXTURE.import, login: null, every_minutes: null }
  expect(ledgerFresh(block, '2026-10-27T14:40:00', null, 'An import is already running.', now)).toMatchObject({
    tone: 'grey', label: '20 min ago', tip: 'An import is already running.',
  })
})
