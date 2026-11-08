import { describe, expect, test } from 'vitest'
import { type Box, drawPoster, POSTER_SIZES, type Poster, type PosterSize, posterFileName, posterLayout } from './poster.ts'

const NUMBERS = [
  { label: 'wishes', value: '1,003', since: null },
  { label: 'five-stars', value: '16', since: null },
  { label: 'primogems earned', value: '98,201', since: 'since Apr' },
  { label: 'biggest month', value: 'July', since: null },
  { label: "luckiest 5★ (Wolf's Gravestone)", value: '6', since: null },
  { label: 'longest session', value: '7 h 34', since: 'since Oct' },
]

const posterWith = (n: number, character: Poster['character'] = { name: 'Sandrone', picture: '/api/art/sandrone' }): Poster => ({
  year: 2026,
  name: 'Traveler',
  ar: 60,
  server: 'Europe',
  character,
  numbers: NUMBERS.slice(0, n),
})

const inside = (box: Box, [width, height]: readonly [number, number]): boolean =>
  box.x >= 0 && box.y >= 0 && box.w > 0 && box.h > 0 && box.x + box.w <= width && box.y + box.h <= height

const SIZES = ['story', 'wide'] as const

/** The boxes that hold words or the picture: none of them may overlap another. The night, its glow, the frame and the halo lie under them. */
const content = (boxes: Box[]): Box[] => boxes.filter((box) => !['night', 'glow', 'frame', 'halo'].includes(box.kind))

const overlap = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

test('posterFileName', () => {
  expect(posterFileName(2026, 'story')).toBe('Guild Board Wrapped 2026 Story.png')
  expect(posterFileName(2026, 'wide')).toBe('Guild Board Wrapped 2026 Wide.png')
})

test('the sizes are those of a phone story and of the player\'s screen', () => {
  expect(POSTER_SIZES).toEqual({ story: [1080, 1920], wide: [2560, 1440] })
})

/** The proportions of the picture drawn: none (the sign), a standing figure, a square one and a seated one wider than it is tall. */
const ASPECTS = [null, 0.55, 1, 1.4, 2.5] as const

describe('posterLayout', () => {
  test('posterLayout keeps every box inside the picture and lays out 6 or 4 numbers', () => {
    for (const size of SIZES)
      for (const n of [6, 4])
        for (const aspect of ASPECTS) {
          const boxes = posterLayout(posterWith(n), size, aspect)
          expect(boxes.filter((b) => b.kind === 'number')).toHaveLength(n)
          boxes.forEach((b) => expect(inside(b, POSTER_SIZES[size]), `${size} ${n} ${aspect}: ${b.kind}`).toBe(true))
        }
  })

  test('nothing that holds words or the picture overlaps anything else', () => {
    for (const size of SIZES)
      for (const n of [6, 4])
        for (const aspect of ASPECTS)
          for (const character of [{ name: 'Sandrone', picture: null }, null]) {
            const boxes = content(posterLayout(posterWith(n, character), size, aspect))
            for (const [at, one] of boxes.entries())
              for (const other of boxes.slice(at + 1))
                expect(overlap(one, other), `${size} ${n} ${aspect}: ${one.kind} and ${other.kind}`).toBe(false)
          }
  })

  test('the parts of the mockup are there, each once, with its words', () => {
    for (const size of SIZES) {
      const boxes = posterLayout(posterWith(6), size)
      const one = (kind: Box['kind']): Box => {
        const found = boxes.filter((box) => box.kind === kind)
        expect(found, kind).toHaveLength(1)
        return found[0]
      }
      expect(one('kicker').text).toBe('Wrapped · Guild Board')
      expect(one('year').text).toBe('2026')
      expect(one('who').text).toBe('Traveler · AR 60 · Europe')
      expect(one('caption').text).toBe('Sandrone')
      expect(one('picture').text).toBe('/api/art/sandrone')
      expect(one('footer').text).toBe('Tracked with Guild Board')
      expect(one('night')).toMatchObject({ x: 0, y: 0, w: POSTER_SIZES[size][0], h: POSTER_SIZES[size][1] })
    }
  })

  test('the numbers keep their order, their labels and their "since"', () => {
    for (const size of SIZES) {
      const numbers = posterLayout(posterWith(6), size).filter((box) => box.kind === 'number')
      expect(numbers.map((box) => [box.text, box.label, box.since])).toEqual(NUMBERS.map((n) => [n.value, n.label, n.since]))
    }
  })

  test('Story stacks the parts, with the numbers in two columns; four numbers in two rows', () => {
    const rowsAndColumns = (n: number) => {
      const numbers = posterLayout(posterWith(n), 'story').filter((box) => box.kind === 'number')
      return [new Set(numbers.map((box) => box.y)).size, new Set(numbers.map((box) => box.x)).size]
    }
    expect(rowsAndColumns(6)).toEqual([3, 2])
    expect(rowsAndColumns(4)).toEqual([2, 2])
    const boxes = posterLayout(posterWith(6), 'story')
    const at = (kind: Box['kind']) => boxes.find((box) => box.kind === kind)!
    const order = ['kicker', 'year', 'who', 'picture', 'caption', 'number', 'footer'] as const
    for (let step = 1; step < order.length; step += 1) expect(at(order[step]).y).toBeGreaterThan(at(order[step - 1]).y)
  })

  test('Wide puts the picture beside the words: three columns of numbers, or two for four', () => {
    for (const n of [6, 4]) {
      const boxes = posterLayout(posterWith(n), 'wide')
      const picture = boxes.find((box) => box.kind === 'picture')!
      const words = boxes.filter((box) => ['kicker', 'year', 'who', 'number', 'footer'].includes(box.kind))
      for (const box of words) expect(box.x + box.w, box.kind).toBeLessThanOrEqual(picture.x)
      const numbers = boxes.filter((box) => box.kind === 'number')
      expect(new Set(numbers.map((box) => box.x)).size).toBe(n === 6 ? 3 : 2)
      expect(new Set(numbers.map((box) => box.y)).size).toBe(2)
    }
  })

  test('a picture\'s box is the picture itself, in its own proportions, and the halo is round behind its middle', () => {
    for (const size of SIZES)
      for (const aspect of ASPECTS.filter((one) => one !== null)) {
        const boxes = posterLayout(posterWith(6), size, aspect)
        const picture = boxes.find((box) => box.kind === 'picture')!
        const halo = boxes.find((box) => box.kind === 'halo')!
        expect(picture.w / picture.h).toBeCloseTo(aspect, 6)
        expect(halo.w).toBeCloseTo(halo.h, 6)
        // Behind its middle, moved only as far as keeps the halo in the picture's room.
        expect(Math.abs(halo.x + halo.w / 2 - (picture.x + picture.w / 2))).toBeLessThan(1)
      }
  })

  test('the player is named by what is known: no AR, no server or nothing at all', () => {
    const who = (poster: Poster) => posterLayout(poster, 'story').find((box) => box.kind === 'who')?.text
    expect(who({ ...posterWith(6), ar: null })).toBe('Traveler · Europe')
    expect(who({ ...posterWith(6), server: '' })).toBe('Traveler · AR 60')
    expect(who({ ...posterWith(6), name: '', ar: null, server: '' })).toBeUndefined()
  })

  test('a year with no character of the year has no caption, and its picture box holds no address', () => {
    const boxes = posterLayout(posterWith(6, null), 'story')
    expect(boxes.filter((box) => box.kind === 'caption')).toHaveLength(0)
    expect(boxes.find((box) => box.kind === 'picture')!.text).toBeUndefined()
  })
})

// ---------- drawPoster, on a context that records what it is asked to draw

type Call = { name: string; args: unknown[]; font: string; textAlign: string }

/** The size in pixels a canvas font names ("800 64px ..."). */
const px = (font: string): number => Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 10)

/** A 2D context that draws nothing and remembers each call, with the font and alignment it was made in. Each character is half its font's size wide. */
function recorder(): { ctx: CanvasRenderingContext2D; calls: Call[] } {
  const calls: Call[] = []
  const state: Record<string, unknown> = { font: '10px sans-serif', textAlign: 'start' }
  const gradient = { addColorStop: () => {} }
  const target: Record<string, unknown> = {}
  const ctx = new Proxy(target, {
    get(_, key) {
      if (typeof key !== 'string') return undefined
      if (key in state) return state[key]
      if (key === 'measureText') return (text: string) => ({ width: text.length * px(String(state.font)) * 0.5 })
      if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => gradient
      return (...args: unknown[]) => {
        calls.push({ name: key, args, font: String(state.font), textAlign: String(state.textAlign) })
      }
    },
    set(_, key, value) {
      state[String(key)] = value
      return true
    },
    has: () => true,
  })
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls }
}

const drawnWords = (calls: Call[]): string[] => calls.filter((call) => call.name === 'fillText').map((call) => String(call.args[0]))

describe('drawPoster', () => {
  const picture = { image: {} as CanvasImageSource, width: 600, height: 1100 }

  test('draws the name, AR and server, the year, the character and the numbers, and never the UID or an account id', () => {
    for (const size of SIZES) {
      const { ctx, calls } = recorder()
      // What a careless caller might pass along: none of it is drawn.
      const poster = { ...posterWith(6), uid: 700000001, account_id: 'ltuid-123', hoyolab: 'mid-456' } as Poster
      drawPoster(ctx, poster, size, { character: picture })
      const words = drawnWords(calls).join('\n')
      expect(words).toContain('Traveler · AR 60 · Europe')
      expect(words).toContain('2026')
      expect(words).toContain('Sandrone')
      expect(words).toContain('Character of the year · ')
      expect(words).toContain('WRAPPED · GUILD BOARD')
      expect(words).toContain('Tracked with Guild Board')
      for (const number of NUMBERS) {
        expect(words).toContain(number.value)
        if (number.since !== null) expect(words).toContain(number.since)
      }
      for (const secret of ['700000001', 'ltuid', 'mid-456']) expect(words).not.toContain(secret)
      const drawnAsText = new Set(drawnWords(calls))
      const allowed = new Set([
        'WRAPPED · GUILD BOARD', '2026', 'Traveler · AR 60 · Europe', 'Character of the year · ', 'Sandrone', 'Tracked with Guild Board',
        ...NUMBERS.flatMap((n) => [n.value, n.since ?? '']),
      ])
      const labels = [...drawnAsText].filter((word) => !allowed.has(word))
      // What is left is the labels, each whole or shortened to fit with "…".
      for (const word of labels) expect(NUMBERS.some((n) => n.label === word || (word.endsWith('…') && n.label.startsWith(word.slice(0, -1))))).toBe(true)
    }
  })

  /** Where a picture of `width` by `height` is drawn on the poster: [x, y, w, h]. */
  const drawn = (poster: Poster, size: PosterSize, width: number, height: number): number[] => {
    const { ctx, calls } = recorder()
    const image = {} as CanvasImageSource
    drawPoster(ctx, poster, size, { character: { image, width, height } })
    const images = calls.filter((call) => call.name === 'drawImage')
    expect(images).toHaveLength(1)
    expect(images[0].args[0]).toBe(image)
    return (images[0].args as number[]).slice(1)
  }
  /** The room the picture has: the box the layout gives when no picture is drawn, where the sign goes. */
  const roomOf = (poster: Poster, size: PosterSize): Box => posterLayout(poster, size).find((box) => box.kind === 'picture')!
  /** The pictures' proportions as the game has them: a standing figure, a square one, a seated one wider than it is tall. */
  const PORTRAITS = [[600, 1100], [1000, 1000], [1400, 1000]] as const

  test('draws the character\'s picture when it is had, and the drawn sign when it is not', () => {
    for (const size of SIZES) {
      // Whole and in its own proportions, in the box the layout gives a picture of those proportions.
      const [x, y, w, h] = drawn(posterWith(6), size, picture.width, picture.height)
      expect(w / h).toBeCloseTo(600 / 1100, 3)
      const box = posterLayout(posterWith(6), size, 600 / 1100).find((one) => one.kind === 'picture')!
      expect([x, y, w, h].map(Math.round)).toEqual([box.x, box.y, box.w, box.h].map(Math.round))

      const missing = recorder()
      drawPoster(missing.ctx, posterWith(6), size, { character: null })
      expect(missing.calls.filter((call) => call.name === 'drawImage')).toHaveLength(0)
      expect(missing.calls.filter((call) => call.name === 'stroke').length).toBeGreaterThan(0)
    }
  })

  test('in Story the picture fills its room across the whole width or height, in its middle, with no empty band above it', () => {
    for (const n of [6, 4])
      for (const [width, height] of PORTRAITS) {
        const label = `${n} numbers, ${width} × ${height}`
        const poster = posterWith(n)
        const [x, y, w, h] = drawn(poster, 'story', width, height)
        const room = roomOf(poster, 'story')
        // The room spans the poster's inner width, from the player's line to the caption.
        expect(room.w, label).toBe(POSTER_SIZES.story[0] - 2 * 72)
        // As large as the room takes: its whole width or its whole height.
        expect(Math.abs(w - room.w) < 0.5 || Math.abs(h - room.h) < 0.5, label).toBe(true)
        expect(x + w / 2, label).toBeCloseTo(room.x + room.w / 2, 3)
        expect(y + h / 2, label).toBeCloseTo(room.y + room.h / 2, 3)
        // No band of empty glow between the player's line and the picture, nor between the picture and the caption.
        const boxes = posterLayout(poster, 'story')
        const who = boxes.find((box) => box.kind === 'who')!
        const caption = boxes.find((box) => box.kind === 'caption')!
        expect(y - (who.y + who.h), label).toBeLessThan(100)
        expect(caption.y - (y + h), label).toBeLessThan(100)
      }
  })

  test('four numbers leave the picture at least the room six would, and in Wide it stands on its caption', () => {
    for (const size of SIZES)
      for (const [width, height] of PORTRAITS) {
        const [, , w6, h6] = drawn(posterWith(6), size, width, height)
        const [, , w4, h4] = drawn(posterWith(4), size, width, height)
        expect(w4 * h4).toBeGreaterThanOrEqual(w6 * h6 - 0.5)
        if (size === 'wide') {
          const [x, y, w, h] = drawn(posterWith(6), size, width, height)
          const room = roomOf(posterWith(6), 'wide')
          expect(y + h).toBeCloseTo(room.y + room.h, 3)
          expect(x + w / 2).toBeCloseTo(room.x + room.w / 2, 3)
        }
      }
  })

  test('every word stays inside the picture, a long label shrunk or shortened to fit its box', () => {
    for (const size of SIZES)
      for (const n of [6, 4]) {
        const [width] = POSTER_SIZES[size]
        const long = { ...posterWith(n), name: 'A very long in-game name indeed', numbers: posterWith(n).numbers.map((one) => ({ ...one, label: `${one.label} and a great deal more besides that` })) }
        const { ctx, calls } = recorder()
        drawPoster(ctx, long, size as PosterSize, { character: null })
        const boxes = posterLayout(long, size).filter((box) => box.kind === 'number')
        for (const call of calls.filter((one) => one.name === 'fillText')) {
          const text = String(call.args[0])
          const x = Number(call.args[1])
          const w = text.length * px(call.font) * 0.5
          const left = call.textAlign === 'center' ? x - w / 2 : call.textAlign === 'right' ? x - w : x
          expect(left, text).toBeGreaterThanOrEqual(0)
          expect(left + w, text).toBeLessThanOrEqual(width)
        }
        // A number's label stays inside its own cell.
        for (const box of boxes) {
          const label = calls.find((call) => call.name === 'fillText' && String(call.args[0]).startsWith(box.label!.slice(0, 10)))!
          const w = String(label.args[0]).length * px(label.font) * 0.5
          expect(Number(label.args[1]) + w).toBeLessThanOrEqual(box.x + box.w)
        }
      }
  })
})
