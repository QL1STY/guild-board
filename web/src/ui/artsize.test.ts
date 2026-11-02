import { expect, test } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { artSize, askedSize, sizedArt } from './artsize.ts'
import { pictureQuality, setPictureQuality } from './pictureQuality.ts'
import { Picture } from './Picture.tsx'

test('a picture of the art cache is asked for at the size it is shown, in device pixels', () => {
  expect(artSize({ width: 56, height: 56 }, 1)).toBe(128)
  expect(artSize({ width: 56, height: 56 }, 1.5610)).toBe(128)
  expect(artSize({ width: 100, height: 100 }, 1.5610)).toBe(256) // 157 pixels: the next size up
  expect(artSize({ width: 896, height: 680 }, 1)).toBe(1024) // the longer side
  expect(artSize({ width: 896, height: 680 }, 2)).toBe(1536) // and none is larger than the largest the core keeps
  expect(artSize({ width: 128.2, height: 10 }, 1)).toBe(256)
})

test('a picture shown as cover is asked for at the size that covers its box, from its own proportions', () => {
  // The art is twice as wide as tall and fills the box by its height: a 1,000 x 700 box shows it 1,400 wide.
  expect(artSize({ width: 1000, height: 700 }, 1, 2)).toBe(1536)
  expect(artSize({ width: 1000, height: 700 }, 1, null)).toBe(1024) // no proportions known: the box's longest side
  expect(artSize({ width: 1000, height: 300 }, 1, 2)).toBe(1024) // the box is wider than the art needs: its width
  expect(artSize({ width: 680, height: 500 }, 1.5, 2)).toBe(1536) // 1,500 device pixels wide
  expect(artSize({ width: 300, height: 200 }, 1, 0.5)).toBe(1024) // a tall picture fills the width: 600 tall
  expect(artSize({ width: 56, height: 56 }, 1, 1)).toBe(128) // a square one is the box
  expect(artSize({ width: 100, height: 100 }, 2, 2)).toBe(512) // 400 wide
  expect(artSize({ width: 5000, height: 4000 }, 2, 2)).toBe(1536) // none is larger than the largest the core keeps
})

test('a picture that has no size yet, or an empty box, is asked for at a small standard size', () => {
  expect(artSize(null, 2)).toBe(256)
  expect(artSize({ width: 0, height: 0 }, 2)).toBe(256)
  expect(artSize({ width: 5, height: 5 }, 1)).toBe(128)
})

test('only an address of the art cache takes a size, once, and the others are left as they are', () => {
  expect(sizedArt('/api/art/abc123', 256)).toBe('/api/art/abc123?size=256')
  expect(sizedArt('/api/art/abc123?size=128', 256)).toBe('/api/art/abc123?size=128')
  expect(sizedArt('/api/icon/static.resin', 256)).toBe('/api/icon/static.resin')
  expect(sizedArt('/api/art/abc123', null)).toBe('/api/art/abc123') // the original has no size on its address
  expect(sizedArt(null, 256)).toBeNull()
  expect(sizedArt('', 256)).toBeNull()
})

test('a picture of the art cache draws no image until it has measured its place, and the others at once', () => {
  const pictured = (src: string) => renderToStaticMarkup(createElement(Picture, { src, sign: 'bust' }))
  expect(pictured('/api/art/abc')).not.toMatch(/<img [^>]*src=/)
  expect(pictured('/api/icon/static.resin')).toMatch(/<img [^>]*src="\/api\/icon\/static\.resin"/)
})

test('a picture off the screen is not loaded or decoded until it nears it, when the place says so', () => {
  const lazy = renderToStaticMarkup(createElement(Picture, { src: '/api/icon/a', sign: 'bust', lazy: true }))
  expect(lazy).toMatch(/<img [^>]*loading="lazy"/)
  expect(lazy).toMatch(/<img [^>]*decoding="async"/)
  const plain = renderToStaticMarkup(createElement(Picture, { src: '/api/icon/a', sign: 'bust' }))
  expect(plain).not.toMatch(/loading="lazy"/)
  expect(plain).toMatch(/<img [^>]*decoding="async"/)
})

test('the large pictures follow the picture quality, and faces and icons are the size they are shown in every mode', () => {
  for (const size of [128, 256, 512]) {
    for (const quality of ['high', 'medium', 'low'] as const) expect(askedSize(size, quality)).toBe(size)
  }
  expect(askedSize(1024, 'high')).toBeNull() // the untouched original
  expect(askedSize(1536, 'high')).toBeNull()
  expect(askedSize(1024, 'medium')).toBe(1024)
  expect(askedSize(1536, 'medium')).toBe(1536) // at most 1536
  expect(askedSize(1024, 'low')).toBe(1024)
  expect(askedSize(1536, 'low')).toBe(1024) // at most 1024
})

test('the picture quality is high until the settings say otherwise, and only the three words are taken', () => {
  expect(pictureQuality()).toBe('high')
  setPictureQuality('low')
  expect(pictureQuality()).toBe('low')
  setPictureQuality('ultra' as never)
  expect(pictureQuality()).toBe('high')
  setPictureQuality(undefined)
  expect(pictureQuality()).toBe('high')
})
