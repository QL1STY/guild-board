import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
// main.tsx and the stylesheet are read as text with Vite's ?raw, as in motion.test.ts.
import main from '../main.tsx?raw'
import signsCss from '../styles/signs.css?raw'
import { Picture } from './Picture.tsx'
import { SIGN_NAMES, Sign, type SignName } from './Sign.tsx'

/** A sign as the page draws it. */
function drawn(name: SignName, className?: string): string {
  return renderToStaticMarkup(createElement(Sign, { name, className }))
}

/** A picture as the page draws it, before any image has failed to load. */
function pictured(src: string | null, className?: string): string {
  return renderToStaticMarkup(createElement(Picture, { src, sign: 'moon', className }))
}

test('every sign is drawn with a path or a circle', () => {
  for (const name of SIGN_NAMES) {
    expect(drawn(name), name).toMatch(/<path|<circle/)
  }
})

test('the set holds the signs of spec 7.2, each once, and the Pulls widgets\' five', () => {
  expect([...SIGN_NAMES].sort()).toEqual(
    [
      ...['hourglass', 'pin', 'star', 'cup', 'moon', 'compass', 'book', 'cycle', 'play', 'bolt', 'stopwatch'],
      ...['clock', 'quill', 'gem', 'teapot', 'transformer', 'boss', 'fish', 'mask', 'person', 'map', 'chest'],
      ...['oculus', 'waypoint', 'scroll', 'cells', 'bars', 'gear', 'cross', 'tick', 'chevron', 'grip'],
      // The Pulls plan, Task 10: Wishing now and the banners' art, Pity, Wishlist, Last pulls and Luck.
      ...['banner', 'ring', 'wish', 'cards', 'dice'],
      // The top bar and undo plan, Task 4: the plate's Sync button and the warning of a refusal and of an amber state.
      ...['sync', 'warn'],
      // The Characters plan, Task U1: the rail's Characters, the five weapons, and the profile's Artifacts, Constellation and
      // Talents (its Story and Your week are the book).
      ...['bust', 'sword', 'claymore', 'polearm', 'bow', 'catalyst', 'flower', 'stars', 'crown'],
      // The online plan, Task B6: Friends, in the rail, and the Friends page's own: two people.
      'people',
    ].sort(),
  )
})

test('no two signs are drawn alike', () => {
  const drawings = SIGN_NAMES.map((name) => drawn(name))
  expect(new Set(drawings).size).toBe(SIGN_NAMES.length)
})

test('a sign is a 20 by 20 line drawing in the colour around it, and screen readers skip it', () => {
  const markup = drawn('gem')
  expect(markup).toMatch(/^<svg /)
  for (const attribute of [
    'viewBox="0 0 20 20"',
    'width="20"',
    'height="20"',
    'fill="none"',
    'stroke="currentColor"',
    'stroke-width="1.5"',
    'stroke-linecap="round"',
    'stroke-linejoin="round"',
    'aria-hidden="true"',
  ]) {
    expect(markup).toContain(attribute)
  }
})

test('no sign holds a colour of its own, so that its place sets it', () => {
  for (const name of SIGN_NAMES) {
    expect(drawn(name), name).not.toMatch(/#[0-9a-f]{3}|rgb|hsl|fill="(?!none)|stroke="(?!currentColor)/i)
  }
})

test('a sign takes the class of the place it is put in', () => {
  expect(drawn('gem')).toContain(' class="sign"')
  expect(drawn('gem', 'ach-gem')).toContain(' class="sign ach-gem"')
})

test('a picture shows its image, with its sign behind it for the case that it does not load', () => {
  const markup = pictured('/api/icon/static.resin', 'ring-pic')
  // (React's server render puts a preload hint for the image before the box.)
  expect(markup).toContain('<span class="pic ring-pic">')
  expect(markup).toMatch(/<img [^>]*src="\/api\/icon\/static\.resin"/)
  expect(markup).toMatch(/<img [^>]*alt=""/) // the image is decoration; it has no text to read
  expect(markup).not.toMatch(/ hidden=/) // (the sign's aria-hidden is another attribute)
  // The stylesheet hides the sign with the sibling rule, which needs the sign to follow the image.
  expect(markup.indexOf('<img')).toBeLessThan(markup.indexOf('<svg'))
})

test('a picture with no address hides its image and shows the sign', () => {
  const markup = pictured(null)
  expect(markup).toMatch(/<img [^>]*hidden=""/)
  expect(markup).not.toMatch(/<img [^>]*src=/)
  expect(markup).toContain('<svg')
  expect(markup).toMatch(/^<span class="pic">/)
})

test('a picture with an empty address shows the sign too, as React drops an empty src and no error follows', () => {
  const markup = pictured('')
  expect(markup).toMatch(/<img [^>]*hidden=""/)
  expect(markup).not.toMatch(/<img [^>]*src=/)
  expect(markup).toContain('<svg')
})

test('the image cannot be dragged, so that it does not cancel the pointer events of a drag of the Board', () => {
  expect(pictured('/api/icon/static.resin')).toMatch(/<img [^>]*draggable="false"/)
  expect(pictured(null)).toMatch(/<img [^>]*draggable="false"/)
})

test('signs.css puts the image and the sign in one place, and shows the sign only when the image is hidden', () => {
  expect(signsCss).toMatch(/\.pic > \*\s*\{[^}]*grid-area:\s*1 \/ 1/)
  expect(signsCss).toMatch(/\.pic img:not\(\[hidden\]\) \+ \.sign\s*\{[^}]*visibility:\s*hidden/)
  // A rule that sets display on the image would win over the hidden attribute's, so this one wins back.
  expect(signsCss).toMatch(/\.pic img\[hidden\]\s*\{[^}]*display:\s*none/)
})

test('the page loads signs.css', () => {
  expect(main).toContain("import './styles/signs.css'")
})
