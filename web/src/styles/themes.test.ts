import { describe, expect, test } from 'vitest'
import emblemSource from '../ui/emblem.ts?raw'
import elementsCss from '../pages/characters/elements.css?raw'
import { colourDistance, contrast, themeDeclarations, tokenValues } from './contrast.ts'
import marksCss from './marks.css?raw'
import themesCss from './themes.css?raw'
import tokensCss from './tokens.css?raw'
import { DARK_THEME_NAMES, THEME_NAMES, type ThemeName } from '../theme.ts'

// The themes besides Parchment (the themes design, sections 2 to 5 and 12): each is a set of the window's tokens, and each
// passes the contrast rules Parchment passes (contrast.test.ts). Parchment itself is tokens.css and is held by themetokens.test.ts.
// Every test below is driven by these lists, so a theme added to one is held to all of them; the second test makes a theme
// that is in THEME_NAMES but in neither list fail.

/** The dark themes: `color-scheme: dark`, lighter element inks, black shadows, a dark title bar (the one list, theme.ts). */
const DARK = DARK_THEME_NAMES
/** The light themes besides Parchment: Mist and the three light nations. */
const LIGHT = ['mist', 'mondstadt', 'sumeru', 'snezhnaya'] as const
const OTHERS = [...DARK, ...LIGHT] as readonly ThemeName[]
type OtherName = ThemeName
/** The themes whose page is a soft gradient; Slate's is one flat colour (the themes design, section 2). */
const GRADIENT = OTHERS.filter((name) => name !== 'slate')
const ELEMENTS = ['pyro', 'hydro', 'anemo', 'electro', 'dendro', 'cryo', 'geo']

/**
 * The tokens that keep one value in every theme, each for its reason. A theme block may still write one (Mist holds a number
 * of Parchment's values on purpose); it need not. Everything else of Parchment's tokens a theme must give its own value.
 */
const SAME_EVERYWHERE: Record<string, string> = {
  '--material-a': "the plate of a material's sign is a purple of its own, and the sign's gold sits on it",
  '--material-b': "the plate of a material's sign is a purple of its own, and the sign's gold sits on it",
  '--material-ink': "the plate of a material's sign is a purple of its own, and the sign's gold sits on it",
  '--map-ground': "the ground behind HoYoverse's map is a night on every theme, as the map itself is",
  '--note-tick': 'the undo note is drawn on the rail, dark on every theme, and its marks are made for that ground',
  '--note-warn': 'the undo note is drawn on the rail, dark on every theme, and its marks are made for that ground',
  '--note-pill': 'the undo note is drawn on the rail, dark on every theme, and its Undo pill is made for that ground',
  '--note-pill-text': 'the dark text of the Undo pill, on its pale gold',
  '--medal-light': 'the gold of a medal and the dark ink on it are a pair of their own, a mark and not a surface',
  '--medal': 'the gold of a medal and the dark ink on it are a pair of their own, a mark and not a surface',
  '--medal-ink': 'the gold of a medal and the dark ink on it are a pair of their own, a mark and not a surface',
  '--brand': "the signs' gold, on the rail's title and the first run's name, reads on a dark ground and is the brand",
  '--emblem-ink': "the cream knocked out of a nation's disc, whose colour is fixed on every theme (ui/emblem.ts)",
  '--w-emblem-ink': "the same cream on the widgets' roles on every page theme (the overlay's panel sets its own dark, as it always had)",
  '--rail-line': "the hairline above the rail's foot: every rail is dark on every theme, and a white line at 12% is right on it",
}

/** The Ledger's six sources, each a mark that has to read on the card in every theme but Parchment's own mockup values. */
const LEDGER_SOURCES = ['--src-welkin', '--src-commissions', '--src-events', '--src-endgame', '--src-other', '--src-shop']

const SETS = Object.fromEntries(OTHERS.map((name) => [name, tokenValues(themesCss, name)])) as Record<OtherName, Record<string, string>>
const { midnight, slate, mist, liyue, inazuma, fontaine, natlan, snezhnaya } = SETS

const parchment = tokenValues(tokensCss)
const parchmentAll = themeDeclarations(tokensCss)

/** Custom properties of Parchment that are not a plain hex but a colour all the same: rgba(), rgb(), a gradient. */
const NOT_PLAIN_COLOURS = Object.entries(parchmentAll)
  .filter(([, value]) => /^(rgba?|hsla?|radial-gradient|linear-gradient)\(/.test(value))
  .map(([name]) => name)

/** An element's `--el-ink` in this theme: its own rule in themes.css where there is one, else the elements.css value. */
function elementInk(theme: ThemeName, element: string): string {
  const plain = themesCss.replace(/\/\*[\s\S]*?\*\//g, '')
  const own = new RegExp(`\\[data-theme=['"]${theme}['"]\\]\\s+\\.el-${element}\\s*\\{([^}]*)\\}`).exec(plain)?.[1]
  const body = own ?? new RegExp(`\\.el-${element}\\s*\\{([^}]*)\\}`).exec(elementsCss.replace(/\/\*[\s\S]*?\*\//g, ''))?.[1] ?? ''
  return /--el-ink:\s*(#[0-9A-Fa-f]{6})/.exec(body)?.[1] ?? ''
}

/** The red, green and blue of an `rgba(…)` or `rgb(… / a)` colour, as a #RRGGBB, and its alpha. */
function rgbaOf(value: string): { hex: string; alpha: number } {
  const numbers = [...value.matchAll(/[\d.]+/g)].map((found) => Number(found[0]))
  const [r, g, b] = numbers
  const alpha = numbers.length > 3 ? numbers[3] : 1
  const hex = `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
  return { hex, alpha }
}

/** The colours of the discs behind a region's emblem: the seven nations' and the slate (ui/emblem.ts). */
const DISCS = [...emblemSource.matchAll(/'(#[0-9A-Fa-f]{6})'/g)].map((found) => found[1])

test('the emblem discs are read from ui/emblem.ts: seven nations and the slate', () => {
  expect(DISCS).toHaveLength(8)
  expect(DISCS).toContain('#4A5366')
})

test.each(THEME_NAMES)("%s: the emblem's knock-out reaches 3:1 on every disc", (name) => {
  const set = name === 'parchment' ? parchment : { ...parchment, ...SETS[name] }
  for (const token of ['--emblem-ink', '--w-emblem-ink'])
    for (const disc of DISCS) expect(contrast(set[token], disc), `${name} ${token} ${set[token]} on ${disc}`).toBeGreaterThanOrEqual(3)
})

test('the theme names are those of the design, Parchment first, the five looks, then the seven nations', () => {
  expect(THEME_NAMES).toEqual([
    'parchment', 'midnight', 'slate', 'dusk', 'mist',
    'mondstadt', 'liyue', 'inazuma', 'sumeru', 'fontaine', 'natlan', 'snezhnaya',
  ])
})

test('every theme but Parchment is in the dark list or the light list, and in one of them only', () => {
  expect([...DARK, ...LIGHT].sort()).toEqual(THEME_NAMES.filter((name) => name !== 'parchment').sort())
  expect(DARK.filter((name) => (LIGHT as readonly string[]).includes(name))).toEqual([])
})

test('SAME_EVERYWHERE names tokens that exist, each with a reason', () => {
  for (const [name, reason] of Object.entries(SAME_EVERYWHERE)) {
    expect(name in parchmentAll, name).toBe(true)
    expect(reason.length, name).toBeGreaterThan(10)
  }
})

describe.each(OTHERS)('%s', (name) => {
  const theme = SETS[name]
  const declared = themeDeclarations(themesCss, name)

  test('it gives every colour token of Parchment a value, but those the same everywhere', () => {
    const missing = Object.keys(parchment).filter((token) => !(token in theme) && !(token in SAME_EVERYWHERE))
    expect(missing).toEqual([])
  })

  test('it gives every rgba, rgb and gradient token of Parchment a value too, but those the same everywhere', () => {
    const missing = NOT_PLAIN_COLOURS.filter((token) => !(token in declared) && !(token in SAME_EVERYWHERE))
    expect(missing).toEqual([])
  })

  test('it sets no token that Parchment does not have', () => {
    expect(Object.keys(declared).filter((token) => !(token in parchmentAll))).toEqual([])
  })

  test('its page runs from its two page colours, in a gradient, or in Slate one flat colour', () => {
    if (name === 'slate') {
      expect(declared['--page']).toBe('var(--page-dark)')
      return
    }
    expect(declared['--page']).toContain('var(--page-light)')
    expect(declared['--page']).toContain('var(--page-dark)')
  })

  test('text reaches 4.5:1', () => {
    for (const [fg, bg] of [
      ['--ink', '--surface'],
      ['--ink2', '--surface'],
      ['--muted', '--surface'],
      ['--muted', '--tint'],
      ['--ink', '--page-dark'],
      ['--ink', '--page-light'],
      ['--good', '--surface'],
      ['--spent', '--surface'],
      ['--button-text', '--button'],
      ['--rail-text', '--rail'],
      ['--rail-muted', '--rail'],
      ['--w-ink', '--w-bg'],
      ['--w-muted', '--w-bg'],
      // The same colours of the rest of the window, on the grounds they are laid on.
      ['--ink', '--tint'],
      ['--ink', '--ledger-light'],
      ['--ink', '--gold-soft'],
      ['--warn-ink', '--gold-soft'],
      ['--ink', '--good-soft'],
      ['--bad', '--bad-soft'],
      ['--bad', '--surface'],
      ['--gold-ink', '--warn-soft'],
      ['--gold-ink', '--gold-soft'], // the step numbers of the profile's Readiness sheet
      ['--r4', '--warn-soft'],
      ['--ink', '--warn-soft'],
      ['--ink', '--field'],
      ['--rail-text', '--refused'],
      ['--refused-ink', '--surface'],
      ['--refused-ink', '--tint'],
      ['--gold-ink', '--surface'],
      ['--w-gold-ink', '--w-bg'],
      ['--w-good', '--w-bg'],
      ['--w-ink2', '--w-bg'],
      ['--w-btn-text', '--w-btn'],
      ['--on-mark', '--gold-ink'],
      ['--on-mark', '--mode-abyss'],
      ['--on-mark', '--mode-theater'],
      ['--on-mark', '--mode-stygian'],
      ['--on-mark', '--seg-done'],
    ])
      expect(contrast(theme[fg], theme[bg]), `${fg} ${theme[fg]} on ${bg} ${theme[bg]}`).toBeGreaterThanOrEqual(4.5)
  })

  test('marks, outlines and the focus ring reach 3:1', () => {
    for (const [fg, bg] of [
      ['--fill', '--surface'],
      ['--five', '--surface'],
      ['--done', '--surface'],
      ['--outline', '--surface'],
      ['--focus', '--surface'],
      ['--focus', '--page-dark'],
      ['--w-fill', '--w-bg'],
      ['--w-five', '--w-bg'],
      ['--w-four', '--w-bg'],
      // The marks of the rest of the window.
      ['--fill', '--page-dark'],
      ['--w-done', '--w-bg'],
      ['--w-outline', '--w-bg'],
      ['--w-focus', '--w-bg'],
      ['--gold', '--rail'], // the AR badge's text, large and bold, on the rail's colour
      ['--button-mark', '--button'], // the chosen achievement category's bar on its plate
      ['--series', '--surface'],
      ['--accent', '--surface'],
      ['--resin', '--surface'],
      ['--wish-character', '--surface'],
      ['--wish-weapon', '--surface'],
      ['--wish-standard', '--surface'],
      ['--wish-chronicled', '--surface'],
      ['--mode-abyss', '--surface'],
      ['--mode-theater', '--surface'],
      ['--mode-stygian', '--surface'],
      // The Ledger's sources: the marks of its segmented bar, its dots and its chart (the Ledger revamp design, section 8).
      ...LEDGER_SOURCES.map((token) => [token, '--surface']),
    ])
      expect(contrast(theme[fg], theme[bg]), `${fg} ${theme[fg]} on ${bg} ${theme[bg]}`).toBeGreaterThanOrEqual(3)
  })

  test("each element's ink reaches 3:1 on the card", () => {
    for (const element of ELEMENTS) {
      const ink = elementInk(name, element)
      expect(ink, `${name} ${element} --el-ink`).toMatch(/^#[0-9A-Fa-f]{6}$/)
      expect(contrast(ink, theme['--surface']), `${element} ${ink}`).toBeGreaterThanOrEqual(3)
    }
  })

  test('the 5★ gold stays a gold, and reaches 3:1 on the card', () => {
    for (const token of ['--five', '--w-five']) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(theme[token].slice(i, i + 2), 16))
      expect(r, token).toBeGreaterThan(b + 40) // a warm colour, red well over blue
      expect(g, token).toBeGreaterThan(b)
      expect(r, token).toBeGreaterThanOrEqual(g)
      expect(contrast(theme[token], theme['--surface']), token).toBeGreaterThanOrEqual(3)
    }
  })
})

describe.each(DARK)('%s, a dark theme', (name) => {
  const theme = SETS[name]
  const declared = themeDeclarations(themesCss, name)

  test('its card is dark and its page is darker still', () => {
    expect(contrast(theme['--surface'], '#000000')).toBeLessThan(2)
    expect(contrast(theme['--page-dark'], '#000000')).toBeLessThan(contrast(theme['--surface'], '#000000'))
    expect(contrast(theme['--page-light'], '#000000')).toBeLessThan(2)
  })

  test('its scrim and shadows are dark, and its glint is faint', () => {
    for (const token of ['--scrim', '--shadow-deep', '--shadow-warm', '--shadow-map']) {
      expect(contrast(rgbaOf(declared[token]).hex, '#000000'), token).toBeLessThan(2)
    }
    expect(rgbaOf(declared['--glint']).alpha, '--glint').toBeLessThanOrEqual(0.3)
  })

  test('its shade under words over a picture is its card, nearly whole', () => {
    const shade = rgbaOf(declared['--w-shade'])
    expect(contrast(shade.hex, '#000000')).toBeLessThan(2)
    expect(shade.alpha).toBeGreaterThanOrEqual(0.8)
  })

  test("its element inks are lighter than the parchment's, and its 5★ gold lighter than Parchment's", () => {
    for (const element of ELEMENTS) {
      expect(contrast(elementInk(name, element), theme['--surface']), element).toBeGreaterThan(
        contrast(elementInk('parchment', element), theme['--surface']),
      )
    }
    expect(contrast(theme['--five'], theme['--surface'])).toBeGreaterThan(contrast(parchment['--five'], theme['--surface']))
  })
})

describe('slate', () => {
  const declared = themeDeclarations(themesCss, 'slate')

  test('its page is one flat colour: no gradient, and its two page colours are the same', () => {
    expect(declared['--page']).not.toMatch(/gradient/)
    expect(declared['--page']).toBe('var(--page-dark)')
    expect(slate['--page-light']).toBe(slate['--page-dark'])
    expect(slate['--page-dark']).toBe('#2C333F')
  })

  test('the other themes that have a gradient keep it', () => {
    for (const name of GRADIENT) expect(themeDeclarations(themesCss, name)['--page'], name).toMatch(/radial-gradient/)
  })

  test('its card is a step lighter than its page, and its gold is the gold of the dark themes', () => {
    expect(contrast(slate['--surface'], '#000000')).toBeGreaterThan(contrast(slate['--page-dark'], '#000000'))
    expect(slate['--button']).toBe(slate['--fill'])
    expect(slate['--fill']).toBe('#DDBB72')
    expect(slate['--five']).toBe('#DDBB72')
  })
})

describe('mist', () => {
  test("its general accent is blue and its 5★ gold is not", () => {
    for (const token of ['--fill', '--w-fill', '--accent']) {
      const [r, , b] = [1, 3, 5].map((i) => parseInt(mist[token].slice(i, i + 2), 16))
      expect(b, token).toBeGreaterThan(r + 40)
    }
    expect(mist['--five']).not.toBe(mist['--fill'])
  })

  test('its button is blue with white text, and its rail dark', () => {
    expect(mist['--button-text']).toBe('#FFFFFF')
    expect(contrast(mist['--rail'], '#000000')).toBeLessThan(2)
  })
})

describe('the dark themes keep their buttons the colour of their progress, with dark text', () => {
  // Natlan has two accents on purpose (the themes design, section 12): turquoise progress, ember buttons.
  test.each(DARK.filter((name) => name !== 'natlan'))('%s', (name) => {
    const theme = SETS[name]
    expect(theme['--button']).toBe(theme['--fill'])
    expect(contrast(theme['--button-text'], '#000000')).toBeLessThan(2)
  })

  test('natlan: ember, with dark text', () => {
    expect(contrast(natlan['--button-text'], '#000000')).toBeLessThan(2)
  })
})

describe('the light nations draw their buttons white on their accent, as Mist does', () => {
  test.each(['mondstadt', 'sumeru', 'snezhnaya'] as const)('%s', (name) => {
    const theme = SETS[name]
    expect(theme['--button']).toBe(theme['--fill'])
    expect(theme['--button-text']).toBe('#FFFFFF')
    expect(theme['--button-mark']).toBe('#FFFFFF')
  })
})

describe('the nations keep their characters (the themes design, section 12)', () => {
  const channelsOf = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))

  test("Inazuma's accent is sakura pink, red over blue, never a violet", () => {
    for (const token of ['--fill', '--w-fill', '--accent', '--button']) {
      const [r, g, b] = channelsOf(inazuma[token])
      expect(r, token).toBeGreaterThan(b)
      expect(r, token).toBeGreaterThan(g + 40)
    }
  })

  test('Natlan has two accents: turquoise for progress, ember with dark text for its buttons', () => {
    for (const token of ['--fill', '--w-fill', '--accent']) {
      const [r, g, b] = channelsOf(natlan[token])
      expect(g, token).toBeGreaterThan(r + 40)
      expect(b, token).toBeGreaterThan(r + 40)
    }
    expect(natlan['--button']).toBe('#F08A4B')
    expect(natlan['--w-btn']).toBe('#F08A4B')
    expect(natlan['--button-mark']).toBe(natlan['--button-text'])
  })

  test("Snezhnaya's progress and button are crimson", () => {
    for (const token of ['--fill', '--w-fill', '--accent', '--button']) {
      const [r, g, b] = channelsOf(snezhnaya[token])
      expect(r, token).toBeGreaterThan(g + 80)
      expect(r, token).toBeGreaterThan(b + 80)
    }
  })

  test('Fontaine is clearly bluer than Midnight, and has no green in it', () => {
    const blueOver = (theme: Record<string, string>) => {
      const [r, g, b] = channelsOf(theme['--page-light'])
      return { toRed: b - r, toGreen: b - g }
    }
    expect(blueOver(fontaine).toRed).toBeGreaterThan(blueOver(midnight).toRed * 1.5)
    expect(blueOver(fontaine).toGreen).toBeGreaterThan(blueOver(midnight).toGreen * 1.5)
    const [r, g, b] = channelsOf(fontaine['--surface'])
    expect(g).toBeLessThan(b - 30)
    expect(r).toBeLessThan(g)
  })

  test('Liyue is a warm lacquer: red over blue in its page and card', () => {
    for (const token of ['--page-dark', '--page-light', '--surface']) {
      const [r, , b] = channelsOf(liyue[token])
      expect(r, token).toBeGreaterThan(b)
    }
  })

  test('the four dark nations have black shadows and a rail darker than their page', () => {
    for (const name of ['liyue', 'inazuma', 'fontaine', 'natlan'] as const) {
      expect(SETS[name]['--shadow-ink'], name).toBe('#000000')
      expect(contrast(SETS[name]['--rail'], '#000000'), name).toBeLessThan(contrast(SETS[name]['--page-dark'], '#000000'))
    }
  })

  test('the three light nations cast their ink as shadow, as Mist does', () => {
    for (const name of ['mondstadt', 'sumeru', 'snezhnaya'] as const) expect(SETS[name]['--shadow-ink'], name).toBe(SETS[name]['--ink'])
  })
})

describe("the Ledger's tokens (the Ledger revamp design, section 8)", () => {
  test("Parchment's are the mockup's, and each theme but Parchment gives its own", () => {
    expect(LEDGER_SOURCES.map((token) => parchment[token])).toEqual(['#7B6AA8', '#5677A6', '#B6803F', '#4C8A86', '#978A6E', '#A4423A'])
    expect([parchment['--ld-cover-a'], parchment['--ld-cover-b'], parchment['--ld-edge']]).toEqual(['#FBF7EE', '#F7F2E7', '#C9A04E'])
    expect(parchmentAll['--ld-cover-stripe']).toBe('rgba(211, 188, 142, .10)')
    for (const name of OTHERS) {
      const declared = themeDeclarations(themesCss, name)
      for (const token of [...LEDGER_SOURCES, '--ld-cover-a', '--ld-cover-b', '--ld-cover-stripe', '--ld-edge']) expect(declared[token], `${name} ${token}`).toBeDefined()
    }
  })

  test('on a dark theme a source is its Parchment colour or a lighter one of the same hue, never another colour', () => {
    const hueOf = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      const max = Math.max(r, g, b)
      const min = Math.min(r, g, b)
      const d = max - min
      if (d === 0) return 0
      const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
      return (h * 60 + 360) % 360
    }
    for (const name of DARK)
      for (const token of LEDGER_SOURCES) {
        expect(Math.abs(hueOf(SETS[name][token]) - hueOf(parchment[token])), `${name} ${token}`).toBeLessThanOrEqual(6)
        expect(contrast(SETS[name][token], '#000000'), `${name} ${token}`).toBeGreaterThanOrEqual(contrast(parchment[token], '#000000'))
      }
  })

  test("the peel's edge is gold in every theme, never the accent: the hue of Parchment's gold, whatever the look", () => {
    const hueOf = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      const d = Math.max(r, g, b) - Math.min(r, g, b)
      const h = Math.max(r, g, b) === r ? ((g - b) / d) % 6 : Math.max(r, g, b) === g ? (b - r) / d + 2 : (r - g) / d + 4
      return (h * 60 + 360) % 360
    }
    for (const name of THEME_NAMES) {
      const edge = name === 'parchment' ? parchment['--ld-edge'] : SETS[name]['--ld-edge']
      const hue = hueOf(edge)
      expect(hue, `${name} ${edge}`).toBeGreaterThanOrEqual(33)
      expect(hue, `${name} ${edge}`).toBeLessThanOrEqual(50)
    }
    for (const name of DARK) expect(contrast(SETS[name]['--ld-edge'], SETS[name]['--surface']), name).toBeGreaterThanOrEqual(3)
  })

  test("the cover of Spent on Genshin is the card's own two grounds, so it lies on a theme as Parchment's lies on parchment", () => {
    for (const name of OTHERS) {
      expect(SETS[name]['--ld-cover-a'], name).toBe(SETS[name]['--ledger-light'])
      expect(SETS[name]['--ld-cover-b'], name).toBe(SETS[name]['--surface'])
    }
  })
})

describe('themes.css', () => {
  test('it has one block for each theme besides Parchment, which tokens.css holds', () => {
    const plain = themesCss.replace(/\/\*[\s\S]*?\*\//g, '')
    for (const name of THEME_NAMES) {
      const blocks = [...plain.matchAll(new RegExp(`(?:^|\\})\\s*\\[data-theme=['"]${name}['"]\\]\\s*\\{`, 'g'))]
      expect(blocks.length, name).toBe(name === 'parchment' ? 0 : 1)
    }
  })

  test('the element inks of the dark themes are written for every element, and a light theme writes none', () => {
    const plain = themesCss.replace(/\/\*[\s\S]*?\*\//g, '')
    for (const name of DARK) {
      for (const element of ELEMENTS) {
        expect(plain, `${name} ${element}`).toMatch(new RegExp(`\\[data-theme=['"]${name}['"]\\]\\s+\\.el-${element}\\s*\\{[^}]*--el-ink:\\s*#`))
      }
    }
    for (const name of LIGHT) expect(plain, name).not.toMatch(new RegExp(`\\[data-theme=['"]${name}['"]\\]\\s+\\.`))
  })
})

describe('Match Windows before the script has run', () => {
  // The core writes data-theme="system" into the page, and main.tsx replaces it with Midnight or Parchment only when it runs, after the
  // first paint may have happened. On a dark Windows that first paint must not be Parchment: a rule inside the dark media query gives
  // the page's own background and ink Midnight's values, and nothing else.
  const plain = themesCss.replace(/\/\*[\s\S]*?\*\//g, '')

  test('a rule for the unresolved word sits in the dark media query and holds exactly the page and the ink, as Midnight has them', () => {
    expect(plain).toMatch(/@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*\[data-theme=['"]system['"]\]\s*\{/)
    const early = themeDeclarations(themesCss, 'system' as ThemeName)
    expect(Object.keys(early).sort()).toEqual(['--ink', '--page', '--page-dark', '--page-light'])
    const written = themeDeclarations(themesCss, 'midnight')
    for (const [name, value] of Object.entries(early)) expect(value, name).toBe(written[name])
  })

  test('there is no such rule for a light Windows: the word keeps the tokens of :root, which are Parchment\'s', () => {
    expect(plain.match(/\[data-theme=['"]system['"]\]\s*\{/g)).toHaveLength(1)
  })
})

describe("the primogem chart's colours tell the sources apart", () => {
  // The columns of Primogems earned per day and their legend stack the daily commissions (--fill), the Welkin Moon (--series), events
  // (--wish-standard) and the endgame (--wish-chronicled) side by side (charts/stack.ts GROUP_COLOURS). A theme whose accent is
  // a pink or a red must not leave --wish-standard the same pink or red: the legend's two swatches read as one.
  const sets: Record<string, Record<string, string>> = { ...SETS, parchment: tokenValues(tokensCss) }
  test.each(THEME_NAMES)('%s: the commissions, the Welkin Moon and the events are 25 apart or more, and the endgame is clear of the commissions', (name) => {
    const set = sets[name]
    const apart = (a: string, b: string) => colourDistance(set[a], set[b])
    expect(apart('--fill', '--series'), `${name} --fill and --series`).toBeGreaterThanOrEqual(25)
    expect(apart('--fill', '--wish-standard'), `${name} --fill and --wish-standard`).toBeGreaterThanOrEqual(25)
    expect(apart('--fill', '--wish-chronicled'), `${name} --fill and --wish-chronicled`).toBeGreaterThanOrEqual(25)
  })
})

describe('the soft-pity mark across a pity ring (--w-pity-mark)', () => {
  const sets: Record<string, Record<string, string>> = { ...SETS, parchment: tokenValues(tokensCss) }

  test('the ring draws its mark with the role of its own', () => {
    const rule = /\.ring > svg \.r-mark\s*\{([^}]*)\}/.exec(marksCss)
    expect(rule).not.toBeNull()
    expect(rule![1]).toMatch(/stroke:\s*var\(--w-pity-mark\)/)
  })

  test('on Parchment and every light theme it is --w-gold-ink as it was, so Parchment and Mist do not change', () => {
    for (const name of ['parchment', ...LIGHT]) expect(sets[name]['--w-pity-mark'], name).toBe(sets[name]['--w-gold-ink'])
  })

  test('on every dark theme it is the dark knock-out, --w-gap, and reads 3:1 on the gold of a filled ring', () => {
    for (const name of DARK) {
      expect(sets[name]['--w-pity-mark'], name).toBe(sets[name]['--w-gap'])
      expect(contrast(sets[name]['--w-pity-mark'], sets[name]['--w-five']), `${name} on the filled ring`).toBeGreaterThanOrEqual(3)
    }
  })

  // On the dark themes no one colour reaches 3:1 on both the gold fill (about 10:1 on the card) and the dark track (1.3:1), so there
  // the mark is a notch cut through the ring; on the light themes it keeps its 3:1 on the track.
  test('on Parchment and every light theme it still reaches 3:1 on the track of the ring', () => {
    for (const name of ['parchment', ...LIGHT]) {
      expect(contrast(sets[name]['--w-pity-mark'], sets[name]['--w-track']), name).toBeGreaterThanOrEqual(3)
    }
  })
})

// A dark theme says so to the browser (`color-scheme: dark`), or Chromium draws the scrollbars and the native controls (a checkbox,
// a select's popup, a textarea) light on its dark page. The light ones leave it alone, as Parchment always has.
describe('color-scheme', () => {
  /** The declarations of the rule whose selector is written exactly so, in a stylesheet with its comments out. */
  const ruleOf = (css: string, selector: string): string => {
    const plain = css.replace(/\/\*[\s\S]*?\*\//g, '')
    const found = [...plain.matchAll(/([^{}]*)\{([^{}]*)\}/g)].filter((rule) => rule[1].trim().endsWith(selector))
    expect(found.length, selector).toBeGreaterThan(0)
    return found.map((rule) => rule[2]).join(';')
  }

  test('every dark theme declares color-scheme: dark', () => {
    for (const name of DARK) expect(ruleOf(themesCss, `[data-theme='${name}']`), name).toMatch(/color-scheme:\s*dark\s*;/)
  })

  test('Match Windows declares it too, in the rule that paints Midnight before the script runs on a dark Windows', () => {
    expect(ruleOf(themesCss, "[data-theme='system']")).toMatch(/color-scheme:\s*dark\s*;/)
  })

  test('Parchment and every light theme declare none, so Parchment and Mist do not change', () => {
    for (const name of LIGHT) expect(ruleOf(themesCss, `[data-theme='${name}']`), name).not.toContain('color-scheme')
    expect(tokensCss).not.toContain('color-scheme')
  })
})
