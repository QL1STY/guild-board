/**
 * Colour checks for the tests of the palette. Nothing in the interface imports this file.
 */

import type { ThemeName } from '../theme.ts'

/** A `#RRGGBB` colour as its red, green and blue, each 0 to 255. Anything else is refused by name. */
function channels(colour: string): [number, number, number] {
  const found = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(colour)
  if (found === null) throw new Error(`Not a #RRGGBB colour: ${colour}`)
  return [parseInt(found[1], 16), parseInt(found[2], 16), parseInt(found[3], 16)]
}

/** How bright a colour is to the eye, 0 for black to 1 for white, as WCAG 2.1 defines it. */
function luminance(colour: string): number {
  const [red, green, blue] = channels(colour).map((channel) => {
    const level = channel / 255
    return level <= 0.03928 ? level / 12.92 : ((level + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

/** The WCAG contrast ratio of two `#RRGGBB` colours: 1 for the same colour, 21 for black and white. Either may come first. */
export function contrast(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (lighter + 0.05) / (darker + 0.05)
}

/** A `#RRGGBB` colour in CIE L*a*b*. */
function lab(colour: string): [number, number, number] {
  const [r, g, b] = channels(colour).map((channel) => {
    const level = channel / 255
    return level <= 0.04045 ? level / 12.92 : ((level + 0.055) / 1.055) ** 2.4
  })
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047)
  const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b)
  const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883)
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
}

/** How far apart two `#RRGGBB` colours look: the CIE76 colour difference, 0 for the same colour, about 2 at the least that an eye tells apart, 100 for black and white. */
export function colourDistance(a: string, b: string): number {
  const [l1, a1, b1] = lab(a)
  const [l2, a2, b2] = lab(b)
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2)
}

/** The `#RRGGBB` colour that `fg` at `alpha` (0 to 1) shows as over `bg`, each channel rounded to a whole number. */
export function over(fg: string, alpha: number, bg: string): string {
  const below = channels(bg)
  const mixed = channels(fg).map((channel, i) => Math.round(channel * alpha + below[i] * (1 - alpha)))
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`.toUpperCase()
}

/**
 * The custom properties of one theme in a stylesheet, as written: `{ '--ink': '#3B4255', '--page': 'radial-gradient(...)' }`.
 * Parchment is the rules whose selector list holds `:root` (`:root` or `:root, [data-theme='parchment']`); another theme is
 * the rules whose list holds exactly `[data-theme='<name>']` (either quote). A rule with a descendant part, such as
 * `[data-theme='midnight'] .el-pyro`, and the dark panel's `.on-dark` are never read.
 */
export function themeDeclarations(css: string, theme: ThemeName = 'parchment'): Record<string, string> {
  const wanted = theme === 'parchment' ? [':root'] : [`[data-theme='${theme}']`, `[data-theme="${theme}"]`]
  const values: Record<string, string> = {}
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const rule of plain.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    if (!rule[1].split(',').some((selector) => wanted.includes(selector.trim()))) continue
    for (const declaration of rule[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+?)\s*(?:;|$)/g)) {
      values[declaration[1]] = declaration[2]
    }
  }
  return values
}

/**
 * The colours of a theme in a stylesheet, as `{ '--ink': '#3B4255' }`, from the rules `themeDeclarations` reads (Parchment by
 * default). Only a value that is a `#RRGGBB` colour on its own is taken: a gradient, a `var()` or an `rgba()` is left out.
 */
export function tokenValues(css: string, theme: ThemeName = 'parchment'): Record<string, string> {
  return Object.fromEntries(Object.entries(themeDeclarations(css, theme)).filter(([, value]) => /^#[0-9a-fA-F]{6}$/.test(value)))
}
