import type { Locator, Page } from '@playwright/test'
import { PAGES } from '../src/route.ts'
import { DARK_THEME_NAMES, THEME_NAMES, type ThemeName, type ThemeSetting } from '../src/theme.ts'
import { type Api, expect, test } from './fixtures.ts'

/*
 * The themes in the browser (the themes design, sections 4, 9 and 10), against a demo core in Edge: the picker saves at once
 * and the served page carries the theme before any script; Match Windows follows Windows live; the overlay keeps no theme; the
 * change fades for 200 ms, or is instant under reduced motion; `system` paints Midnight on a dark Windows before the script
 * runs; and the light-patch sweep, which reads every page's boxes on each theme.
 */

type Setting = ThemeSetting

/** Every theme of the window and the dark ones: the interface's own lists (src/theme.ts), so a theme added there is in every loop below. */
const ALL_THEMES = THEME_NAMES
const isDark = (theme: Setting) => DARK_THEME_NAMES.includes(theme as ThemeName)
const NATIONS: Record<string, string> = {
  mondstadt: 'Mondstadt', liyue: 'Liyue', inazuma: 'Inazuma', sumeru: 'Sumeru', fontaine: 'Fontaine', natlan: 'Natlan', snezhnaya: 'Snezhnaya',
}

const setTheme = (api: Api, theme: Setting) => api.put('/api/settings', { theme })
const themeOf = (page: Page) => page.evaluate(() => document.documentElement.dataset.theme ?? null)
const guildBoard = (page: Page) => page.getByRole('region', { name: 'Guild Board', exact: true })
/** The chosen tile shows whole inside the row. */
const chosenShows = (page: Page) =>
  page.locator('.tp-tile.on').evaluate((one) => {
    const box = one.getBoundingClientRect()
    const rowBox = one.closest('.tp')!.getBoundingClientRect()
    return box.left >= rowBox.left - 1 && box.right <= rowBox.right + 1
  })
const tile = (page: Page, name: string) => page.getByRole('radio', { name: new RegExp(`^${name}, `) })

/** Midnight's own values (themes.css): the page's dark and the ink. */
const MIDNIGHT_PAGE = 'rgb(12, 15, 26)'
const MIDNIGHT_INK = 'rgb(236, 230, 216)'
const MIDNIGHT_RAIL = 'rgb(8, 10, 18)'

test.describe('the picker', () => {
  test.beforeEach(async ({ page, core }) => {
    await page.goto(`${core.origin}/#/settings`)
  })

  test('Theme is the first row of the Guild Board group, a radio group of thirteen tiles in one row that scrolls sideways, and the page does not', async ({ page }) => {
    await page.setViewportSize({ width: 1640, height: 1100 })
    const first = guildBoard(page).locator('.set-row').first()
    await expect(first).toContainText('Theme')
    const group = first.getByRole('radiogroup', { name: 'Theme' })
    await expect(group.getByRole('radio')).toHaveCount(13)
    const tops = await group.getByRole('radio').evaluateAll((tiles) => tiles.map((one) => Math.round(one.getBoundingClientRect().top)))
    expect(new Set(tops).size, `the thirteen tiles' tops: ${tops.join(', ')}`).toBe(1)
    await expect(tile(page, 'Parchment')).toHaveAttribute('aria-checked', 'true')
    const style = await group.evaluate((row) => ({ overflowX: getComputedStyle(row).overflowX, snap: getComputedStyle(row).scrollSnapType }))
    expect(style.overflowX).toBe('auto')
    expect(style.snap).toMatch(/^x/) // proximity is the default, so the computed value leaves it out
    const widths = await group.getByRole('radio').evaluateAll((tiles) => tiles.map((one) => Math.round(one.getBoundingClientRect().width)))
    expect([...new Set(widths)]).toEqual([108])
    // Narrow (the window's own least width is about 1,040): the row scrolls and the page does not.
    await page.setViewportSize({ width: 1100, height: 900 })
    await expect.poll(() => group.evaluate((row) => row.scrollWidth > row.clientWidth)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  })

  test('the small Nations mark stands before Mondstadt and is a label only: no radio, no tab stop', async ({ page }) => {
    const mark = guildBoard(page).getByTestId('tp-nations')
    await expect(mark).toHaveText('Nations')
    expect(await mark.evaluate((one) => one.nextElementSibling?.getAttribute('data-theme-option'))).toBe('mondstadt')
    expect(await mark.evaluate((one) => one.previousElementSibling?.getAttribute('data-theme-option'))).toBe('system')
    expect(await mark.evaluate((one) => one.matches('button, [tabindex], [role]') || one.querySelector('button, [tabindex], [role]') !== null)).toBe(false)
    await expect(mark).toHaveAttribute('aria-hidden', 'true')
    expect(await mark.getAttribute('tabindex')).toBeNull()
    expect(await mark.getAttribute('role')).toBeNull()
    const fontSize = await mark.locator('span').evaluate((one) => parseFloat(getComputedStyle(one).fontSize))
    expect(fontSize).toBeGreaterThanOrEqual(13)
  })

  test('the chosen tile is scrolled into view when Settings opens, and the fade stands while more is to the right', async ({ page, api, core }) => {
    await page.setViewportSize({ width: 1100, height: 900 })
    await setTheme(api, 'snezhnaya')
    await page.goto('about:blank')
    await page.goto(`${core.origin}/#/settings`)
    await expect.poll(() => themeOf(page)).toBe('snezhnaya')
    const row = page.getByRole('radiogroup', { name: 'Theme' })
    await expect.poll(() => row.evaluate((one) => one.scrollLeft)).toBeGreaterThan(0)
    await expect.poll(() => chosenShows(page)).toBe(true)
    // It is the last tile: nothing is to the right any more, so no fade.
    await expect(page.locator('.tp-wrap')).not.toHaveClass(/more/)
    await row.evaluate((one) => {
      one.scrollLeft = 0
    })
    await expect(page.locator('.tp-wrap')).toHaveClass(/more/)
    expect(await page.locator('.tp-fade').evaluate((one) => getComputedStyle(one).pointerEvents)).toBe('none')
  })

  test('the arrow keys scroll the new choice into view, and the mouse wheel scrolls the row sideways', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 900 })
    const row = page.getByRole('radiogroup', { name: 'Theme' })
    await tile(page, 'Parchment').focus()
    for (let key = 0; key < 7; key += 1) await page.keyboard.press('ArrowRight') // Midnight, Slate, Dusk, Mist, Match Windows, Mondstadt, Liyue
    await expect.poll(() => themeOf(page)).toBe('liyue')
    await expect(tile(page, 'Liyue')).toBeFocused()
    await expect.poll(() => chosenShows(page)).toBe(true)
    await row.evaluate((one) => {
      one.scrollLeft = 0
    })
    const before = await row.evaluate((one) => one.scrollLeft)
    await row.hover()
    await page.mouse.wheel(0, 300)
    await expect.poll(() => row.evaluate((one) => one.scrollLeft)).toBeGreaterThan(before)
    expect(await page.evaluate(() => window.scrollY)).toBe(0)
  })

  test('a touchpad, many small wheel events, moves the row, and the page scrolls on where the row cannot go', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 700 })
    const row = page.getByRole('radiogroup', { name: 'Theme' })
    await row.evaluate((one) => {
      one.scrollLeft = 0
    })
    await row.hover()
    // A precision touchpad sends a few pixels at a time; the row's scroll snapping must not pull each one back to where it was.
    for (let step = 0; step < 20; step += 1) await page.mouse.wheel(0, 5)
    await expect.poll(() => row.evaluate((one) => one.scrollLeft)).toBeGreaterThan(0)
    // At the row's end the same wheel is the page's: it scrolls Settings down.
    await row.evaluate((one) => {
      one.scrollLeft = one.scrollWidth
    })
    await expect.poll(() => row.evaluate((one) => one.scrollLeft + one.clientWidth >= one.scrollWidth - 2)).toBe(true)
    const scrolled = await page.evaluate(() => document.documentElement.scrollHeight > document.documentElement.clientHeight)
    expect(scrolled, 'Settings is taller than the window, so it can scroll').toBe(true)
    for (let step = 0; step < 10; step += 1) await page.mouse.wheel(0, 40)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
  })

  test('choosing Midnight repaints the window at once, with no Save, and the served page keeps it', async ({ page, core }) => {
    await expect.poll(() => themeOf(page)).toBe('parchment')
    await tile(page, 'Midnight').click()
    await expect.poll(() => themeOf(page)).toBe('midnight')
    await expect(tile(page, 'Midnight')).toHaveAttribute('aria-checked', 'true')
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(MIDNIGHT_PAGE) // after the 200 ms fade
    // There is nothing to save: the choice was kept when the tile was clicked.
    await expect(guildBoard(page).getByRole('button', { name: /^Save/ })).toHaveCount(0)
    // The core writes the theme into the page it serves, before any script (read here from the response's text).
    await expect
      .poll(async () => (await page.request.get(`${core.origin}/`)).text())
      .toContain('<html lang="en" data-theme="midnight">')
    await page.reload()
    await expect.poll(() => themeOf(page)).toBe('midnight')
    await expect(tile(page, 'Midnight')).toHaveAttribute('aria-checked', 'true')
  })

  test('each tile repaints, and the arrow keys choose', async ({ page }) => {
    for (const theme of [...Object.keys(NATIONS), 'dusk', 'mist', 'parchment']) {
      const name = NATIONS[theme] ?? theme[0].toUpperCase() + theme.slice(1)
      await tile(page, name).scrollIntoViewIfNeeded()
      await tile(page, name).click()
      await expect.poll(() => themeOf(page)).toBe(theme)
    }
    await tile(page, 'Parchment').focus()
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => themeOf(page)).toBe('midnight')
    await expect(tile(page, 'Midnight')).toBeFocused()
  })

  for (const theme of ALL_THEMES) {
    test(`the focus ring shows on ${theme}`, async ({ page, api }) => {
      await setTheme(api, theme)
      await page.reload()
      await expect.poll(() => themeOf(page)).toBe(theme)
      const chosen = page.locator('.tp-tile.on')
      await chosen.focus()
      await expect(chosen).toBeFocused()
      const ring = await chosen.locator('.tp-mini').evaluate((mini) => {
        const style = getComputedStyle(mini)
        const probe = document.createElement('span')
        probe.style.color = 'var(--focus)'
        document.body.append(probe)
        const focus = getComputedStyle(probe).color
        probe.remove()
        return { style: style.outlineStyle, width: parseFloat(style.outlineWidth), colour: style.outlineColor, focus, surface: getComputedStyle(document.body).backgroundColor }
      })
      expect(ring.style).toBe('solid')
      expect(ring.width).toBeGreaterThanOrEqual(2)
      expect(ring.colour).toBe(ring.focus)
      expect(ring.colour).not.toBe(ring.surface)
    })
  }
})

test.describe('color-scheme', () => {
  const schemeOf = (page: Page) => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)

  for (const theme of ALL_THEMES) {
    const expected = isDark(theme) ? 'dark' : 'normal'
    test(`${theme} tells the browser its scheme is ${expected}, so scrollbars and native controls are drawn to match`, async ({ page, api, core }) => {
      await setTheme(api, theme)
      await page.goto('about:blank') // a fresh load, so the page is served in the theme just chosen and no live update can be missed
      await page.goto(`${core.origin}/#/settings`)
      await expect.poll(() => themeOf(page)).toBe(theme)
      expect(await schemeOf(page)).toBe(expected)
    })
  }

  test('Match Windows is dark on a dark Windows before the script runs, and light when Windows is light', async ({ page, api, core }) => {
    await setTheme(api, 'system')
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.goto(`${core.origin}/#/settings`)
    await expect.poll(() => themeOf(page)).toBe('midnight')
    expect(await schemeOf(page)).toBe('dark')
    await page.emulateMedia({ colorScheme: 'light' })
    await expect.poll(() => themeOf(page)).toBe('parchment')
    expect(await schemeOf(page)).toBe('normal')
  })
})

test.describe("a character's Readiness sheet", () => {
  // The sheet sits below the profile's dark card, on the theme's ground: its step numbers and bars wear tokens, not the cream of Parchment.
  for (const theme of ALL_THEMES) {
    test(`on ${theme} its step numbers are on --gold-soft and its bars' tracks on --r0`, async ({ page, api, core }) => {
      await setTheme(api, theme)
      await page.goto('about:blank') // a fresh load, so the page is served in the theme just chosen and no live update can be missed
      await page.goto(`${core.origin}/#/characters/sandrone`)
      await expect.poll(() => themeOf(page)).toBe(theme)
      const sheet = page.getByTestId('readiness')
      await expect(sheet.locator('.pf-steps li').first()).toBeVisible()
      await drawn(page) // the theme's fade has ended
      const found = await sheet.evaluate((root) => {
        const colourOf = (token: string) => {
          const probe = document.createElement('span')
          probe.style.backgroundColor = `var(${token})`
          document.body.append(probe)
          const colour = getComputedStyle(probe).backgroundColor
          probe.remove()
          return colour
        }
        const number = getComputedStyle(root.querySelector('.pf-steps li')!, '::before')
        const track = getComputedStyle(root.querySelector('.pf-pb')!)
        return {
          numberGround: number.backgroundColor, numberInk: number.color, track: track.backgroundColor,
          goldSoft: colourOf('--gold-soft'), goldInk: colourOf('--gold-ink'), r0: colourOf('--r0'),
        }
      })
      expect(found.numberGround).toBe(found.goldSoft)
      expect(found.numberInk).toBe(found.goldInk)
      expect(found.track).toBe(found.r0)
    })
  }
})

test.describe('Match Windows', () => {
  test('follows the browser\'s light or dark live, without a reload', async ({ page, api }) => {
    await setTheme(api, 'system')
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.reload()
    await expect.poll(() => themeOf(page)).toBe('midnight')
    await page.evaluate(() => {
      ;(window as unknown as { kept: number }).kept = 1
    })
    await page.emulateMedia({ colorScheme: 'light' })
    await expect.poll(() => themeOf(page)).toBe('parchment')
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect.poll(() => themeOf(page)).toBe('midnight')
    // The page never reloaded.
    expect(await page.evaluate(() => (window as unknown as { kept?: number }).kept)).toBe(1)
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(MIDNIGHT_PAGE)
  })

  test('a dark Windows paints Midnight before the script has run', async ({ page, api, core }) => {
    await setTheme(api, 'system')
    await page.emulateMedia({ colorScheme: 'dark' })
    // The page's script waits a second and a half; until then only the stylesheet and the page's own <html data-theme="system"> are there.
    await page.route('**/assets/*.js', async (route) => {
      await new Promise((done) => setTimeout(done, 1500))
      await route.continue()
    })
    await page.goto('about:blank')
    await page.goto(`${core.origin}/#/board`, { waitUntil: 'commit' })
    await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() !== '')
    const early = await page.evaluate(() => ({
      theme: document.documentElement.dataset.theme,
      page: getComputedStyle(document.body).backgroundColor,
      ink: getComputedStyle(document.body).color,
      scripted: document.getElementById('root')?.childElementCount ?? 0,
    }))
    expect(early.scripted).toBe(0) // the script has not run: this is the page as the stylesheet alone paints it
    expect(early.theme).toBe('system')
    expect(early.page).toBe(MIDNIGHT_PAGE)
    expect(early.ink).toBe(MIDNIGHT_INK)
    await expect.poll(() => themeOf(page), { timeout: 15_000 }).toBe('midnight')
  })

  test('a light Windows keeps Parchment before the script has run', async ({ page, api, core }) => {
    await setTheme(api, 'system')
    await page.emulateMedia({ colorScheme: 'light' })
    await page.route('**/assets/*.js', async (route) => {
      await new Promise((done) => setTimeout(done, 1500))
      await route.continue()
    })
    await page.goto('about:blank')
    await page.goto(`${core.origin}/#/board`, { waitUntil: 'commit' })
    await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() !== '')
    const early = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, page: getComputedStyle(document.body).backgroundColor }))
    expect(early.theme).toBe('system')
    expect(early.page).not.toBe(MIDNIGHT_PAGE)
    await expect.poll(() => themeOf(page), { timeout: 15_000 }).toBe('parchment')
  })
})

test.describe('the overlay', () => {
  test('keeps no theme whatever the setting, and the window takes it back when the address leaves the overlay', async ({ page, api, core }) => {
    await setTheme(api, 'midnight')
    await page.goto('about:blank')
    await page.goto(`${core.origin}/#/overlay`)
    await page.waitForFunction(() => document.documentElement.classList.contains('ov-doc'))
    expect(await themeOf(page)).toBeNull()
    await page.evaluate(() => {
      const root = document.documentElement
      const seen: boolean[] = []
      ;(window as unknown as { fades: boolean[] }).fades = seen
      new MutationObserver(() => {
        if (root.classList.contains('theme-fade')) seen.push(true)
      }).observe(root, { attributes: true, attributeFilter: ['class'] })
    })
    // Out of the overlay, by the address alone: the theme comes back, and with no fade (it is the window's first paint of it).
    await page.evaluate(() => {
      window.location.hash = '#/board'
    })
    await expect.poll(() => themeOf(page)).toBe('midnight')
    await expect(page.locator('html')).not.toHaveClass(/ov-doc/)
    await page.waitForTimeout(400)
    expect(await page.evaluate(() => (window as unknown as { fades: boolean[] }).fades)).toEqual([])
    // And into it again: gone.
    await page.evaluate(() => {
      window.location.hash = '#/overlay/open'
    })
    await expect.poll(() => themeOf(page)).toBeNull()
    await page.evaluate(() => {
      window.location.hash = '#/stats'
    })
    await expect.poll(() => themeOf(page)).toBe('midnight')
  })

  test('Match Windows on a dark Windows leaves the overlay with no theme too', async ({ page, api, core }) => {
    await setTheme(api, 'system')
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.goto('about:blank')
    await page.goto(`${core.origin}/#/overlay`)
    await page.waitForFunction(() => document.documentElement.classList.contains('ov-doc'))
    expect(await themeOf(page)).toBeNull()
  })
})

test.describe('the fade', () => {
  /** Records when `theme-fade` is on <html>, and the rail's colour at the instant the theme changes. */
  async function watch(page: Page) {
    await page.evaluate(() => {
      const root = document.documentElement
      const log = { fade: [] as { on: boolean; at: number }[], railAtChange: [] as string[] }
      ;(window as unknown as { watch: typeof log }).watch = log
      let on = root.classList.contains('theme-fade')
      new MutationObserver(() => {
        const now = root.classList.contains('theme-fade')
        if (now !== on) {
          on = now
          log.fade.push({ on, at: performance.now() })
        }
      }).observe(root, { attributes: true, attributeFilter: ['class'] })
      new MutationObserver(() => {
        const rail = document.querySelector('.gb-rail')
        if (rail !== null) log.railAtChange.push(getComputedStyle(rail).backgroundColor)
      }).observe(root, { attributes: true, attributeFilter: ['data-theme'] })
    })
  }
  const read = (page: Page) =>
    page.evaluate(() => (window as unknown as { watch: { fade: { on: boolean; at: number }[]; railAtChange: string[] } }).watch)

  test('a change of theme fades for about 200 ms, and the class is gone after', async ({ page, core }) => {
    await page.goto(`${core.origin}/#/settings`)
    await expect(page.locator('.gb-rail')).toBeVisible()
    await expect.poll(() => themeOf(page)).toBe('parchment')
    const before = await page.evaluate(() => getComputedStyle(document.querySelector('.gb-rail')!).backgroundColor)
    await watch(page)
    await tile(page, 'Midnight').click()
    await expect.poll(async () => (await read(page)).fade.length).toBe(2)
    const { fade, railAtChange } = await read(page)
    expect(fade[0].on).toBe(true)
    expect(fade[1].on).toBe(false)
    const length = fade[1].at - fade[0].at
    expect(length).toBeGreaterThanOrEqual(150)
    expect(length).toBeLessThan(1000)
    await expect(page.locator('html')).not.toHaveClass(/theme-fade/)
    // The colours cross-fade: at the instant the theme changed the rail still had its old colour.
    expect(railAtChange[0]).toBe(before)
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.querySelector('.gb-rail')!).backgroundColor)).toBe(MIDNIGHT_RAIL)
  })

  test('under reduced motion the change is instant', async ({ page, core }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(`${core.origin}/#/settings`)
    await expect(page.locator('.gb-rail')).toBeVisible()
    await expect.poll(() => themeOf(page)).toBe('parchment')
    await watch(page)
    await tile(page, 'Midnight').click()
    await expect.poll(async () => (await read(page)).railAtChange.length).toBeGreaterThan(0)
    const { railAtChange } = await read(page)
    // At the very instant the theme changed, the rail already had Midnight's colour.
    expect(railAtChange[0]).toBe(MIDNIGHT_RAIL)
  })
})

/*
 * The light-patch sweep. On a dark theme no box larger than 40 x 20 pixels may have a background lighter than 0.35 (relative
 * luminance), and on a light theme none darker than 0.08, outside what the design leaves alone: the overlay, the dark panels
 * (.on-dark), a character's profile and planner, the Year tab's poster (.yr-stage), the Pulls page's night strip (.pl-sky), the
 * pictures and their frames, the rail on a light theme, and the dark tip of Your week (.cx-tip, dark on every theme).
 */
const LEFT_ALONE = [
  '.on-dark', '.yr-stage', '.pl-sky', '.pf-card', '.pp-card', '.cx-tip', '.pic', 'img', 'canvas', 'svg', 'video',
  '.mp-area', // the room for the map, dark as the map is (map.css): the picture's frame
  '.tp-mini', // the picker's tiles, which draw each theme's own Board whichever theme the window wears
] as const

/**
 * Colours that are a theme's own marks, not patches: the gold of a pressed button, a chosen segment and a filled bar on a dark
 * theme (--button, --fill, --gold, --gold-ink, --accent: lighter than 0.35 on purpose, with a dark label on them), and on a light
 * theme the rail's dark (a chosen chip wears it).
 */
const MARKS_DARK = ['--button', '--fill', '--gold', '--gold-ink', '--accent', '--w-fill', '--w-btn'] as const
const MARKS_LIGHT = ['--rail'] as const
/** Every page of the window (route.ts' PAGES, so a new page is swept at once), and the tabs and views that have addresses of their own. */
const SWEPT = [...PAGES, 'stats/months', 'stats/year', 'friends/me', 'characters/endgame', 'characters/sandrone']

type Sweep = { found: Patch[]; checked: number }
type Patch = { where: string; selector: string; size: string; luminance: number; colour: string }

/** Every visible box of the page larger than 40 x 20 whose composed background is on the wrong side of the limit. */
async function patches(page: Page, dark: boolean, where: string): Promise<Sweep> {
  return page.evaluate(
    ({ dark, where, leftAlone, marksOf }) => {
      type Rgba = [number, number, number, number]
      const parse = (text: string): Rgba => {
        const m = text.match(/rgba?\(([^)]+)\)/)
        if (m === null) return [0, 0, 0, 0]
        const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number)
        return [parts[0], parts[1], parts[2], parts[3] ?? 1]
      }
      const cache = new WeakMap<Element, [number, number, number]>()
      const composed = (el: Element | null): [number, number, number] => {
        if (el === null) return [255, 255, 255]
        const known = cache.get(el)
        if (known !== undefined) return known
        const own = parse(getComputedStyle(el).backgroundColor)
        const below = own[3] >= 1 ? ([0, 0, 0] as [number, number, number]) : composed(el.parentElement)
        const a = own[3]
        const out: [number, number, number] = [own[0] * a + below[0] * (1 - a), own[1] * a + below[1] * (1 - a), own[2] * a + below[2] * (1 - a)]
        cache.set(el, out)
        return out
      }
      const luminance = ([r, g, b]: [number, number, number]) => {
        const f = (v: number) => {
          const s = v / 255
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
        }
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
      }
      const describe = (el: Element) => {
        const name = (e: Element) => {
          const classes = [...e.classList].slice(0, 2).map((c) => `.${c}`).join('')
          return `${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ''}${classes}`
        }
        const chain: string[] = []
        for (let e: Element | null = el, n = 0; e !== null && n < 3; e = e.parentElement, n += 1) chain.unshift(name(e))
        return chain.join(' > ')
      }
      const tokenColour = (name: string): string => {
        const probe = document.createElement('span')
        probe.style.backgroundColor = `var(${name})`
        document.body.append(probe)
        const [r, g, b] = parse(getComputedStyle(probe).backgroundColor)
        probe.remove()
        return `${r},${g},${b}`
      }
      const marks = new Set(marksOf.map(tokenColour))
      const skip = leftAlone.join(',')
      const found: Patch[] = []
      const seen = new Set<string>()
      let checked = 0
      for (const el of document.querySelectorAll('body *')) {
        if (el.closest(skip) !== null) continue
        if (!dark && el.closest('.gb-rail') !== null) continue
        if (document.documentElement.classList.contains('ov-doc')) continue
        const rect = el.getBoundingClientRect()
        if (rect.width <= 40 || rect.height <= 20) continue
        if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue
        const own = parse(getComputedStyle(el).backgroundColor)
        if (own[3] < 0.5) continue // a see-through box shows what is under it, which is measured on its own
        checked += 1
        const colour = composed(el)
        if (marks.has(colour.map(Math.round).join(','))) continue
        const lum = luminance(colour)
        if (dark ? lum <= 0.35 : lum >= 0.08) continue
        const selector = describe(el)
        if (seen.has(selector)) continue
        seen.add(selector)
        found.push({ where, selector, size: `${Math.round(rect.width)}x${Math.round(rect.height)}`, luminance: Math.round(lum * 1000) / 1000, colour: `rgb(${colour.map(Math.round).join(',')})` })
      }
      return { found, checked }
    },
    { dark, where, leftAlone: [...LEFT_ALONE], marksOf: dark ? [...MARKS_DARK] : [...MARKS_LIGHT] },
  )
}

/** The page is drawn: its heading is there and nothing is moving. */
async function drawn(page: Page): Promise<void> {
  await expect(page.locator('main, .gb-main, .gb-page').first()).toBeVisible()
  // Endless animations (a spinner, a shimmer) never end; those that have an end are waited for.
  await page.waitForFunction(() =>
    !document.getAnimations().some((animation) => animation.playState === 'running' && animation.effect?.getComputedTiming().iterations !== Infinity),
  )
  await page.waitForTimeout(250)
}

async function sweepAll(page: Page, api: Api, origin: string, theme: Setting): Promise<Patch[]> {
  await setTheme(api, theme)
  await page.goto('about:blank')
  const dark = isDark(theme)
  const found: Patch[] = []
  for (const route of SWEPT) {
    await page.goto(`${origin}/#/${route}`)
    await expect.poll(() => themeOf(page)).toBe(theme)
    await drawn(page)
    const swept = await patches(page, dark, `${theme} #/${route}`)
    // A page that drew nothing would pass for free: every page has some painted boxes to check.
    expect(swept.checked, `${theme} #/${route}: boxes with a background that were checked`).toBeGreaterThanOrEqual(route === 'stats/year' ? 1 : 3) // the Year is mostly its poster, which is left alone
    found.push(...swept.found)
  }
  // One open dialog of the window: the profile card's panel.
  await page.goto(`${origin}/#/board`)
  await drawn(page)
  const card: Locator = page.getByTestId('profile')
  await card.click()
  await expect(page.getByTestId('profile-panel')).toBeVisible()
  await page.waitForTimeout(300)
  const panel = await patches(page, dark, `${theme} profile panel`)
  expect(panel.checked, `${theme} profile panel: boxes checked`).toBeGreaterThanOrEqual(3)
  found.push(...panel.found)
  return found
}

function report(found: Patch[]): string {
  return found.map((patch) => `${patch.where}: ${patch.selector} ${patch.size} ${patch.colour} (luminance ${patch.luminance})`).join('\n')
}

test.describe('the light-patch sweep', () => {
  test.setTimeout(240_000)

  test('the sweep sees a light box on Midnight and a dark one on Mist (a control)', async ({ page, api, core }) => {
    for (const [theme, colour, dark] of [['midnight', '#f4efe2', true], ['mist', '#10131c', false]] as const) {
      await setTheme(api, theme)
      await page.goto('about:blank')
      await page.goto(`${core.origin}/#/board`)
      await expect.poll(() => themeOf(page)).toBe(theme)
      await drawn(page)
      await page.evaluate((colour) => {
        const box = document.createElement('div')
        box.className = 'control-box'
        box.style.cssText = `position:fixed;left:300px;top:300px;width:120px;height:60px;background:${colour}`
        document.body.append(box)
      }, colour)
      const swept = await patches(page, dark, `${theme} control`)
      expect(swept.found.map((patch) => patch.selector).join('|')).toContain('div.control-box')
    }
  })

  for (const theme of ALL_THEMES) {
    test(`${theme} has no ${isDark(theme) ? 'light' : 'dark'} patch`, async ({ page, api, core }) => {
      const found = await sweepAll(page, api, core.origin, theme)
      expect(report(found), 'boxes on the wrong side of the limit, by page').toBe('')
    })
  }
})
