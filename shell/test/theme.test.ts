import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext, runInNewContext } from 'node:vm'
import { expect, test } from 'vitest'
import { tokenValues } from '../../web/src/styles/contrast.ts'
import { DARK_THEME_NAMES, THEME_NAMES } from '../../web/src/theme.ts'
import { backgroundOf, themeOf, themeSourceOf, THEMES } from '../src/theme.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const STYLES = join(HERE, '..', '..', 'web', 'src', 'styles')
const tokens = readFileSync(join(STYLES, 'tokens.css'), 'utf8')
const themes = readFileSync(join(STYLES, 'themes.css'), 'utf8')
const dialogCss = readFileSync(join(HERE, '..', 'src', 'pages', 'dialog.css'), 'utf8')

/** One theme's colours in the web's two stylesheets. */
function webColours(theme: (typeof THEMES)[number]): Record<string, string> {
  return tokenValues(theme === 'parchment' ? tokens : themes, theme)
}

test('themeOf resolves Match Windows with the system, and anything unknown is Parchment', () => {
  expect(themeOf('system', true)).toBe('midnight')
  expect(themeOf('system', false)).toBe('parchment')
  for (const name of THEMES) expect(themeOf(name, true)).toBe(name)
  for (const bad of [undefined, null, 3, '', 'Midnight', 'neon']) expect(themeOf(bad, true)).toBe('parchment')
})

test('the dark themes darken the title bar: Midnight, Slate, Dusk and the dark nations; every other setting follows Windows', () => {
  for (const dark of ['midnight', 'slate', 'dusk', 'liyue', 'inazuma', 'fontaine', 'natlan']) expect(themeSourceOf(dark), dark).toBe('dark')
  for (const light of ['mist', 'parchment', 'mondstadt', 'sumeru', 'snezhnaya', 'system', undefined, null, 'neon', 7]) {
    expect(themeSourceOf(light), String(light)).toBe('system')
  }
})

test("the shell's themes and its dark ones are the interface's own lists (web/src/theme.ts), in the same order", () => {
  expect([...THEMES]).toEqual([...THEME_NAMES])
  expect(THEMES.filter((name) => themeSourceOf(name) === 'dark')).toEqual([...DARK_THEME_NAMES])
})

test('the shell has the twelve themes, and the dark ones are exactly those themes.css gives color-scheme: dark', () => {
  expect(THEMES).toHaveLength(12)
  const plain = themes.replace(/\/\*[\s\S]*?\*\//g, '')
  const dark = [...plain.matchAll(/^\[data-theme='([a-z]+)'\]\s*\{([^{}]*)\}/gm)]
    .filter((rule) => /color-scheme:\s*dark\s*;/.test(rule[2]) && rule[1] !== 'system')
    .map((rule) => rule[1])
  expect(THEMES.filter((name) => themeSourceOf(name) === 'dark').sort()).toEqual(dark.sort())
})

test('backgroundOf is each theme’s --page-dark in the web’s stylesheets, so the shell cannot drift', () => {
  for (const theme of THEMES) {
    const wanted = webColours(theme)['--page-dark']
    expect(wanted, theme).toMatch(/^#[0-9A-F]{6}$/i)
    expect(backgroundOf(theme).toUpperCase(), theme).toBe(wanted.toUpperCase())
  }
  expect(backgroundOf('parchment')).toBe('#E6DDCA')
  expect(backgroundOf('slate')).toBe('#2C333F')
})

/** The custom properties a rule of dialog.css gives, for the selector written exactly as `selector`. */
function dialogBlock(selector: string): Record<string, string> {
  const plain = dialogCss.replace(/\/\*[\s\S]*?\*\//g, '')
  const values: Record<string, string> = {}
  for (const rule of plain.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    if (rule[1].trim() !== selector) continue
    for (const d of rule[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+?)\s*(?:;|$)/g)) values[d[1]] = d[2]
  }
  return values
}

test('dialog.css wears each theme: the same colours as the interface, for every token it uses', () => {
  const root = dialogBlock(':root')
  const used = Object.keys(root)
  expect(used.length).toBeGreaterThan(5)
  expect(used).toContain('--page-dark')
  for (const theme of THEMES) {
    const block = theme === 'parchment' ? root : dialogBlock(`[data-theme='${theme}']`)
    const web = webColours(theme)
    for (const name of used) {
      expect(block[name], `${theme} ${name}`).toBeDefined()
      expect(block[name].toUpperCase(), `${theme} ${name}`).toBe(web[name].toUpperCase())
    }
  }
})

// ---- the dialog pages take their theme from their address before they draw: one script, theme.js, in each page's <head>

const PAGES = join(HERE, '..', 'src', 'pages')

function runTheme(search: string): string | undefined {
  const html: { dataset: Record<string, string> } = { dataset: {} }
  runInNewContext(readFileSync(join(PAGES, 'theme.js'), 'utf8'), { document: { documentElement: html }, location: { search }, URLSearchParams })
  return html.dataset.theme
}

test('theme.js sets data-theme from the address, to one of the twelve names alone', () => {
  for (const theme of THEMES) expect(runTheme(`?theme=${theme}&labels=%5B%22A%22%5D`), theme).toBe(theme)
  // No theme, or one that is not a theme's name (Match Windows is resolved before the address is made): Parchment's colours,
  // which the page has with no attribute.
  expect(runTheme('')).toBeUndefined()
  expect(runTheme('?theme=neon')).toBeUndefined()
  expect(runTheme('?theme=system')).toBeUndefined()
  expect(runTheme('?theme=Midnight')).toBeUndefined()
})

test('theme.js leaves no name behind: the page scripts after it may declare their own `theme`', () => {
  const html = { dataset: {} as Record<string, string> }
  const context = createContext({ document: { documentElement: html }, location: { search: '?theme=dusk' }, URLSearchParams })
  runInContext(readFileSync(join(PAGES, 'theme.js'), 'utf8'), context)
  expect(html.dataset.theme).toBe('dusk')
  expect(runInContext('typeof theme', context)).toBe('undefined')
  expect(() => runInContext("const theme = 'again'", context)).not.toThrow()
})

for (const page of ['paste', 'choose', 'bar']) {
  test(`${page}.html loads theme.js in its head, as a plain script before the body, and ${page}.js has no theme code of its own`, () => {
    const html = readFileSync(join(PAGES, `${page}.html`), 'utf8')
    const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'))
    expect(head).toContain('<script src="theme.js"></script>')
    expect(head).not.toMatch(/(?:defer|async|type=)/)
    expect(head.indexOf('theme.js')).toBeGreaterThan(head.indexOf('dialog.css')) // after the stylesheet link: the script waits for it, the body waits for the script
    expect(html.indexOf('theme.js')).toBeLessThan(html.indexOf('<body'))
    const script = readFileSync(join(PAGES, `${page}.js`), 'utf8')
    expect(script).not.toContain('dataset.theme')
  })
}

// The dialog pages' own stylesheet tells the browser which of its looks are dark, as the interface's does (themes.css), so a
// textarea, a scrollbar and the like are drawn dark on them.
test('dialog.css declares color-scheme: dark for the dark looks and for no other', () => {
  const plain = dialogCss.replace(/\/\*[\s\S]*?\*\//g, '')
  const declared = (selector: string) =>
    [...plain.matchAll(/([^{}]*)\{([^{}]*)\}/g)].filter((rule) => rule[1].trim() === selector).some((rule) => /color-scheme:\s*dark\s*;/.test(rule[2]))
  for (const theme of THEMES) expect(declared(theme === 'parchment' ? ':root' : `[data-theme='${theme}']`), theme).toBe(themeSourceOf(theme) === 'dark')
})

// The shell's list of looks and the interface's stylesheet must name the same ones: a look added to one and not the other
// would open a window in one colour and draw the page in another.
test("the shell's THEMES are the looks themes.css writes (Parchment is tokens.css), both ways", () => {
  const written = [...themes.matchAll(/^\[data-theme='([a-z]+)'\]\s*\{/gm)].map((one) => one[1]).filter((name) => name !== 'system')
  expect([...new Set(['parchment', ...written])].sort()).toEqual([...THEMES].sort())
})
