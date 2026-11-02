import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { COLLECT_AFTER_MS, COLLECT_EVERY_MS, collectEveryMinute, collectSoon } from './collect.ts'

const asked = vi.fn()
const held = globalThis as { gbCollect?: () => void }

beforeEach(() => {
  vi.useFakeTimers()
  asked.mockClear()
  held.gbCollect = asked
})

afterEach(() => {
  vi.useRealTimers()
  delete held.gbCollect
})

test('a collection waits until the page has settled, and a run of page changes costs one', () => {
  collectSoon()
  vi.advanceTimersByTime(COLLECT_AFTER_MS - 1)
  expect(asked).not.toHaveBeenCalled()
  collectSoon() // the arrow held down: another card
  vi.advanceTimersByTime(COLLECT_AFTER_MS - 1)
  expect(asked).not.toHaveBeenCalled()
  vi.advanceTimersByTime(1)
  expect(asked).toHaveBeenCalledTimes(1)
  vi.advanceTimersByTime(COLLECT_AFTER_MS * 5)
  expect(asked).toHaveBeenCalledTimes(1)
})

test('a page that stays open is collected every minute, until it is told to stop', () => {
  const stop = collectEveryMinute()
  vi.advanceTimersByTime(COLLECT_EVERY_MS * 3)
  expect(asked).toHaveBeenCalledTimes(3)
  stop()
  vi.advanceTimersByTime(COLLECT_EVERY_MS * 3)
  expect(asked).toHaveBeenCalledTimes(3)
})

test('in a plain browser, with no way to ask, nothing happens', () => {
  delete held.gbCollect
  collectSoon()
  const stop = collectEveryMinute()
  expect(() => vi.advanceTimersByTime(COLLECT_EVERY_MS * 2)).not.toThrow()
  stop()
})
