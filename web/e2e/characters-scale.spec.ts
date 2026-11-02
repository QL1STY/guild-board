import { expect, test } from './fixtures.ts'

/*
 * The Characters pages' own scale (the Characters design, 11.7). The window zooms the dashboard by its width over 1,640, so on a
 * full screen the page is 1,640 CSS pixels wide and about 900 tall, and the whole card (art, attributes and the strip of weapon
 * and five artifacts) has to fit that height. The windows are what the player's are, as the zoom shows them: 1,640 x 1,100 in
 * the usual window; and 2,000 x 1,125, 2,560 x 1,400 and 2,560 x 1,440 full screen (1,640 x 922, 897 and 923 CSS pixels).
 */
test.use({ demoNow: '2026-10-25T08:00:00+00:00', weekAndEndgame: false })

const WINDOWS = [
  { name: 'usual 1640 x 1100', height: 1100, device: 1 },
  { name: 'full screen 2000 x 1125', height: 922, device: 2000 / 1640 },
  { name: 'full screen 2560 x 1400', height: 897, device: 2560 / 1640 },
  { name: 'full screen 2560 x 1440', height: 923, device: 2560 / 1640 },
]

for (const { name, height, device } of WINDOWS) {
  test(`the whole card is on the screen, and the roster shows its characters: ${name}`, async ({ browser, core }) => {
    const context = await browser.newContext({ viewport: { width: 1640, height }, deviceScaleFactor: device })
    try {
      await context.request.get(core.launch, { maxRedirects: 0 })
      await context.request.put(`${core.origin}/api/settings`, { data: { risk_acknowledged: true } })
      const page = await context.newPage()
      const usual = height === 1100

      await page.goto(`${core.origin}/#/characters/sandrone`)
      await expect(page.locator('.pf-name')).toBeVisible()
      await page.waitForFunction(() => document.getAnimations().length === 0, undefined, { timeout: 15_000 })
      const card = await page.evaluate(() => {
        const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect()
        const strip = box('.pf-strip')
        const whole = box('.pf-card')
        return { top: whole.top, bottom: whole.bottom, stripBottom: strip.bottom, scrolled: window.scrollY, height: innerHeight, scale: getComputedStyle(document.querySelector('.pf-page')!).getPropertyValue('--cs') }
      })
      expect(card.scrolled).toBe(0)
      expect(card.top).toBeGreaterThanOrEqual(0)
      expect(card.stripBottom, 'the build strip is on the screen').toBeLessThanOrEqual(card.height)
      expect(card.bottom, 'the whole card is on the screen').toBeLessThanOrEqual(card.height)
      if (usual) {
        expect(card.scale.trim(), 'the usual window keeps the pages as they were').toBe('1')
        expect(Math.round(card.bottom - card.top)).toBe(882)
      } else {
        expect(Number(card.scale)).toBeLessThan(1)
        expect(Number(card.scale)).toBeGreaterThanOrEqual(0.85)
      }

      // A tip stands by the pointer, whatever the scale.
      const stat = page.locator('.pf-panel [tabindex="0"]').first()
      await stat.hover({ position: { x: 20, y: 8 } })
      const tip = page.locator('.cx-tip')
      await expect(tip).toBeVisible()
      const [at, near] = await Promise.all([stat.boundingBox(), tip.boundingBox()])
      expect(Math.abs(near!.x - (at!.x + 20 + 14))).toBeLessThanOrEqual(2)
      expect(Math.abs(near!.y - (at!.y + 8 + 16))).toBeLessThanOrEqual(2)

      await page.goto(`${core.origin}/#/characters/sandrone/plan`)
      await expect(page.locator('.pp-card')).toBeVisible()
      const planner = await page.evaluate(() => ({ scale: getComputedStyle(document.querySelector('.pp-page')!).getPropertyValue('--cs'), width: document.documentElement.scrollWidth, view: innerWidth }))
      expect(planner.width, 'nothing runs past the window sideways').toBeLessThanOrEqual(planner.view)
      expect(Number(planner.scale)).toBe(Number(card.scale))

      await page.goto(`${core.origin}/#/characters`)
      await expect(page.locator('.cr-card').first()).toBeVisible()
      await page.waitForFunction(() => document.getAnimations().length === 0, undefined, { timeout: 15_000 })
      const roster = await page.evaluate(() => {
        const columns = getComputedStyle(document.querySelector('.cr-grid')!).gridTemplateColumns.split(' ').length
        const shown = [...document.querySelectorAll('.cr-card')].filter((one) => one.getBoundingClientRect().bottom <= innerHeight).length
        return { columns, shown, wide: document.documentElement.scrollWidth <= innerWidth }
      })
      expect(roster.wide).toBe(true)
      if (usual) expect(roster.columns).toBe(5)
      else {
        expect(roster.columns).toBe(6)
        expect(roster.shown, 'more characters on the first screen than the 15 or so the page showed').toBeGreaterThanOrEqual(24)
      }
    } finally {
      await context.close()
    }
  })
}
