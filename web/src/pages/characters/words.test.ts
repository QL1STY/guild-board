import { expect, test } from 'vitest'
import { ringFill } from '../../frame/freshview.ts'
import type { CharSync } from '../../types.ts'
import { CALCULATOR_OFF, FOUR_AT_MOST, LOGIN_FIRST, NOT_YOURS, charactersFresh } from './words.ts'

const NOW = new Date('2026-10-25T07:20:00+00:00')
const base: CharSync = {
  can_refresh: true, wait_minutes: null, reading: false, blocked: null, read_at: '2026-10-25T07:00:00+00:00', calculator: 'on', message: null, every_minutes: 360,
}

test('the plain sentences of the Characters pages are the plan\'s', () => {
  expect(FOUR_AT_MOST).toBe('Four at most: take one out first.')
  expect(NOT_YOURS).toBe('Not yours yet')
  expect(CALCULATOR_OFF).toBe(
    "Calculator sync is off in HoYoLAB, so Guild Board can't see what you hold. Switch it on in HoYoLAB's Enhancement Progression Calculator, or type what you hold here.",
  )
})

test('a read that can be repeated shows its age in gold and says it reads again by itself', () => {
  expect(charactersFresh(base, NOW, null)).toEqual({
    tone: 'gold',
    fill: ringFill(base.read_at, 360, NOW),
    label: '20 min ago',
    tip: 'Read from HoYoLAB 20 min ago. Reads again by itself every 6 hours.',
    turning: false,
  })
})

test('the cadence in the tip comes from the model, not from a typed 6', () => {
  expect(charactersFresh({ ...base, every_minutes: 30 }, NOW, null).tip).toBe(
    'Read from HoYoLAB 20 min ago. Reads again by itself every 30 minutes.',
  )
  expect(charactersFresh({ ...base, every_minutes: 60 }, NOW, null).tip).toMatch(/every hour\.$/)
  expect(charactersFresh({ ...base, every_minutes: 120 }, NOW, null).tip).toMatch(/every 2 hours\.$/)
})

test('before the first read the ring is grey and says so', () => {
  const view = charactersFresh({ ...base, read_at: null }, NOW, null)
  expect(view).toMatchObject({ tone: 'grey', fill: 0, label: 'Not read yet', turning: false })
  expect(view.tip).toBe('Not read from HoYoLAB yet. Reads again by itself every 6 hours.')
})

test('a read within five minutes of a run says how long to wait, and keeps the fill', () => {
  const sync = { ...base, can_refresh: false, wait_minutes: 4, read_at: '2026-10-25T07:18:00+00:00' }
  const view = charactersFresh(sync, NOW, null)
  expect(view.tone).toBe('gold')
  expect(view.fill).toBe(ringFill(sync.read_at, 360, NOW))
  expect(view.label).toBe('2 min ago')
  expect(view.tip.endsWith('Try again in 4 minutes.')).toBe(true)
  expect(view.tip).toBe('Read from HoYoLAB 2 min ago. Reads again by itself every 6 hours. Try again in 4 minutes.')
  expect(charactersFresh({ ...sync, wait_minutes: 1 }, NOW, null).tip.endsWith('Try again in 1 minute.')).toBe(true)
})

test('while HoYoLAB is being read the ring turns and says so', () => {
  expect(charactersFresh({ ...base, reading: true, can_refresh: false }, NOW, null)).toEqual({
    tone: 'gold',
    fill: ringFill(base.read_at, 360, NOW),
    label: 'Reading…',
    tip: 'Reading your characters from HoYoLAB…',
    turning: true,
  })
})

test('without a login the ring is amber and the tip is the message of the core', () => {
  const view = charactersFresh({ ...base, can_refresh: false, read_at: null, message: LOGIN_FIRST }, NOW, null)
  expect(view).toMatchObject({ tone: 'amber', label: 'Log in', tip: LOGIN_FIRST, turning: false })
  expect(LOGIN_FIRST).toBe('Log in to HoYoLAB to see your builds.')
})

test('another message of the core comes first in the tip, and the ring stays gold', () => {
  const view = charactersFresh({ ...base, message: 'HoYoLAB did not answer.' }, NOW, null)
  expect(view.tone).toBe('gold')
  expect(view.tip).toBe('HoYoLAB did not answer. Read from HoYoLAB 20 min ago. Reads again by itself every 6 hours.')
})

test('with the calculator sync off the ring is amber and the tip says how to switch it on', () => {
  const view = charactersFresh({ ...base, calculator: 'off' }, NOW, null)
  expect(view).toMatchObject({ tone: 'amber', label: 'Calculator off', turning: false })
  expect(view.tip).toBe(`Read from HoYoLAB 20 min ago. ${CALCULATOR_OFF}`)
  expect(charactersFresh({ ...base, calculator: 'off', read_at: null }, NOW, null).tip).toBe(`Not read from HoYoLAB yet. ${CALCULATOR_OFF}`)
  expect(charactersFresh({ ...base, calculator: 'unknown' }, NOW, null).tone).toBe('gold')
})

test('a refusal of the core is the tip, over the age, until the next model', () => {
  const view = charactersFresh({ ...base, can_refresh: false, wait_minutes: 3 }, NOW, 'Wait 3 minutes.')
  expect(view).toMatchObject({ tone: 'gold', label: '20 min ago', tip: 'Wait 3 minutes.', turning: false })
})

test('with the login to give again the ring is amber, says Log in and does not say it reads by itself', () => {
  const view = charactersFresh({ ...base, can_refresh: false, blocked: 'login_needed' }, NOW, null)
  expect(view).toMatchObject({ tone: 'amber', label: 'Log in', turning: false })
  expect(view.tip).toBe('Read from HoYoLAB 20 min ago. Log in to HoYoLAB so that Guild Board can read your account.')
  expect(view.tip).not.toContain('by itself')
})

test('with a check to pass the ring is amber, says Check needed and does not say it reads by itself', () => {
  const view = charactersFresh({ ...base, can_refresh: false, blocked: 'verification_needed' }, NOW, null)
  expect(view).toMatchObject({ tone: 'amber', label: 'Check needed', turning: false })
  expect(view.tip).toBe('Read from HoYoLAB 20 min ago. HoYoLAB asked for a verification check. Finish it from the sync panel first.')
  expect(view.tip).not.toContain('by itself')
})

test('with the sync paused the ring is grey and the tip says to resume it', () => {
  const view = charactersFresh({ ...base, can_refresh: false, blocked: 'paused' }, NOW, null)
  expect(view).toMatchObject({ tone: 'grey', label: '20 min ago', turning: false })
  expect(view.tip).toBe('Read from HoYoLAB 20 min ago. Syncing is paused. Resume it in Settings.')
  expect(view.tip).not.toContain('by itself')
})
