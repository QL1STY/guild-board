import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { readPlacement, restoredBounds, writePlacement, type Bounds } from '../src/placement.js'

// The player's displays: the ultrawide (main) and the 2K one to its right.
const WORK: Bounds[] = [
  { x: 0, y: 0, width: 3440, height: 1400 },
  { x: 3440, y: 0, width: 2560, height: 1400 },
]

let folder = ''
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'gb-placement-'))
})
afterEach(() => {
  rmSync(folder, { recursive: true, force: true })
})

test('a written placement reads back the same', () => {
  const file = join(folder, 'window.json')
  const place = { x: 100, y: 50, width: 1640, height: 1100, maximized: false }
  writePlacement(file, place)
  expect(readPlacement(file)).toEqual(place)
  writePlacement(file, { ...place, maximized: true })
  expect(readPlacement(file)).toEqual({ ...place, maximized: true })
})

test('a write leaves no part file behind', () => {
  const file = join(folder, 'window.json')
  writePlacement(file, { x: 1, y: 2, width: 300, height: 400, maximized: false })
  expect(readFileSync(file, 'utf8')).toContain('"width"')
  expect(() => readFileSync(file + '.part')).toThrow()
})

test('a missing file is no placement', () => {
  expect(readPlacement(join(folder, 'window.json'))).toBeNull()
})

test('Qt’s blob is no placement, so the first start after the update opens at the first-run place', () => {
  const file = join(folder, 'window.json')
  writeFileSync(file, '{"geometry": "AdnQywADAAAAAAAA"}')
  expect(readPlacement(file)).toBeNull()
})

test('unreadable JSON, a non-object and a half-numeric object are no placement', () => {
  const file = join(folder, 'window.json')
  for (const text of ['{not json', '', 'null', '[1,2,3,4]', '"x"', '{"x":1,"y":2,"width":"3","height":4}', '{"x":1,"y":2,"width":3}']) {
    writeFileSync(file, text)
    expect(readPlacement(file), text).toBeNull()
  }
})

test('numbers that are not finite are no placement', () => {
  const file = join(folder, 'window.json')
  writeFileSync(file, '{"x":1e999,"y":2,"width":3,"height":4,"maximized":false}')
  expect(readPlacement(file)).toBeNull()
})

test('a placement with no maximized flag is read as not maximized', () => {
  const file = join(folder, 'window.json')
  writeFileSync(file, '{"x":5,"y":6,"width":700,"height":800}')
  expect(readPlacement(file)).toEqual({ x: 5, y: 6, width: 700, height: 800, maximized: false })
})

test('no placement opens maximized on the second display', () => {
  expect(restoredBounds(null, WORK, 0)).toEqual({ bounds: WORK[1], maximized: true })
})

test('a single display is the first-run place too', () => {
  expect(restoredBounds(null, [WORK[0]], 0)).toEqual({ bounds: WORK[0], maximized: true })
})

test('when the main display is not the first, the first one that is not main is used', () => {
  expect(restoredBounds(null, WORK, 1)).toEqual({ bounds: WORK[0], maximized: true })
})

test('a place off every display falls back to the first-run place', () => {
  const far = { x: 9000, y: 100, width: 1640, height: 1100, maximized: false }
  expect(restoredBounds(far, WORK, 0)).toEqual({ bounds: WORK[1], maximized: true })
})

test('a place with less than 100 by 100 on a display falls back, and exactly 100 by 100 stays', () => {
  const sliver = { x: 3440 - 99, y: 100, width: 1640, height: 1100, maximized: false } // 99 px on the main display
  const edge = { x: 3440 - 100, y: 100, width: 1640, height: 1100, maximized: false } // 100 px
  expect(restoredBounds(sliver, [WORK[0]], 0)).toEqual({ bounds: WORK[0], maximized: true })
  expect(restoredBounds(edge, [WORK[0]], 0)).toEqual({ bounds: { x: edge.x, y: edge.y, width: 1640, height: 1100 }, maximized: false })
  const short = { x: 100, y: 1400 - 99, width: 1640, height: 1100, maximized: false }
  expect(restoredBounds(short, [WORK[0]], 0).maximized).toBe(true)
})

test('a visible place is kept, with its maximized flag', () => {
  const visible = { x: 3500, y: 40, width: 1640, height: 1100, maximized: false }
  expect(restoredBounds(visible, WORK, 0)).toEqual({ bounds: { x: 3500, y: 40, width: 1640, height: 1100 }, maximized: false })
  expect(restoredBounds({ ...visible, maximized: true }, WORK, 0).maximized).toBe(true)
})

test('a place that shows on only one of two displays is kept', () => {
  const straddling = { x: 3000, y: 0, width: 1000, height: 800, maximized: false }
  expect(restoredBounds(straddling, WORK, 0).maximized).toBe(false)
})

test('no displays at all gives a plain window', () => {
  const result = restoredBounds(null, [], 0)
  expect(result.maximized).toBe(false)
  expect(result.bounds.width).toBeGreaterThan(0)
})
