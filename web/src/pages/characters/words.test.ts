import { expect, test } from 'vitest'
import type { CharSync } from '../../types.ts'
import { CALCULATOR_OFF, FOUR_AT_MOST, NOT_YOURS, syncWords } from './words.ts'

const NOW = new Date('2026-10-25T07:20:00+00:00')
const base: CharSync = {
  can_refresh: true, wait_minutes: null, reading: false, read_at: '2026-10-25T07:00:00+00:00', calculator: 'on', message: null,
}

test('the plain sentences of the Characters pages are the plan\'s', () => {
  expect(FOUR_AT_MOST).toBe('Four at most: take one out first.')
  expect(NOT_YOURS).toBe('Not yours yet')
  expect(CALCULATOR_OFF).toBe(
    "Calculator sync is off in HoYoLAB, so Guild Board can't see what you hold. Switch it on in HoYoLAB's Enhancement Progression Calculator, or type what you hold here.",
  )
})

test('a read that can be repeated offers Refresh and says when HoYoLAB was last read', () => {
  const view = syncWords(base, NOW)
  expect(view).toEqual({ button: 'Refresh', disabled: false, lines: ['Read from HoYoLAB 20 min ago.'] })
})

test('before the first read it says so', () => {
  expect(syncWords({ ...base, read_at: null }, NOW).lines).toEqual(['Not read from HoYoLAB yet.'])
})

test('a refresh within five minutes of a run shows the minutes to wait, and the button rests', () => {
  const view = syncWords({ ...base, can_refresh: false, wait_minutes: 4, read_at: '2026-10-25T07:18:00+00:00' }, NOW)
  expect(view.disabled).toBe(true)
  expect(view.button).toBe('Refresh')
  expect(view.lines).toEqual(['Read from HoYoLAB 2 min ago.', 'Try again in 4 minutes.'])
  expect(syncWords({ ...base, can_refresh: false, wait_minutes: 1 }, NOW).lines.at(-1)).toBe('Try again in 1 minute.')
})

test('while HoYoLAB is being read the button says so and rests', () => {
  const view = syncWords({ ...base, reading: true, can_refresh: false }, NOW)
  expect(view).toEqual({ button: 'Reading…', disabled: true, lines: ['Reading your characters from HoYoLAB…'] })
})

test('a message of the core comes first, and the button rests when nothing can be read', () => {
  const view = syncWords({ ...base, can_refresh: false, read_at: null, message: 'Log in to HoYoLAB to see your builds.' }, NOW)
  expect(view.disabled).toBe(true)
  expect(view.lines).toEqual(['Log in to HoYoLAB to see your builds.'])
})

test('with the calculator\'s sync off the page says how to switch it on, in the plan\'s words', () => {
  const view = syncWords({ ...base, calculator: 'off' }, NOW)
  expect(view.lines).toEqual(['Read from HoYoLAB 20 min ago.', CALCULATOR_OFF])
  expect(syncWords({ ...base, calculator: 'unknown' }, NOW).lines).toEqual(['Read from HoYoLAB 20 min ago.'])
})
