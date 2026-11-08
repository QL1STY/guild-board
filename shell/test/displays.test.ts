import { expect, test } from 'vitest'
import { displayFor, displayList, type DisplayInfo } from '../src/displays.js'

// The player's setup: the ultrawide (main) and the 2K display to its right. Electron's ids are whatever Windows gave.
const ULTRAWIDE: DisplayInfo = { id: 11, bounds: { x: 0, y: 0, width: 3440, height: 1440 }, scaleFactor: 1, primary: true }
const TWO_K: DisplayInfo = { id: 22, bounds: { x: 3440, y: 0, width: 2560, height: 1440 }, scaleFactor: 1, primary: false }

test('the list names each display by its id and numbers them from the left, in physical pixels', () => {
  expect(displayList([ULTRAWIDE, TWO_K])).toEqual([
    { name: '11', label: 'Display 1, 3440 × 1440, main', primary: true },
    { name: '22', label: 'Display 2, 2560 × 1440', primary: false },
  ])
})

test('the numbering follows the position, not the order Electron lists them in', () => {
  const list = displayList([TWO_K, ULTRAWIDE])
  expect(list.map((entry) => entry.name)).toEqual(['11', '22'])
  expect(list[1].label).toBe('Display 2, 2560 × 1440')
})

test('a display above another sorts by its top when the lefts are equal', () => {
  const upper = { ...TWO_K, id: 33, bounds: { x: 0, y: -1440, width: 2560, height: 1440 } }
  expect(displayList([ULTRAWIDE, upper]).map((entry) => entry.name)).toEqual(['33', '11'])
})

test('the sizes follow the scale factor, rounded', () => {
  const scaled = { ...ULTRAWIDE, bounds: { x: 0, y: 0, width: 2293, height: 960 }, scaleFactor: 1.5 }
  expect(displayList([scaled])[0].label).toBe('Display 1, 3440 × 1440, main')
  const odd = { ...TWO_K, bounds: { x: 3440, y: 0, width: 1707, height: 960 }, scaleFactor: 1.5 }
  expect(displayList([scaled, odd])[1].label).toBe('Display 2, 2561 × 1440')
})

test('no displays, no entries', () => {
  expect(displayList([])).toEqual([])
})

test('displayFor returns the named display', () => {
  expect(displayFor([ULTRAWIDE, TWO_K], '22')).toBe(TWO_K)
  expect(displayFor([ULTRAWIDE, TWO_K], '11')).toBe(ULTRAWIDE)
})

test('displayFor returns the main display for no name, an unknown name, and a Qt screen name', () => {
  expect(displayFor([ULTRAWIDE, TWO_K], '')).toBe(ULTRAWIDE)
  expect(displayFor([ULTRAWIDE, TWO_K], '99')).toBe(ULTRAWIDE)
  expect(displayFor([ULTRAWIDE, TWO_K], '\\\\.\\DISPLAY2')).toBe(ULTRAWIDE)
  expect(displayFor([TWO_K, ULTRAWIDE], '\\\\.\\DISPLAY1')).toBe(ULTRAWIDE)
})

test('with no main display marked, the first one is used', () => {
  const none = [{ ...ULTRAWIDE, primary: false }, TWO_K]
  expect(displayFor(none, 'x').id).toBe(11)
})
