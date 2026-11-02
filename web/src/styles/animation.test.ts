import { expect, test } from 'vitest'

// Every stylesheet of the interface, read as text with Vite's ?raw (vite.config.ts lets those through), as widgetcss.test.ts
// reads its own: a test under src cannot import node:fs.
const SHEETS = import.meta.glob<string>(['./*.css', '../pages/**/*.css'], { query: '?raw', import: 'default', eager: true })

/**
 * What an animation may move when it runs for ever: the compositor moves these alone, so the page is not painted again at
 * every frame for as long as it runs (audit L28: the update notice's pulse animated box-shadow while the notice showed).
 */
const COMPOSITED = new Set(['opacity', 'transform', 'translate', 'rotate', 'scale'])

/** Each @keyframes of a stylesheet, by name, with the properties its frames set. Comments are left out. */
function keyframesOf(css: string): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>()
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const [, name, body] of text.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g)) {
    const properties = found.get(name) ?? new Set<string>()
    for (const [, frame] of body.matchAll(/\{([^{}]*)\}/g)) {
      for (const [, property] of frame.matchAll(/([\w-]+)\s*:/g)) properties.add(property)
    }
    found.set(name, properties)
  }
  return found
}

/** The names of the animations a stylesheet runs for ever, by the shorthand or by animation-iteration-count. */
function endlessOf(css: string, names: ReadonlySet<string>): string[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@keyframes\s+[\w-]+\s*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '')
  const endless: string[] = []
  for (const [, block] of text.matchAll(/\{([^{}]*)\}/g)) {
    const declarations = new Map<string, string>()
    for (const declaration of block.split(';')) {
      const colon = declaration.indexOf(':')
      if (colon > 0) declarations.set(declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim())
    }
    const shorthand = declarations.get('animation') ?? ''
    const count = declarations.get('animation-iteration-count') ?? ''
    if (!/\binfinite\b/.test(shorthand) && !/\binfinite\b/.test(count)) continue
    const tokens = [...shorthand.split(/[\s,]+/), ...(declarations.get('animation-name') ?? '').split(/[\s,]+/)]
    endless.push(...tokens.filter((token) => names.has(token)))
  }
  return endless
}

/** Each endless animation of the sheets that moves something the compositor does not move alone, as "sheet: name moves property". */
function repaintingForEver(sheets: Record<string, string>): string[] {
  const frames = new Map<string, Set<string>>()
  for (const css of Object.values(sheets)) for (const [name, properties] of keyframesOf(css)) frames.set(name, properties)
  const names = new Set(frames.keys())
  const found: string[] = []
  for (const [sheet, css] of Object.entries(sheets)) {
    for (const name of endlessOf(css, names)) {
      for (const property of frames.get(name) ?? []) {
        if (!COMPOSITED.has(property)) found.push(`${sheet}: ${name} moves ${property}`)
      }
    }
  }
  return found
}

test('every stylesheet is read, the characters pages\' among them', () => {
  expect(Object.keys(SHEETS)).toContain('./update.css')
  expect(Object.keys(SHEETS)).toContain('./frame.css')
  expect(Object.keys(SHEETS).some((sheet) => sheet.startsWith('../pages/characters/'))).toBe(true)
})

test('the check finds an endless animation of box-shadow, by the shorthand or by its count, and passes a spinner and a fade', () => {
  const css = `
    /* @keyframes ghost { 50% { color: red; } } a comment is not a stylesheet */
    @keyframes ring { 50% { box-shadow: 0 0 0 6px red; } }
    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes fade { 50% { opacity: .35; } }
    .a { animation: ring 2s ease-in-out infinite; }
    .b { animation-name: ring; animation-iteration-count: infinite; }
    .c { animation: spin 1s linear infinite; }
    .d { animation: fade 1s ease infinite; }
    .e { animation: ring 2s ease 3; }
  `
  expect(repaintingForEver({ 'test.css': css })).toEqual(['test.css: ring moves box-shadow', 'test.css: ring moves box-shadow'])
})

test('no animation that runs for ever moves anything but opacity or transform, so none paints the page at every frame', () => {
  expect(repaintingForEver(SHEETS)).toEqual([])
})
