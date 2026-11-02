import { expect, test } from 'vitest'
import { buttonsOf, kindLabel, releasedText } from './whatsnew.ts'

test('a kind is a tag, and a plain line has none', () => {
  expect(kindLabel('new')).toBe('NEW')
  expect(kindLabel('better')).toBe('BETTER')
  expect(kindLabel('fixed')).toBe('FIXED')
  expect(kindLabel(null)).toBeNull()
})

test('the release date is written out, and left out when the core does not know it', () => {
  expect(releasedText('2026-10-26')).toBe('Released 26 October 2026')
  expect(releasedText('2026-01-05')).toBe('Released 5 January 2026')
  expect(releasedText(null)).toBeNull()
  expect(releasedText('2026-13-01')).toBeNull()
  expect(releasedText('soon')).toBeNull()
})

test('before an update the list offers Later and Update now; after one, Got it alone', () => {
  expect(buttonsOf('before')).toEqual({ close: 'Later', install: 'Update now' })
  expect(buttonsOf('after')).toEqual({ close: 'Got it', install: null })
})
