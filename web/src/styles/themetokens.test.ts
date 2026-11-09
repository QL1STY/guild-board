import { expect, test } from 'vitest'
import { tokenValues } from './contrast.ts'
import backlogCss from './backlog.css?raw'
import parchment from './parchment.json'
import pullsCss from './pulls.css?raw'
import tokensCss from './tokens.css?raw'
import widgetsCss from './widgets.css?raw'

// Every stylesheet of the interface, read as text with Vite's ?raw (vite.config.ts lets those through): a test under src
// cannot import node:fs, since the app's tsconfig has no Node types and `npm run build` checks the tests.
const SHEETS = import.meta.glob<string>('../**/*.css', { query: '?raw', import: 'default', eager: true })

/*
 * A theme is a set of token values and nothing else (the themes design, section 4), so a stylesheet of the themed window
 * names no colour of its own: it names a token. This test reads every stylesheet but those below and fails on a hex colour,
 * an rgb()/rgba()/hsl() or a colour word (white, black) in a value.
 */

/** The stylesheets that keep their own colours, each for a reason of the design's section 4, "Leaves alone". */
const LEFT_ALONE = [
  'styles/tokens.css', // where the tokens are written
  'styles/themes.css', // where a theme sets them
  'styles/overlay.css', // the overlay over the game keeps its dark glass panel whatever the theme
  'styles/year.css', // the Year tab's night poster
  'pages/characters/planner.css', // so does her planner
  'pages/characters/elements.css', // the dark card's values themselves
]

/**
 * A stylesheet whose first part is a dark card of an element's look, left alone, and whose rest sits on the theme: the text of
 * the stylesheet from this comment on is scanned. The profile's card (.pf-card, its hero, its glass panel, its pages and the
 * unfolded piece) is the element's dark whatever the theme; the Readiness sheet below it (.pf-sheet and what is in it) is on
 * the theme's ground and names tokens only.
 */
const CARD_ENDS: Record<string, string> = {
  'pages/characters/profile.css': 'Readiness, below the card, on parchment',
}

/** The rules left alone inside a stylesheet, by a part of their selector. */
const RULES_LEFT_ALONE = [
  '.pl-sky', // the Pulls page's night strip is a night of its own on every theme
]

/**
 * A colour that stays where it is, as `file | selector | property`, with the reason. Text and shades drawn over a picture
 * are on the picture's colours, not the theme's; a profile's dark card is an element's look, not the theme's.
 */
const STAYS: Record<string, string> = {
  'styles/gallery.css | .ga-time | color': 'white time over a screenshot, with a black shadow for a light sky',
  'styles/gallery.css | .ga-star | color': 'a gold star over a screenshot',
  'styles/gallery.css | .ga-big | background': 'the letterbox behind a large screenshot, the dark every picture is shown on',
  'styles/gallery.css | .ga-nav | background': 'a black shade behind the arrows, over the screenshot',
  'styles/gallery.css | .ga-nav | color': 'white arrows over the screenshot',
  'styles/gallery.css | .ga-nav:not(:disabled):hover | background': 'the same shade, darker, on hover',
  'pages/characters/characters.css | .cx-ava.on-card | background': "an avatar on a profile's dark card, in the element's look",
  'pages/characters/characters.css | .cx-tip | border': "the dark tip of the profile, the planner and Your week's tooltip, dark on every theme",
  'pages/characters/characters.css | .cx-tip | background': "the dark tip of the profile, the planner and Your week's tooltip, dark on every theme",
}

type Finding = { file: string; selector: string; property: string; value: string }

const COLOUR = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|\b(?:white|black)\b/i
/** A black of some alpha, which a shadow may be in every theme. */
const BLACK = /rgba?\(\s*0[,\s]+0[,\s]+0\s*[,/]\s*[\d.]+\s*\)/g
const SHADOWS = new Set(['box-shadow', 'text-shadow', 'filter', '-webkit-filter', 'drop-shadow'])
/** A mask reads a stylesheet's alpha, not its colour. */
const MASKS = new Set(['mask', 'mask-image', '-webkit-mask', '-webkit-mask-image'])

/** Every declaration of a stylesheet, comments left out, with the selector of its rule. */
function declarationsOf(css: string): { selector: string; property: string; value: string }[] {
  const found: { selector: string; property: string; value: string }[] = []
  const preludes: string[] = []
  for (const [, text, bracket] of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]*)([{}])/g)) {
    if (bracket === '{') {
      preludes.push(text.trim().replace(/\s+/g, ' '))
      continue
    }
    for (const declaration of text.split(';')) {
      const colon = declaration.indexOf(':')
      if (colon < 0) continue
      found.push({
        selector: preludes[preludes.length - 1] ?? '',
        property: declaration.slice(0, colon).trim(),
        value: declaration.slice(colon + 1).trim(),
      })
    }
    preludes.pop()
  }
  return found
}

/** The part of a stylesheet that sits on the theme: all of it, or what follows the dark card's end. */
function onTheTheme(file: string, css: string): string {
  const end = CARD_ENDS[file]
  if (end === undefined) return css
  const at = css.indexOf(end)
  return at < 0 ? css : css.slice(at)
}

function findingsIn(file: string, css: string): Finding[] {
  const found: Finding[] = []
  for (const { selector, property, value } of declarationsOf(onTheTheme(file, css))) {
    if (RULES_LEFT_ALONE.some((part) => selector.includes(part))) continue
    if (MASKS.has(property)) continue
    const checked = SHADOWS.has(property) ? value.replace(BLACK, '') : value
    if (COLOUR.test(checked)) found.push({ file, selector, property, value })
  }
  return found
}

const all: Finding[] = Object.entries(SHEETS)
  .map(([path, css]) => [path.replace(/^\.\//, 'styles/').replace(/^\.\.\//, ''), css] as const)
  .filter(([file]) => !LEFT_ALONE.includes(file))
  .flatMap(([file, css]) => findingsIn(file, css))

const keyOf = (finding: Finding) => `${finding.file} | ${finding.selector} | ${finding.property}`

test("Parchment keeps every colour it had", () => {
  const now = tokenValues(tokensCss)
  for (const [name, value] of Object.entries(parchment)) expect([name, now[name]]).toEqual([name, value])
})

test('no stylesheet of the themed window writes a colour in place', () => {
  const findings = all.filter((finding) => !(keyOf(finding) in STAYS)).map((finding) => `${keyOf(finding)}: ${finding.value}`)
  expect(findings).toEqual([])
})

test('every colour that stays is still written where it is listed', () => {
  const written = new Set(all.map(keyOf))
  expect(Object.keys(STAYS).filter((key) => !written.has(key))).toEqual([])
})

/** A rule that fills with --ink but carries no text: a line on a track. */
const INK_GROUNDS_WITHOUT_TEXT: Record<string, string> = {
  'pages/characters/week.css | .wk-track .m': "a 2px marker on the week's track, with no text on it",
  'styles/themepicker.css | .tp-h': "a 5px bar that stands for a heading in a picker tile's tiny Board, in that tile's own --ink: no text on it",
  'styles/themepicker.css | .tp-card u': "a 3px bar that stands for a line of text in a picker tile's tiny Board: no text on it",
}

test('no stylesheet uses --ink as a ground: on Midnight and Dusk it is the colour of the light text laid on it', () => {
  const grounds = Object.entries(SHEETS)
    .map(([path, css]) => [path.replace(/^\.\//, 'styles/').replace(/^\.\.\//, ''), css] as const)
    .filter(([file]) => !LEFT_ALONE.includes(file))
    .flatMap(([file, css]) =>
      declarationsOf(onTheTheme(file, css))
        .filter((one) => (one.property === 'background' || one.property === 'background-color') && /^var\(--ink\)$/.test(one.value))
        .map((one) => `${file} | ${one.selector}`),
    )
  expect(grounds.filter((key) => !(key in INK_GROUNDS_WITHOUT_TEXT))).toEqual([])
  expect(Object.keys(INK_GROUNDS_WITHOUT_TEXT).filter((key) => !grounds.includes(key))).toEqual([])
})

/**
 * Whether a shadow value has a layer that glows on a dark look: a layer coloured from the ink (or its muted shades) that
 * is blurred. A layer with no blur is a solid ring, such as today's outline in a calendar: a mark drawn in the ink on
 * purpose, as a border would be, not a shadow.
 */
function glowsFromInk(value: string): boolean {
  const layers: string[] = ['']
  let depth = 0
  for (const char of value) {
    if (char === '(') depth++
    if (char === ')') depth--
    if (char === ',' && depth === 0) layers.push('')
    else layers[layers.length - 1] += char
  }
  return layers.some((layer) => {
    if (!/var\(--(ink|ink2|muted)\)/.test(layer)) return false
    const lengths = layer.replace(/color-mix\((?:[^()]|\([^()]*\))*\)|var\([^)]*\)/g, ' ').match(/-?\d*\.?\d+/g) ?? []
    return lengths.length >= 3 && parseFloat(lengths[2]) > 0
  })
}

test('the glow check tells a blurred shadow of the ink from a solid ring in it', () => {
  expect(glowsFromInk('inset 0 0 0 3px var(--ledger-light), 0 8px 18px -14px color-mix(in srgb, var(--ink) 60%, transparent)')).toBe(true)
  expect(glowsFromInk('0 1px 2px color-mix(in srgb, var(--ink) 30%, transparent)')).toBe(true)
  expect(glowsFromInk('0 0 0 1.5px var(--surface), 0 0 0 3px var(--ink)')).toBe(false)
  expect(glowsFromInk('inset 0 0 0 1.5px var(--ink2)')).toBe(false)
  expect(glowsFromInk('0 8px 18px -14px color-mix(in srgb, var(--shadow-ink) 60%, transparent)')).toBe(false)
})

test('no shadow is mixed from the ink: on a dark look the ink is light and the shadow would glow (that is --shadow-ink)', () => {
  const glows = Object.entries(SHEETS)
    .map(([path, css]) => [path.replace(/^\.\//, 'styles/').replace(/^\.\.\//, ''), css] as const)
    .filter(([file]) => !LEFT_ALONE.includes(file))
    .flatMap(([file, css]) =>
      declarationsOf(onTheTheme(file, css))
        .filter((one) => /shadow/.test(one.property) && glowsFromInk(one.value))
        .map((one) => `${file} | ${one.selector}`),
    )
  expect(glows).toEqual([])
  expect(Object.values(SHEETS).join('').match(/var\(--shadow-ink\)/g)?.length).toBeGreaterThanOrEqual(4)
})

test("--refused is a ground (the refused note's) and is never the colour of text: that is --refused-ink", () => {
  const texts = Object.entries(SHEETS).flatMap(([path, css]) =>
    declarationsOf(css)
      .filter((one) => one.property === 'color' && one.value.includes('var(--refused)'))
      .map((one) => `${path} | ${one.selector}`),
  )
  expect(texts).toEqual([])
})

test("a region's emblem is knocked out of its nation's disc in --emblem-ink, a cream, and not in the card's colour", () => {
  const colourOf = (css: string, selector: string) => declarationsOf(css).find((one) => one.selector === selector && one.property === 'color')?.value
  expect(colourOf(backlogCss, '.gb-emb')).toBe('var(--emblem-ink)')
  expect(colourOf(widgetsCss, '.look-emblem')).toBe('var(--w-emblem-ink)')
})

test("the profile's Readiness sheet is scanned, and the dark card above it is where the scan stops being left alone", () => {
  for (const [file, end] of Object.entries(CARD_ENDS)) {
    const css = SHEETS[`../${file}`]
    expect(css, file).toContain(end)
    // Something of the sheet is after the mark, and the dark card's own rules are before it.
    expect(onTheTheme(file, css)).toContain('.pf-sheet')
    expect(onTheTheme(file, css)).not.toMatch(/[.]pf-card[^l]/)
  }
})

test('the scan sees the stylesheets', () => {
  expect(Object.keys(SHEETS).length).toBeGreaterThan(30)
  expect(Object.keys(SHEETS)).toContain('../pages/characters/week.css')
  expect(all.map((finding) => finding.file)).not.toContain('styles/tokens.css')
})

test("the 5★ gold is a token of its own, the progress gold's value on Parchment", () => {
  const values = tokenValues(tokensCss)
  expect(values['--five']).toBe('#A6751F')
  expect(values['--w-five']).toBe('#A6751F')
  expect(values['--five']).toBe(values['--fill'])
  expect(values['--w-five']).toBe(values['--w-fill'])
})

test('the marks that count toward a 5★ take the 5★ gold, and the planner controls keep the progress gold', () => {
  const rule = (css: string, selector: string) => declarationsOf(css).find((one) => one.selector === selector)?.value
  expect(declarationsOf(pullsCss).find((one) => one.selector === '.pl-split .won')?.value).toBe('var(--five)')
  expect(declarationsOf(pullsCss).find((one) => one.selector === '.pl-bar i' && one.property === 'background')?.value).toBe('var(--five)')
  expect(rule(pullsCss, '.pl-chip.likely')).toContain('var(--five)')
  expect(declarationsOf(widgetsCss).find((one) => one.selector === '.lk-won')?.value).toBe('var(--w-five)')
  expect(declarationsOf(pullsCss).filter((one) => one.selector === '.pl-cell:hover' || one.selector === '.pl-cell.on').map((one) => one.value).join(' ')).toContain('var(--fill)')
})
