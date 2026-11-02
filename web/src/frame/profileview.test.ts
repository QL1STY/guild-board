import { expect, test } from 'vitest'
import type { Settings, Status } from '../types.ts'
import { cardText, isPaused, linksOf, primoName, primoText, profileRows, resinText, syncRows } from './profileview.ts'

type Account = NonNullable<Status['account']>

const ACCOUNT: Account = {
  nickname: 'Traveler', server: 'os_euro', uid: 700000001, adventure_rank: 60, days_active: 1823,
  resin: 5, resin_max: 200, resin_read_at: '2026-10-13T08:00:00+00:00', resin_full_at: null, picture_url: null,
}

// Local times, so that the tests hold in any time zone. Tuesday 13 Oct 2026, 08:10.
const NOW = new Date(2026, 9, 13, 8, 10)
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).toISOString()

test('resin: the figure, the maximum, and how long to full', () => {
  // Full on Wed 14 Oct at 09:10, 1 d 1 h ahead; the day is named, as the Board's Resin widget names it.
  const text = resinText({ ...ACCOUNT, resin_full_at: at(14, 9, 10) }, NOW)
  expect(text).toEqual({ value: '5', max: '200', sub: 'full in 1 d 1 h', title: 'Full Wed 09:10' })
})

test('resin: within a day the tooltip gives the time of day alone, as the Board does', () => {
  const text = resinText({ ...ACCOUNT, resin: 150, resin_full_at: at(13, 21, 42) }, NOW)
  expect(text).toEqual({ value: '150', max: '200', sub: 'full in 13 h 32 min', title: 'Full 21:42' })
})

test('resin: full says so, whatever the notes say of the time', () => {
  expect(resinText({ ...ACCOUNT, resin: 200, resin_full_at: at(13, 1) }, NOW)).toEqual({
    value: '200', max: '200', sub: 'Full', title: null,
  })
  // The full time has passed since the last read.
  expect(resinText({ ...ACCOUNT, resin: 190, resin_full_at: at(13, 7) }, NOW)).toMatchObject({ value: '200', sub: 'Full' })
  // Above the maximum, as events give, the count is shown as it is.
  expect(resinText({ ...ACCOUNT, resin: 230 }, NOW)).toMatchObject({ value: '230', max: '200', sub: 'Full' })
})

test('resin: notes that give no full time leave the small line empty', () => {
  expect(resinText(ACCOUNT, NOW)).toEqual({ value: '5', max: '200', sub: '', title: null })
})

test('resin: nothing to show without an account or without notes', () => {
  expect(resinText(null, NOW)).toBeNull()
  expect(resinText({ ...ACCOUNT, resin: null, resin_max: null }, NOW)).toBeNull()
})

test('primogems: the estimate, its pulls, and a tooltip that names both', () => {
  expect(primoText({ primogems: 12480, fates: 3, pulls: 78 })).toEqual({
    value: '12,480', sub: '78 pulls saved', title: '12,480 primogems and 3 fates, from the Pulls page',
  })
  expect(primoText({ primogems: 12480, fates: 0, pulls: 78 }).title).toBe('12,480 primogems, from the Pulls page')
  expect(primoText({ primogems: 160, fates: 1, pulls: 2 })).toEqual({
    value: '160', sub: '2 pulls saved', title: '160 primogems and 1 fate, from the Pulls page',
  })
  expect(primoText({ primogems: 160, fates: 0, pulls: 1 }).sub).toBe('1 pull saved')
})

test('primogems: the link says what its figures are to a screen reader', () => {
  expect(primoName({ primogems: 9840, fates: 2, pulls: 75 })).toBe('9,840 primogems, 75 pulls saved')
  expect(primoName({ primogems: 1, fates: 0, pulls: 1 })).toBe('1 primogem, 1 pull saved')
  expect(primoName(null)).toBe('Primogems, set on Pulls')
})

test('primogems: with no balance typed the part points to the Pulls page', () => {
  expect(primoText(null)).toEqual({ value: 'Primogems', sub: 'Set on Pulls', title: 'Your savings from the Pulls page' })
})

test('the card: the name, the UID and the server, and the rank', () => {
  expect(cardText(ACCOUNT)).toEqual({ name: 'Traveler', line: 'UID 700000001 · Europe', ar: 'AR 60' })
  expect(cardText({ ...ACCOUNT, server: 'os_usa', adventure_rank: null })).toEqual({
    name: 'Traveler', line: 'UID 700000001 · America', ar: null,
  })
})

test('the card: a server the table does not know is shown as it is, and a missing UID is left out', () => {
  expect(cardText({ ...ACCOUNT, server: 'os_moon' }).line).toBe('UID 700000001 · os_moon')
  expect(cardText({ ...ACCOUNT, uid: null }).line).toBe('Europe')
})

test('the card: with no account, it says so and shows no rank', () => {
  expect(cardText(null)).toEqual({ name: 'Not logged in', line: '', ar: null })
})

test('the profile panel: the UID, the server, the days active and the day tracking began', () => {
  expect(profileRows(ACCOUNT, '2026-06-01')).toEqual([
    ['UID', '700000001'], ['Server', 'Europe'], ['Days active', '1,823'], ['Tracking since', '1 Jun 2026'],
  ])
  // What the core does not know is a dash.
  expect(profileRows({ ...ACCOUNT, uid: null, days_active: null }, null)).toEqual([
    ['UID', '—'], ['Server', 'Europe'], ['Days active', '—'], ['Tracking since', '—'],
  ])
})

function status(sync: Partial<Status['sync']> = {}): Status {
  return {
    sync: {
      state: 'ok', message: null, last_ok_at: at(13, 8, 6), next_at: at(13, 8, 45), manual_wait_seconds: 0,
      runs_today: 3, daily_cap: 24, manual_gap_seconds: 300, ...sync,
    },
  } as Status
}

const settings = (minutes: Settings['in_session_interval_min']) => ({ in_session_interval_min: minutes }) as Settings

test('the sync panel: the last and the next sync, the syncs today and the interval while playing', () => {
  expect(syncRows(status(), settings(30), NOW)).toEqual([
    ['Last sync', '08:06'], ['Next sync', '08:45'], ['Today', '3 of 24 syncs'], ['While playing', 'every 30 min'],
  ])
  expect(syncRows(status(), settings(60), NOW)[3]).toEqual(['While playing', 'every 60 min'])
  expect(syncRows(status(), settings(0), NOW)[3]).toEqual(['While playing', 'off'])
})

test('the sync panel: a time on another day names the day, and a time that is not known is said so', () => {
  const rows = syncRows(status({ last_ok_at: at(12, 22, 5), next_at: at(14, 3) }), settings(30), NOW)
  expect(rows[0]).toEqual(['Last sync', '12 Oct, 22:05'])
  expect(rows[1]).toEqual(['Next sync', '14 Oct, 03:00'])
  const none = syncRows(status({ last_ok_at: null, next_at: null }), settings(30), NOW)
  expect(none[0]).toEqual(['Last sync', 'Never'])
  expect(none[1]).toEqual(['Next sync', 'None planned'])
  expect(syncRows(status({ runs_today: 1 }), null, NOW)[2]).toEqual(['Today', '1 of 24 syncs'])
})

test('the sync panel: without settings read, the interval is left out', () => {
  expect(syncRows(status(), null, NOW).map(([name]) => name)).toEqual(['Last sync', 'Next sync', 'Today'])
})

test('paused: the settings decide, and without them the sync state does', () => {
  const paused = (value: boolean) => ({ sync_paused: value }) as Settings
  expect(isPaused(status(), paused(true))).toBe(true)
  expect(isPaused(status({ state: 'paused' }), paused(false))).toBe(false) // the settings are the newer word
  expect(isPaused(status({ state: 'paused' }), null)).toBe(true)
  expect(isPaused(status(), null)).toBe(false)
})

test('links: the UID is in the Akasha and Enka addresses, the Battle Chronicle is the same for everyone', () => {
  expect(linksOf({ uid: '700000001' })).toEqual([
    { label: 'Akasha: your builds ranked', url: 'https://akasha.cv/profile/700000001' },
    { label: 'Enka.Network: your showcase', url: 'https://enka.network/u/700000001' },
    { label: 'HoYoLAB: Battle Chronicle', url: 'https://act.hoyolab.com/app/community-game-records-sea/index.html#/ys' },
  ])
})

test('links: with no account there are none', () => {
  expect(linksOf(null)).toEqual([])
})
