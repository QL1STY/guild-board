import type { Locator, Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Achievements, ImportPreview, ListCheck } from '../src/types.ts'
import { changeAnswer, holding } from './answers.ts'
import { type Api, expect, test } from './fixtures.ts'

/** A Paimon.moe export with these achievements ticked, on its main profile. */
const paimonFile = (...ids: string[]) =>
  JSON.stringify({ achievement: { '0': Object.fromEntries(ids.map((id) => [id, true])) } })

const save = paimonFile('81732')

test('an uploaded Paimon.moe export is previewed and imported', async ({ page, core }) => {
  await page.goto(`${core.origin}/#/settings`)
  const section = page.getByRole('region', { name: 'Your data' })
  await section.getByLabel('Choose a file').setInputFiles({ name: 'paimon-moe-local-data.json', mimeType: 'application/json', buffer: Buffer.from(save) })
  await expect(section).toContainText('This import would tick 1 achievement.')
  await section.getByRole('button', { name: 'Import' }).click()
  await expect(section).toContainText('Imported from paimon-moe-local-data.json.')
})

test('the demo list check offers three made-up achievements, installs them and goes back', async ({ page, core }) => {
  await page.goto(`${core.origin}/#/settings`)
  const section = page.getByRole('region', { name: 'Achievements' })
  await section.getByRole('button', { name: 'Check for new achievements' }).click()
  await expect(section).toContainText('Version 7.2: 3 new, 0 changed, 0 no longer listed.')
  await expect(section).toContainText('Demo achievement 1')
  await section.getByRole('button', { name: 'Install this list' }).click()
  await expect(section).toContainText('Installed version 7.2, 1,857 achievements.')
  // Spec 12.5: the installed list's source, version and date.
  await expect(section.getByText(/^Achievement list version 7\.2,/)).toHaveText(
    /^Achievement list version 7\.2, 1,857 achievements, made up for the demo and installed \d{1,2} [A-Z][a-z]{2}, \d\d:\d\d\.$/,
  )
  await section.getByRole('button', { name: 'Go back to the earlier list' }).click()
  await expect(section).toContainText('Went back to version 7.1.')
})

const importPanel = (page: Page) => page.getByRole('region', { name: 'Your data' }).getByTestId('import-panel')
const listPanel = (page: Page) => page.getByRole('region', { name: 'Achievements' }).getByTestId('list-panel')

const BUNDLED = 'Achievement list version 7.1, 1,854 achievements, from 2026-09-23 (the copy that came with Guild Board).'

/** The paths of the requests the page sends from now on to an address that starts with one of `starts`, in order. */
function sentTo(page: Page, ...starts: string[]): string[] {
  const sent: string[] = []
  page.on('request', (request) => {
    const { pathname } = new URL(request.url())
    if (starts.some((start) => pathname.startsWith(start))) sent.push(pathname)
  })
  return sent
}

/** Whether a line's text runs past the right edge of the line's own box, and so past its panel's. */
function runsPast(line: Locator): Promise<boolean> {
  return line.evaluate((element) => {
    const text = document.createRange()
    text.selectNodeContents(element)
    return text.getBoundingClientRect().right > element.getBoundingClientRect().right + 0.5
  })
}

/** The paths of the import requests the page sends from now on, in order. */
const importsSent = (page: Page) => sentTo(page, '/api/import/')

/** The status the core holds for an achievement of one stage, found by its name. */
async function statusOf(api: Api, name: string): Promise<string> {
  const model = await api.get<Achievements>(`/api/achievements?view=all&q=${encodeURIComponent(name)}`)
  const group = model.groups.find((each) => each.name === name)
  if (group === undefined) throw new Error(`no achievement is named ${name}`)
  return group.stages[0].status
}

test.describe('in Settings', () => {
  test.beforeEach(async ({ page, core }) => {
    await page.goto(`${core.origin}/#/settings`)
  })

  test('a file is the one way in, and its line does not start with "Or"', async ({ page }) => {
    const panel = importPanel(page)
    const line = panel.getByText('Choose a file: a Paimon.moe export.', { exact: true })
    await expect(line).toBeVisible()
    await expect(panel).not.toContainText('Or choose a file')
  })

  test('a chosen file that is not a save says why, and another file can be chosen', async ({ page }) => {
    const panel = importPanel(page)
    const chooser = panel.getByLabel('Choose a file')
    await chooser.setInputFiles({ name: 'notes.json', mimeType: 'application/json', buffer: Buffer.from('{"notes": []}') })
    await expect(panel.getByRole('alert')).toHaveText('This file is not a Paimon.moe export.')
    await chooser.setInputFiles({ name: 'paimon-moe-local-data.json', mimeType: 'application/json', buffer: Buffer.from(save) })
    await expect(panel).toContainText('This import would tick 1 achievement.')
    await expect(panel.getByRole('alert')).toBeEmpty()
  })

  test('a file over 30 MB is refused before it is read, and nothing is sent', async ({ page, core }) => {
    const big = path.join(core.dataDir, 'big.json') // removed with the core's folder
    writeFileSync(big, Buffer.alloc(30_000_001, ' '))
    const panel = importPanel(page)
    const sent = importsSent(page)
    await panel.getByLabel('Choose a file').setInputFiles(big)
    await expect(panel.getByRole('alert')).toHaveText('The file is larger than 30 MB. No achievement save is that big.')
    // A save of the usual size next. The page sends its requests in order, so one for the big file would come first.
    await panel.getByLabel('Choose a file').setInputFiles({ name: 'paimon-moe-local-data.json', mimeType: 'application/json', buffer: Buffer.from(save) })
    await expect(panel).toContainText('This import would tick 1 achievement.')
    expect(sent).toEqual(['/api/import/preview'])
  })

  test('a preview names the achievements the list does not hold', async ({ page }) => {
    const file = paimonFile('99000001', '99000002')
    const panel = importPanel(page)
    await panel.getByLabel('Choose a file').setInputFiles({ name: 'paimon-moe-local-data.json', mimeType: 'application/json', buffer: Buffer.from(file) })
    await expect(panel).toContainText('This import would only add progress on achievements that are not in the list.')
    const unknown = '2 achievements in the file are not in the list: 99000001, 99000002. They are kept.'
    await expect(panel.getByText(unknown, { exact: true })).toBeVisible()
  })

  test('when the file has nothing new, Import keeps the focus, and a press sends nothing', async ({ page, api }) => {
    // The save was imported before, so that the page's preview of it finds nothing new.
    const before = await api.post<ImportPreview>('/api/import/preview', { text: save, file: 'paimon-moe-local-data.json' })
    await api.post('/api/import/apply', { text: save, file: 'state.json', fingerprint: before.fingerprint })
    const file = { name: 'paimon-moe-local-data.json', mimeType: 'application/json', buffer: Buffer.from(save) }
    const panel = importPanel(page)
    const sent = importsSent(page)
    await panel.getByLabel('Choose a file').setInputFiles(file)
    await expect(panel).toContainText('This file has nothing new for Guild Board.')
    const importButton = panel.getByRole('button', { name: 'Import', exact: true })
    await expect(importButton).toHaveAttribute('aria-disabled', 'true')
    await importButton.focus()
    await page.keyboard.press('Enter')
    await page.keyboard.press('Space')
    await expect(importButton).toBeFocused()
    // Cancel and a preview once more: a request that the presses sent would have gone out before these.
    await panel.getByRole('button', { name: 'Cancel' }).click()
    await panel.getByLabel('Choose a file').setInputFiles(file)
    await expect(panel).toContainText('This file has nothing new for Guild Board.')
    expect(sent).toEqual(['/api/import/preview', '/api/import/preview'])
  })

  test('with two Paimon.moe profiles, the one chosen is previewed again and imported, and Cancel sends nothing', async ({ page, api }) => {
    const exported = JSON.stringify({
      achievement: { '0': { '81732': true } }, // Winter Night's Letter
      'alt-achievement': { '0': { '81000': true, '81004': true } }, // Overlooking View and Initiating Warp Drive!
    })
    const file = { name: 'paimon-moe-local-data.json', mimeType: 'application/json', buffer: Buffer.from(exported) }
    const panel = importPanel(page)
    const sent = importsSent(page)
    await panel.getByLabel('Choose a file').setInputFiles(file)
    const profile = panel.getByRole('combobox', { name: 'Paimon.moe profile' })
    await expect(profile.getByRole('option')).toHaveText(['Main profile', 'alt'])
    await expect(profile).toHaveValue('')
    await expect(panel).toContainText('This import would tick 1 achievement.')
    await profile.selectOption('alt')
    await expect(panel).toContainText('This import would tick 2 achievements.')
    await panel.getByRole('button', { name: 'Cancel' }).click()
    await expect(panel.getByLabel('Choose a file')).toBeAttached() // the first step again
    await panel.getByLabel('Choose a file').setInputFiles(file)
    await panel.getByRole('combobox', { name: 'Paimon.moe profile' }).selectOption('alt')
    await expect(panel).toContainText('This import would tick 2 achievements.')
    await panel.getByRole('button', { name: 'Import', exact: true }).click()
    await expect(panel).toContainText('Imported from paimon-moe-local-data.json.')
    const names = ['Overlooking View', 'Initiating Warp Drive!', "Winter Night's Letter"]
    expect(await Promise.all(names.map((name) => statusOf(api, name)))).toEqual(['done', 'done', 'not_started'])
    // Two previews for each choice of the file, and the import. Cancel sent nothing.
    expect(sent).toEqual([
      '/api/import/preview', '/api/import/preview', '/api/import/preview', '/api/import/preview', '/api/import/apply',
    ])
  })

  test('while the check is out, a second press sends nothing, and the button keeps the focus', async ({ page }) => {
    const { held, release } = holding()
    let checks = 0
    await page.route('**/api/achievements/list/check', async (route) => {
      checks += 1
      await held
      await route.fallback()
    })
    const panel = listPanel(page)
    await panel.getByRole('button', { name: 'Check for new achievements' }).focus()
    await page.keyboard.press('Enter')
    const checking = panel.getByRole('button', { name: 'Checking…' })
    await expect(checking).toBeFocused()
    await expect(checking).toHaveAttribute('aria-disabled', 'true')
    // It looks as a disabled button does: dimmed, with the plain pointer.
    const look = (element: HTMLElement) => [getComputedStyle(element).opacity, getComputedStyle(element).cursor]
    expect(await checking.evaluate(look)).toEqual(['0.6', 'default'])
    await page.keyboard.press('Enter')
    release()
    await expect(panel).toContainText('Version 7.2: 3 new, 0 changed, 0 no longer listed.')
    await expect(panel.getByRole('button', { name: 'Check for new achievements' })).toBeFocused()
    expect(checks).toBe(1)
  })

  test('a long preview names 50 new and 50 changed stages, says how many more, and every stage no longer listed', async ({ page }) => {
    // The demo's check finds 3 new stages and nothing else, so its answer gets others in their place. More than 50
    // stages are no longer listed, and each of them is named all the same.
    const names = (kind: string, count: number) =>
      Array.from({ length: count }, (_, index) => `${kind} stage ${index + 1}`)
    const added = names('New', 55)
    const changed = names('Changed', 60)
    const removed = names('Removed', 56)
    await changeAnswer<ListCheck>(page, '/api/achievements/list/check', (check) => {
      check.added = added.map((name, index) => ({
        id: 990001 + index, name, description: 'd', version: '7.2', category: 'Made up',
      }))
      check.changed = changed.map((name, index) => ({ id: 991001 + index, name, what: ['name'] }))
      check.removed = removed.map((name, index) => ({ id: 992001 + index, name }))
    })
    const panel = listPanel(page)
    await panel.getByRole('button', { name: 'Check for new achievements' }).click()
    await expect(panel).toContainText('Version 7.2: 55 new, 60 changed, 56 no longer listed.')
    // What the preview shows, line by line and in order.
    await expect(panel.locator('.ach-found').locator('p, li')).toHaveText([
      'Added in 7.2', 'Made up', ...added.slice(0, 50), 'And 5 more.',
      'Changed', ...changed.slice(0, 50), 'And 10 more.',
      'No longer listed', ...removed,
    ])
    await expect(panel.getByText('Changed stage 51', { exact: true })).toHaveCount(0)
  })

  test("at the frame's least width a long file name wraps inside the panel", async ({ page }) => {
    await page.setViewportSize({ width: 1040, height: 800 })
    const panel = importPanel(page)
    const name = 'PaimonMoeBackupFromTheOldGamingPcBeforeTheBigUpdateOfOctober2026.json'
    await panel.getByLabel('Choose a file').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(save) })
    await panel.getByRole('button', { name: 'Import', exact: true }).click()
    const imported = panel.getByText(`Imported from ${name}.`)
    await expect(imported).toBeVisible()
    expect(await runsPast(imported)).toBe(false)
  })

  test("at the frame's least width the list's date stays on one line", async ({ page }) => {
    await page.setViewportSize({ width: 1040, height: 800 })
    const line = listPanel(page).getByText(BUNDLED)
    await expect(line).toBeVisible()
    // The boxes the date takes on screen: one while it stays on one line, two when it breaks at a hyphen.
    const boxes = await line.evaluate((element, date) => {
      const texts = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
      for (let node = texts.nextNode(); node !== null; node = texts.nextNode()) {
        const at = (node.textContent ?? '').indexOf(date)
        if (at === -1) continue
        const range = document.createRange()
        range.setStart(node, at)
        range.setEnd(node, at + date.length)
        return range.getClientRects().length
      }
      return 0
    }, '2026-09-23')
    expect(boxes).toBe(1)
  })

  test('a check that fails says why on one line, the list stays, and the check can be pressed again', async ({ page }) => {
    const offline = 'The achievement list could not be downloaded. Check the connection and try again.'
    await page.route('**/api/achievements/list/check', (route) => route.fulfill({ status: 503, json: { error: offline } }))
    const panel = listPanel(page)
    await expect(panel).toContainText(BUNDLED)
    await panel.getByRole('button', { name: 'Check for new achievements' }).click()
    await expect(panel.getByRole('alert')).toHaveText(offline)
    await expect(panel).toContainText(BUNDLED)
    await page.unroute('**/api/achievements/list/check')
    await panel.getByRole('button', { name: 'Check for new achievements' }).click()
    await expect(panel).toContainText('Version 7.2: 3 new, 0 changed, 0 no longer listed.')
    await expect(panel.getByRole('alert')).toBeEmpty()
  })

  test('Go back to the earlier list goes back once, also before the list read after it arrives', async ({ page }) => {
    const panel = listPanel(page)
    await panel.getByRole('button', { name: 'Check for new achievements' }).click()
    await panel.getByRole('button', { name: 'Install this list' }).click()
    await expect(panel).toContainText('Installed version 7.2, 1,857 achievements.')
    const goBack = panel.getByRole('button', { name: 'Go back to the earlier list' })
    await expect(goBack).toBeVisible() // the list read after the install names the earlier one
    // From now on the page's reads of the list are held, so that the list it shows still names the earlier one.
    const { held, release } = holding()
    let reads = 0
    await page.route((url) => url.pathname === '/api/achievements', async (route) => {
      reads += 1
      await held
      await route.fallback()
    })
    const sent = sentTo(page, '/api/achievements/list/')
    await goBack.focus()
    await page.keyboard.press('Enter')
    const wentBack = panel.getByText('Went back to version 7.1.', { exact: true })
    await expect(wentBack).toBeVisible()
    await page.keyboard.press('Enter') // a second press, on the button had it stayed
    await expect(wentBack).toBeFocused() // the line took the button's place
    await expect(goBack).toHaveCount(0)
    await expect.poll(() => reads).toBeGreaterThan(0) // the read after the going back is on its way
    release()
    await expect(panel).toContainText(BUNDLED) // the list read after the going back
    await expect(wentBack).toBeVisible()
    await expect(panel.getByRole('alert')).toBeEmpty()
    await expect(goBack).toHaveCount(0)
    expect(sent).toEqual(['/api/achievements/list/undo'])
  })
})

test.describe('on the Achievements page', () => {
  test.beforeEach(async ({ page, core }) => {
    await page.goto(`${core.origin}/#/achievements`)
  })

  test("the top line's check opens the list panel under it, outside the bar", async ({ page }) => {
    const top = page.getByTestId('ach-top')
    const bar = page.getByTestId('ach-bar')
    await expect(page.getByTestId('ach-group').first()).toBeVisible()
    const height = await bar.evaluate((element) => element.getBoundingClientRect().height)
    await top.getByRole('button', { name: 'Check for new achievements' }).click()
    const panel = page.getByTestId('list-panel')
    await expect(panel).toContainText('Version 7.2: 3 new, 0 changed, 0 no longer listed.')
    await expect(panel).toContainText('Demo achievement 1')
    await expect(page.getByRole('button', { name: 'Check for new achievements' })).toHaveCount(1) // the top line's
    const topBottom = await top.evaluate((element) => element.getBoundingClientRect().bottom)
    expect(await panel.evaluate((element) => element.getBoundingClientRect().top)).toBeGreaterThan(topBottom)
    expect(await bar.evaluate((element) => element.getBoundingClientRect().height)).toBe(height)
    // Install this list and Go back to the earlier list go once pressed, and the focus moves to the line that says so.
    await panel.getByRole('button', { name: 'Install this list' }).focus()
    await page.keyboard.press('Enter')
    await expect(panel.getByText('Installed version 7.2, 1,857 achievements.')).toBeFocused()
    await expect(top).toContainText('of 1,857 ticked')
    await panel.getByRole('button', { name: 'Go back to the earlier list' }).focus()
    await page.keyboard.press('Enter')
    await expect(panel.getByText('Went back to version 7.1.')).toBeFocused()
    await expect(panel.getByRole('button', { name: 'Go back to the earlier list' })).toHaveCount(0)
    await expect(top).toContainText('of 1,854 ticked')
  })

  test("Close, from the keyboard, closes the list panel and hands the focus to the top line's check", async ({ page, core }) => {
    const check = page.getByTestId('ach-top').getByRole('button', { name: 'Check for new achievements' })
    await check.focus()
    await page.keyboard.press('Enter')
    const panel = page.getByTestId('list-panel')
    await expect(panel).toContainText('Version 7.2: 3 new, 0 changed, 0 no longer listed.')
    await page.keyboard.press('Tab')
    const close = panel.getByRole('button', { name: 'Close' })
    await expect(close).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(panel).toHaveCount(0)
    await expect(check).toBeFocused()
    // Pressed again, the check opens the panel again, with nothing left of what it said before it was closed.
    const { held, release } = holding()
    await page.route('**/api/achievements/list/check', async (route) => {
      await held
      await route.fallback()
    })
    await page.keyboard.press('Enter')
    await expect(panel).toContainText(BUNDLED)
    await expect(panel).not.toContainText('Version 7.2')
    release()
    await expect(panel).toContainText('Version 7.2: 3 new, 0 changed, 0 no longer listed.')
    // Settings' panel is part of its section and has no Close.
    await page.goto(`${core.origin}/#/settings`)
    await expect(listPanel(page)).toContainText(BUNDLED)
    await expect(listPanel(page).getByRole('button', { name: 'Close' })).toHaveCount(0)
  })
})

test('opening Settings and the Achievements page checks no list and previews no import', async ({ page, core }) => {
  const sent = sentTo(page, '/api/achievements/list/', '/api/import/')
  await page.goto(`${core.origin}/#/settings`)
  await expect(listPanel(page)).toContainText(BUNDLED)
  await expect(importPanel(page)).toBeVisible()
  await page.goto(`${core.origin}/#/achievements`)
  await expect(page.getByTestId('ach-group').first()).toBeVisible()
  // Settings once more: a request that either page sent by itself on opening would have gone out before this.
  await page.goto(`${core.origin}/#/settings`)
  await expect(listPanel(page)).toContainText(BUNDLED)
  expect(sent).toEqual([])
})
