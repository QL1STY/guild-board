import { expect, test } from 'vitest'
import { nextIndex } from './roving.ts'

test('arrow keys move one step and stop at the ends', () => {
  expect(nextIndex('ArrowRight', 0, 3)).toBe(1)
  expect(nextIndex('ArrowDown', 1, 3)).toBe(2)
  expect(nextIndex('ArrowRight', 2, 3)).toBe(2)
  expect(nextIndex('ArrowLeft', 1, 3)).toBe(0)
  expect(nextIndex('ArrowUp', 0, 3)).toBe(0)
})

test('home and end jump to the first and the last', () => {
  expect(nextIndex('Home', 2, 3)).toBe(0)
  expect(nextIndex('End', 0, 3)).toBe(2)
})

test('other keys are not handled', () => {
  expect(nextIndex('Tab', 1, 3)).toBeNull()
  expect(nextIndex('a', 1, 3)).toBeNull()
  expect(nextIndex('ArrowRight', 0, 0)).toBeNull()
})

test('in a grid, left and right move a whole column', () => {
  expect(nextIndex('ArrowRight', 3, 84, 7)).toBe(10)
  expect(nextIndex('ArrowLeft', 10, 84, 7)).toBe(3)
  expect(nextIndex('ArrowLeft', 3, 84, 7)).toBe(3) // there is no column to the left
  expect(nextIndex('ArrowDown', 3, 84, 7)).toBe(4)
})
