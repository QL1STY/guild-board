import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Frame, type Locator, type Page } from '@playwright/test'

/**
 * The site's browser demo in a real browser on a full screen: the built demo (`web/dist-site`) in Edge at 2,560 by 1,400, where
 * the page a visitor opens draws the interface in its frame that zooms (web/src/sitedemo.ts). It is a test, not a picture: only
 * `npm run test:site-demo` runs it (the tag @demoframe), which builds the demo first, and it is not part of `npm run e2e`. The
 * build reads the recording of tools/record-site-demo.py, which is to be made first.
 *
 * The test serves the build itself, at the site's address on a made-up host, and reads nothing from the internet: the pictures'
 * hosts are refused, and the page shows its drawn signs. Playwright's own boxes for an element in a CSS-zoomed frame leave out the
 * zoom, so its clicks there land elsewhere; the browser maps the pointer right, so the pointer is placed here from the frame's own
 * coordinates.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.resolve(HERE, '..', 'dist-site')
const ORIGIN = 'http://guild-board.test'
const BASE = '/guild-board/demo/'
const TYPES: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml', '.png': 'image/png',
}

test.use({ viewport: { width: 2560, height: 1400 } }) // the screen is as wide: the page draws the frame

/** Answers the page's requests from the build, at the site's address; any other host is refused. */
async function serveBuild(page: Page): Promise<void> {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== ORIGIN) return route.abort()
    const name = url.pathname.startsWith(BASE) ? decodeURIComponent(url.pathname.slice(BASE.length)) || 'index.html' : null
    const file = name === null ? null : path.resolve(DIST, name)
    if (file === null || !file.startsWith(DIST + path.sep) || !existsSync(file) || !statSync(file).isFile()) {
      return route.fulfill({ status: 404 })
    }
    return route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] ?? 'application/octet-stream', body: readFileSync(file) })
  })
}

/** The page in the demo's frame, once the interface is drawn there. */
async function demoFrame(page: Page): Promise<Frame> {
  const element = await page.waitForSelector('#site-frame', { state: 'attached' })
  const frame = await element.contentFrame()
  if (frame === null) throw new Error('The demo drew no frame.')
  await frame.waitForSelector('.gb')
  return frame
}

/** The frame's place on the screen and its zoom: the frame's width over the width its page is laid out in. */
async function frameOnScreen(page: Page): Promise<{ x: number; y: number; zoom: number }> {
  return page.evaluate(() => {
    const element = document.getElementById('site-frame') as HTMLIFrameElement
    const box = element.getBoundingClientRect()
    return { x: box.left, y: box.top, zoom: box.width / element.contentWindow!.innerWidth }
  })
}

/** The place on the screen of a point of the frame's page, in that page's own coordinates. */
async function onScreen(page: Page, point: { x: number; y: number }): Promise<{ x: number; y: number }> {
  const frame = await frameOnScreen(page)
  return { x: frame.x + point.x * frame.zoom, y: frame.y + point.y * frame.zoom }
}

/** Clicks the middle of an element of the frame's page. */
async function click(page: Page, element: Locator): Promise<void> {
  const middle = await element.evaluate((one) => {
    const box = one.getBoundingClientRect()
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
  })
  const at = await onScreen(page, middle)
  await page.mouse.click(at.x, at.y)
}

/** A widget's cell on the Board, its column and row from 0, from its box against the Board's, as e2e/board.ts counts them. */
async function cellOf(frame: Frame, id: string): Promise<{ x: number; y: number; w: number; h: number }> {
  return frame.evaluate((id) => {
    const board = document.querySelector('[data-testid="board"]')!
    const pitch = { x: parseFloat(getComputedStyle(board).gridTemplateColumns) + 12, y: 108 }
    const grid = board.getBoundingClientRect()
    const box = document.querySelector(`[data-widget="${id}"]`)!.getBoundingClientRect()
    return {
      x: Math.round((box.left - grid.left) / pitch.x), y: Math.round((box.top - grid.top) / pitch.y),
      w: Math.round((box.width + 12) / pitch.x), h: Math.round((box.height + 12) / pitch.y),
    }
  }, id)
}

test(
  'site demo: on a full screen it is the 1,640-pixel window zoomed, its rail moves the address bar, and a drag lands where it is dropped',
  { tag: '@demoframe' },
  async ({ page }) => {
    test.skip(!existsSync(path.join(DIST, 'recording', 'index.json')), 'no built demo with its recording: see CONTRIBUTING.md')
    await serveBuild(page)
    await page.goto(`${ORIGIN}${BASE}#/board`)
    const frame = await demoFrame(page)

    // The interface is laid out in the player's usual window, 1,640 pixels wide, and drawn 2,560 wide.
    expect(await frame.evaluate(() => innerWidth)).toBe(1640)

    // A click on the rail goes to the page, and the address bar follows the frame.
    const rail = (name: string) => frame.locator(`nav.gb-rail a.gb-nav[href="#/${name}"]`)
    await click(page, rail('stats'))
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/stats')
    expect(await frame.evaluate(() => location.hash)).toBe('#/stats')
    await click(page, rail('board'))
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/board')

    // In Edit, the Clock dragged by its heading to the cells after the Notes lands there. Nothing is saved: Cancel ends Edit.
    const clock = frame.locator('[data-widget="start-clock"]')
    await expect(clock.locator('.w-head')).toBeVisible()
    await click(page, frame.getByRole('button', { name: 'Edit', exact: true }))
    await expect(frame.getByRole('button', { name: 'Cancel' })).toBeVisible()
    await clock.evaluate((one) => Promise.allSettled(one.getAnimations().map((animation) => animation.finished)))
    const notes = await cellOf(frame, 'start-notes')
    const cell = { x: notes.x + notes.w, y: notes.y }
    const way = await frame.evaluate((cell) => {
      const board = document.querySelector('[data-testid="board"]')!
      const pitch = { x: parseFloat(getComputedStyle(board).gridTemplateColumns) + 12, y: 108 }
      const grid = board.getBoundingClientRect()
      const widget = document.querySelector('[data-widget="start-clock"]')!
      const box = widget.getBoundingClientRect()
      const head = widget.querySelector('.w-head')!.getBoundingClientRect()
      // A point of the heading left of its buttons, which keeps its place on the widget as the widget follows the pointer.
      const grab = { x: head.left + 12, y: head.top + head.height / 2 }
      return { grab, drop: { x: grid.left + cell.x * pitch.x + grab.x - box.left, y: grid.top + cell.y * pitch.y + grab.y - box.top } }
    }, cell)
    const from = await onScreen(page, way.grab)
    const to = await onScreen(page, way.drop)
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(to.x, to.y, { steps: 8 })
    await page.mouse.up()
    await expect.poll(() => cellOf(frame, 'start-clock')).toMatchObject(cell)
    await expect(clock).toHaveAccessibleName(`Clock, 2 by 1, column ${cell.x + 1}, row ${cell.y + 1}`)
    await click(page, frame.getByRole('button', { name: 'Cancel' }))
    await expect(frame.getByRole('button', { name: 'Edit', exact: true })).toBeVisible()
  },
)

/** src/sitedemo.ts's RECORDING_REFUSAL: what a page shows when a write is tried in the recording. */
const REFUSAL = 'This is a recording, so nothing here changes. Install Guild Board to use it.'

test.describe('site demo: the theme', () => {
  test.use({ viewport: { width: 1440, height: 900 } }) // not wider than the usual window: the interface is the page itself, with no frame

  test(
    'site demo: a tile applies the theme and tries no write (the recording would refuse it in words), and the choice survives a reload',
    { tag: '@demoframe' },
    async ({ page }) => {
      test.skip(!existsSync(path.join(DIST, 'recording', 'index.json')), 'no built demo with its recording: see CONTRIBUTING.md')
      await serveBuild(page)
      const sent: string[] = []
      page.on('request', (request) => {
        if (request.method() !== 'GET') sent.push(`${request.method()} ${request.url()}`)
      })
      await page.goto(`${ORIGIN}${BASE}#/settings`)
      const picker = page.getByRole('radiogroup', { name: 'Theme' })
      await expect(picker).toBeVisible()
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'parchment')
      await picker.getByRole('radio', { name: /^Midnight, / }).click()
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'midnight')
      await expect(picker.getByRole('radio', { name: /^Midnight, / })).toHaveAttribute('aria-checked', 'true')
      expect(await page.evaluate(() => localStorage.getItem('gb-theme'))).toBe('midnight')
      // The demo's transport refuses every write in place, with RECORDING_REFUSAL (src/sitedemo.ts), which the page shows under the row
      // that asked for it: a tile that wrote the setting would show it (no request leaves the page, so the page's own words are the proof).
      await page.waitForTimeout(500) // a refused write is answered at once; this is longer than it takes
      await expect(page.getByText(REFUSAL)).toHaveCount(0)
      // The Theme row's notice (role="status", after the row) is where a refused write would show.
      await expect(page.locator('.tp-row + [role="status"]')).toHaveCount(0)
      expect(sent).toEqual([])
      // A reload brings the choice back, before the interface draws.
      await page.reload()
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'midnight')
      await expect(page.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio', { name: /^Midnight, / })).toHaveAttribute('aria-checked', 'true')
      // And another one, Mist, and Match Windows (which follows this browser's scheme, dark here).
      await page.emulateMedia({ colorScheme: 'dark' })
      await page.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio', { name: /^Match Windows, / }).click()
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'midnight')
      expect(await page.evaluate(() => localStorage.getItem('gb-theme'))).toBe('system')
      await page.waitForTimeout(500)
      await expect(page.getByText(REFUSAL)).toHaveCount(0)
      expect(sent).toEqual([])
      // The control: a setting that does write (a switch of the same group) is refused in those very words, so the check above can fail.
      await page.getByRole('region', { name: 'Guild Board', exact: true }).locator('button[aria-pressed]').first().click()
      await expect(page.getByText(REFUSAL).first()).toBeVisible()
    },
  )
})
