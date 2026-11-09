import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  applyInitialTheme, applyTheme, FADE_CLASS, FADE_MS, resolveTheme, setSiteTheme, siteTheme, startTheme, subscribeSiteTheme,
  type ThemeSetting,
} from './theme.ts'

/** The few things of `<html>` the theme touches, and a window's `matchMedia` that Windows can change. */
function fakeRoot(attribute?: string, classes: string[] = []) {
  const set = new Set(classes)
  const dataset: { theme?: string } = attribute === undefined ? {} : { theme: attribute }
  return {
    dataset,
    classList: {
      contains: (name: string) => set.has(name),
      add: (name: string) => void set.add(name),
      remove: (name: string) => void set.delete(name),
    },
    has: (name: string) => set.has(name),
  }
}

function fakeWindows(dark: boolean) {
  const listeners = new Set<(event: { matches: boolean }) => void>()
  const state = { dark }
  const matchMedia = vi.fn((query: string) => ({
    get matches() {
      return query.includes('dark') && state.dark
    },
    addEventListener: (_: string, listener: (event: { matches: boolean }) => void) => void listeners.add(listener),
    removeEventListener: (_: string, listener: (event: { matches: boolean }) => void) => void listeners.delete(listener),
  }))
  vi.stubGlobal('window', { matchMedia })
  return {
    listeners,
    change(next: boolean) {
      state.dark = next
      for (const listener of [...listeners]) listener({ matches: next })
    },
  }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

test('a setting resolves to a theme, Match Windows by Windows', () => {
  expect(resolveTheme('dusk', true)).toBe('dusk')
  expect(resolveTheme('slate', false)).toBe('slate')
  for (const nation of ['mondstadt', 'liyue', 'inazuma', 'sumeru', 'fontaine', 'natlan', 'snezhnaya'] as const) {
    expect(resolveTheme(nation, true)).toBe(nation)
    expect(resolveTheme(nation, false)).toBe(nation)
  }
  expect(resolveTheme('system', true)).toBe('midnight')
  expect(resolveTheme('system', false)).toBe('parchment')
  expect(resolveTheme(undefined, true)).toBe('parchment')
  expect(resolveTheme('neon' as ThemeSetting, false)).toBe('parchment')
})

test('Match Windows follows Windows while the window is open, and stops listening when the setting changes', () => {
  const windows = fakeWindows(true)
  const root = fakeRoot()
  const stop = startTheme('system', root as unknown as HTMLElement)
  expect(root.dataset.theme).toBe('midnight')
  windows.change(false)
  expect(root.dataset.theme).toBe('parchment')
  windows.change(true)
  expect(root.dataset.theme).toBe('midnight')
  stop()
  expect(windows.listeners.size).toBe(0)
  windows.change(false)
  expect(root.dataset.theme).toBe('midnight')
})

test('a named theme does not listen to Windows at all', () => {
  const windows = fakeWindows(true)
  const root = fakeRoot()
  startTheme('dusk', root as unknown as HTMLElement)
  expect(root.dataset.theme).toBe('dusk')
  expect(windows.listeners.size).toBe(0)
})

test('a change of theme fades for 200 ms, the first application does not', () => {
  fakeWindows(false)
  const root = fakeRoot('midnight')
  const html = root as unknown as HTMLElement
  applyTheme(html, 'midnight')
  expect(root.has(FADE_CLASS)).toBe(false)
  applyTheme(html, 'mist')
  expect(root.dataset.theme).toBe('mist')
  expect(root.has(FADE_CLASS)).toBe(true)
  expect(FADE_MS).toBe(200)
  vi.advanceTimersByTime(FADE_MS - 1)
  expect(root.has(FADE_CLASS)).toBe(true)
  vi.advanceTimersByTime(1)
  expect(root.has(FADE_CLASS)).toBe(false)
  const fresh = fakeRoot()
  applyTheme(fresh as unknown as HTMLElement, 'dusk')
  expect(fresh.dataset.theme).toBe('dusk')
  expect(fresh.has(FADE_CLASS)).toBe(false)
})

test('the overlay keeps its own look', () => {
  fakeWindows(true)
  const root = fakeRoot('midnight', ['ov-doc'])
  startTheme('midnight', root as unknown as HTMLElement)
  expect(root.dataset.theme).toBeUndefined()
  startTheme('system', root as unknown as HTMLElement)
  expect(root.dataset.theme).toBeUndefined()
  expect(root.has(FADE_CLASS)).toBe(false)
})

test('before the settings arrive the page keeps the theme the core wrote', () => {
  fakeWindows(true)
  const root = fakeRoot('dusk')
  startTheme(undefined, root as unknown as HTMLElement)
  expect(root.dataset.theme).toBe('dusk')
})

test('the first step: system becomes a theme at once, an unknown word parchment, the overlay none', () => {
  const dark = fakeWindows(true)
  const system = fakeRoot('system')
  applyInitialTheme(system as unknown as HTMLElement)
  expect(system.dataset.theme).toBe('midnight')
  dark.change(false)
  const light = fakeRoot('system')
  applyInitialTheme(light as unknown as HTMLElement)
  expect(light.dataset.theme).toBe('parchment')
  const unknown = fakeRoot('neon')
  applyInitialTheme(unknown as unknown as HTMLElement)
  expect(unknown.dataset.theme).toBe('parchment')
  const named = fakeRoot('mist')
  applyInitialTheme(named as unknown as HTMLElement)
  expect(named.dataset.theme).toBe('mist')
  const overlay = fakeRoot('system', ['ov-doc'])
  applyInitialTheme(overlay as unknown as HTMLElement)
  expect(overlay.dataset.theme).toBeUndefined()
  for (const root of [system, light, unknown, named]) expect(root.has(FADE_CLASS)).toBe(false)
})

function storage(overrides: Partial<Storage> = {}) {
  const items = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    ...overrides,
  })
  return items
}

test("the browser demo keeps the visitor's choice, and tells those who listen", () => {
  const items = storage()
  expect(siteTheme()).toBeNull()
  items.set('gb-theme', 'neon')
  expect(siteTheme()).toBeNull()
  items.delete('gb-theme')
  const heard = vi.fn()
  const stop = subscribeSiteTheme(heard)
  setSiteTheme('mist')
  expect(items.get('gb-theme')).toBe('mist')
  expect(siteTheme()).toBe('mist')
  expect(heard).toHaveBeenCalledTimes(1)
  stop()
  setSiteTheme('system')
  expect(siteTheme()).toBe('system')
  expect(heard).toHaveBeenCalledTimes(1)
})

test('the browser demo works when storage throws', () => {
  storage({
    getItem: () => {
      throw new Error('blocked')
    },
    setItem: () => {
      throw new Error('blocked')
    },
  })
  expect(() => siteTheme()).not.toThrow()
  const heard = vi.fn()
  subscribeSiteTheme(heard)
  expect(() => setSiteTheme('dusk')).not.toThrow()
  expect(heard).toHaveBeenCalledTimes(1)
  // Without storage the choice still holds for the page's own time.
  expect(siteTheme()).toBe('dusk')
})
