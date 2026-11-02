import type { PictureQuality } from './pictureQuality.ts'

/*
 * The Characters pages' pictures come from the art cache (`/api/art/<key>`), where the original of a character's art is 2048
 * pixels across. A picture is asked for at the size it is shown (the core keeps a copy for each of a few sizes, characters/art.py)
 * so that the window decodes the pixels it draws and no more.
 */

/** What a picture is asked for when its place has no size to measure. */
const STANDARD = 256

/**
 * The sizes the core keeps a picture at (DISPLAY_SIZES in characters/art.py). A page asks for one of them, so that the same
 * picture is one address and the window's cache holds it once.
 */
export const ART_SIZES = [128, 256, 512, 1024, 1536] as const

/**
 * The size to ask for of a place this large in CSS pixels as the screen shows it (a zoomed place is measured zoomed): the
 * next size up of `ART_SIZES` from the longest side the picture is drawn at, in device pixels, or the largest.
 *
 * A picture drawn to fit (`object-fit: contain`, the default) is no larger than its box, so its longest side is at most the
 * box's longest. One drawn as cover, with `aspect` its width over its height, fills the box and runs past it: art twice as wide
 * as tall in a 1,000 x 700 box is drawn 1,400 wide, and a copy of 1,024 would be stretched. Its width is then the larger of the
 * box's width and the box's height times `aspect` (the height likewise for a tall picture), and that is what is asked for.
 * Without an `aspect` the box's longest side stands in for it.
 */
export function artSize(box: { width: number; height: number } | null, ratio: number, aspect: number | null = null): number {
  let longest = box === null ? 0 : Math.max(box.width, box.height)
  if (box !== null && aspect !== null && aspect > 0 && Number.isFinite(aspect)) {
    longest = Math.max(box.width, box.height * aspect, box.height, box.width / aspect)
  }
  if (!(longest > 0)) return STANDARD
  const device = longest * ratio - 1e-6
  return ART_SIZES.find((size) => size >= device) ?? ART_SIZES[ART_SIZES.length - 1]
}

/** The proportions (width over height) of the pictures that have loaded in this run, by address of the art cache. */
const aspects = new Map<string, number>()

/** The proportions of a picture of the art cache that has loaded before, or null. */
export function knownAspect(src: string | null): number | null {
  return src === null ? null : (aspects.get(src) ?? null)
}

/** Remembers the proportions of a picture that loaded at this size; whether they are new, or not the same as before. */
export function learnAspect(src: string | null, width: number, height: number): boolean {
  if (src === null || !(width > 0) || !(height > 0)) return false
  const aspect = width / height
  const before = aspects.get(src)
  if (before !== undefined && Math.abs(before - aspect) < 0.02) return false // a copy is rounded to whole pixels
  aspects.set(src, aspect)
  return true
}

/** From this size up a picture counts as a large one, which the picture quality governs; a face or an icon never does. */
const LARGE_FROM = 1024

/**
 * What a picture whose box needs `size` is asked for in this picture quality: the size itself where the picture is small, in
 * every mode (80 faces sit on a roster page); for a large one the original in high (null: no size on its address), at most 1,536
 * pixels in medium and at most 1,024 in low. The core takes only the five sizes, whatever is chosen here.
 */
export function askedSize(size: number, quality: PictureQuality): number | null {
  if (size < LARGE_FROM) return size
  if (quality === 'high') return null
  return Math.min(size, quality === 'medium' ? 1536 : 1024)
}

/** The address of a picture of the art cache with the size asked for (none: the original); any other address is as it was. */
export function sizedArt(src: string | null, size: number | null): string | null {
  if (src === null || src === '') return null
  if (!src.startsWith('/api/art/') || src.includes('?') || size === null) return src
  return `${src}?size=${size}`
}
