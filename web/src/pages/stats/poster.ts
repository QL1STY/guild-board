/**
 * The Wrapped picture (the Months and Wrapped design, 6.4; the accepted mockup wrapped-year.html, its right side): a still
 * poster of its own, drawn with the 2D canvas from a pure layout, in two sizes. Story stacks the mockup's parts down a phone's
 * screen; Wide sets the same parts side by side on the player's 2,560 × 1,440. Its colours are the Year tab's (year.css).
 *
 * The poster names the player by in-game name, AR and server alone: the layout reads those fields and no other, so nothing else
 * of the account can reach the picture. Its one picture comes from the core's art cache, on the page's own origin, so the canvas
 * is never tainted, and the page loads nothing from the internet; where there is none, or it cannot be had, the drawn sign stands
 * in, as on the tab.
 */
import { ApiError, savePicture } from '../../api.ts'
import type { YearPoster } from '../../types.ts'

export const POSTER_SIZES = { story: [1080, 1920], wide: [2560, 1440] } as const
export type PosterSize = keyof typeof POSTER_SIZES

/** What the poster shows: the model's poster and the year it is of. */
export type Poster = YearPoster & { year: number }

/**
 * One part of the poster, in the picture's own pixels. `night` is the whole picture, with its gold glow; `frame` the thin gold
 * line inside its edge; `halo` the glow behind the picture; the others hold words or the picture.
 */
export type Box = {
  kind: 'night' | 'frame' | 'kicker' | 'year' | 'who' | 'halo' | 'picture' | 'caption' | 'number' | 'footer'
  x: number
  y: number
  w: number
  h: number
  /** The words; a number's value; the character's name in the caption; the picture's address (none for a year with no character). */
  text?: string
  /** A number's label, and its "since Apr" where it covers part of the year. */
  label?: string
  since?: string | null
  /** The size in pixels of the box's words: of a number's value. */
  size?: number
  align?: 'left' | 'center'
  /** The night's glow: its centre and its two radii. */
  glow?: { x: number; y: number; rx: number; ry: number }
}

/** "Guild Board Wrapped 2026 Story.png": the name the Save dialog offers, and the one the core takes. */
export function posterFileName(year: number, size: PosterSize): string {
  return `Guild Board Wrapped ${year} ${size === 'story' ? 'Story' : 'Wide'}.png`
}

/** The player as the poster names them: in-game name, AR and server, those that are known. */
function whoOf(poster: Poster): string {
  return [poster.name, poster.ar === null ? '' : `AR ${poster.ar}`, poster.server].filter((part) => part !== '').join(' · ')
}

const KICKER = 'Wrapped · Guild Board'
const FOOTER = 'Tracked with Guild Board'
const CAPTION = 'Character of the year · '
/** The halo's radius, of the picture's longer side; it stays inside the picture's room. */
const HALO = 0.45

/** The numbers' grid: `columns` across, from `top`, ending at `bottom`, `gap` between cells. */
function grid(poster: Poster, x: number, w: number, top: number, bottom: number, columns: number, gap: number): Box[] {
  const rows = Math.ceil(poster.numbers.length / columns)
  const cellW = (w - gap * (columns - 1)) / columns
  const cellH = (bottom - top - gap * (rows - 1)) / rows
  return poster.numbers.map((number, at) => ({
    kind: 'number',
    x: x + (at % columns) * (cellW + gap),
    y: top + Math.floor(at / columns) * (cellH + gap),
    w: cellW,
    h: cellH,
    text: number.value,
    label: number.label,
    since: number.since,
    size: Math.min(cellH * 0.34, cellW * 0.19),
    align: 'left',
  }))
}

type Room = { x: number; y: number; w: number; h: number }

const within = (value: number, least: number, most: number): number => Math.min(Math.max(value, least), most)

/**
 * The picture and its halo in the room they have. With the picture's proportions (`aspect`, its width over its height), the box is
 * the picture itself, as large as the room takes: in the middle of the room (`seat` 'middle'), or across its middle and standing on
 * its foot, over the caption ('foot'). Without them (no picture is had, or no character), the box is the whole room, where the sign
 * is drawn. The halo is round, behind the middle of the picture, inside the room. The box holds the picture's address ('' where
 * there is none), and none for a year with no character.
 */
function pictured(poster: Poster, room: Room, aspect: number | null, seat: 'middle' | 'foot'): Box[] {
  let w = room.w
  let h = room.h
  if (aspect !== null && Number.isFinite(aspect) && aspect > 0 && poster.character !== null) {
    w = Math.min(room.w, room.h * aspect)
    h = w / aspect
  }
  const x = room.x + (room.w - w) / 2
  const y = seat === 'middle' ? room.y + (room.h - h) / 2 : room.y + room.h - h
  const shown: Box = { kind: 'picture', x, y, w, h, text: poster.character === null ? undefined : (poster.character.picture ?? '') }
  const r = Math.min(Math.max(w, h), room.w, room.h) * HALO
  const cx = within(x + w / 2, room.x + r, room.x + room.w - r)
  const cy = within(y + h / 2, room.y + r, room.y + room.h - r)
  return [{ kind: 'halo', x: cx - r, y: cy - r, w: r * 2, h: r * 2 }, shown]
}

/**
 * Story, 1,080 × 1,920: the mockup's poster at three times its size, its parts stacked and the numbers two to a row. The picture
 * is as large as the room between the player's line and the caption takes, across the whole width, in the middle of it.
 */
function story(poster: Poster, aspect: number | null): Box[] {
  const [W, H] = POSTER_SIZES.story
  const pad = 72
  const inner = W - pad * 2
  const who = whoOf(poster)
  const boxes: Box[] = [
    { kind: 'night', x: 0, y: 0, w: W, h: H, glow: { x: W / 2, y: H * 0.18, rx: 1200, ry: 900 } },
    { kind: 'frame', x: 28, y: 28, w: W - 56, h: H - 56 },
    { kind: 'kicker', x: pad, y: 96, w: inner, h: 40, text: KICKER, size: 30, align: 'center' },
    { kind: 'year', x: pad, y: 140, w: inner, h: 168, text: String(poster.year), size: 162, align: 'center' },
  ]
  if (who !== '') boxes.push({ kind: 'who', x: pad, y: 318, w: inner, h: 48, text: who, size: 36, align: 'center' })
  // From the foot up: the footer, the numbers (three rows, or two larger ones for four), the caption; the picture takes what is left.
  const footer: Box = { kind: 'footer', x: pad, y: H - pad - 40, w: inner, h: 40, text: FOOTER, size: 28, align: 'center' }
  const rows = Math.ceil(poster.numbers.length / 2)
  const cellH = rows >= 3 ? 190 : 230
  const gridBottom = footer.y - 36
  const gridTop = gridBottom - rows * cellH - (rows - 1) * 24
  const captionY = gridTop - 36 - 52
  const pictureTop = 392
  const pictureBottom = poster.character === null ? gridTop - 36 : captionY - 12
  boxes.push(...pictured(poster, { x: pad, y: pictureTop, w: inner, h: pictureBottom - pictureTop }, aspect, 'middle'))
  if (poster.character !== null)
    boxes.push({ kind: 'caption', x: pad, y: captionY, w: inner, h: 52, text: poster.character.name, size: 38, align: 'center' })
  boxes.push(...grid(poster, pad, inner, gridTop, gridBottom, 2, 24), footer)
  return boxes
}

/**
 * Wide, 2,560 × 1,440: the words and the numbers on the left, the picture and its caption on the right, the picture standing on
 * its caption.
 */
function wide(poster: Poster, aspect: number | null): Box[] {
  const [W, H] = POSTER_SIZES.wide
  // The picture's column is wide enough for a portrait wider than it is tall, as many of the game's are (a seated pose).
  const left = 150
  const leftW = 1340
  const right = 1570
  const rightW = W - left - right
  const who = whoOf(poster)
  const footer: Box = { kind: 'footer', x: left, y: H - 130 - 50, w: leftW, h: 50, text: FOOTER, size: 34, align: 'left' }
  const captionY = H - 130 - 70
  const pictureBottom = poster.character === null ? footer.y + footer.h : captionY - 24
  const room: Room = { x: right, y: 130, w: rightW, h: pictureBottom - 130 }
  const boxes: Box[] = [
    {
      kind: 'night',
      x: 0,
      y: 0,
      w: W,
      h: H,
      glow: { x: room.x + room.w / 2, y: room.y + room.h * 0.36, rx: 1300, ry: 1000 },
    },
    { kind: 'frame', x: 36, y: 36, w: W - 72, h: H - 72 },
    { kind: 'kicker', x: left, y: 140, w: leftW, h: 56, text: KICKER, size: 40, align: 'left' },
    { kind: 'year', x: left, y: 200, w: leftW, h: 290, text: String(poster.year), size: 280, align: 'left' },
  ]
  if (who !== '') boxes.push({ kind: 'who', x: left, y: 500, w: leftW, h: 64, text: who, size: 50, align: 'left' })
  boxes.push(...pictured(poster, room, aspect, 'foot'))
  if (poster.character !== null)
    boxes.push({ kind: 'caption', x: right, y: captionY, w: rightW, h: 70, text: poster.character.name, size: 50, align: 'center' })
  // Six numbers three to a row, four two to a row: two rows either way, between the player's line and the footer.
  boxes.push(...grid(poster, left, leftW, 620, footer.y - 60, poster.numbers.length > 4 ? 3 : 2, 32), footer)
  return boxes
}

/**
 * The poster's parts, where the drawing puts them: the pure layout that `drawPoster` follows. `aspect` is the character's picture's
 * width over its height, when one is drawn: its box is then the picture itself; without it, the room the sign is drawn in.
 */
export function posterLayout(poster: Poster, size: PosterSize, aspect: number | null = null): Box[] {
  return size === 'story' ? story(poster, aspect) : wide(poster, aspect)
}

// ---------- The drawing

/** The Year tab's own tokens (year.css). */
const GOLD = '#E9C77B'
const GOLD2 = '#F6E2AE'
const INK = '#F4EEDD'
const MUTED = '#B9B3CF'
const FAMILY = '"Alegreya Sans", "Segoe UI", sans-serif'

/** A picture to draw, with its own size. */
export type PosterPicture = { image: CanvasImageSource; width: number; height: number }
/** The poster's pictures: the character of the year's, or null where there is none or it could not be had. */
export type PosterImages = { character: PosterPicture | null }

const font = (weight: number, size: number): string => `${weight} ${size}px ${FAMILY}`

/**
 * The words as they fit `width`: at their size; else smaller, down to `least` of it; else at that size and cut short with "…".
 * Leaves the context's font set to the size returned.
 */
function fit(ctx: CanvasRenderingContext2D, text: string, weight: number, size: number, width: number, least = 0.7): { text: string; size: number } {
  ctx.font = font(weight, size)
  const measured = ctx.measureText(text).width
  if (measured <= width) return { text, size }
  const smaller = Math.max(size * least, Math.floor(((size * width) / measured) * 100) / 100)
  ctx.font = font(weight, smaller)
  if (ctx.measureText(text).width <= width) return { text, size: smaller }
  let cut = text
  while (cut.length > 1 && ctx.measureText(`${cut.trimEnd()}…`).width > width) cut = cut.slice(0, -1)
  return { text: `${cut.trimEnd()}…`, size: smaller }
}

/**
 * Words on one line, their capitals and figures centred on `middle`, aligned at `x` as `align` says, shrunk or cut to `width`.
 * Answers the width drawn.
 */
function words(
  ctx: CanvasRenderingContext2D,
  text: string,
  { x, middle, width, size, weight, colour, align = 'left' }: { x: number; middle: number; width: number; size: number; weight: number; colour: string | CanvasGradient; align?: 'left' | 'center' },
): number {
  const shown = fit(ctx, text, weight, size, width)
  ctx.fillStyle = colour
  ctx.textAlign = align
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(shown.text, x, middle + shown.size * 0.34)
  return ctx.measureText(shown.text).width
}

/** The start and end of a CSS `linear-gradient(<angle>)` over a box of `w` by `h` at `x`, `y`. */
function cssLinear(ctx: CanvasRenderingContext2D, degrees: number, x: number, y: number, w: number, h: number): CanvasGradient {
  const turn = (degrees * Math.PI) / 180
  const dx = Math.sin(turn)
  const dy = -Math.cos(turn)
  const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2
  const cx = x + w / 2
  const cy = y + h / 2
  return ctx.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half)
}

function night(ctx: CanvasRenderingContext2D, box: Box): void {
  const deep = cssLinear(ctx, 170, box.x, box.y, box.w, box.h)
  deep.addColorStop(0, '#1A1C44')
  deep.addColorStop(0.55, '#2C1F53')
  deep.addColorStop(1, '#3E2357')
  ctx.fillStyle = deep
  ctx.fillRect(box.x, box.y, box.w, box.h)
  const glow = box.glow
  if (glow === undefined) return
  ctx.save()
  ctx.beginPath()
  ctx.rect(box.x, box.y, box.w, box.h)
  ctx.clip()
  ctx.translate(glow.x, glow.y)
  ctx.scale(1, glow.ry / glow.rx)
  const light = ctx.createRadialGradient(0, 0, 0, 0, 0, glow.rx)
  light.addColorStop(0, 'rgba(233, 199, 123, 0.35)')
  light.addColorStop(0.7, 'rgba(233, 199, 123, 0)')
  ctx.fillStyle = light
  ctx.fillRect(-glow.rx, -glow.rx, glow.rx * 2, glow.rx * 2)
  ctx.restore()
}

function frame(ctx: CanvasRenderingContext2D, box: Box): void {
  ctx.save()
  ctx.strokeStyle = 'rgba(233, 199, 123, 0.35)'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.roundRect(box.x, box.y, box.w, box.h, 36)
  ctx.stroke()
  ctx.restore()
}

function kicker(ctx: CanvasRenderingContext2D, box: Box): void {
  const size = box.size ?? 30
  const spacing = size * 0.3
  ctx.save()
  ctx.letterSpacing = `${spacing}px`
  // The spacing follows the last letter too, so centred words move back by half of it.
  const x = box.align === 'center' ? box.x + box.w / 2 + spacing / 2 : box.x
  words(ctx, (box.text ?? '').toUpperCase(), { x, middle: box.y + box.h / 2, width: box.w, size, weight: 700, colour: GOLD, align: box.align })
  ctx.restore()
}

function year(ctx: CanvasRenderingContext2D, box: Box): void {
  const size = box.size ?? 162
  const text = box.text ?? ''
  ctx.font = font(900, size)
  const width = Math.min(ctx.measureText(text).width, box.w)
  const start = box.align === 'center' ? box.x + (box.w - width) / 2 : box.x
  // The tab's gold on the year's digits (year.css, .yr-digits), still, with the light in its middle.
  const gold = ctx.createLinearGradient(start, box.y, start + width, box.y + box.h)
  gold.addColorStop(0, GOLD)
  gold.addColorStop(0.42, '#FFF6D8')
  gold.addColorStop(0.62, GOLD2)
  gold.addColorStop(1, '#C99A3E')
  ctx.save()
  ctx.shadowColor = 'rgba(233, 199, 123, 0.35)'
  ctx.shadowBlur = size * 0.25
  words(ctx, text, {
    x: box.align === 'center' ? box.x + box.w / 2 : box.x,
    middle: box.y + box.h / 2,
    width: box.w,
    size,
    weight: 900,
    colour: gold,
    align: box.align,
  })
  ctx.restore()
}

function line(ctx: CanvasRenderingContext2D, box: Box, colour: string, weight: number): void {
  words(ctx, box.text ?? '', {
    x: box.align === 'center' ? box.x + box.w / 2 : box.x,
    middle: box.y + box.h / 2,
    width: box.w,
    size: box.size ?? 30,
    weight,
    colour,
    align: box.align,
  })
}

function haloOf(ctx: CanvasRenderingContext2D, box: Box): void {
  const r = box.w / 2
  const cx = box.x + r
  const cy = box.y + r
  const light = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
  light.addColorStop(0, 'rgba(233, 199, 123, 0.55)')
  light.addColorStop(0.55, 'rgba(201, 135, 216, 0.15)')
  light.addColorStop(0.7, 'rgba(201, 135, 216, 0)')
  ctx.fillStyle = light
  ctx.fillRect(box.x, box.y, box.w, box.h)
}

/**
 * The picture, whole and in its own proportions, in its box, which the layout made of the picture's own proportions: as large as
 * the box takes, in its middle, with the mockup's shadow under it.
 */
function portrait(ctx: CanvasRenderingContext2D, box: Box, shown: PosterPicture): void {
  const scale = Math.min(box.w / shown.width, box.h / shown.height)
  const w = shown.width * scale
  const h = shown.height * scale
  ctx.save()
  ctx.shadowColor = 'rgba(0, 0, 0, 0.5)'
  ctx.shadowBlur = box.h * 0.06
  ctx.shadowOffsetY = box.h * 0.03
  ctx.drawImage(shown.image, box.x + (box.w - w) / 2, box.y + (box.h - h) / 2, w, h)
  ctx.restore()
}

/**
 * The drawn sign where there is no picture, as the tab draws it, in the halo's circle: a dashed ring around it and, inside, the
 * person of signs.tsx for a character whose picture is not had, or the four-point star for a year with no character, on its
 * 20-unit square.
 */
function sign(ctx: CanvasRenderingContext2D, circle: Box, person: boolean): void {
  const r = circle.w / 2
  const cx = circle.x + r
  const cy = circle.y + r
  ctx.save()
  ctx.strokeStyle = 'rgba(233, 199, 123, 0.5)'
  ctx.lineWidth = 3
  ctx.setLineDash([12, 10])
  ctx.beginPath()
  ctx.arc(cx, cy, r * 0.98, 0, Math.PI * 2)
  ctx.stroke()
  ctx.setLineDash([])
  const unit = (r * 0.8) / 20
  ctx.translate(cx - 10 * unit, cy - 10 * unit)
  ctx.scale(unit, unit)
  ctx.globalAlpha = 0.85
  ctx.strokeStyle = GOLD
  ctx.lineWidth = 1
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  if (person) {
    ctx.arc(10, 7.3, 3.3, 0, Math.PI * 2)
    ctx.moveTo(4, 17)
    ctx.bezierCurveTo(4.8, 13.6, 7.2, 12, 10, 12)
    ctx.bezierCurveTo(12.8, 12, 15.2, 13.6, 16, 17)
  } else {
    ctx.moveTo(10, 2.2)
    ctx.bezierCurveTo(10.7, 6.3, 13.7, 9.3, 17.8, 10)
    ctx.bezierCurveTo(13.7, 10.7, 10.7, 13.7, 10, 17.8)
    ctx.bezierCurveTo(9.3, 13.7, 6.3, 10.7, 2.2, 10)
    ctx.bezierCurveTo(6.3, 9.3, 9.3, 6.3, 10, 2.2)
    ctx.closePath()
  }
  ctx.stroke()
  ctx.restore()
}

/** "Character of the year · Sandrone": the words in ink, the name in gold, centred together. */
function caption(ctx: CanvasRenderingContext2D, box: Box): void {
  const name = box.text ?? ''
  let size = box.size ?? 38
  ctx.font = font(500, size)
  let lead = ctx.measureText(CAPTION).width
  ctx.font = font(800, size)
  let named = ctx.measureText(name).width
  if (lead + named > box.w) {
    size = Math.max(size * 0.7, Math.floor(((size * box.w) / (lead + named)) * 100) / 100)
    ctx.font = font(500, size)
    lead = ctx.measureText(CAPTION).width
    ctx.font = font(800, size)
    named = ctx.measureText(name).width
  }
  const start = box.x + Math.max(0, (box.w - lead - named) / 2)
  const middle = box.y + box.h / 2
  words(ctx, CAPTION, { x: start, middle, width: lead, size, weight: 500, colour: INK })
  words(ctx, name, { x: start + lead, middle, width: box.x + box.w - start - lead, size, weight: 800, colour: GOLD2 })
}

/** A number's cell: the value large, its label under it and its "since" under that, as the mockup's grid. */
function number(ctx: CanvasRenderingContext2D, box: Box): void {
  const radius = box.h * 0.15
  ctx.save()
  ctx.fillStyle = 'rgba(255, 255, 255, 0.07)'
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.roundRect(box.x, box.y, box.w, box.h, radius)
  ctx.fill()
  ctx.stroke()
  ctx.restore()
  const pad = Math.min(box.w * 0.066, 36)
  const x = box.x + pad
  const width = box.w - pad * 2
  const value = box.size ?? box.h * 0.34
  const label = Math.min(box.h * 0.158, box.w * 0.075)
  words(ctx, box.text ?? '', { x, middle: box.y + box.h * 0.32, width, size: value, weight: 800, colour: INK })
  words(ctx, box.label ?? '', { x, middle: box.y + box.h * 0.63, width, size: label, weight: 500, colour: MUTED })
  if (box.since) words(ctx, box.since, { x, middle: box.y + box.h * 0.84, width, size: label * 0.86, weight: 500, colour: GOLD })
}

/**
 * Draws the poster on `ctx`, a canvas of POSTER_SIZES[size], as `posterLayout` places its parts, given the proportions of the
 * picture that is drawn, if one is.
 */
export function drawPoster(ctx: CanvasRenderingContext2D, poster: Poster, size: PosterSize, images: PosterImages): void {
  const shown = poster.character !== null ? images.character : null
  let circle: Box | null = null
  for (const box of posterLayout(poster, size, shown === null ? null : shown.width / shown.height)) {
    if (box.kind === 'night') night(ctx, box)
    else if (box.kind === 'frame') frame(ctx, box)
    else if (box.kind === 'kicker') kicker(ctx, box)
    else if (box.kind === 'year') year(ctx, box)
    else if (box.kind === 'who') line(ctx, box, MUTED, 500)
    else if (box.kind === 'halo') {
      haloOf(ctx, box)
      circle = box
    } else if (box.kind === 'picture') {
      if (shown !== null) portrait(ctx, box, shown)
      else sign(ctx, circle ?? box, poster.character !== null)
    } else if (box.kind === 'caption') caption(ctx, box)
    else if (box.kind === 'number') number(ctx, box)
    else line(ctx, box, MUTED, 500)
  }
}

// ---------- Making the PNG, and saving it

/** The weights the poster draws in, all the app's own (main.tsx); 900 is drawn with the heaviest there is. */
const FONTS = ['900 54px "Alegreya Sans"', '800 54px "Alegreya Sans"', '700 54px "Alegreya Sans"', '500 54px "Alegreya Sans"']
const NOT_MADE = 'The picture could not be made.'

/** An address of the core's art or icon cache, on this page's own origin. */
const CORE_PICTURE = /^\/api\/(?:art|icon)\//

/** The character's picture, decoded, when it is one of the core's own on this page's origin and can be had; else null. */
async function loadPicture(address: string | null | undefined): Promise<PosterPicture | null> {
  // Only the core's art and icon caches: a picture of another origin would taint the canvas, and the page loads nothing from the internet.
  if (!address || !CORE_PICTURE.test(address)) return null
  const image = new Image()
  image.src = address
  try {
    await image.decode()
  } catch {
    return null
  }
  return image.naturalWidth > 0 && image.naturalHeight > 0 ? { image, width: image.naturalWidth, height: image.naturalHeight } : null
}

/** The poster as a PNG of its full size, drawn off-screen once the app's fonts and the picture are ready. */
export async function makePoster(poster: Poster, size: PosterSize): Promise<Blob> {
  await Promise.all(FONTS.map((one) => document.fonts.load(one).catch(() => [])))
  const character = await loadPicture(poster.character?.picture)
  const [width, height] = POSTER_SIZES[size]
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  try {
    const ctx = canvas.getContext('2d')
    if (ctx === null) throw new Error(NOT_MADE)
    drawPoster(ctx, poster, size, { character })
    const made = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (made === null) throw new Error(NOT_MADE)
    return made
  } finally {
    // A browser can keep what a page lets go of for a long while, so the canvas and the picture are emptied now.
    canvas.width = 0
    canvas.height = 0
    if (character !== null && character.image instanceof HTMLImageElement) character.image.removeAttribute('src')
  }
}

/** Where a picture went: to the window's Save dialog, or downloaded by the browser where there is no window. */
export type Saved = 'dialog' | 'download'

/**
 * Makes the poster and saves it: the core holds it and asks the window for its Save dialog. With no window (`--no-shell`, or the
 * site's demo) the core answers 409, and the browser downloads it instead.
 */
export async function savePoster(poster: Poster, size: PosterSize): Promise<Saved> {
  const made = await makePoster(poster, size)
  const name = posterFileName(poster.year, size)
  try {
    await savePicture(name, made)
    return 'dialog'
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 409) throw error
  }
  const address = URL.createObjectURL(made)
  const link = document.createElement('a')
  link.href = address
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(address), 60_000) // once the browser has taken it
  return 'download'
}
