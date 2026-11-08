import type { Locator, Page, Request } from '@playwright/test'
import type { Ledger } from '../src/ledgertypes.ts'
import type { PityCard, Pulls } from '../src/types.ts'
import { changeAnswer, holding } from './answers.ts'
import { type Api, DEMO_NOW, expect, test } from './fixtures.ts'
import { ring } from './ring.ts'

test.beforeEach(async ({ page, core }) => {
  await page.goto(`${core.origin}/#/pulls`)
})

/** The pity card of a wish. */
function card(page: Page, pool: string): Locator {
  return page.locator(`[data-testid="pity-card"][data-pool="${pool}"]`)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAY_MS = 86_400_000

/** A number as the page writes it, to the whole: 4812 is "4,812", 66.6 is "67". */
const num = (value: number): string => Math.round(value).toLocaleString('en-US')

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
]
/** A month of the model, "2026-10", as the graph's tooltip and table say it: "October 2026". */
const monthTitle = (month: string): string => `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`
type Month = Pulls['history']['months'][number]
const WISH_KEYS = ['character', 'weapon', 'standard', 'chronicled'] as const
const monthTotal = (month: Month): number => WISH_KEYS.reduce((sum, key) => sum + month[key], 0)

/** The request that sends a Pulls setting: the switches, the typed events count and the cards' corrections. */
const sendsSettings = (request: Request): boolean =>
  request.method() === 'PUT' && request.url().endsWith('/api/pulls/settings')

/** The correction's field of a card's form, named by the day its history starts in this PC's time: "Before 16 Apr: pity". */
function pityField(form: Locator, of: PityCard): Locator {
  const from = new Date(of.from!)
  return form.getByLabel(`Before ${from.getDate()} ${MONTHS[from.getMonth()]}: pity`, { exact: true })
}

test("the page shows the demo's banners, cards, savings, planner and history", async ({ page, api }) => {
  const model = await api.get<Pulls>('/api/pulls')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pulls')
  // The demo's import ran when it was seeded, at the demo's start, and its history updates itself with its login.
  await expect(ring(page, 'pulls-import').mark).toHaveAttribute(
    'aria-label',
    /^Updated automatically with your HoYoLAB login · last 13 Oct, \d\d:\d\d$/,
  )

  // The night strip: the three banners of the demo, which end at 06:00 UTC on 24 Oct, 10 d 22 h after its 08:00 on 13 Oct.
  // The demo's clock runs on from there, so a moment later the whole hours left are 21.
  const sky = page.getByTestId('pulls-sky')
  await expect(sky.getByRole('heading')).toHaveText(/^Wishing now · ends in 10 d 2[12] h$/)
  const banners = sky.getByTestId('pulls-banner')
  await expect(banners).toHaveCount(3)
  await expect(banners.nth(0)).toContainText("Void Star's Advent")
  await expect(banners.nth(0)).toContainText('Skirk · your pity 61 · guaranteed')
  await expect(banners.nth(1)).toContainText('La Chanson Cerise')
  await expect(banners.nth(1)).toContainText('Escoffier · shares the same pity')
  await expect(banners.nth(2)).toContainText('Epitome Invocation')
  await expect(banners.nth(2)).toContainText('Azurelight · Symphonist of Scents · pity 23')
  // The demo downloads nothing: each banner shows its sign in place of its art.
  for (const banner of await banners.all()) {
    await expect(banner.locator('img')).toBeHidden()
    await expect(banner.locator('svg.sign')).toBeVisible()
  }

  // The four pity cards, in the core's order.
  const cards = page.getByTestId('pity-card')
  await expect(cards).toHaveCount(4)
  expect(await cards.evaluateAll((all) => all.map((one) => one.getAttribute('data-pool')))).toEqual([
    'character', 'weapon', 'standard', 'chronicled',
  ])
  // The cards have a heading of their own, which screen readers find.
  await expect(page.getByRole('region', { name: 'Pity', exact: true }).getByTestId('pity-card')).toHaveCount(4)
  const character = card(page, 'character')
  // Named with what the next 5★ is in its seal's words.
  await expect(character).toHaveAttribute('aria-label', 'Character event: pity 61 of 90, next 5★ is the featured one')
  await expect(character).toContainText('Character event')
  await expect(character.locator('.ring')).toContainText('61')
  await expect(character.locator('.ring')).toContainText('of 90')
  await expect(character).toContainText('13 to soft pity')
  await expect(character).toContainText('4★ in 3')
  await expect(character.locator('.seal')).toHaveText('Next 5★ is the featured one')
  await expect(card(page, 'weapon')).toContainText('Epitomized Path 0 of 1 · Azurelight')
  await expect(card(page, 'weapon').locator('.seal')).toHaveText('Next 5★ is a 75/25')
  await expect(card(page, 'standard').locator('.seal')).toHaveCount(0) // it features nothing
  await expect(card(page, 'chronicled')).toContainText('No path chosen')
  // The chronicled wish's five hold no 4★ to count from: one comes within five (ruling R22).
  await expect(card(page, 'chronicled')).toContainText('4★ within 5')

  // Savings, the ledger: the pulls as estimated now with what they are made of, when the balance was set, and the
  // forecast to the banners' end. The next version's sources have a test of their own.
  const savings = page.getByTestId('pulls-savings')
  await expect(savings.getByTestId('ledger-pulls')).toHaveText(num(model.savings.pulls!))
  await expect(savings).toContainText('pulls now')
  await expect(savings).toContainText('9,840 primogems and 14 Intertwined Fates')
  await expect(savings).toContainText('set today, estimated since')
  await expect(savings).toContainText(`By 24 Oct, when these banners end: about ${model.savings.forecast.pulls}`)
  await expect(savings).toContainText('more if you finish your remaining achievements')

  // The planner: each running character banner, and the weapon banner, which features the charted Azurelight.
  const planner = page.getByTestId('pulls-planner')
  const plans = planner.getByTestId('plan')
  await expect(plans).toHaveCount(3)
  await expect(planner).toContainText(/On the banners now\s*you have \d+ pulls by 24 Oct/)
  await expect(plans.nth(0)).toContainText('SkirkCharacter eventuntil 24 Oct')
  await expect(plans.nth(0)).toContainText('Certainat most 29 pulls · 2nd copy')
  await expect(plans.nth(2)).toContainText('AzurelightWeapon eventuntil 24 Oct')
  await expect(plans.nth(2)).toContainText(/(Likely|Maybe|Unlikely) · \d+%\d+ pulls by then · 2nd copy \d+%/)
  // The wishlist: Citlali, who is certain by her day, as the first character on the list starts from the card's
  // guarantee.
  const wishes = page.getByTestId('pulls-wishlist').getByRole('listitem')
  await expect(wishes).toHaveCount(1)
  await expect(wishes.first()).toContainText('Citlaliabout 11 NovCertainat most 29 pulls')

  // The history: 100 rows, newest first.
  const history = page.getByTestId('pulls-history')
  await expect(history).toContainText('History · 445 pulls kept')
  // Over the rows, the luck tiles and the graph of the wishes each month, which have tests of their own.
  await expect(history.getByTestId('luck-kept').getByTestId('tile-value')).toHaveText('445')
  await expect(history.getByTestId('pulls-months')).toBeVisible()
  const rows = history.getByTestId('history-row')
  await expect(rows).toHaveCount(100)
  await expect(rows.first()).toHaveAttribute('data-rank', /^[34]$/)
  await expect(rows.first()).toContainText('12 Oct')
  await expect(rows.first()).toContainText('Character event')
})

/**
 * The ring's sentence after an import that ended well, on the demo: a press takes the HoYoLAB login path first (the design,
 * section 5), so the import's own sentence is followed by that the history updates by itself with the login. (The tests that
 * route the model without the login give the sentences of the link a press keeps.)
 */
const withLogin = (sentence: string): string => `${sentence} Updates automatically with your HoYoLAB login.`

test('Import runs on the demo and says what it found', async ({ page, api }) => {
  const line = ring(page, 'pulls-import').mark
  // the demo's own import, at its start
  await expect(line).toHaveAttribute('aria-label', /^Updated automatically with your HoYoLAB login · last 13 Oct, \d\d:\d\d$/)
  // Every sentence the ring shows (its accessible name): the demo's import reads one page of each wish type, a twentieth of a
  // second apart. The few words beside the ring follow them as "page 1 · 3 new".
  await line.evaluate((element) => {
    const shown: string[] = []
    ;(window as unknown as { importLines: string[] }).importLines = shown
    new MutationObserver(() => shown.push(element.getAttribute('aria-label') ?? '')).observe(element, {
      attributes: true,
      attributeFilter: ['aria-label'],
    })
  })
  const lines = () => page.evaluate(() => (window as unknown as { importLines: string[] }).importLines)
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(line).toHaveAttribute('aria-label', withLogin('Imported 3 new wishes.'))
  // On the way: the wish being read by the core's name for it, with its page and what is new so far. The lines that stay
  // up for a pause are the ones checked: the start comes with the first page, and the beginners' wish, read last, with
  // the end, so either may show for no time at all (pullsview.test.ts has their words).
  expect(await lines()).toEqual(
    expect.arrayContaining([
      'Importing the character event wish, page 1 · 3 new',
      'Importing the weapon event wish, page 1 · 3 new',
    ]),
  )
  expect((await lines()).filter((text) => /wish wish/.test(text))).toEqual([])
  // The three new wishes are kept, newest first: the history counts them.
  await expect(page.getByTestId('pulls-history')).toContainText('History · 448 pulls kept')
  await expect(page.getByTestId('history-row').first()).toContainText('13 Oct')
  // The same press reads the four history logs after the wishes (the ledger design, section 0), with the login, and is running
  // until they are read.
  await expect.poll(async () => (await api.get<Ledger>('/api/ledger')).import.ledger.state).toBe('done')
  // A second press finds nothing more.
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(line).toHaveAttribute('aria-label', withLogin('Nothing new. The history is up to date.'))
  await expect(page.getByTestId('pulls-history')).toContainText('History · 448 pulls kept')
  // The page read again, as Guild Board's window is opened again, keeps what this session's import ended with, and the
  // sentence it ended with.
  await page.reload()
  await expect(line).toHaveAttribute('aria-label', withLogin('Nothing new. The history is up to date.'))
})

test("the ring empties and the age grows as the demo's clock moves on, with no reload", async ({ page, api }) => {
  const { label, mark, arc } = ring(page, 'pulls-import')
  // The demo's import ran at its start, and the history updates itself every 30 minutes: the ring is full and the age is nil.
  const offset = async (): Promise<number> => Number((await arc.getAttribute('stroke-dashoffset')) ?? 100)
  await expect(label).toHaveText('just now')
  expect(await offset()).toBeLessThan(5)
  // The page's own clock follows the core's: 20 of the 30 minutes pass and a third of the ring is left, the age reads 20 min.
  await api.advance(20 * 60)
  await expect(label).toHaveText('20 min ago')
  await expect.poll(offset).toBeGreaterThan(60)
  await expect.poll(offset).toBeLessThan(72)
  await expect(mark).toHaveAttribute('aria-label', /^Updated automatically with your HoYoLAB login · last 13 Oct, \d\d:\d\d$/)
})

/** An instant as the import line says it, in this PC's own time: "07:52". */
function clock(instant: string): string {
  const at = new Date(instant)
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
}

/** "today" or "tomorrow" for an instant, against the day the demo starts on. */
const dayWord = (instant: string): string =>
  new Date(instant).toDateString() === new Date(DEMO_NOW).toDateString() ? 'today' : 'tomorrow'

test('the import line says how long Import updates itself, and when its link has expired', async ({ page }) => {
  // The model is routed, to give the page each state of the kept link: the demo's own keeps one only after a press (the
  // test of Import above), and not yet used, refused or run out at the moments the tests choose.
  const until = '2026-10-14T07:52:00+00:00' // a day after an import at 07:52, the demo's morning
  const tick = '2026-10-13T08:05:00+00:00'
  let keep: (block: Pulls['import']) => void = () => {}
  await changeAnswer<Pulls>(page, '/api/pulls', (data) => {
    // A player without the HoYoLAB login's updates, whose history updates itself only with the link a press keeps.
    Object.assign(data.import, { state: 'done', found: 41, auto: null, auto_stopped: null, login: null })
    keep(data.import)
  })
  const line = ring(page, 'pulls-import').mark
  const imported = 'Imported 41 new wishes.'
  const shows = async (text: string) => {
    await page.reload()
    await expect(line).toHaveAttribute('aria-label', text)
  }

  // No link kept: the import's own sentence, as it was.
  await shows(imported)
  // A link kept until a day after the import, not yet used.
  keep = (block) => Object.assign(block, { auto: { until, last_at: null } })
  await shows(`${imported} Updates itself until ${clock(until)} ${dayWord(until)}.`)
  // After an update, when it was, and that it will again.
  keep = (block) => Object.assign(block, { auto: { until, last_at: tick } })
  await shows(`${imported} Updated ${clock(tick)}, and again until ${clock(until)} ${dayWord(until)}.`)
  // HoYoverse refused the link: the update that met the refusal ended failed, with the block the core gives then
  // (tests/test_wish_import.py), and the line says what to do once, alone, in place of that update's own words.
  keep = (block) =>
    Object.assign(block, {
      state: 'failed',
      found: 0,
      message: 'Open Wish → History in the game, then press Import again.',
      auto: null,
      auto_stopped: 'expired',
    })
  await shows('The link from Wish → History has expired. Open it in the game, then press Import.')
  // A link whose day is past by the core's clock says nothing, whatever the model still holds.
  keep = (block) => Object.assign(block, { auto: { until: '2026-10-13T07:52:00+00:00', last_at: null } })
  await shows(imported)
})

test('the history updates itself with the HoYoLAB login, reading no file of the game', async ({ page, api }) => {
  // The demo's stand-in for the keys HoYoverse gives the login: the core's half-hourly update, asked for at once. It finds
  // the demo's three new wishes, and then reads the game's own history as well.
  const line = ring(page, 'pulls-import').mark
  await expect(line).toHaveAttribute('aria-label', /^Updated automatically with your HoYoLAB login · last /)
  await api.post('/api/demo/refresh')
  await expect(line).toHaveAttribute('aria-label', 'Imported 3 new wishes. Updates automatically with your HoYoLAB login.')
  await expect(page.getByTestId('pulls-history')).toContainText('History · 448 pulls kept')
  await expect.poll(async () => (await api.get<Ledger>('/api/ledger')).import.ledger.state).toBe('done')
  // Import stays; with the login a press reads with it first, and the ring says the history updates by itself.
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(line).toHaveAttribute('aria-label', withLogin('Nothing new. The history is up to date.'))
})

test('the import line says nothing of the kept link while an import runs, nor beside a refusal', async ({ page }) => {
  await changeAnswer<Pulls>(page, '/api/pulls', (data) => {
    Object.assign(data.import, {
      state: 'done', found: 41, auto: { until: '2026-10-14T07:52:00+00:00', last_at: null }, auto_stopped: null,
    })
  })
  await page.reload()
  const line = ring(page, 'pulls-import').mark
  await expect(line).toHaveAttribute('aria-label', /Updates itself until/)
  // A press the core refuses is said alone.
  await page.route('**/api/pulls/import', (route) => route.fulfill({ status: 409, json: { error: 'An import is running.' } }))
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(line).toHaveAttribute('aria-label', 'An import is running.')
  await page.unroute('**/api/pulls/import')
  // While one the press started is on its way, the line follows it and says nothing of the link.
  const { held, release } = holding()
  await page.route('**/api/pulls/import', async (route) => {
    await held
    await route.continue()
  })
  const button = page.getByRole('button', { name: /^Import/ })
  await button.click()
  await expect(button).toHaveText('Importing…')
  await expect(line).not.toHaveAttribute('aria-label', /Updates itself/)
  release()
  await expect(button).toHaveText('Import')
})

test('the import line says when the link last updated as soon as the core says the model changed', async ({ page, api }) => {
  // After every automatic update the core publishes pulls_changed (tests/test_wish_import.py holds it to that, an update
  // that finds nothing included), and the page reads the model again. Here the core's own event is a settings change that
  // changes nothing, and the model is routed to say what an update would have left in it.
  const until = '2026-10-14T07:52:00+00:00'
  const tick = '2026-10-13T08:05:00+00:00'
  let last: string | null = null
  await changeAnswer<Pulls>(page, '/api/pulls', (data) => {
    Object.assign(data.import, { state: 'done', found: 0, auto: { until, last_at: last }, auto_stopped: null })
  })
  await page.reload()
  const line = ring(page, 'pulls-import').mark
  const nothing = 'Nothing new. The history is up to date.'
  await expect(line).toHaveAttribute('aria-label', `${nothing} Updates itself until ${clock(until)} ${dayWord(until)}.`)
  last = tick
  await api.put('/api/pulls/settings', { corrections: {} })
  await expect(line).toHaveAttribute('aria-label', `${nothing} Updated ${clock(tick)}, and again until ${clock(until)} ${dayWord(until)}.`)
})

test('a correction turns at least into a number', async ({ page, api }) => {
  // A history that cannot tell the character event's pity: the card says what it knows, and not more.
  await changeAnswer<Pulls>(page, '/api/pulls', (data) => {
    Object.assign(data.pity.find((one) => one.pool === 'character')!, { known: false, pity: 40, guarantee: 'unknown' })
  })
  await page.reload()
  const character = card(page, 'character')
  await expect(character.locator('.ring')).toContainText('at least 40')
  await expect(character).toContainText('at most 34 to soft pity')
  await expect(character.locator('.seal')).toHaveText('Guarantee not known')
  await expect(character.locator('.seal')).toHaveClass(/quiet/)

  // The player says what the pity was before the day the history starts, which the form names (ruling R20): the
  // model's, 180 days before the demo's import, as every wish it kept is younger. The demo's clock runs from DEMO_NOW,
  // so an import at a slow start is a second or two after it.
  const [model] = (await api.get<Pulls>('/api/pulls')).pity
  const from = Date.parse(model.from!) - (Date.parse(DEMO_NOW) - 180 * DAY_MS)
  expect(from).toBeGreaterThanOrEqual(0)
  expect(from).toBeLessThan(10_000)
  await character.getByRole('button', { name: 'Set…' }).click()
  const pity = pityField(character, model)
  await expect(pity).toBeFocused()
  await pity.fill('21')
  await character.getByLabel('and the next 5★').selectOption('guaranteed')
  const sent = page.waitForRequest((request) => request.method() === 'PUT' && request.url().endsWith('/api/pulls/settings'))
  const reread = page.waitForResponse((response) => response.url().endsWith('/api/pulls') && response.request().method() === 'GET')
  await character.getByRole('button', { name: 'Save' }).click()
  expect((await sent).postDataJSON()).toEqual({ corrections: { character: { pity: 21, guaranteed: true } } })
  await expect(character.getByRole('button', { name: 'Set…' })).toBeFocused() // the form has closed
  await reread // the core told the page of the change, and it read the model again

  // A pity the wish cannot have is refused, and the core's sentence shows under the form.
  await character.getByRole('button', { name: 'Set…' }).click()
  await expect(pityField(character, model)).toHaveValue('21') // as the core keeps it
  await pityField(character, model).fill('90')
  await character.getByRole('button', { name: 'Save' }).click()
  await expect(character.getByRole('alert')).toHaveText('Give the pity as a whole number from 0 to 89.')
  await character.getByRole('button', { name: 'Cancel' }).click()
  await expect(character.getByRole('alert')).toHaveCount(0)

  // The weapon card's Fate Point, as the game shows it: the next 5★ is the charted weapon.
  const weapon = card(page, 'weapon')
  await weapon.getByRole('button', { name: 'Set…' }).click()
  await expect(weapon.getByLabel('Charted weapon')).toHaveValue('Azurelight')
  await expect(weapon.getByLabel('Charted weapon')).toHaveAttribute('maxlength', '80')
  const points = page.waitForRequest((request) => request.method() === 'PUT' && request.url().endsWith('/api/pulls/settings'))
  await weapon.getByLabel('Fate Points now').selectOption('1')
  await weapon.getByRole('button', { name: 'Save' }).click()
  expect((await points).postDataJSON()).toEqual({ points: { weapon: 1 } })
  await expect(weapon.locator('.seal')).toHaveText('Next 5★ is Azurelight')
  await expect(weapon).toContainText('Epitomized Path 1 of 1 · Azurelight')
  await expect(weapon).toHaveAttribute('aria-label', 'Weapon event: pity 23 of 80, next 5★ is Azurelight')
})

test('the chronicled card takes its path, and the standard card no guarantee', async ({ page, api }) => {
  const chronicled = card(page, 'chronicled')
  await chronicled.getByRole('button', { name: 'Set…' }).click()
  await expect(chronicled.getByLabel('Path', { exact: true })).toHaveAttribute('maxlength', '80')
  await expect(chronicled.getByLabel('Fate Points now')).toHaveValue('0')
  await chronicled.getByRole('button', { name: 'Cancel' }).click()
  const standard = card(page, 'standard')
  const model = (await api.get<Pulls>('/api/pulls')).pity.find((one) => one.pool === 'standard')!
  await standard.getByRole('button', { name: 'Set…' }).click()
  await expect(pityField(standard, model)).toBeVisible()
  await expect(standard.getByLabel('and the next 5★')).toHaveCount(0)
  await expect(standard.getByLabel('Fate Points now')).toHaveCount(0)
  await pityField(standard, model).press('Escape') // closes it, as Cancel does
  await expect(standard.getByRole('button', { name: 'Set…' })).toBeFocused()
})

test('the balance can be set and the forecast date picked', async ({ page }) => {
  const savings = page.getByTestId('pulls-savings')
  await savings.getByRole('button', { name: 'Set the balance' }).click()
  await savings.getByLabel('Primogems').fill('12000')
  await savings.getByLabel('Intertwined Fates').fill('3')
  const sent = page.waitForRequest((request) => request.method() === 'PUT' && request.url().endsWith('/api/pulls/balance'))
  await savings.getByRole('button', { name: 'Save' }).click()
  expect((await sent).postDataJSON()).toEqual({ primogems: 12000, fates: 3 })
  await expect(savings).toContainText('12,000 primogems and 3 Intertwined Fates')
  await expect(savings).toContainText('set today, estimated since')
  await expect(savings.getByRole('button', { name: 'Set the balance' })).toBeFocused() // the form has closed

  // A field left empty is sent as none, and the core says what it wants.
  await savings.getByRole('button', { name: 'Set the balance' }).click()
  await savings.getByLabel('Primogems').fill('100')
  await savings.getByRole('button', { name: 'Save' }).click()
  await expect(savings.getByRole('alert')).toHaveText('Give primogems and fates as whole numbers.')
  await savings.getByRole('button', { name: 'Cancel' }).click()

  // The forecast's day: the page reads the model to that day.
  const day = savings.getByLabel('Forecast day')
  await expect(day).toHaveValue('2026-10-24')
  await expect(day).toHaveAttribute('min', '2026-10-13')
  const read = page.waitForRequest((request) => request.url().includes('/api/pulls?by=2026-11-11'))
  await day.fill('2026-11-11')
  await read
  await expect(savings).toContainText(/By 11 Nov: about \d+/)
  await expect(day).toHaveValue('2026-11-11')
  // A day before today, which the field's own picker does not offer, is refused, and the core says why under it.
  await day.fill('2026-10-01')
  await expect(savings.getByRole('alert')).toHaveText('Choose today or a later day.')
  await day.fill('2026-11-11')
  await expect(savings.getByRole('alert')).toHaveCount(0)
})

test('the balance form shown before any balance hands the focus on once it is saved', async ({ page }) => {
  // The demo has a balance: the page is shown none until the form is sent.
  let hide = true
  await changeAnswer<Pulls>(page, '/api/pulls', (data) => {
    if (hide) Object.assign(data.savings, { set: null, pulls: null, estimated: null, by_next_end: null })
  })
  await page.reload()
  const savings = page.getByTestId('pulls-savings')
  await expect(savings).toContainText('Type your primogems and fates to see your savings as pulls.')
  await expect(savings.getByRole('button', { name: 'Cancel' })).toHaveCount(0) // nothing to go back to
  await savings.getByLabel('Primogems').fill('12000')
  await savings.getByLabel('Intertwined Fates').fill('3')
  hide = false
  await savings.getByRole('button', { name: 'Save' }).click()
  await expect(savings).toContainText('12,000 primogems and 3 Intertwined Fates')
  await expect(savings).toContainText('set today, estimated since')
  await expect(savings.getByRole('button', { name: 'Set the balance' })).toBeFocused()
})

test('the ledger shows the next version and its total', async ({ page, api }) => {
  const model = await api.get<Pulls>('/api/pulls')
  const { next } = model.savings
  const savings = page.getByTestId('pulls-savings')
  await expect(savings).toContainText('Version 7.2, 4 Nov to 16 Dec')
  await expect(savings).toContainText('everything 7.2 offers')
  // The seven sources, in the ledger's order, each with the model's amount.
  const rows = savings.getByTestId('ledger-row')
  await expect(rows).toHaveCount(7)
  await expect(rows).toContainText([
    'Daily commissions',
    'Events, estimated',
    'Spiral Abyss, Imaginarium Theater and Stygian Onslaught',
    'The update and its codes',
    'Quests and trials, estimated',
    'Blessing of the Welkin Moon',
    'Gnostic Hymn',
  ])
  expect(await rows.evaluateAll((all) => all.map((row) => row.getAttribute('data-key')))).toEqual(
    next.rows.map((row) => row.key),
  )
  const fates = (count: number) => `${count} ${count === 1 ? 'fate' : 'fates'}`
  expect(await savings.getByTestId('ledger-amount').allTextContents()).toEqual(
    next.rows.map((row) => (row.fates > 0 ? `${num(row.primogems)} and ${fates(row.fates)}` : num(row.primogems))),
  )
  await expect(savings.getByTestId('version-amount')).toHaveText(
    `about ${num(next.primogems)}${next.fates > 0 ? ` and ${fates(next.fates)}` : ''}`,
  )
  // The total by the version's end is the model's, with what the unfinished achievements would add under it, outside it.
  expect(model.savings.by_next_end).not.toBeNull()
  const total = savings.getByTestId('ledger-total')
  await expect(total).toContainText('By 16 Dec, when 7.2 ends')
  await expect(total).toContainText(`about ${num(model.savings.by_next_end!)} pulls`)
  expect(model.savings.achievements_pulls).toBeGreaterThan(0) // the demo has achievements left
  await expect(savings).toContainText(
    `and about ${num(model.savings.achievements_pulls)} more if you finish your remaining achievements`,
  )
  // The double rules stand between the balance and the version, and between the sources and the total.
  await expect(savings.locator('.pl-rule')).toHaveCount(2)
})

test('the ledger says the next version when the calendar cannot place it, and asks for no events count', async ({ page }) => {
  await changeAnswer<Pulls>(page, '/api/pulls', (data) => {
    data.savings.next.number = null
  })
  await page.reload()
  const savings = page.getByTestId('pulls-savings')
  await expect(savings).toContainText('The next version, 4 Nov to 16 Dec')
  await expect(savings).toContainText('everything it offers')
  await expect(savings.getByTestId('ledger-total')).toContainText('By 16 Dec, when the next version ends')
  // The count is kept per version, and there is no version to name.
  await expect(savings.getByRole('button', { name: 'Type the events count' })).toHaveCount(0)
})

test('the Gnostic Hymn switch adds its row and its fates to the total', async ({ page, api }) => {
  const before = await api.get<Pulls>('/api/pulls')
  expect(before.savings.owned.gnostic_hymn).toBe(false) // the demo's
  const savings = page.getByTestId('pulls-savings')
  const hymn = savings.getByRole('button', { name: 'Gnostic Hymn' })
  const row = savings.locator('[data-testid="ledger-row"][data-key="gnostic_hymn"]')
  const struck = () => row.getByTestId('ledger-amount').evaluate((amount) => getComputedStyle(amount).textDecorationLine)
  const total = savings.getByTestId('ledger-total')
  await expect(hymn).toHaveAttribute('aria-pressed', 'false')
  await expect(row).toHaveClass(/off/) // greyed, with its amount struck through: what it would add
  expect(await struck()).toBe('line-through')
  await expect(total).toContainText(`about ${num(before.savings.by_next_end!)} pulls`)

  const sent = page.waitForRequest(sendsSettings)
  await hymn.click()
  expect((await sent).postDataJSON()).toEqual({ gnostic_hymn: true })
  await expect(hymn).toHaveAttribute('aria-pressed', 'true')
  await expect(row).not.toHaveClass(/off/)
  expect(await struck()).toBe('none')
  const on = await api.get<Pulls>('/api/pulls')
  expect(on.savings.by_next_end!).toBeGreaterThan(before.savings.by_next_end!)
  await expect(total).toContainText(`about ${num(on.savings.by_next_end!)} pulls`)
  await expect(savings.getByTestId('version-amount')).toContainText(/ and \d+ fates?$/) // the version now brings fates

  // A second press takes it back.
  const again = page.waitForRequest(sendsSettings)
  await hymn.click()
  expect((await again).postDataJSON()).toEqual({ gnostic_hymn: false })
  await expect(hymn).toHaveAttribute('aria-pressed', 'false')
  await expect(total).toContainText(`about ${num(before.savings.by_next_end!)} pulls`)
})

test('the Welkin Moon switch is kept, and the page shows it again once read', async ({ page, api }) => {
  const before = await api.get<Pulls>('/api/pulls')
  const savings = page.getByTestId('pulls-savings')
  const welkin = savings.getByRole('button', { name: 'Blessing of the Welkin Moon' })
  const pressed = String(before.savings.owned.welkin)
  await expect(welkin).toHaveAttribute('aria-pressed', pressed)
  const sent = page.waitForRequest(sendsSettings)
  await welkin.click()
  expect((await sent).postDataJSON()).toEqual({ welkin: !before.savings.owned.welkin })
  await expect(welkin).toHaveAttribute('aria-pressed', String(!before.savings.owned.welkin))
  // Kept per game uid by the core: a page opened again shows it.
  await page.reload()
  await expect(welkin).toHaveAttribute('aria-pressed', String(!before.savings.owned.welkin))
  expect((await api.get<Pulls>('/api/pulls')).savings.owned.welkin).toBe(!before.savings.owned.welkin)
})

test('a typed events count replaces the estimate, and the estimate comes back', async ({ page, api }) => {
  const before = await api.get<Pulls>('/api/pulls')
  const events = before.savings.next.rows.find((row) => row.key === 'events')!
  expect(events.estimated).toBe(true) // the demo has typed nothing for the next version
  const savings = page.getByTestId('pulls-savings')
  const row = savings.locator('[data-testid="ledger-row"][data-key="events"]')
  const amount = row.getByTestId('ledger-amount')
  const total = savings.getByTestId('ledger-total')
  const field = savings.getByLabel('Events, as the community counts them')
  await expect(row).toContainText('Events, estimated')
  await expect(amount).toHaveText(num(events.primogems))

  // Escape closes the form, as Cancel does, and hands the focus back.
  await row.getByRole('button', { name: 'Type the events count' }).click()
  await expect(field).toBeFocused()
  await expect(savings.getByRole('button', { name: 'Use the estimate' })).toHaveCount(0) // none typed yet
  await field.press('Escape')
  await expect(field).toHaveCount(0)
  await expect(row.getByRole('button', { name: 'Type the events count' })).toBeFocused()

  // What is not a whole number of primogems from 0 to 100,000 is said, and nothing is sent.
  await row.getByRole('button', { name: 'Type the events count' }).click()
  const sent: string[] = []
  page.on('request', (request) => {
    if (sendsSettings(request)) sent.push(request.postData() ?? '')
  })
  for (const text of ['12.5', '', '-5', '100001']) {
    await field.fill(text)
    await savings.getByRole('button', { name: 'Save' }).click()
    await expect(savings.getByRole('alert').filter({ hasText: 'Type a whole number of primogems.' })).toBeVisible()
  }
  expect(sent).toEqual([])

  // A count replaces the estimate: the row says "Events", the amount is the count, and the total follows.
  const count = events.primogems + 1_000
  await field.fill(String(count))
  const typed = page.waitForRequest(sendsSettings)
  await savings.getByRole('button', { name: 'Save' }).click()
  expect((await typed).postDataJSON()).toEqual({ events_typed: { version: '7.2', primogems: count } })
  await expect(row).not.toContainText('estimated')
  await expect(row.getByTestId('ledger-name')).toContainText('Events')
  await expect(amount).toHaveText(num(count))
  await expect(row.getByRole('button', { name: 'Change' })).toBeFocused() // the form has closed
  const replaced = await api.get<Pulls>('/api/pulls')
  expect(replaced.savings.next.events_typed).toBe(count)
  expect(replaced.savings.by_next_end!).toBeGreaterThan(before.savings.by_next_end!)
  await expect(total).toContainText(`about ${num(replaced.savings.by_next_end!)} pulls`)

  // The estimate comes back.
  await row.getByRole('button', { name: 'Change' }).click()
  await expect(field).toHaveValue(String(count))
  const cleared = page.waitForRequest(sendsSettings)
  await savings.getByRole('button', { name: 'Use the estimate' }).click()
  expect((await cleared).postDataJSON()).toEqual({ events_typed: { version: '7.2', primogems: null } })
  await expect(row).toContainText('Events, estimated')
  await expect(amount).toHaveText(num(events.primogems))
  await expect(row.getByRole('button', { name: 'Type the events count' })).toBeFocused()
  await expect(total).toContainText(`about ${num(before.savings.by_next_end!)} pulls`)
})

test("the primogem picture is the game's, and the switches' pictures are the sign where the repository has none", async ({ page }) => {
  const savings = page.getByTestId('pulls-savings')
  // The game's own picture of the core's icon cache; the demo downloads none, so there its sign stands in.
  await expect(savings.getByTestId('ledger-hero').locator('img')).toHaveAttribute('src', '/api/icon/static.primogem')
  await expect(savings.getByTestId('ledger-hero').locator('svg.sign')).toBeVisible()
  // The Welkin Moon and the Gnostic Hymn ship no picture: each shows its drawn sign, and loads nothing.
  for (const name of ['Blessing of the Welkin Moon', 'Gnostic Hymn']) {
    const button = savings.getByRole('button', { name })
    await expect(button.locator('svg.sign')).toBeVisible()
    await expect(button.locator('img')).toBeHidden()
  }
})

test("with no balance set, the ledger shows the next version's rows and the balance form, and no total", async ({ page }) => {
  await changeAnswer<Pulls>(page, '/api/pulls', (data) => {
    Object.assign(data.savings, { set: null, pulls: null, estimated: null, by_next_end: null })
  })
  await page.reload()
  const savings = page.getByTestId('pulls-savings')
  await expect(savings).toContainText('Type your primogems and fates to see your savings as pulls.')
  await expect(savings.getByLabel('Primogems')).toBeVisible()
  await expect(savings.getByLabel('Intertwined Fates')).toBeVisible()
  // The version is there all the same, with its seven sources and its switches, but no total of the balance's.
  await expect(savings).toContainText('Version 7.2, 4 Nov to 16 Dec')
  await expect(savings.getByTestId('ledger-row')).toHaveCount(7)
  await expect(savings.getByRole('button', { name: 'Blessing of the Welkin Moon' })).toBeVisible()
  await expect(savings.getByTestId('ledger-total')).toHaveCount(0)
  await expect(savings.getByTestId('ledger-hero')).toHaveCount(0)
  await expect(savings).not.toContainText('By 16 Dec')
  await expect(savings).not.toContainText('more if you finish your remaining achievements')
})

test('the luck tiles and the months show the history', async ({ page, api }) => {
  const { history } = await api.get<Pulls>('/api/pulls')
  const tiles = page.getByTestId('luck-tiles')
  // Three tiles, stacked, in this order.
  const groups = tiles.getByRole('group')
  await expect(groups).toHaveCount(3)
  expect(await groups.evaluateAll((all) => all.map((one) => one.getAttribute('aria-label')))).toEqual([
    'Average 5★ pity, character event', '50/50s won', 'Wishes kept',
  ])
  const tops = await groups.evaluateAll((all) => all.map((one) => Math.round(one.getBoundingClientRect().top)))
  expect(tops).toEqual([...tops].sort((a, b) => a - b))
  expect(new Set(tops).size).toBe(3)

  // The average 5★ pity of the character event, against a typical player's, and the share of players it beats.
  expect(history.average_pity).not.toBeNull()
  const average = tiles.getByTestId('luck-average')
  await expect(average.getByTestId('tile-value')).toHaveText(num(history.average_pity!))
  const beaten = history.luckier_than === null ? '' : ` Luckier than ${Math.floor(history.luckier_than * 100 + 1e-9)}% of players.`
  await expect(average.getByTestId('tile-note')).toHaveText(
    `A typical player: about ${num(history.typical_average)}. Lower is luckier.${beaten}`,
  )

  // The 50/50s won of those won and lost, in a thin bar of the two.
  const fifty = tiles.getByTestId('luck-fifty')
  await expect(fifty.getByTestId('tile-value')).toHaveText(`${history.won} of ${history.won + history.lost}`)
  await expect(fifty.getByTestId('tile-note')).toHaveText('With Capturing Radiance a typical player wins about 55%.')
  const bar = async (part: string) => (await fifty.locator(`.pl-split .${part}`).boundingBox())!.width
  const [won, lost] = [await bar('won'), await bar('lost')]
  expect(won / (won + lost)).toBeCloseTo(history.won / (history.won + history.lost), 1)

  // The wishes kept, and how many are 5★.
  const kept = tiles.getByTestId('luck-kept')
  await expect(kept.getByTestId('tile-value')).toHaveText(num(history.count))
  await expect(kept.getByTestId('tile-note')).toHaveText(
    `${num(history.fives)} of them 5★, one in every ${num(history.count / history.fives)} wishes.`,
  )

  // Wishes each month: the legend over the graph names the wishes in the order the columns stack them.
  const months = page.getByTestId('pulls-months')
  await expect(months.getByRole('heading', { name: 'Wishes each month' })).toBeVisible()
  const names = ['Character event', 'Weapon event', 'Standard']
  if (history.months.some((month) => month.chronicled > 0)) names.push('Chronicled')
  await expect(months.getByTestId('months-legend').locator('span')).toHaveText(names)

  // Every month from the oldest kept wish to this month has its place on the axis, oldest first; this month is the last.
  expect(history.months.length).toBeGreaterThan(1)
  const last = history.months[history.months.length - 1]
  expect(last.month).toBe('2026-10') // the demo's month
  const labels = months.getByTestId('months-label')
  await expect(labels.last()).toHaveText('Oct')
  await expect(labels.first()).toHaveText(new RegExp(`^${MONTH_NAMES[Number(history.months[0].month.slice(5, 7)) - 1].slice(0, 3)}`))

  // A column for each month that has wishes, each at most 24 pixels wide, a segment for each wish in it, in the palette.
  const segments = months.locator('path.pl-seg')
  const have = history.months.flatMap((month) => names.map((_, at) => month[WISH_KEYS[at]]).filter((count) => count > 0))
  await expect(segments).toHaveCount(have.length)
  await expect(months.getByTestId('months-hit')).toHaveCount(have.length)
  const widths = await segments.evaluateAll((all) => all.map((one) => one.getBoundingClientRect().width))
  expect(Math.max(...widths)).toBeLessThanOrEqual(24)
  const fill = (key: string) =>
    months.locator(`path.pl-seg.${key}`).first().evaluate((one) => getComputedStyle(one).fill)
  expect(await fill('character')).toBe('rgb(166, 117, 31)') // #A6751F
  expect(await fill('weapon')).toBe('rgb(68, 112, 180)') // #4470B4
  expect(await fill('standard')).toBe('rgb(181, 84, 106)') // #B5546A

  // The busiest month carries its total over its column, and no other does.
  const busiest = history.months.reduce((most, month) => (monthTotal(month) > monthTotal(most) ? month : most))
  await expect(months.getByTestId('months-peak')).toHaveCount(1)
  await expect(months.getByTestId('months-peak')).toHaveText(num(monthTotal(busiest)))

  // The busiest month's column, once the columns have grown: its wishes stack from the foot up with 2 pixels between them,
  // and only the top is rounded.
  await expect.poll(() => page.evaluate(() => document.getAnimations().length)).toBe(0)
  const inColumn = WISH_KEYS.filter((key) => busiest[key] > 0)
  expect(inColumn.length).toBeGreaterThan(1)
  const marks = inColumn.map((key) => months.locator(`path.pl-seg[data-month="${busiest.month}"][data-wish="${key}"]`))
  const boxes = await Promise.all(marks.map((mark) => mark.boundingBox()))
  for (let at = 1; at < boxes.length; at += 1) {
    expect(boxes[at - 1]!.y - (boxes[at]!.y + boxes[at]!.height)).toBeCloseTo(2, 1)
  }
  const arcs = await Promise.all(marks.map(async (mark) => ((await mark.getAttribute('d')) ?? '').includes('a')))
  expect(arcs).toEqual(inColumn.map((_, at) => at === inColumn.length - 1))
  await expect(months.getByTestId('months-hit').and(page.locator(`[data-month="${busiest.month}"]`))).toHaveCount(inColumn.length)

  // Hover a segment: its month, its wish with the wishes of it, and the month's total.
  const tip = months.getByTestId('months-tip')
  await expect(tip).toHaveCount(0)
  await months.locator(`[data-testid="months-hit"][data-month="${busiest.month}"][data-wish="character"]`).hover()
  await expect(tip).toContainText(monthTitle(busiest.month))
  await expect(tip).toContainText(`Character event: ${num(busiest.character)}`)
  await expect(tip).toContainText(`All banners: ${num(monthTotal(busiest))}`)
  await page.mouse.move(0, 0)
  await expect(tip).toHaveCount(0)
})

test('the months graph answers the keyboard with one tab stop, and says the same as the pointer', async ({ page, api }) => {
  const { history } = await api.get<Pulls>('/api/pulls')
  const months = page.getByTestId('pulls-months')
  const hits = months.getByTestId('months-hit')
  // One tab stop for every segment of the graph.
  await expect(months.locator('[data-testid="months-hit"][tabindex="0"]')).toHaveCount(1)
  const first = hits.first()
  const tip = months.getByTestId('months-tip')
  await first.focus()
  await expect(tip).toBeVisible()
  const oldest = history.months.find((month) => monthTotal(month) > 0)!
  await expect(tip).toContainText(monthTitle(oldest.month))
  await expect(tip).toContainText(`All banners: ${num(monthTotal(oldest))}`)
  // The arrow keys move along the segments, and the tooltip follows.
  const before = await tip.textContent()
  await first.press('ArrowRight')
  await expect(hits.nth(1)).toBeFocused()
  await expect(tip).toBeVisible()
  expect(await tip.textContent()).not.toBe(before)
  await hits.nth(1).press('Home')
  await expect(first).toBeFocused()
  await hits.first().press('End')
  await expect(hits.last()).toBeFocused()
  // Each segment is named for a screen reader as the tooltip says it.
  await expect(first).toHaveAttribute('aria-label', new RegExp(`^${monthTitle(oldest.month)}, .+: \\d+, all banners: [\\d,]+$`))
  // Leaving the graph closes the tooltip.
  await page.keyboard.press('Tab') // from the last segment on
  await expect(tip).toHaveCount(0)
})

test('the months graph has a table view', async ({ page, api }) => {
  const { history } = await api.get<Pulls>('/api/pulls')
  const months = page.getByTestId('pulls-months')
  const toggle = months.getByRole('button', { name: 'Show as a table' })
  await expect(months.getByTestId('months-plot')).toBeVisible()
  await toggle.click()
  // The same numbers: a row for each month, a column for each wish shown, and one for all of them.
  const heads = ['Month', 'Character event', 'Weapon event', 'Standard']
  if (history.months.some((month) => month.chronicled > 0)) heads.push('Chronicled')
  heads.push('All')
  const table = months.getByTestId('months-table').getByRole('table')
  await expect(table.getByRole('columnheader')).toHaveText(heads)
  await expect(months.getByRole('button', { name: 'Show as a graph' })).toBeVisible()
  await expect(months.getByRole('button', { name: 'Show as a table' })).toHaveCount(0)
  await expect(months.getByTestId('months-plot')).toHaveCount(0)
  const rows = table.locator('tbody tr')
  await expect(rows).toHaveCount(history.months.length)
  const cells = await rows.evaluateAll((all) => all.map((row) => [...row.children].map((cell) => cell.textContent)))
  const keys = WISH_KEYS.slice(0, heads.length - 2)
  expect(cells).toEqual(
    history.months.map((month) => [monthTitle(month.month), ...keys.map((key) => num(month[key])), num(monthTotal(month))]),
  )
  // The rows share the room the graph had: no band of nothing lies under the last one, and none between two rows (each row
  // is as tall as the room allows, and no row is a band of its own beside the others).
  const room = await months.getByTestId('months-table').evaluate((box) => {
    const table = box.querySelector('table')!.getBoundingClientRect()
    const heights = [...box.querySelectorAll('tbody tr')].map((row) => row.getBoundingClientRect().height)
    return { box: box.getBoundingClientRect().bottom, table: table.bottom, heights }
  })
  expect(room.table).toBeGreaterThanOrEqual(room.box - 2)
  expect(Math.max(...room.heights) - Math.min(...room.heights)).toBeLessThanOrEqual(2)
  // The table stays inside the box, whose height does not change with the view.
  const tall = (await months.boundingBox())!.height
  await months.getByRole('button', { name: 'Show as a graph' }).click()
  await expect(months.getByTestId('months-plot')).toBeVisible()
  await expect(months.getByRole('button', { name: 'Show as a table' })).toBeVisible()
  expect((await months.boundingBox())!.height).toBeCloseTo(tall, 0)
})

test('the chronicled wish has its colour and its column only where its wishes are kept', async ({ page }) => {
  const route = async (chronicled: number) => {
    await page.unroute('**/api/pulls*')
    await changeAnswer<Pulls>(page, '/api/pulls', (data) => {
      for (const month of data.history.months) month.chronicled = 0
      data.history.months[data.history.months.length - 2].chronicled = chronicled
    })
    await page.reload()
  }
  const months = page.getByTestId('pulls-months')
  const legend = months.getByTestId('months-legend').locator('span')
  await route(0)
  await expect(legend).toHaveText(['Character event', 'Weapon event', 'Standard'])
  await expect(months.locator('path.pl-seg.chronicled')).toHaveCount(0)
  await route(4)
  await expect(legend).toHaveText(['Character event', 'Weapon event', 'Standard', 'Chronicled'])
  const chronicled = months.locator('path.pl-seg.chronicled')
  await expect(chronicled).toHaveCount(1)
  expect(await chronicled.evaluate((one) => getComputedStyle(one).fill)).toBe('rgb(106, 79, 184)') // #6A4FB8
  await months.getByRole('button', { name: 'Show as a table' }).click()
  await expect(months.getByTestId('months-table').getByRole('columnheader')).toHaveText([
    'Month', 'Character event', 'Weapon event', 'Standard', 'Chronicled', 'All',
  ])
})

test('a history with nothing to show yet says so in its tiles and its graph', async ({ page }) => {
  await changeAnswer<Pulls>(page, '/api/pulls', (data) => {
    Object.assign(data.history, { fives: 0, average_pity: null, luckier_than: null, won: 0, lost: 0 })
    for (const month of data.history.months) Object.assign(month, { character: 0, weapon: 0, standard: 0, chronicled: 0 })
  })
  await page.reload()
  const tiles = page.getByTestId('luck-tiles')
  await expect(tiles.getByTestId('luck-average').getByTestId('tile-note')).toHaveText(
    'No character-event 5★ with a known pity yet.',
  )
  await expect(tiles.getByTestId('luck-average').getByTestId('tile-value')).toHaveCount(0)
  await expect(tiles.getByTestId('luck-fifty').getByTestId('tile-note')).toHaveText('No 50/50 yet.')
  await expect(tiles.getByTestId('luck-fifty').getByTestId('tile-value')).toHaveCount(0)
  await expect(tiles.getByTestId('luck-kept').getByTestId('tile-note')).toHaveText('No 5★ yet.')
  await expect(tiles.getByTestId('luck-kept').getByTestId('tile-value')).toHaveText('445') // the wishes are still kept
  const months = page.getByTestId('pulls-months')
  await expect(months).toContainText('No wishes kept yet.')
  await expect(months.getByRole('button', { name: 'Show as a table' })).toHaveCount(0)
})

/** The bottoms of the two boxes of each pair on the Pulls page: the ledger and the planner, the tiles and the graph. */
function bottoms(page: Page): Promise<Record<'ledger' | 'planner' | 'tiles' | 'months', number>> {
  return page.evaluate(() => {
    const bottom = (id: string) => document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect().bottom
    return {
      ledger: bottom('pulls-savings'), planner: bottom('pulls-planner'), tiles: bottom('luck-tiles'), months: bottom('pulls-months'),
    }
  })
}

/** Leaves the wishlist with this many entries: Citlali, the demo's one, goes first, and others are added. */
async function wishlistOf(page: Page, api: Api, count: number): Promise<void> {
  const origin = new URL(page.url()).origin
  const current = await (await page.request.get(`${origin}/api/pulls`)).json()
  for (const entry of (current as Pulls).wishlist) await page.request.delete(`${origin}/api/pulls/wishlist/${entry.id}`)
  const names = ['Mavuika', 'Furina', 'Navia', 'Xiangling', 'Clorinde', 'Arlecchino', 'Kinich', 'Chasca', 'Mualani', 'Xilonen']
  for (const name of names.slice(0, count)) {
    await api.post('/api/pulls/wishlist', { name, kind: 'character', about: '2026-12-05', copies: 1 })
  }
}

/**
 * The planner's parts, top to bottom, as what each shows: its heading, its groups' headings, the words of each row (its
 * face, its name, its verdict and its Remove), the dashed place that takes the spare room, and its foot; the gaps between
 * them, in pixels; and the height of its tallest row, which counts its room round its words.
 */
function plannerGaps(page: Page): Promise<{ gaps: number[]; row: number }> {
  return page.evaluate(() => {
    const planner = document.querySelector('[data-testid="pulls-planner"]')!
    const words = (element: Element) => {
      const range = document.createRange()
      range.selectNodeContents(element)
      const box = range.getBoundingClientRect()
      return { top: box.top, bottom: box.bottom }
    }
    const rows = [...planner.querySelectorAll('li')]
    const parts = [
      words(planner.querySelector('h2')!),
      ...[...planner.querySelectorAll('.pl-group')].map(words),
      ...rows.map((row) => {
        const boxes = [...row.children].map((child) => child.getBoundingClientRect())
        return { top: Math.min(...boxes.map((box) => box.top)), bottom: Math.max(...boxes.map((box) => box.bottom)) }
      }),
      planner.querySelector('.pl-filler')!.getBoundingClientRect(),
      planner.querySelector('[data-testid="wishes-foot"]')!.getBoundingClientRect(),
    ].sort((a, b) => a.top - b.top)
    return {
      gaps: parts.slice(1).map((part, at) => Math.round(part.top - parts[at].bottom)),
      row: Math.max(56, ...rows.map((row) => row.getBoundingClientRect().height)),
    }
  })
}

test.describe('no blank space', () => {
  /**
   * The pairs end level: the bottoms of the two boxes of each are within 1 pixel. Inside the planner, no band of nothing
   * lies between its parts: no gap between the words of one part and the next is taller than a row.
   */
  async function expectLevel(page: Page, entries: number, gaps = true): Promise<void> {
    await expect(page.getByTestId('pulls-wishlist').getByRole('listitem')).toHaveCount(entries)
    await expect(page.getByTestId('history-row')).toHaveCount(100)
    await expect.poll(() => page.evaluate(() => document.getAnimations().length)).toBe(0) // the page has settled
    const level = await bottoms(page)
    expect(Math.abs(level.ledger - level.planner), `ledger ${level.ledger}, planner ${level.planner}`).toBeLessThanOrEqual(1)
    expect(Math.abs(level.tiles - level.months), `tiles ${level.tiles}, graph ${level.months}`).toBeLessThanOrEqual(1)
    if (!gaps) return // entries that outgrow the card scroll in it, some out of sight: they have no gaps to measure
    const measured = await plannerGaps(page)
    expect(Math.max(...measured.gaps), `the planner's gaps ${measured.gaps}, its tallest row ${measured.row}`).toBeLessThanOrEqual(
      measured.row,
    )
    expect(Math.min(...measured.gaps), `the planner's gaps ${measured.gaps}`).toBeGreaterThanOrEqual(0)
  }

  test('the ledger and the planner end level, and so do the tiles and the graph, in the usual window', async ({ page, api }) => {
    await page.setViewportSize({ width: 1640, height: 1100 })
    for (const entries of [0, 1, 6]) {
      await wishlistOf(page, api, entries)
      await page.reload()
      await expectLevel(page, entries)
    }
  })

  test("with no banner running, the wishlist takes the planner's room, and the pairs still end level", async ({ page }) => {
    await changeAnswer<Pulls>(page, '/api/pulls', (data) => {
      data.planner = []
    })
    await page.setViewportSize({ width: 1640, height: 1100 })
    await page.reload()
    await expectLevel(page, 1)
  })

  test("and full screen on the player's 2,560-pixel display, as the window's zoom shows it", async ({ browser, core, api }) => {
    // A browser of its own at 1,640 × 897 and 2,560 / 1,640 device pixels to a pixel, as the scaling pass's pictures take it.
    const context = await browser.newContext({ viewport: { width: 1640, height: 897 }, deviceScaleFactor: 2560 / 1640 })
    try {
      await context.request.get(core.launch, { maxRedirects: 0 })
      const zoomed = await context.newPage()
      await zoomed.goto(`${core.origin}/#/pulls`)
      for (const entries of [0, 1, 6]) {
        await wishlistOf(zoomed, api, entries)
        await zoomed.reload()
        await expectLevel(zoomed, entries)
      }
    } finally {
      await context.close()
    }
  })

  test('a wishlist longer than the card holds scrolls in it, with the fade, and Add a wish keeps the foot', async ({ page, api }) => {
    await page.setViewportSize({ width: 1640, height: 1100 })
    await wishlistOf(page, api, 10)
    for (const name of ['Dehya', 'Alhaitham', 'Cyno']) {
      await api.post('/api/pulls/wishlist', { name, kind: 'character', about: '2026-12-05', copies: 1 })
    }
    await page.reload()
    await expectLevel(page, 13, false)
    const scroll = page.getByTestId('wishes-scroll')
    // Taller than its room: it scrolls, in the widgets' way, its foot fading out.
    const shown = await scroll.evaluate((element) => ({
      held: element.scrollHeight > element.clientHeight,
      mask: getComputedStyle(element).maskImage,
      overflow: getComputedStyle(element).overflowY,
      scrollbar: getComputedStyle(element).scrollbarWidth,
    }))
    expect(shown.held).toBe(true)
    expect(shown.overflow).toBe('auto')
    expect(shown.scrollbar).toBe('none')
    expect(shown.mask).toContain('linear-gradient')
    await expect(scroll).toHaveClass(/w-scroll/)
    // The foot, with Add a wish, stays at the card's foot, whole, however many entries there are.
    const form = page.getByTestId('wishes-foot')
    const planner = (await page.getByTestId('pulls-planner').boundingBox())!
    const at = (await form.boundingBox())!
    expect(planner.y + planner.height - (at.y + at.height)).toBeGreaterThanOrEqual(0)
    expect(planner.y + planner.height - (at.y + at.height)).toBeLessThanOrEqual(40)
    // Scrolled to its end, the last entry lies inside it, above the strip that fades.
    await scroll.evaluate((element) => element.scrollTo(0, element.scrollHeight))
    const last = await page.getByTestId('pulls-wishlist').getByRole('listitem').last().boundingBox()
    const room = (await scroll.boundingBox())!
    expect(last!.y + last!.height).toBeLessThanOrEqual(room.y + room.height - 11)
  })
})

test('the wishlist adds from the faces, chains and removes', async ({ page }) => {
  const planner = page.getByTestId('pulls-planner')
  const wishlist = page.getByTestId('pulls-wishlist')
  const wishes = wishlist.getByRole('listitem')
  await expect(wishes).toHaveCount(1)
  await planner.getByRole('button', { name: '+ Add a wish' }).click()
  const picker = page.getByTestId('wish-picker')
  await expect(picker.getByRole('searchbox', { name: 'Search by name' })).toBeFocused()
  // The groups in their order: the ones coming soon, those on the banners now with their banner's end, then every 5★ and 4★.
  await expect(picker.getByRole('region')).toHaveText([/^Coming soon/, /^On the banners now/, /^Every 5★/, /^Every 4★/])
  await expect(picker.getByRole('region', { name: 'Coming soon' })).toContainText('Danicanot out yet')
  await expect(picker.getByRole('region', { name: 'On the banners now' })).toContainText('Skirkuntil 24 Oct')
  // A face on a banner now takes the banner's end as its day.
  await picker.getByRole('button', { name: /^Skirk/ }).click()
  await expect(picker.getByLabel('About when')).toHaveValue('2026-10-24')
  // The search finds a name; another pick takes no day of its own.
  await picker.getByRole('searchbox', { name: 'Search by name' }).fill('mavu')
  await expect(picker.getByRole('button', { name: /^Mavuika/ })).toHaveCount(1)
  await picker.getByRole('button', { name: /^Mavuika/ }).click()
  await expect(picker.getByLabel('About when')).toHaveValue('')
  // A refused entry says why: no day yet.
  await picker.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(picker.getByRole('alert')).toHaveText(
    'Give a name, a kind (character or weapon), a day as 2026-11-11, and copies from 1 to 7.',
  )
  await picker.getByLabel('About when').fill('2026-12-05')
  await picker.getByRole('button', { name: 'One copy more' }).click()
  await expect(picker.getByRole('group', { name: 'Copies' }).locator('output')).toHaveText('2')
  const sent = page.waitForRequest((request) => request.method() === 'POST' && request.url().endsWith('/api/pulls/wishlist'))
  await picker.getByRole('button', { name: 'Add', exact: true }).click()
  expect((await sent).postDataJSON()).toEqual({ name: 'Mavuika', kind: 'character', about: '2026-12-05', copies: 2 })
  // Back on the planner, the focus on Add a wish. Mavuika comes after Citlali, who takes the card's guarantee.
  await expect(planner.getByRole('button', { name: '+ Add a wish' })).toBeFocused()
  await expect(wishes).toHaveCount(2)
  await expect(wishes.nth(0)).toContainText('Citlaliabout 11 NovCertainat most 29 pulls')
  await expect(wishes.nth(1)).toContainText(/Mavuikaabout 5 Dec · 2 copies(Likely|Maybe|Unlikely) · \d{1,2}%for all 2/)
  // A name the lists lack is added as typed; Escape goes back without adding.
  await planner.getByRole('button', { name: '+ Add a wish' }).click()
  await picker.getByRole('searchbox', { name: 'Search by name' }).fill('Someone New')
  await picker.getByRole('button', { name: 'Add “Someone New” as typed' }).click()
  await expect(picker.getByText('Someone New', { exact: true })).toBeVisible()
  await picker.getByLabel('About when').press('Escape')
  await expect(planner.getByRole('button', { name: '+ Add a wish' })).toBeFocused()
  await expect(wishes).toHaveCount(2)
  // Remove hands the focus to the next entry's Remove, and after the last to Add a wish.
  await wishes.nth(0).getByRole('button', { name: 'Remove Citlali' }).click()
  await expect(wishes).toHaveCount(1)
  await expect(wishes.first().getByRole('button', { name: 'Remove Mavuika' })).toBeFocused()
  await wishes.first().getByRole('button', { name: 'Remove Mavuika' }).click()
  await expect(wishlist).toContainText('Add the characters you are saving for, with a rough date.')
  await expect(planner.getByRole('button', { name: '+ Add a wish' })).toBeFocused()
})

test('a planner entry shows the icon the model gives it', async ({ page }) => {
  // The model names the icon of the 5★ each entry is for; nothing else on the page has Skirk's.
  await changeAnswer<Pulls>(page, '/api/pulls', (data) => {
    data.planner[0].icon = '/api/icon/wish.character.skirk'
  })
  await page.reload()
  const plans = page.getByTestId('pulls-planner').getByTestId('plan')
  await expect(plans.nth(0).locator('img')).toHaveAttribute('src', '/api/icon/wish.character.skirk')
  await expect(plans.nth(1).locator('img')).not.toHaveAttribute('src') // Escoffier's entry has none
})

test('a row without an icon shows the sign', async ({ page }) => {
  const rows = page.getByTestId('history-row')
  await expect(rows).toHaveCount(100)
  // The demo's wiki has no icons: every row shows its sign, and no image.
  const shown = await rows.evaluateAll((all) =>
    all.map((row) => {
      const image = row.querySelector('img')
      const sign = row.querySelector('svg.sign')
      return image !== null && image.hidden && sign !== null && getComputedStyle(sign).visibility === 'visible'
    }),
  )
  expect(shown.filter((one) => !one)).toEqual([])
  // 4★ rows and 3★ rows are told apart, and a 4★ gives its count.
  const four = rows.and(page.locator('[data-rank="4"]')).first()
  await expect(four).toContainText(/pity \d+/)
})

test('Show more appends older rows', async ({ page }) => {
  const rows = page.getByTestId('history-row')
  await expect(rows).toHaveCount(100)
  const read = page.waitForRequest((request) => request.url().includes('/api/pulls/history?before=1700000000000000346'))
  await page.getByRole('button', { name: 'Show more' }).click()
  await read
  await expect(rows).toHaveCount(300)
  // Newest first, the older ones after: every row is older than the one above it.
  const times = await rows.locator('time').evaluateAll((all) => all.map((one) => Date.parse(one.getAttribute('datetime')!)))
  expect(times.every((time, index) => index === 0 || time <= times[index - 1])).toBe(true)
  // Among them the 5★ rows: Qiqi's lost 50/50, with its pity, in gold.
  const qiqi = rows.filter({ hasText: 'Qiqi' })
  await expect(qiqi).toHaveAttribute('data-rank', '5')
  await expect(qiqi).toContainText('pity 81')
  await expect(qiqi).toContainText('lost the 50/50')
  // 445 kept: 145 are left, and the next read ends the list. Show more goes with it, and the last row takes the focus.
  await page.getByRole('button', { name: 'Show more' }).click()
  await expect(rows).toHaveCount(445)
  await expect(page.getByRole('button', { name: 'Show more' })).toHaveCount(0)
  await expect(rows.last()).toBeFocused()
})

test("a 5★ is said to have fallen in its own wish's words", async ({ page }) => {
  await changeAnswer<Pulls>(page, '/api/pulls', (data) => {
    const [first, second, third] = data.history.rows
    Object.assign(first, { name: 'Azurelight', kind: 'weapon', rank: 5, pool: 'weapon', pool_label: 'Weapon event', pity: 40, result: 'won' })
    Object.assign(second, { name: 'Shenhe', kind: 'character', rank: 5, pool: 'chronicled', pool_label: 'Chronicled', pity: 70, result: 'path' })
    Object.assign(third, { name: 'Diluc', kind: 'character', rank: 5, pool: 'standard', pool_label: 'Standard', pity: 75, result: null })
  })
  await page.reload()
  const rows = page.getByTestId('history-row')
  await expect(rows.nth(0)).toContainText('won the 75/25')
  await expect(rows.nth(1)).toContainText('the chosen path')
  await expect(rows.nth(2)).toContainText('pity 75')
  await expect(rows.nth(2).locator('td').nth(2)).toHaveText('') // the standard wish features nothing
})

test('the Import button reads Importing… and rests while an import runs', async ({ page }) => {
  const { held, release } = holding()
  await page.route('**/api/pulls/import', async (route) => {
    await held
    await route.continue()
  })
  const button = page.getByRole('button', { name: /^Import/ })
  await button.click()
  await expect(button).toHaveText('Importing…')
  await expect(button).toHaveAttribute('aria-disabled', 'true')
  // A press while it rests sends nothing. (Playwright waits for a button that is aria-disabled; a player can press it.)
  const presses: string[] = []
  page.on('request', (request) => {
    if (request.url().endsWith('/api/pulls/import')) presses.push(request.method())
  })
  await button.click({ force: true })
  release()
  await expect(ring(page, 'pulls-import').mark).toHaveAttribute('aria-label', withLogin('Imported 3 new wishes.'))
  await expect(button).toHaveText('Import')
  await expect(button).toHaveAttribute('aria-disabled', 'false')
  expect(presses).toEqual([])
})

test('a refused press is said on the line until the stream tells of an import', async ({ page, api }) => {
  await page.route('**/api/pulls/import', (route) => route.fulfill({ status: 409, json: { error: 'An import is running.' } }))
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  const line = ring(page, 'pulls-import').mark
  await expect(line).toHaveAttribute('aria-label', 'An import is running.')
  await page.unroute('**/api/pulls/import')
  // An import started elsewhere, as from another window: its events reach this page, and the refusal goes.
  await api.post('/api/pulls/import')
  await expect(line).toHaveAttribute('aria-label', withLogin('Imported 3 new wishes.'))
})

test('the strip places each banner by its times, not by the flag read with the model', async ({ page }) => {
  await changeAnswer<Pulls>(page, '/api/pulls', (data) => {
    const [first, second] = data.banners
    // One that has ended since the model was read, and one that starts later, both still flagged as running.
    Object.assign(first, { ends_at: '2026-10-01T06:00:00+00:00', running: true })
    Object.assign(second, { starts_at: '2026-11-13T10:00:00+00:00', ends_at: '2026-12-03T06:00:00+00:00', running: true })
  })
  await page.reload()
  const banners = page.getByTestId('pulls-sky').getByTestId('pulls-banner')
  await expect(banners).toHaveCount(2)
  await expect(banners.nth(0)).toContainText('La Chanson Cerise')
  await expect(banners.nth(0)).toContainText('from 13 Nov')
  await expect(banners.nth(1)).toContainText('Azurelight · Symphonist of Scents · pity 23')
})

test('with only banners to come, the strip says when the next one starts', async ({ page }) => {
  await changeAnswer<Pulls>(page, '/api/pulls', (data) => {
    for (const banner of data.banners) {
      Object.assign(banner, { starts_at: '2026-11-13T10:00:00+00:00', ends_at: '2026-12-03T06:00:00+00:00', running: false })
    }
  })
  await page.reload()
  const sky = page.getByTestId('pulls-sky')
  await expect(sky.getByRole('heading')).toHaveText('Coming next · from 13 Nov')
  await expect(sky.getByTestId('pulls-banner')).toHaveCount(3)
  await expect(sky.getByTestId('pulls-banner').first()).toContainText('from 13 Nov')
})

test('Set… offers only what changes something', async ({ page }) => {
  // Every card known from its own history, with no correction in force.
  await changeAnswer<Pulls>(page, '/api/pulls', (data) => {
    for (const one of data.pity) one.correction = null
  })
  await page.reload()
  // The character event and the standard wish have nothing to set.
  await expect(card(page, 'character').getByRole('button', { name: 'Set…' })).toHaveCount(0)
  await expect(card(page, 'standard').getByRole('button', { name: 'Set…' })).toHaveCount(0)
  // The weapon event and the chronicled wish keep their path and Fate Points, and no correction.
  for (const [pool, item] of [['weapon', 'Charted weapon'], ['chronicled', 'Path']] as const) {
    const one = card(page, pool)
    await one.getByRole('button', { name: 'Set…' }).click()
    await expect(one.getByLabel(item, { exact: true })).toBeFocused()
    await expect(one.getByLabel('Fate Points now')).toBeVisible()
    await expect(one.getByLabel(/: pity$/)).toHaveCount(0)
    await expect(one.getByLabel('and the next 5★')).toHaveCount(0)
    await one.getByRole('button', { name: 'Cancel' }).click()
  }
})

test('a correction taken away leaves the card with nothing to set, and the card keeps the focus', async ({ page, api }) => {
  const character = card(page, 'character')
  const [model] = (await api.get<Pulls>('/api/pulls')).pity
  await character.getByRole('button', { name: 'Set…' }).click()
  await pityField(character, model).fill('')
  await character.getByRole('button', { name: 'Save' }).click()
  // The demo's history settles the card by itself (Qiqi's lost 50/50), so there is nothing left to set.
  await expect(character.getByRole('button', { name: 'Set…' })).toHaveCount(0)
  await expect(character).toBeFocused()
  await expect(character.locator('.ring')).toContainText('61')
})

test.describe('before any import', () => {
  test.use({ mode: 'live' })

  test('the page says so', async ({ page }) => {
    await expect(
      page.getByText('No wish history yet. Open Wish → History in the game, then press Import.'),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeVisible()
    await expect(page.getByTestId('pulls-sky')).toHaveCount(0)
    await expect(page.getByTestId('pity-card')).toHaveCount(0)
  })

  test('with the HoYoLAB login on, it says Guild Board is reading the history now', async ({ page }) => {
    await changeAnswer<Pulls>(page, '/api/pulls', (data) => {
      data.import.login = 'on'
      data.import.every_minutes = 30
    })
    await page.reload()
    await expect(page.getByText('No wish history yet. Guild Board is reading it now with your HoYoLAB login.')).toBeVisible()
    await expect(page.getByText('Open Wish → History')).toHaveCount(0)
  })

  test('while the key is asked for after a press the ring turns and Import rests', async ({ page }) => {
    await changeAnswer<Pulls>(page, '/api/pulls', (data) => {
      data.import.login = 'minting'
      data.import.every_minutes = 30
    })
    await page.reload()
    await expect(page.getByRole('button', { name: 'Importing…' })).toHaveAttribute('aria-disabled', 'true')
    await expect(page.locator('.gb-fresh', { has: page.getByTestId('pulls-import') }).locator('.sign.turning')).toHaveCount(1)
  })
})

test('a history of another uid is said', async ({ page }) => {
  await changeAnswer<Pulls>(page, '/api/pulls', (data) => {
    data.uid = 700000002
    data.account_uid = 700000001
  })
  await page.reload()
  const said = page.getByText("This history is UID 700000002. Guild Board's HoYoLAB account is UID 700000001.")
  await expect(said).toBeVisible()
  // Above the strip.
  const above = await said.evaluate((element) => {
    const sky = document.querySelector('[data-testid="pulls-sky"]')!
    return element.getBoundingClientRect().bottom <= sky.getBoundingClientRect().top
  })
  expect(above).toBe(true)
})

test('nothing on the page moves after it has settled', async ({ page }) => {
  await expect(page.getByTestId('history-row')).toHaveCount(100)
  // The rings have filled and the rows have come in, once: nothing loops.
  await expect.poll(() => page.evaluate(() => document.getAnimations().length)).toBe(0)
  await page.waitForTimeout(1_500)
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0)
})

test('with reduced motion the page is drawn at once', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.reload()
  await expect(page.getByTestId('history-row')).toHaveCount(100)
  expect(await page.evaluate(() => document.getAnimations().filter((one) => one.playState === 'running').length)).toBe(0)
})
