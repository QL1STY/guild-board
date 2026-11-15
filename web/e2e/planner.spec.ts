import type { Page } from '@playwright/test'
import { expect, test } from './fixtures.ts'
import { asHuTao } from './hutao.ts'

/*
 * The planner as the stat simulator (the Plan page and simulator design, sections 5 and 6), against the demo core: its
 * Sandrone wears a five-piece set, a +16 plume among +20 pieces. The tested pieces, weapon and set live in the page only.
 */
test.use({ viewport: { width: 1640, height: 1100 } })

/** The most room the demo Sandrone's page may leave in its first two columns with the verdict on (measured at 212 and 135, in pixels, each 26 over what it was before the verdict gained its folded Not counted line: the right column is the tallest, and the closing notes sit at the foot of the others). */
const GAP_MIDDLE = 220
const GAP_LEFT = 140

async function open(page: Page, origin: string) {
  await page.goto(`${origin}/#/characters/sandrone/plan`)
  await expect(page.locator('.pp-piece[data-slot="flower"]')).toBeVisible()
}

const piece = (page: Page, slot: string) => page.locator(`.pp-piece[data-slot="${slot}"]`)

test('the pieces show their Crit Value in its tier', async ({ page, core }) => {
  await open(page, core.origin)
  const flower = piece(page, 'flower')
  await expect(flower).toContainText('42.8')
  await expect(flower.locator('.pp-cv')).toHaveClass(/\bt3\b/)
  await expect(piece(page, 'goblet').locator('.pp-cv')).toHaveClass(/\bt0\b/)
  // The set's total sits in the header, in its own tier colour (130.6 is under 180).
  await expect(page.locator('.pp-chip').first()).toContainText('130.6')
})

test('typing an impossible value turns it red', async ({ page, core }) => {
  await open(page, core.origin)
  await piece(page, 'flower').click()
  const value = page.getByLabel('Value of Crit DMG')
  await value.fill('21.3')
  await expect(page.getByText('No roll can make this')).toBeVisible()
  await expect(value).toHaveClass(/\bbad\b/)
  await value.fill('21.8')
  await expect(page.getByText('No roll can make this')).toHaveCount(0)
})

test('a roll button adds a roll and the budget counts it', async ({ page, core }) => {
  await open(page, core.origin)
  await piece(page, 'flower').click()
  await page.getByRole('button', { name: 'New +0 piece' }).click()
  const budget = page.locator('.pp-budget')
  await expect(budget).toContainText(/rolls at \+0/)
  await page.getByRole('button', { name: 'Level up +4' }).click()
  await expect(budget).toContainText(/rolls at \+4/)
  for (const level of [8, 12, 16, 20]) {
    await page.getByRole('button', { name: 'Level up +4' }).click()
    await expect(budget).toContainText(`rolls at +${level}`)
  }
  await expect(page.getByRole('button', { name: 'Level up +4' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Roll to +20' })).toBeDisabled()
})

test('a tier button adds a roll of that value until the piece holds all it can', async ({ page, core }) => {
  await open(page, core.origin)
  await piece(page, 'plume').click() // +16: 4 + 4 = 8 rolls, all held
  await expect(page.locator('.pp-budget')).toContainText('8 of 8 rolls at +16')
  await expect(page.locator('.pp-tiers button').first()).toBeDisabled()
  await page.getByRole('button', { name: 'New +0 piece' }).click()
  await page.getByRole('button', { name: 'Level up +4' }).click()
  await page.getByRole('button', { name: 'Level up +4' }).click()
  const used = async () => Number(/^(\d+) of (\d+)/.exec(await page.locator('.pp-budget').innerText())![1])
  const all = await used() // at +8 a new piece holds every roll it can
  await page.locator('.pp-undo:enabled').first().click() // one roll off a substat that has two
  await expect.poll(used).toBe(all - 1)
  await page.locator('.pp-tiers button:not(.pp-undo):enabled').first().click()
  await expect.poll(used).toBe(all)
  await expect(page.locator('.pp-tiers button:not(.pp-undo)').first()).toBeDisabled()
})

test('an ATK% goblet swapped for Cryo DMG lowers ATK by 473', async ({ page, core }) => {
  await open(page, core.origin)
  const atk = page.locator('tr[data-stat="atk"]')
  await expect(atk.locator('.chg')).toHaveText('·')
  await piece(page, 'goblet').click()
  await page.getByLabel('Main stat').selectOption('dmg')
  await expect(atk.locator('.chg')).toHaveText('−473')
  await expect(page.locator('tr[data-stat="dmg"] .chg')).toHaveText('+46.6%')
  await expect(piece(page, 'goblet')).toContainText('Tested')
  // A stat that did not move is dim.
  await expect(page.locator('tr[data-stat="er"]')).toHaveClass(/\bsame\b/)
})

test('the pickers open over the page', async ({ page, core }) => {
  await open(page, core.origin)
  const height = await page.evaluate(() => document.body.scrollHeight)
  const weapon = page.locator('.pp-pick[data-open="weapon"]')
  await weapon.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('searchbox')).toBeFocused()
  expect(await page.evaluate(() => document.body.scrollHeight)).toBe(height)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(weapon).toBeFocused()

  await page.locator('.pp-pick[data-open="set"]').first().click()
  await expect(dialog).toBeVisible()
  expect(await page.evaluate(() => document.body.scrollHeight)).toBe(height)
  await page.mouse.click(4, 4) // the scrim, outside the dialog
  await expect(dialog).toHaveCount(0)
})

test('choosing a weapon replaces hers in the test, and a search narrows the grid', async ({ page, core }) => {
  await open(page, core.origin)
  const weapon = page.locator('.pp-pick[data-open="weapon"]')
  const hers = await weapon.locator('b').innerText()
  await weapon.click()
  const dialog = page.getByRole('dialog')
  const tiles = dialog.locator('.pp-tile')
  await expect(tiles.first()).toBeVisible()
  const all = await tiles.count()
  expect(all).toBeGreaterThan(1)
  await dialog.getByRole('searchbox').fill('zzzz')
  await expect(tiles).toHaveCount(0)
  await dialog.getByRole('searchbox').fill('')
  await expect(tiles).toHaveCount(all)
  const other = tiles.filter({ hasNotText: hers }).first()
  const name = await other.locator('b').innerText()
  await other.click()
  await expect(dialog).toHaveCount(0)
  await expect(weapon.locator('b')).toHaveText(name)
})

test('a 2+2 build shows two set tiles, and choosing a set swaps only the pieces of the tile pressed', async ({ page, core }) => {
  await page.route(/\/api\/characters\/sandrone\/plan$/, async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    const response = await route.fetch()
    const model = await response.json()
    const first = model.sim.sets[0]
    const second = { ...first, key: 'second-set', name: 'Second Set', pieces: 2 }
    first.pieces = 2
    model.sim.sets = [first, second]
    model.sim.pieces.forEach((one: { slot: string; set_key: string }) => {
      one.set_key = ['flower', 'plume'].includes(one.slot) ? first.key : ['sands', 'goblet'].includes(one.slot) ? second.key : 'a-lone-set'
    })
    await route.fulfill({ response, json: model })
  })
  await open(page, core.origin)
  const tiles = page.locator('.pp-pick[data-open="set"]')
  await expect(tiles).toHaveCount(2)
  await expect(tiles.nth(0)).toContainText('2 of 5 pieces')
  await expect(tiles.nth(1)).toContainText('Second Set')
  await tiles.nth(1).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.locator('.pp-tile').first()).toBeVisible()
  await dialog.locator('.pp-tile').filter({ hasNotText: 'Second Set' }).filter({ hasNotText: 'Disenchantment' }).first().click()
  await expect(dialog).toHaveCount(0)
  await expect(tiles.nth(1)).toBeFocused() // the tile that was pressed is still there, and has the focus back
  // Only the Sands and Goblet (the second tile's pieces) are of the new set: two tiles still, the first one unchanged.
  await expect(tiles).toHaveCount(2)
  await expect(tiles.nth(0)).toContainText('Disenchantment in Deep Shadow')
  await expect(tiles.nth(1)).not.toContainText('Second Set')
  await expect(piece(page, 'sands')).toContainText('Tested')
  await expect(piece(page, 'flower')).not.toContainText('Tested')
})

test('Raise marks a talent within one level of her highest, below 10, and the targets still step', async ({ page, core }) => {
  await open(page, core.origin)
  const rows = page.locator('.pp-trow')
  await expect(rows.filter({ hasText: 'Normal Attack' }).locator('.pp-raise')).toHaveText('Raise')
  await expect(rows.filter({ hasText: 'Elemental Skill' }).locator('.pp-raise')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Lower the Normal Attack target' })).toBeEnabled()
})

test('the old planner parts are gone', async ({ page, core }) => {
  await open(page, core.origin)
  for (const words of ['Main stats', 'Try a piece you got', 'What it takes', 'Days to ready', 'Goals met', 'damage against now', 'of her full potential']) {
    await expect(page.getByText(words)).toHaveCount(0)
  }
  await expect(page.getByRole('button', { name: /focus/i })).toHaveCount(0)
  await expect(page.locator('.pp-chip.hero')).toContainText('No change')
  await expect(page.locator('.pp-chip.hero')).toContainText('nothing tested yet')
})

test('a main stat that a substat has turns that substat into another one and says so', async ({ page, core }) => {
  await open(page, core.origin)
  await piece(page, 'sands').click() // ATK% main; substats Crit DMG, Crit Rate, Elemental Mastery, DEF
  await page.getByLabel('Main stat').selectOption('em')
  await expect(page.locator('.pp-srow')).toHaveCount(4)
  await expect(page.locator('.pp-log')).toContainText(/Elemental Mastery moved to the main stat; the substat became .+\./)
  await expect(page.getByLabel('Value of Elemental Mastery')).toHaveCount(0)
})

test('emptying a typed value gives the rolls back, and "21." is no error while it is typed', async ({ page, core }) => {
  await open(page, core.origin)
  await piece(page, 'flower').click()
  const value = page.getByLabel('Value of Crit DMG')
  await value.fill('21.')
  await expect(page.getByText('One decimal at most')).toHaveCount(0)
  await value.fill('21.3')
  await expect(page.getByText('No roll can make this')).toBeVisible()
  await value.fill('') // the pips come back with the rolls the piece had
  await expect(page.getByText('3 rolls').first()).toBeVisible()
  await expect(page.getByText('No roll can make this')).toHaveCount(0)
  await value.blur()
  await expect(value).toHaveValue('21.8')
})

test("the header line has her constellation, and the weapon's refinement and level targets step", async ({ page, core }) => {
  await open(page, core.origin)
  await expect(page.locator('.pp-sub')).toContainText('Cryo · Claymore · Level 90 · C2')
  await expect(page.getByRole('button', { name: 'Raise the refinement' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Lower the weapon level target' })).toBeVisible()
})

test('the three columns end at one height and the editor keeps its buttons on one row', async ({ page, core }) => {
  await open(page, core.origin)
  const bottoms = await page.locator('.pp-cols > .pp-col').evaluateAll((cols) => cols.map((col) => Math.round(col.getBoundingClientRect().bottom)))
  expect(Math.max(...bottoms) - Math.min(...bottoms)).toBeLessThanOrEqual(1)
  for (const slot of ['flower', 'goblet']) {
    await piece(page, slot).click()
    const tops = await page.locator('.pp-edhead.top').first().locator('select, button, .lv').evaluateAll((items) => items.map((item) => Math.round(item.getBoundingClientRect().top / 10)))
    expect(new Set(tops).size, slot).toBeLessThanOrEqual(2) // one row (the heights of a select and a button differ a little)
  }
})

/*
 * The verdict (the Plan design, sections 6 and 7.5; the mockup's right column): the damage engine's answer for the tested build,
 * on since 2.2.0.
 */
test.describe('the verdict', () => {
  const verdict = (page: Page) => page.locator('.pp-verdict')
  const talent = (page: Page, key: string) => page.locator(`.pp-tal[data-talent="${key}"]`)
  const counted = (page: Page, name: string) => page.locator('.pp-counted').getByRole('button', { name, exact: true })

  async function cryoGoblet(page: Page) {
    await piece(page, 'goblet').click()
    await page.getByLabel('Main stat').selectOption('dmg')
  }

  test('the verdict says Hits softer for a Cryo goblet on Sandrone, in the box and in the header', async ({ page, core }) => {
    await open(page, core.origin)
    // Nothing is tested yet.
    await expect(verdict(page).locator('.v')).toHaveText('No change')
    await expect(page.locator('.pp-chip.hero b')).toHaveText('No change')
    await expect(page.locator('.pp-chip.hero')).toContainText('nothing tested yet')
    await cryoGoblet(page)
    const head = verdict(page).locator('.v')
    await expect(head).toHaveText(/^Hits softer: −\d+\.\d%$/)
    await expect(head).toHaveClass(/\bless\b/)
    const figure = (await head.innerText()).replace('Hits softer: ', '')
    await expect(page.locator('.pp-chip.hero b')).toHaveText(figure)
    await expect(page.locator('.pp-chip.hero b')).toHaveClass(/\bdown\b/)
    await expect(page.locator('.pp-chip.hero')).toContainText('with the tested pieces')
    await expect(verdict(page).locator('.why')).not.toBeEmpty()
    // Every main talent shows its own change.
    for (const key of ['normal', 'skill', 'burst']) await expect(talent(page, key).locator('.d')).toHaveText(/^[+−]\d+\.\d%$/)
  })

  test('talent rows show Stellar-Conduct and the Melt switch her ordinary Cryo rows need', async ({ page, core }) => {
    await open(page, core.origin)
    for (const key of ['skill', 'burst']) {
      await expect(talent(page, key)).toContainText('Stellar-Conduct')
      // Her Skill and Burst mix an ordinary Cryo row with the Stellar-Conduct one: the Melt that the ordinary row can trigger is a switch
      await expect(talent(page, key).getByRole('button', { name: /^Melt for the/ })).toHaveAttribute('aria-pressed', 'false')
    }
    await expect(page.locator('.pp-counted')).toContainText('Polestar field')
    await cryoGoblet(page)
    const skill = talent(page, 'skill')
    const before = await skill.locator('.d').innerText()
    await skill.getByRole('button', { name: /^Melt for the/ }).click()
    await expect(skill.getByRole('button', { name: /^Melt for the/ })).toHaveAttribute('aria-pressed', 'true')
    await expect(skill.locator('.d')).not.toHaveText(before) // Melt changes what her ordinary Cryo row is worth
  })

  test('the closing note says what matters for her hits, and the enemy is in the title of the verdict', async ({ page, core }) => {
    await open(page, core.origin)
    const note = page.locator('.pp-cols > .pp-col').nth(2).locator('> .pp-note').last()
    await expect(note).toContainText('deal Stellar-Conduct damage. Cryo DMG Bonus and enemy DEF do not change it; ATK, crit and Elemental Mastery do.')
    await expect(note).toContainText('Her other hits scale with')
    await expect(verdict(page)).toHaveAttribute('title', /level 100 enemy with 10% resistance, at average crit/)
    await expect(page.locator('.pp-chip.hero')).toHaveAttribute('title', /level 100 enemy/)
  })

  test("toggles are named with their weapon or set in plain words, and the one list is Not counted", async ({ page, core }) => {
    await open(page, core.origin)
    await expect(page.locator('.pp-counted')).not.toContainText('Left out')
    // A long list folds into one line, so the column does not grow far past its neighbours; pressing it shows every effect.
    await expect(page.locator('.pp-counted .pp-chipsw[aria-pressed="false"]')).toHaveCount(0)
    await page.locator('.pp-counted').getByRole('button', { name: /^\d+ effects\. Show them$/ }).click()
    await expect(page.locator('.pp-counted .pp-chipsw[aria-pressed="false"]').first()).toBeVisible()
    // no chip is a bare code word, nor ends in one: "Passive", "State", "Stack", "Mode", "Hp", "Set4" (a name like "Berserker: Hp" is the old kind)
    const chips = await page.locator('.pp-counted button').allInnerTexts()
    for (const chip of chips) {
      expect(chip, chip).not.toMatch(/^(Passive|State|Stack|Stacks|Mode|Hp|Set4)$/)
      expect(chip, chip).not.toMatch(/(^|[ :])(Passive|State|Stack|Mode|Hp|Set2|Set4)$/)
      expect(chip, chip).not.toMatch(/[a-z][A-Z]|_/)
    }
    // the hint is there only while the line has chips
    const notCounted = page.locator('.pp-counted').getByText('Not counted:')
    if (await notCounted.count()) await expect(page.locator('.pp-counted')).toContainText('Press one to count it.')
    else await expect(page.locator('.pp-counted')).not.toContainText('Press one to count it.')
  })

  test('Recorded hits steps from 12 down to 0 on a Stellar-Conduct talent and moves the change', async ({ page, core }) => {
    await open(page, core.origin)
    await cryoGoblet(page)
    const skill = talent(page, 'skill')
    const hits = skill.locator('.pp-rec .n')
    await expect(hits).toHaveText('12')
    const before = await skill.locator('.d').innerText()
    await expect(skill.getByRole('button', { name: /^Raise the recorded hits/ })).toBeDisabled()
    await skill.getByRole('button', { name: /^Lower the recorded hits/ }).click()
    await expect(hits).toHaveText('11')
    await expect(skill.getByRole('button', { name: /^Raise the recorded hits/ })).toBeEnabled()
    for (let hit = 10; hit >= 0; hit -= 1) await skill.getByRole('button', { name: /^Lower the recorded hits/ }).click()
    await expect(hits).toHaveText('0')
    await expect(skill.getByRole('button', { name: /^Lower the recorded hits/ })).toBeDisabled()
    // The field's DMG Bonus is smaller with fewer hits recorded, and her ordinary Cryo rows share in it.
    expect(await skill.locator('.d').innerText()).not.toBe(before)
  })

  test('a counted toggle switched off changes the verdict (Hu Tao, Paramita Papilio)', async ({ page, core }) => {
    await asHuTao(page, 'sandrone')
    await open(page, core.origin)
    await piece(page, 'sands').click()
    await page.getByLabel('Main stat').selectOption('atk_pct') // HP% sands for ATK% sands, as Genshin Optimizer ran it
    await expect(verdict(page).locator('.v')).toHaveText('Hits softer: −5.3%')
    await expect(page.locator('.pp-counted')).toContainText('Paramita Papilio')
    await expect(counted(page, 'Paramita Papilio')).toHaveAttribute('aria-pressed', 'true')
    await counted(page, 'Paramita Papilio').click()
    await expect(verdict(page).locator('.v')).toHaveText('Hits harder: +20.3%')
    await expect(verdict(page).locator('.v')).toHaveClass(/\bmore\b/)
    await expect(page.locator('.pp-chip.hero b')).toHaveText('+20.3%')
    // The name stays, off, to be switched on again.
    await expect(counted(page, 'Paramita Papilio')).toHaveAttribute('aria-pressed', 'false')
    await counted(page, 'Paramita Papilio').click()
    await expect(verdict(page).locator('.v')).toHaveText('Hits softer: −5.3%')
  })

  test('a toggle that is off by default is offered under Not counted, pressed it moves to Counted and moves the verdict (Hu Tao, HP below 50%)', async ({ page, core }) => {
    await asHuTao(page, 'sandrone')
    await open(page, core.origin)
    await piece(page, 'sands').click()
    await page.getByLabel('Main stat').selectOption('atk_pct')
    const before = await verdict(page).locator('.v').innerText()
    const chip = counted(page, 'HP below 50%')
    await expect(chip).toHaveAttribute('aria-pressed', 'false')
    await expect(chip).toHaveAttribute('title', 'Not counted. Press to count it.')
    await expect(page.locator('.pp-counted').getByText('Not counted:')).toBeVisible()
    await expect(page.locator('.pp-counted')).toContainText('Press one to count it.')
    await chip.click()
    await expect(counted(page, 'HP below 50%')).toHaveAttribute('aria-pressed', 'true')
    await expect(counted(page, 'HP below 50%')).toHaveAttribute('title', 'Counted. Press to leave it out.')
    // Her own bonus adds to the damage of both builds alike, so the verdict (their ratio) stays; the weapon's ATK from Max HP is not the same in both, so counting it moves the verdict.
    expect(await verdict(page).locator('.v').innerText()).toBe(before)
    const homa = counted(page, 'Staff of Homa: More ATK from Max HP below 50% HP')
    await expect(homa).toHaveAttribute('aria-pressed', 'false')
    await homa.click()
    await expect(homa).toHaveAttribute('aria-pressed', 'true')
    expect(await verdict(page).locator('.v').innerText()).not.toBe(before)
    await homa.click()
    await expect(homa).toHaveAttribute('aria-pressed', 'false')
    // pressed again it is left out and goes back under Not counted
    await counted(page, 'HP below 50%').click()
    await expect(counted(page, 'HP below 50%')).toHaveAttribute('aria-pressed', 'false')
  })

  test('a reaction is a switch for an ordinary elemental talent, and the Mitya note goes when one is on', async ({ page, core }) => {
    await asHuTao(page, 'sandrone', { recommended: ['cr', 'em'] })
    await open(page, core.origin)
    const note = 'HoYoverse recommends Elemental Mastery for her. Turn on the reaction she triggers to count it.'
    await expect(page.getByText(note)).toBeVisible()
    // Pyro can Vaporize or Melt: a switch of None, Vaporize and Melt on each talent.
    const normal = talent(page, 'normal')
    const choice = normal.getByLabel('Reaction of the Normal Attack')
    await expect(choice.locator('option')).toHaveText(['None', 'Vaporize', 'Melt'])
    await expect(choice).toHaveValue('none')
    await choice.selectOption('vaporize')
    await expect(choice).toHaveValue('vaporize')
    await expect(page.getByText(note)).toHaveCount(0)
    await choice.selectOption('none')
    await expect(page.getByText(note)).toBeVisible()
    // The choice is one line: the row is no taller than a row with no reaction to choose
    const heights = await page.locator('.pp-tal').evaluateAll((rows) => rows.map((row) => Math.round(row.getBoundingClientRect().height)))
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(2)
  })

  test('Raise marks a main talent below level 10, however far below', async ({ page, core }) => {
    await page.route(/\/api\/characters\/sandrone\/plan$/, async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      const response = await route.fetch()
      const model = await response.json()
      const now: Record<string, number> = { normal: 5, skill: 10, burst: 9 }
      for (const one of model.talents) one.now = now[one.kind]
      await route.fulfill({ response, json: model })
    })
    await open(page, core.origin)
    const rows = page.locator('.pp-trow')
    await expect(rows.filter({ hasText: 'Normal Attack' }).locator('.pp-raise')).toHaveText('Raise') // 5 is not within one of 10
    await expect(rows.filter({ hasText: 'Elemental Burst' }).locator('.pp-raise')).toHaveText('Raise')
    await expect(rows.filter({ hasText: 'Elemental Skill' }).locator('.pp-raise')).toHaveCount(0)
  })

  test('no large gap in the first two columns, nothing overflows, and the right column reads in order', async ({ page, core }) => {
    await open(page, core.origin)
    await cryoGoblet(page)
    const cols = page.locator('.pp-cols > .pp-col')
    const wide = await cols.evaluateAll((all) => all.filter((col) => col.scrollWidth > col.clientWidth + 1).length)
    expect(wide).toBe(0)
    // The columns share a height, so the weight of the tallest one decides how much room the other two leave: what is left between
    // the editor and the closing note of the middle column, and below the last block of the left one, must stay small.
    const gaps = await page.evaluate(() => {
      const columns = [...document.querySelectorAll('.pp-cols > .pp-col')] as HTMLElement[]
      const middleNote = columns[1].querySelector(':scope > .pp-note:last-child') as HTMLElement
      const editor = columns[1].querySelector('.pp-editor') as HTMLElement
      const blocks = [...columns[0].querySelectorAll(':scope > .pp-blk')] as HTMLElement[]
      return {
        middle: middleNote.getBoundingClientRect().top - editor.getBoundingClientRect().bottom,
        left: columns[0].getBoundingClientRect().bottom - blocks[blocks.length - 1].getBoundingClientRect().bottom,
        tallest: Math.max(...columns.map((col) => col.getBoundingClientRect().height)),
      }
    })
    expect(gaps.middle).toBeLessThanOrEqual(GAP_MIDDLE)
    expect(gaps.left).toBeLessThanOrEqual(GAP_LEFT)
    // The verdict, the rows, the counted line and the stats table follow one another.
    const tops = await page.locator('.pp-verdict, .pp-tal, .pp-counted, .pp-stats').evaluateAll((items) => items.map((item) => item.getBoundingClientRect().top))
    expect([...tops].sort((a, b) => a - b)).toEqual(tops)
  })

  test('choices live in the page and are forgotten when it is left', async ({ page, core }) => {
    await open(page, core.origin)
    await cryoGoblet(page)
    const skill = talent(page, 'skill')
    await skill.getByRole('button', { name: /^Lower the recorded hits/ }).click()
    await expect(skill.locator('.pp-rec .n')).toHaveText('11')
    await page.goto(`${core.origin}/#/characters`)
    await page.goto(`${core.origin}/#/characters/sandrone/plan`)
    await expect(piece(page, 'flower')).toBeVisible()
    await expect(talent(page, 'skill').locator('.pp-rec .n')).toHaveText('12')
  })
})
