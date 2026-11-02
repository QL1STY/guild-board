import { expect, test } from 'vitest'
import type { Backlog } from '../types.ts'
import { counterFigure, counterSign, exploredShare, statusTone } from './backlogview.ts'

type Counter = Backlog['counters'][number]
const counter = (over: Partial<Counter>): Counter => ({
  id: 'chests', label: 'Chests', value: 0, delta: null, delta_note: null, text: null, ...over,
})

test('each counter has its sign, and the Archon Quests the book', () => {
  expect(['chests', 'oculi', 'achievements', 'waypoints', 'archon'].map(counterSign)).toEqual([
    'chest', 'oculus', 'cup', 'waypoint', 'book',
  ])
  expect(counterSign('something-new')).toBeNull()
})

test('a counter counts up to its number, with the words after it', () => {
  expect(counterFigure(counter({ value: 5349 }))).toEqual({ value: 5349, unit: '' })
  expect(counterFigure(counter({ id: 'archon', value: 2, text: '2 open' }))).toEqual({ value: 2, unit: ' open' })
  expect(counterFigure(counter({ id: 'archon', value: 1234, text: '1,234 open' }))).toEqual({ value: 1234, unit: ' open' })
})

test('words that are not a number and its unit are shown as they are', () => {
  expect(counterFigure(counter({ id: 'archon', value: 0, text: 'All finished' }))).toEqual({ text: 'All finished' })
  expect(counterFigure(counter({ id: 'archon', value: 3, text: 'Chapter 3 open' }))).toEqual({ text: 'Chapter 3 open' })
})

test('an entry of Closest to done is explored by what is not left', () => {
  expect(exploredShare(1)).toBe(99)
  expect(exploredShare(1.8)).toBeCloseTo(98.2)
  expect(exploredShare(0)).toBe(100)
  expect(exploredShare(120)).toBe(0) // never below nothing
  expect(exploredShare(-3)).toBe(100) // and never above all
})

test('a chapter in progress is in gold, and one not started is outlined', () => {
  expect(statusTone('In progress')).toBe('gold')
  expect(statusTone('Not started')).toBe('outline')
  expect(statusTone('Something else')).toBe('outline')
})
