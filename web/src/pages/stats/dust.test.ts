import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { startDust } from './dust.ts'

/** The frames the fake screen has asked for, each run with the time given to `frameAt`. */
let frames: Map<number, FrameRequestCallback>
let nextFrame: number

/** Runs the frame the dust asked for, as the screen does at `now` milliseconds. */
function frameAt(now: number): void {
  const due = [...frames.values()]
  frames.clear()
  for (const callback of due) callback(now)
}

/** A canvas in a 300 × 200 box whose drawing counts the frames drawn: each draw clears it first. */
function fakeCanvas() {
  const drawn = { count: 0 }
  const context = {
    setTransform: () => undefined,
    clearRect: () => {
      drawn.count += 1
    },
    beginPath: () => undefined,
    arc: () => undefined,
    fill: () => undefined,
    fillStyle: '',
  }
  const canvas = {
    width: 0,
    height: 0,
    dataset: {} as Record<string, string>,
    parentElement: { clientWidth: 300, clientHeight: 200 },
    getContext: () => context,
  }
  return { canvas: canvas as unknown as HTMLCanvasElement, drawn }
}

beforeEach(() => {
  frames = new Map()
  nextFrame = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    nextFrame += 1
    frames.set(nextFrame, callback)
    return nextFrame
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  vi.stubGlobal('document', { hidden: false, visibilityState: 'visible', addEventListener: () => undefined, removeEventListener: () => undefined })
  vi.stubGlobal('window', { devicePixelRatio: 1, addEventListener: () => undefined, removeEventListener: () => undefined })
  vi.stubGlobal('ResizeObserver', undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** How many frames the dust draws in one second of a screen at `hz`. */
function drawnInASecond(hz: number): number {
  const { canvas, drawn } = fakeCanvas()
  const stop = startDust(canvas, { count: 20, reduced: false })
  const before = drawn.count // the first picture, drawn at once
  for (let at = 1; at <= hz; at += 1) frameAt(1000 + (at * 1000) / hz)
  const count = drawn.count - before
  stop()
  return count
}

test('the dust draws at most about 60 frames a second, however fast the screen asks', () => {
  // The window draws at the monitor's rate: a fast screen asks for every frame it shows.
  expect(drawnInASecond(60)).toBe(60)
  for (const hz of [120, 144, 165, 240]) {
    const count = drawnInASecond(hz)
    expect(count, `${hz} Hz`).toBeLessThanOrEqual(61)
    expect(count, `${hz} Hz`).toBeGreaterThanOrEqual(45)
  }
})

test('a frame skipped moves nothing: the dust drifts by the time since the frame last drawn', () => {
  const { canvas, drawn } = fakeCanvas()
  const stop = startDust(canvas, { count: 5, reduced: false })
  frameAt(1000)
  const after = drawn.count
  frameAt(1008) // 8 ms on: too soon, nothing drawn, and the dust asks for the next frame
  expect(drawn.count).toBe(after)
  expect(frames.size).toBe(1)
  frameAt(1017)
  expect(drawn.count).toBe(after + 1)
  stop()
})

test('stopping the dust lets go of its canvas: no frame is asked for, and the canvas is emptied to nothing', () => {
  const { canvas, drawn } = fakeCanvas()
  const stop = startDust(canvas, { count: 5, reduced: false })
  expect([canvas.width, canvas.height]).toEqual([300, 200])
  frameAt(1000)
  stop()
  expect([canvas.width, canvas.height]).toEqual([0, 0])
  expect(frames.size).toBe(0)
  const count = drawn.count
  frameAt(2000)
  expect(drawn.count).toBe(count)
  expect(canvas.dataset.running).toBe('false')
})
