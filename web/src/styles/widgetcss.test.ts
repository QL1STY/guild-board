import { expect, test } from 'vitest'
import { columnsFor, columnWidth } from '../pages/boardview.ts'
import { rangeOf } from '../widgets/registry.ts'
import { ONE_CELL_ACROSS } from '../widgets/widget.ts'
import checkin from './checkin.css?raw'
import marks from './marks.css?raw'
import pulls from './pulls.css?raw'
import tokens from './tokens.css?raw'
import widgets from './widgets.css?raw'

// Stylesheets are read as text with Vite's ?raw (vite.config.ts lets those through), as contrast.test.ts reads them: a
// test under src cannot import node:fs, since the app's tsconfig has no Node types and `npm run build` checks the tests.

/*
 * A widget draws with the widget roles of tokens.css (look pass spec 6.2) and no colour of its own, so that the overlay's
 * dark panel can set the roles again and the same widget reads right over the game (spec 17). The roles are the colours
 * the two stylesheets of the widgets may name: no raw colour, no colour token of the pages, no named colour.
 */

type Declaration = { selector: string; name: string; value: string }

/** Every declaration of a stylesheet, comments left out, with the selector (and the at-rules) it stands in. */
function declarationsOf(css: string): Declaration[] {
  const found: Declaration[] = []
  const preludes: string[] = []
  for (const [, text, bracket] of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]*)([{}])/g)) {
    if (bracket === '{') {
      preludes.push(text.trim())
      continue
    }
    for (const declaration of text.split(';')) {
      const colon = declaration.indexOf(':')
      if (colon > 0) {
        found.push({ selector: preludes.join(' '), name: declaration.slice(0, colon).trim(), value: declaration.slice(colon + 1).trim() })
      }
    }
    preludes.pop()
  }
  return found
}

/** The CSS colour keywords and the system colours. `transparent` and `currentColor` are not colours of a stylesheet's own. */
const NAMED_COLOURS = new Set(
  (
    'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue ' +
    'chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen ' +
    'darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue ' +
    'darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick ' +
    'floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink ' +
    'indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan ' +
    'lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray ' +
    'lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid ' +
    'mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream ' +
    'mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen ' +
    'paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue ' +
    'saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen ' +
    'steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen ' +
    'canvas canvastext buttonface buttontext highlight highlighttext graytext field fieldtext linktext'
  ).split(' '),
)

/** The properties that hold a colour, in which a bare word can be the name of one. */
const COLOUR_PROPERTIES =
  /^(color|background(-color|-image)?|border(-(top|right|bottom|left))?(-color)?|outline(-color)?|box-shadow|text-shadow|fill|stroke|accent-color|caret-color|text-decoration(-color)?|column-rule(-color)?)$/

/**
 * What a stylesheet names that a widget may not: a colour written out (hex, a colour function, a colour's name), or a
 * custom property that is not one of the roles, a motion token, or a variable of the stylesheets themselves (`own`).
 * `roles` and `motion` come from tokens.css.
 */
function problemsIn(css: string, allowed: ReadonlySet<string>): string[] {
  const problems: string[] = []
  for (const { selector, name, value } of declarationsOf(css)) {
    const where = `${selector} { ${name}: ${value} }`
    if (/#[0-9a-f]{3,8}\b/i.test(value)) problems.push(`${where} writes a colour in hex`)
    if (/\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\(/i.test(value)) problems.push(`${where} writes a colour as a function`)
    if (COLOUR_PROPERTIES.test(name)) {
      const words = value.replace(/var\([^)]*\)/g, ' ').toLowerCase().match(/[a-z]+/g) ?? []
      for (const word of words) if (NAMED_COLOURS.has(word)) problems.push(`${where} names the colour ${word}`)
    }
    for (const [, token] of value.matchAll(/var\((--[\w-]+)/g)) {
      if (!allowed.has(token)) problems.push(`${where} draws with ${token}, which is no widget role`)
    }
  }
  return problems
}

/** The custom properties the widget stylesheets may use: the roles and the motion tokens of tokens.css, and their own. */
function allowedProperties(...sheets: string[]): Set<string> {
  const root = declarationsOf(tokens).filter((one) => one.selector === ":root, [data-theme='parchment']").map((one) => one.name)
  const own = sheets.flatMap((css) => declarationsOf(css).map((one) => one.name)).filter((name) => name.startsWith('--'))
  const motion = root.filter((name) => /^--(t-|ease-|stagger$)/.test(name))
  // --n is set by a view, on the element (a slot's place, for the stagger of its tick).
  return new Set([...root.filter((name) => name.startsWith('--w-')), ...motion, ...own, '--n'])
}

test('the widget roles are the colours of tokens.css that the widget stylesheets may use', () => {
  const allowed = allowedProperties(widgets, marks)
  // --w-gold-ink and --w-four: the Pulls plan, Tasks 11 and 12; --w-five-wash, --w-four-wash and --w-shade: its review;
  // --w-five: the themes plan, Task 2; --w-emblem-ink: its Task 3; --w-pity-mark: its fix round.
  expect([...allowed].filter((name) => name.startsWith('--w-')).length).toBe(26)
  for (const own of ['--fade', '--size', '--line']) expect(allowed.has(own), own).toBe(true)
  for (const page of ['--ink', '--ink2', '--muted', '--surface', '--border', '--hairline', '--fill', '--track', '--accent']) {
    expect(allowed.has(page), page).toBe(false) // a colour of the pages, which the dark panel does not set again
  }
})

test('the check finds a colour written out, a colour named, and a colour token that is not a role', () => {
  const allowed = allowedProperties(widgets, marks)
  const sheet = `
    .a { color: #123456; background: rgba(1, 2, 3, .5); border: 1px solid red; outline: 2px solid var(--focus) }
    .b { fill: var(--ink); box-shadow: 0 0 0 2px var(--w-outline), 0 0 4px var(--accent); stroke: color(srgb 1 0 0) }
    .c { background: linear-gradient(to right, color-mix(in srgb, var(--w-icon) 60%, transparent) 0 55%, transparent) }
    .d { mask-image: linear-gradient(to bottom, currentColor calc(100% - var(--fade)), transparent); width: var(--size, 36px) }
    @container (min-width: 300px) { .e { border-top: 3px solid var(--w-done); animation-delay: calc(var(--n, 0) * var(--stagger)) } }
  `
  expect(problemsIn(sheet, allowed)).toEqual([
    '.a { color: #123456 } writes a colour in hex',
    '.a { background: rgba(1, 2, 3, .5) } writes a colour as a function',
    '.a { border: 1px solid red } names the colour red',
    '.a { outline: 2px solid var(--focus) } draws with --focus, which is no widget role',
    '.b { fill: var(--ink) } draws with --ink, which is no widget role',
    '.b { box-shadow: 0 0 0 2px var(--w-outline), 0 0 4px var(--accent) } draws with --accent, which is no widget role',
    '.b { stroke: color(srgb 1 0 0) } writes a colour as a function',
  ])
})

test('the declarations of a stylesheet are found inside at-rules too, and comments are left out', () => {
  expect(declarationsOf('/* .x { color: red } */ @container (min-width: 1px) { .y { color: blue; width: 1px } } .z { top: 0 }')).toEqual([
    { selector: '@container (min-width: 1px) .y', name: 'color', value: 'blue' },
    { selector: '@container (min-width: 1px) .y', name: 'width', value: '1px' },
    { selector: '.z', name: 'top', value: '0' },
  ])
})

test('widgets.css draws with the widget roles and no colour of its own', () => {
  expect(problemsIn(widgets, allowedProperties(widgets, marks))).toEqual([])
})

test('marks.css draws with the widget roles and no colour of its own', () => {
  expect(problemsIn(marks, allowedProperties(widgets, marks))).toEqual([])
})

test("the Pulls page's washes are roles of tokens.css, which the dark panel sets again, and no colour of its own", () => {
  // The history's 5★ and 4★ rows, the shade under a banner's name on the night strip, and the light on the top of the
  // Savings ledger's card (a page role, since the ledger is no widget). The strip's sky is a drawing of its own, in hex,
  // as the mockup draws it: night is not a role.
  const washes = declarationsOf(pulls).filter((one) => /gradient\(/.test(one.value) && !one.selector.includes('pl-sky'))
  expect(washes.map(({ selector, value }) => `${selector} { ${value} }`)).toEqual([
    '.pl-over { linear-gradient(transparent, var(--w-shade)) }',
    '.pl-ledger { linear-gradient(180deg, var(--ledger-light) 0%, var(--surface) 60%) }',
    '.pl-r5 { linear-gradient(90deg, var(--w-five-wash), transparent 70%) }',
    '.pl-r4 { linear-gradient(90deg, var(--w-four-wash), transparent 70%) }',
  ])
  const colourFunction = /\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\(/i
  expect(declarationsOf(pulls).filter((one) => colourFunction.test(one.value))).toEqual([])
})

// The background is see-through on the overlay's dark panel (contrast.test.ts). Drawn over the panel alone it shows the
// panel, but drawn over a mark of the widget's own it lets some of the mark through. So what is drawn in the background's
// colour over a mark, a gap or a notch cut into it or a knock-out on it, is drawn in the gap colour, which is opaque. A
// box or a field filled with the background's colour lies on the panel alone, and keeps it.
test('ring gaps, notches and knock-outs are drawn in the opaque gap colour', () => {
  const gaps = [...declarationsOf(marks), ...declarationsOf(widgets)].filter((one) => one.value.includes('var(--w-gap)'))
  expect(gaps.map(({ selector, name, value }) => `${selector} { ${name}: ${value} }`)).toEqual([
    '.bar-notch { background: var(--w-gap) }', // between the days of the week's bar
    '.ring > svg .r-gaps { stroke: var(--w-gap) }', // between Resin's segments
    '.dial-tick { color: var(--w-gap) }', // the tick on a ready dial's badge
    '.dial-tick { box-shadow: 0 0 0 2px var(--w-gap) }', // round that badge, over the dial's ring
    '.pn-tick .sign { color: var(--w-gap) }', // the tick in a checked box of Pinned achievements
    '.cf-pin-dot { fill: var(--w-gap) }', // the dot in the Clock's pin, over its hands
    '.clock-dial .fig { background: var(--w-gap) }', // the plate of the Clock's time, over its hands
    '.ex .face-tick { color: var(--w-gap) }', // the tick on an expedition's badge
    '.ex .face-tick { box-shadow: 0 0 0 2px var(--w-gap) }', // round that badge, over the face's ring
  ])
})

test('the scroll with a fade at its bottom edge is written once, as the w-scroll class', () => {
  const rules = declarationsOf(widgets)
  const scrolling = rules.filter((one) => one.name === 'overflow' || one.name === 'overflow-y')
  // Nothing else in the stylesheet scrolls; what it clips with `overflow: hidden` is no scroll.
  expect(scrolling.filter((one) => /auto|scroll/.test(one.value)).map((one) => one.selector)).toEqual(['.w-scroll'])
  expect(rules.filter((one) => one.name === 'mask-image').map((one) => one.selector)).toEqual(['.w-scroll'])
  // A list that holds controls keeps its first row clear of the top edge for their rings; nothing else is its own.
  const scrollsOf = (shared: boolean) =>
    rules.filter((one) => one.name.startsWith('scroll') && (one.selector === '.w-scroll') === shared).map((one) => one.name)
  expect(scrollsOf(true).sort()).toEqual(['scroll-padding-bottom', 'scrollbar-width'])
  expect(new Set(scrollsOf(false))).toEqual(new Set(['scroll-padding-top']))
  expect(rules.filter((one) => one.selector === '.w-scroll').map((one) => one.name).sort()).toEqual([
    'mask-image', 'overflow', 'padding-bottom', 'scroll-padding-bottom', 'scrollbar-width',
  ])
})

/*
 * What a widget shows at its size is chosen by container queries on its frame (widgets.css). The overlay's cells are 168
 * pixels wide, and the Board's columns share its width (boardview.ts, columnWidth), so a frame of a size is a little
 * wider on the Board, by how much depending on the window. A query on the width tells the sizes apart all the same: it
 * splits between whole cells, never inside the widths that one size takes.
 */

type WidthQuery = { feature: 'min-width' | 'max-width'; px: number }

/** Each `min-width` and `max-width` of a stylesheet's @container rules, in pixels. */
function widthQueries(css: string): WidthQuery[] {
  const found: WidthQuery[] = []
  for (const [prelude] of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/@container[^{]*/g)) {
    for (const [, feature, px] of prelude.matchAll(/\((min-width|max-width):\s*([\d.]+)px\)/g)) {
      found.push({ feature: feature as WidthQuery['feature'], px: Number(px) })
    }
  }
  return found
}

/**
 * The widths that a frame `cells` columns wide takes, its 1-pixel border aside, as a query measures it: first on the
 * overlay, of columns 168 pixels wide, then on the Board at every width from its narrowest, 850 pixels in a window of
 * 1,040, up to 4,000, in quarters of a pixel.
 */
function frameWidths(cells: number): number[] {
  const widths = [cells * 168 + (cells - 1) * 12 - 2]
  for (let board = 850; board <= 4000; board += 0.25) {
    const columns = columnsFor(board)
    if (columns >= cells) widths.push(cells * columnWidth(board, columns) + (cells - 1) * 12 - 2)
  }
  return widths
}

test("a query on a widget's width tells its sizes apart however wide the Board's columns are, as one cell across does", () => {
  const queries = [...widthQueries(widgets), ...widthQueries(checkin)]
  expect(queries.length).toBeGreaterThan(10) // the stylesheets' queries are found
  expect(Math.max(...frameWidths(1))).toBeGreaterThan(210) // one cell is up to 213 pixels wide on the Board
  // useOneCell's `narrow`, a frame's width without its border at most ONE_CELL_ACROSS, splits as a max-width does.
  for (const { feature, px } of [...queries, { feature: 'max-width' as const, px: ONE_CELL_ACROSS }]) {
    const holds = (width: number) => (feature === 'min-width' ? width >= px : width <= px)
    for (let cells = 1; cells <= 6; cells += 1) {
      const widths = frameWidths(cells)
      const atOverlay = holds(widths[0])
      const differ = widths.find((width) => holds(width) !== atOverlay)
      expect(differ, `(${feature}: ${px}px) on a frame ${cells} cells across, ${differ?.toFixed(2)} pixels wide`).toBeUndefined()
    }
  }
})

/** Each `min-aspect-ratio` of a stylesheet's @container rules, as it is written and as a width over a height. */
function shapeQueries(css: string): { text: string; ratio: number }[] {
  const found: { text: string; ratio: number }[] = []
  for (const [prelude] of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/@container[^{]*/g)) {
    expect(prelude, 'a query on a shape is written as min-aspect-ratio').not.toMatch(/max-aspect-ratio|[^-]aspect-ratio\s*[<>=]/)
    for (const [text, width, height] of prelude.matchAll(/min-aspect-ratio:\s*([\d.]+)\s*\/\s*([\d.]+)/g)) {
      found.push({ text, ratio: Number(width) / Number(height) })
    }
  }
  return found
}

/** The queries on a frame's shape, each with the widget it is written for, over whose sizes it is swept. */
const SHAPES: readonly { text: string; type: string }[] = [
  { text: 'min-aspect-ratio: 12 / 5', type: 'clock' }, // the dial beside the time, from three cells across
  { text: 'min-aspect-ratio: 8 / 5', type: 'quick-timer' }, // the running dial beside the time and the button
]

test("a query on a widget's shape tells the widget's sizes apart however wide the Board's columns are", () => {
  const found = [...shapeQueries(widgets), ...shapeQueries(checkin)]
  expect(found.map(({ text }) => text).sort()).toEqual(SHAPES.map(({ text }) => text).sort()) // each one is swept below
  for (const { text, type } of SHAPES) {
    const { ratio } = found.find((one) => one.text === text)!
    const range = rangeOf(type)!
    expect(range, type).toBeDefined()
    for (let w = range.min.w; w <= range.max.w; w += 1) {
      for (let h = range.min.h; h <= range.max.h; h += 1) {
        const height = h * 96 + (h - 1) * 12 - 2 // the rows are 96 pixels on both places
        const widths = frameWidths(w)
        const atOverlay = widths[0] / height >= ratio
        const differ = widths.find((width) => width / height >= ratio !== atOverlay)
        expect(differ, `(${text}) on a ${type} of ${w} × ${h}, ${differ?.toFixed(2)} pixels wide`).toBeUndefined()
      }
    }
  }
})
