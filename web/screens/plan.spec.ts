import type { Page } from '@playwright/test'
import path from 'node:path'
import { SCREENS_OUT } from './out.ts'
import { expect, test, type Core } from '../e2e/fixtures.ts'
import { asHuTao } from '../e2e/hutao.ts'
import { asLauma } from '../e2e/lauma.ts'

/*
 * The Plan page's and the stat simulator's pictures, which only `npm run screens:plan` takes, to be looked at against the Plan page
 * and simulator design (`2026-11-12-guild-board-plan-and-stat-simulator-design.md`, sections 4 to 6) and its mockups, plan.html and
 * simulator.html (`assets/2026-11-12-plan-and-simulator-mockup/`). Each is what the window shows, in the player's usual window,
 * 1,640 × 1,100, and full screen on their 2,560-pixel display as the window's zoom shows it (the page lays out as the usual window,
 * enlarged), once the fonts and pictures are in and the motion has settled: the Plan page, the planner of Sandrone, the planner with
 * her goblet tested (its main stat changed to Cryo DMG Bonus), the weapon picker open, the set picker open, and her Profile's
 * artifacts with their Crit Value pills. The core starts on Wednesday 11 November 2026, 09:00 server time, with Sandrone, Odette,
 * Alyosha and Jahoda planned. The demo's characters, wiki and pictures are made up; nothing in them is the player's. The first
 * six were stage 1's, taken before the verdict was on; since 2.2.0 they show it (the planner with its verdict and per-talent rows),
 * so they are compared with the mockups for the page's layout alone. The `verdict-` pictures: the planner of Sandrone with her goblet tested and its
 * verdict, Lauma's planner (a Lunar character, her goblet changed to Elemental Mastery) and Hu Tao's with her sands tested and
 * Paramita Papilio counted. The demo has neither Lauma nor Hu Tao, so the page's read of the planner is answered by route
 * interception with the kit data of the core's own and Genshin Optimizer's own stats (`e2e/lauma.ts`, `e2e/hutao.ts`).
 *
 * They go into the folder 2026-11-12-plan-and-simulator-screens of the directory GB_SCREENS_DIR names (the design's assets folder, as
 * the Stats pictures do), else of `screenshots`.
 */

const NAME = '2026-11-12-plan-and-simulator-screens'
const FOLDER = path.join(SCREENS_OUT, NAME)
const PLAN = '@plan'

test.use({ demoNow: '2026-11-11T08:00:00+00:00' })

/** Waits until no animation or transition runs (a paused one rests) and every counted number shows its value (look pass spec 6.3). */
async function settled(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const moving = document.getAnimations().some((animation) => animation.playState === 'running')
    const counting = [...document.querySelectorAll('span[aria-hidden="true"] + .sr-only')].some(
      (real) => real.previousElementSibling?.textContent !== real.textContent,
    )
    return !moving && !counting
  })
}

/** The window's picture, once the fonts and pictures are in and the motion has settled; the pointer is out of the window. */
async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready
  })
  await page.waitForFunction(() =>
    [...document.images].every((image) => image.hidden || (image.complete && image.naturalWidth > 0)),
  )
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.mouse.move(0, 0)
  await settled(page)
  await page.screenshot({ path: path.join(FOLDER, `${name}.png`) })
}

type Scene = {
  name: string
  /** Opens the page and brings it to the state the picture shows. */
  open: (page: Page, core: Core) => Promise<void>
}

const planner = async (page: Page, core: Core) => {
  await page.goto(`${core.origin}/#/characters/sandrone/plan`)
  await expect(page.locator('.pp-piece[data-slot="flower"]')).toContainText('42.8')
}

const SCENES: Scene[] = [
  {
    name: 'plan',
    open: async (page, core) => {
      await page.goto(`${core.origin}/#/plan`)
      await expect(page.getByRole('heading', { name: 'Wednesday', level: 2 })).toBeVisible()
      await expect(page.getByTestId('plan-grid').locator('.pln-tr[data-key]')).toHaveCount(4)
      await expect(page.getByTestId('plan-bosses')).toContainText("Madman's Restraint")
    },
  },
  { name: 'planner', open: planner },
  {
    name: 'planner-goblet-tested',
    open: async (page, core) => {
      await planner(page, core)
      await page.locator('.pp-piece[data-slot="goblet"]').click()
      await page.getByLabel('Main stat').selectOption('dmg')
      await expect(page.locator('tr[data-stat="atk"] .chg')).toHaveText('−473')
    },
  },
  {
    name: 'weapon-picker',
    open: async (page, core) => {
      await planner(page, core)
      await page.locator('.pp-pick[data-open="weapon"]').click()
      await expect(page.getByRole('dialog').locator('.pp-tile').first()).toBeVisible()
    },
  },
  {
    name: 'set-picker',
    open: async (page, core) => {
      await planner(page, core)
      await page.locator('.pp-pick[data-open="set"]').first().click()
      await expect(page.getByRole('dialog').locator('.pp-tile').first()).toBeVisible()
    },
  },
  {
    name: 'profile-artifacts',
    open: async (page, core) => {
      await page.goto(`${core.origin}/#/characters/sandrone`)
      await page.getByRole('button', { name: 'Artifacts', exact: true }).click()
      await expect(page.locator('.pf-cvrow .pp-cv').first()).toBeVisible()
    },
  },
]

/** The scenes taken with the verdict switch on. */
const VERDICT_SCENES: Scene[] = [
  {
    name: 'verdict-goblet-tested',
    open: async (page, core) => {
      await planner(page, core)
      await page.locator('.pp-piece[data-slot="goblet"]').click()
      await page.getByLabel('Main stat').selectOption('dmg')
      await expect(page.locator('.pp-verdict .v')).toHaveText(/^Hits softer: −\d+\.\d%$/)
    },
  },
  {
    name: 'verdict-lauma',
    open: async (page, core) => {
      await asLauma(page, 'sandrone')
      await planner(page, core)
      await page.locator('.pp-piece[data-slot="goblet"]').click()
      await page.getByLabel('Main stat').selectOption('em')
      await expect(page.locator('.pp-verdict .v')).toHaveText(/^Hits (harder|softer): [+−]\d+\.\d%$/)
    },
  },
  {
    name: 'verdict-hutao-paramita',
    open: async (page, core) => {
      await asHuTao(page, 'sandrone')
      await planner(page, core)
      await page.locator('.pp-piece[data-slot="sands"]').click()
      await page.getByLabel('Main stat').selectOption('atk_pct')
      await expect(page.locator('.pp-verdict .v')).toHaveText('Hits softer: −5.3%')
      await expect(page.locator('.pp-counted button', { hasText: 'Paramita Papilio' })).toHaveAttribute('aria-pressed', 'true')
    },
  },
]

/** The two pictures of a scene: the usual window, and full screen at 2,560 as the window's zoom shows it. */
function takeScenes(scenes: Scene[]): void {
  for (const scene of scenes) {
    test(`plan: ${scene.name} in the usual window`, { tag: PLAN }, async ({ page, core }) => {
      await page.setViewportSize({ width: 1640, height: 1100 })
      await scene.open(page, core)
      await shot(page, `${scene.name}-1640`)
    })

    // Full screen on the 2,560-pixel display, the window zooms its page by 2,560 / 1,640 (the scaling pass spec, section 5): a
    // browser of its own does the same, at 1,640 × 897 and 2,560 / 1,640 device pixels to a pixel, logged in through the launch link.
    test(`plan: ${scene.name} full screen at 2560, zoomed`, { tag: PLAN }, async ({ browser, core, api }) => {
      void api // the fixture that acknowledges the first-run notice
      const context = await browser.newContext({ viewport: { width: 1640, height: 897 }, deviceScaleFactor: 2560 / 1640 })
      try {
        await context.request.get(core.launch, { maxRedirects: 0 })
        const zoomed = await context.newPage()
        await scene.open(zoomed, core)
        await shot(zoomed, `${scene.name}-2560`)
      } finally {
        await context.close()
      }
    })
  }
}

takeScenes(SCENES)

takeScenes(VERDICT_SCENES)
