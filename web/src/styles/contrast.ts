/**
 * Colour checks for the tests of the palette. Nothing in the interface imports this file.
 */

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

/** The `#RRGGBB` colour that `fg` at `alpha` (0 to 1) shows as over `bg`, each channel rounded to a whole number. */
export function over(fg: string, alpha: number, bg: string): string {
  const below = channels(bg)
  const mixed = channels(fg).map((channel, i) => Math.round(channel * alpha + below[i] * (1 - alpha)))
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`.toUpperCase()
}

/**
 * The colours of a stylesheet's `:root`, as `{ '--ink': '#3B4255' }`. Only a value that is a `#RRGGBB` colour on its own
 * is taken: a gradient, a `var()` or an `rgba()` is left out, and so is everything outside `:root`, such as the dark
 * panel's own values.
 */
export function tokenValues(css: string): Record<string, string> {
  const values: Record<string, string> = {}
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const rule of plain.matchAll(/:root\s*\{([^}]*)\}/g)) {
    for (const declaration of rule[1].matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*(?:;|$)/g)) {
      values[declaration[1]] = declaration[2]
    }
  }
  return values
}
