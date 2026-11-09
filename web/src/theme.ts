import { useLayoutEffect, useState } from 'react'

/** The themes of the window: the names the setting keeps and `data-theme` carries. */
export type ThemeName =
  | 'parchment' | 'midnight' | 'slate' | 'dusk' | 'mist'
  | 'mondstadt' | 'liyue' | 'inazuma' | 'sumeru' | 'fontaine' | 'natlan' | 'snezhnaya'

/** Parchment, the five looks, then the seven nations (the themes design, sections 2 and 12). */
export const THEME_NAMES: readonly ThemeName[] = [
  'parchment', 'midnight', 'slate', 'dusk', 'mist',
  'mondstadt', 'liyue', 'inazuma', 'sumeru', 'fontaine', 'natlan', 'snezhnaya',
]

/**
 * The dark themes, the one list of them: the interface's tests, the browser tests and the shell's tests are held to it, and it is held to
 * the `color-scheme: dark` blocks of themes.css (themes.test.ts), so a theme is dark in all of them or in none.
 */
export const DARK_THEME_NAMES: readonly ThemeName[] = ['midnight', 'slate', 'dusk', 'liyue', 'inazuma', 'fontaine', 'natlan']

/** What the player chose: a theme, or Match Windows. `data-theme` on the window's page never holds `system`, only what it resolves to. */
export type ThemeSetting = ThemeName | 'system'

/** The class `<html>` wears for `FADE_MS` after a change of theme: base.css makes the colours cross-fade while it is there. */
export const FADE_CLASS = 'theme-fade'
export const FADE_MS = 200

const DARK = '(prefers-color-scheme: dark)'

function isThemeName(value: unknown): value is ThemeName {
  return typeof value === 'string' && (THEME_NAMES as readonly string[]).includes(value)
}

function isThemeSetting(value: unknown): value is ThemeSetting {
  return value === 'system' || isThemeName(value)
}

/** The theme a setting wears: Match Windows follows `prefersDark`; a missing or unknown setting is Parchment. */
export function resolveTheme(setting: ThemeSetting | undefined, prefersDark: boolean): ThemeName {
  if (setting === 'system') return prefersDark ? 'midnight' : 'parchment'
  return isThemeName(setting) ? setting : 'parchment'
}

function windowPrefersDark(): boolean {
  try {
    return window.matchMedia(DARK).matches
  } catch {
    return false
  }
}

function inOverlay(root: HTMLElement): boolean {
  return root.classList.contains('ov-doc')
}

let fadeTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Puts a theme on `<html>` as `data-theme`, and fades the colours when it replaces another. The overlay's document keeps no
 * `data-theme` at all: the overlay has its own look on every theme.
 */
export function applyTheme(root: HTMLElement, theme: ThemeName): void {
  if (inOverlay(root)) {
    delete root.dataset.theme
    return
  }
  const before = root.dataset.theme
  if (before === theme) return
  root.dataset.theme = theme
  if (before === undefined) return
  root.classList.add(FADE_CLASS)
  if (fadeTimer !== null) clearTimeout(fadeTimer)
  fadeTimer = setTimeout(() => {
    fadeTimer = null
    root.classList.remove(FADE_CLASS)
  }, FADE_MS)
}

/**
 * Keeps `<html>` in step with a setting until the returned function is called. Under Match Windows it also follows Windows'
 * own light or dark while the window is open. With no setting yet (the core has not answered), the page keeps the theme the
 * core wrote into it.
 */
export function startTheme(setting: ThemeSetting | undefined, root: HTMLElement = document.documentElement): () => void {
  if (setting === undefined) return () => undefined
  if (setting !== 'system') {
    applyTheme(root, resolveTheme(setting, false))
    return () => undefined
  }
  applyTheme(root, resolveTheme('system', windowPrefersDark()))
  if (inOverlay(root)) return () => undefined
  let query: MediaQueryList
  try {
    query = window.matchMedia(DARK)
  } catch {
    return () => undefined
  }
  const onChange = (event: { matches: boolean }) => applyTheme(root, resolveTheme('system', event.matches))
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

/**
 * The first step of the page, before React draws: the core writes the raw setting into `<html data-theme>`, so on the overlay's
 * document it is taken away, and otherwise `system` is replaced at once by what Windows is now (Match Windows on a dark Windows
 * never paints Parchment first) and an unknown word by Parchment. The site's browser demo has no core, so it reads the
 * visitor's own choice.
 */
export function applyInitialTheme(root: HTMLElement = document.documentElement, siteDemo = false): void {
  if (inOverlay(root)) {
    delete root.dataset.theme
    return
  }
  let written: string | undefined = root.dataset.theme
  if (written === undefined && siteDemo) written = siteTheme() ?? 'parchment'
  if (written === undefined) return
  root.dataset.theme = resolveTheme(isThemeSetting(written) ? written : undefined, windowPrefersDark())
}

/**
 * Wears a setting on the window for as long as the component is there, and says which theme that is. The fade belongs to a
 * later change, not to the first application.
 */
export function useTheme(setting: ThemeSetting | undefined): ThemeName {
  // The overlay's address decides whether this document takes a theme (App keeps `ov-doc` in step with it).
  const overlay = window.location.hash.startsWith('#/overlay')
  const [dark, setDark] = useState(windowPrefersDark)
  useLayoutEffect(() => {
    if (setting === 'system') setDark(windowPrefersDark())
    return startTheme(setting)
  }, [setting, overlay])
  useLayoutEffect(() => {
    if (setting !== 'system') return
    try {
      const query = window.matchMedia(DARK)
      const onChange = (event: MediaQueryListEvent) => setDark(event.matches)
      query.addEventListener('change', onChange)
      return () => query.removeEventListener('change', onChange)
    } catch {
      return
    }
  }, [setting])
  return resolveTheme(setting, dark)
}

// The site's browser demo has no core to keep the setting, so it keeps the visitor's choice itself, in the browser.
const SITE_KEY = 'gb-theme'
const siteListeners = new Set<() => void>()
let siteChoice: ThemeSetting | null = null

/** The theme the visitor of the browser demo chose, or null before they chose one. Storage may be blocked: then it is the page's own memory. */
export function siteTheme(): ThemeSetting | null {
  try {
    const stored = localStorage.getItem(SITE_KEY)
    if (isThemeSetting(stored)) return stored
  } catch {
    // Blocked storage: the choice lasts for this page only.
  }
  return siteChoice
}

export function setSiteTheme(value: ThemeSetting): void {
  siteChoice = value
  try {
    localStorage.setItem(SITE_KEY, value)
  } catch {
    // The page's own memory holds it.
  }
  for (const listener of [...siteListeners]) listener()
}

export function subscribeSiteTheme(listener: () => void): () => void {
  siteListeners.add(listener)
  return () => void siteListeners.delete(listener)
}
