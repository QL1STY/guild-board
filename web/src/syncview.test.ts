import { expect, test } from 'vitest'
import { PLATE_ACTIONS, syncPlate } from './syncview.ts'
import type { Status, SyncState } from './types.ts'

const NOW = new Date('2026-10-13T08:10:00Z')

function sync(state: SyncState, changes: Partial<Status['sync']> = {}): Status['sync'] {
  return {
    state, message: null, last_ok_at: '2026-10-13T08:06:00+00:00', next_at: null, manual_wait_seconds: 0,
    runs_today: 3, daily_cap: 24, manual_gap_seconds: 300, ...changes,
  }
}

// ---------------------------------------------------------------------------------------------------- the plate

/** The status with only its sync part filled in; syncPlate reads nothing else. */
function status(state: SyncState, changes: Partial<Status['sync']> = {}): Status {
  return { sync: sync(state, changes) } as Status
}

const READY = { disabled: false, busy: false, ring: 0, name: 'Sync now' }

test('ok: the last sync, and the button ready', () => {
  expect(syncPlate(status('ok'), NOW, 0, true)).toEqual({
    dot: 'green', amber: false, state: 'Synced', sub: '4 min ago', button: READY, action: null, detail: null,
  })
})

test('ok, waiting: the wait is in the ring and in the name, and the time since the status counts it down', () => {
  const waiting = status('ok', { manual_wait_seconds: 266 })
  expect(syncPlate(waiting, NOW, 0, true)).toEqual({
    dot: 'green', amber: false, state: 'Synced', sub: 'again in 4:26',
    button: { disabled: true, busy: false, ring: 266 / 300, name: 'Sync now, in 4:26' }, action: null, detail: null,
  })
  const later = syncPlate(waiting, NOW, 250, true)
  expect(later.sub).toBe('again in 0:16')
  expect(later.button).toEqual({ disabled: true, busy: false, ring: 16 / 300, name: 'Sync now, in 0:16' })
  // Once the wait has run out the button is ready again, with an empty ring.
  expect(syncPlate(waiting, NOW, 300, true).button).toEqual(READY)
  expect(syncPlate(waiting, NOW, 300, true).sub).toBe('4 min ago')
})

test('the ring is never fuller than full', () => {
  expect(syncPlate(status('ok', { manual_wait_seconds: 900 }), NOW, 0, true).button?.ring).toBe(1)
})

test('ok, daily limit reached: the button is off and the ring empty, whatever the wait', () => {
  const expected = {
    dot: 'green', amber: false, state: 'Synced', sub: 'daily limit reached',
    button: { disabled: true, busy: false, ring: 0, name: 'Sync now' }, action: null, detail: null,
  }
  expect(syncPlate(status('ok', { runs_today: 24 }), NOW, 0, true)).toEqual(expected)
  expect(syncPlate(status('ok', { runs_today: 24, manual_wait_seconds: 100 }), NOW, 0, true)).toEqual(expected)
})

test('the daily limit turns the button off wherever the button shows', () => {
  const off = { disabled: true, busy: false, ring: 0, name: 'Sync now' }
  expect(syncPlate(status('offline', { runs_today: 24 }), NOW, 0, true).button).toEqual(off)
  expect(syncPlate(status('offline', { runs_today: 23 }), NOW, 0, true).button).toEqual(READY)
  expect(syncPlate(status('syncing', { runs_today: 24 }), NOW, 0, true).button).toEqual({ ...off, busy: true })
})

test('ok, never synced: grey, and the button is ready', () => {
  expect(syncPlate(status('ok', { last_ok_at: null }), NOW, 0, true)).toEqual({
    dot: 'grey', amber: false, state: 'Not synced yet', sub: null, button: READY, action: null, detail: null,
  })
})

test('syncing: busy, and the button is off', () => {
  expect(syncPlate(status('syncing'), NOW, 0, true)).toEqual({
    dot: 'busy', amber: false, state: 'Syncing…', sub: 'reading HoYoLAB',
    button: { disabled: true, busy: true, ring: 0, name: 'Sync now' }, action: null, detail: null,
  })
})

test("offline: grey, the next try in the PC's time, the button as the wait allows", () => {
  // Local times, so that the test holds in any time zone.
  const now = new Date(2026, 9, 13, 1, 10)
  const next = new Date(2026, 9, 13, 2, 45).toISOString()
  const last = new Date(2026, 9, 13, 1, 0).toISOString()
  expect(syncPlate(status('offline', { next_at: next, last_ok_at: last }), now, 0, true)).toEqual({
    dot: 'grey', amber: false, state: 'No connection', sub: 'next try at 02:45', button: READY, action: null,
    detail: 'No connection. Guild Board will try again at the next sync.',
  })
  const waiting = syncPlate(status('offline', { next_at: next, manual_wait_seconds: 60 }), now, 0, true)
  expect(waiting.button).toEqual({ disabled: true, busy: false, ring: 60 / 300, name: 'Sync now, in 1:00' })
  expect(waiting.sub).toBe('next try at 02:45')
  // A try on another day says the day too; none planned says nothing.
  const tomorrow = new Date(2026, 9, 14, 2, 45).toISOString()
  expect(syncPlate(status('offline', { next_at: tomorrow }), now, 0, true).sub).toBe('next try at 14 Oct, 02:45')
  expect(syncPlate(status('offline'), now, 0, true).sub).toBeNull()
})

test("the amber states take the button's place with an action", () => {
  const amber = { dot: null, amber: true, button: null }
  expect(syncPlate(status('login_needed'), NOW, 0, true)).toEqual({
    ...amber, state: 'Log in needed', sub: 'you were signed out', action: { kind: 'login', label: 'Log in' },
    detail: 'Log in to HoYoLAB so that Guild Board can read your account.',
  })
  const another = status('login_needed')
  another.sync.message = 'The HoYoLAB login is of another game account (UID 2) than this history (UID 1).'
  expect(syncPlate(another, NOW, 0, true)).toEqual({
    ...amber, state: 'Log in needed', sub: null, action: { kind: 'login', label: 'Log in' }, detail: another.sync.message,
  })
  expect(syncPlate(status('verification_needed'), NOW, 0, true)).toEqual({
    ...amber, state: 'Check needed', sub: 'HoYoLAB asks for a check', action: { kind: 'verify', label: 'Verify' },
    detail: 'HoYoLAB asked for a verification check. Syncing is paused until you have passed it.',
  })
  expect(syncPlate(status('paused'), NOW, 0, true)).toEqual({
    ...amber, state: 'Syncing paused', sub: null, action: { kind: 'resume', label: 'Resume' }, detail: 'Syncing is paused.',
  })
  expect(syncPlate(status('switch_off', { message: 'HoYoLAB reports that this data is switched off.' }), NOW, 0, true)).toEqual({
    ...amber, state: 'A switch is off', sub: 'in HoYoLAB', action: { kind: 'panel', label: 'How to fix' },
    detail: 'HoYoLAB reports that this data is switched off.',
  })
  expect(syncPlate(status('error', { message: 'HoYoLAB answered with error 12345.' }), NOW, 0, true)).toEqual({
    ...amber, state: 'Sync failed', sub: 'see the log', action: { kind: 'log', label: 'See the log' },
    detail: 'HoYoLAB answered with error 12345.',
  })
})

test("a switch or an error without a message from the core gets the banner's own sentence", () => {
  expect(syncPlate(status('switch_off'), NOW, 0, true).detail).toBe('A HoYoLAB privacy switch is off.')
  expect(syncPlate(status('error'), NOW, 0, true).detail).toBe('The last sync failed.')
})

test('without the core the plate claims nothing about the sync', () => {
  const expected = {
    dot: 'grey', amber: false, state: 'Not connected', sub: null,
    button: { disabled: true, busy: false, ring: 0, name: 'Sync now' }, action: null, detail: null,
  }
  expect(syncPlate(status('ok'), NOW, 999, false)).toEqual(expected)
  expect(syncPlate(status('login_needed'), NOW, 0, false)).toEqual(expected)
  expect(syncPlate(status('syncing'), NOW, 0, false)).toEqual(expected)
})

test('the amber actions send what the banner sent', () => {
  expect(PLATE_ACTIONS).toEqual({ verify: '/api/auth/verify', login: '/api/auth/login', resume: '/api/sync/resume' })
})
