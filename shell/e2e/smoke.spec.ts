import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// The shell's folder: electron.exe takes it as its first argument, as the installed copy's launcher does not need to.
const SHELL = resolve(__dirname, '..')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ELECTRON = require('electron') as string
const TASKKILL = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe')

let folder: string
let app: ElectronApplication | null = null
// The program's own handle, kept at launch: Playwright's `app.process()` cannot be read once the app has closed.
let appProcess: ChildProcess | null = null

test.beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'gb-e2e-'))
})

/** Whether a started program is still running: its id is only killed while it has not been seen to end (a freed id can be reused). */
function running(child: { exitCode: number | null; signalCode: NodeJS.Signals | null }): boolean {
  return child.exitCode === null && child.signalCode === null
}

/**
 * The program and everything it started, by process id, never by name. In development the core is the venv's launcher and
 * the interpreter under it, so the tree goes. Safe by construction: global-setup.ts refuses to run while the game runs.
 */
function killTree(pid: number | undefined): void {
  if (pid !== undefined) spawnSync(TASKKILL, ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
}

test.afterEach(async () => {
  const started = app
  const program = appProcess
  app = null
  appProcess = null
  if (started !== null && program !== null && running(program)) {
    // The normal way first: the shell quits through its own quit(), which stops the core.
    await Promise.race([started.close().catch(() => undefined), new Promise((done) => setTimeout(done, 20_000))])
    if (running(program)) killTree(program.pid)
  }
  // Asynchronous, so that Playwright's timeouts can still fire; the core lets go of its database a moment after the shell.
  await rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
})

/** The first Guild Board: Playwright adds its debugging switches, which only a demo allows. */
async function launch(env?: Record<string, string>): Promise<ElectronApplication> {
  app = await electron.launch({ args: [SHELL, '--demo', '--acknowledged', '--data-dir', folder], ...(env ? { env } : {}) })
  appProcess = app.process()
  return app
}

/** A later start as a plain process, with no Playwright: how the installer runs `--quit`. Its exit code, within `ms`. */
function startAgain(extra: string[], ms: number, env?: Record<string, string>): Promise<number | null> {
  return new Promise((done, fail) => {
    const child = spawn(ELECTRON, [SHELL, '--demo', ...extra, '--data-dir', folder], { windowsHide: true, stdio: 'ignore', ...(env ? { env } : {}) })
    const timer = setTimeout(() => {
      if (running(child)) killTree(child.pid)
      done(null)
    }, ms)
    child.once('error', fail)
    child.once('exit', (code) => {
      clearTimeout(timer)
      done(code)
    })
  })
}

test('the dashboard shows the Board', async () => {
  const first = await launch()
  const window = await first.firstWindow()
  await expect(window.locator('.gb-rail')).toBeVisible({ timeout: 60_000 })
})

test('a second start shows the first and ends', async () => {
  const first = await launch()
  const window = await first.firstWindow()
  await expect(window.locator('.gb-rail')).toBeVisible({ timeout: 60_000 })
  // The first is minimized, so that "shows the first" is something the second start has to do.
  await first.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize())
  expect(await first.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized())).toBe(true)
  expect(await startAgain([], 30_000)).toBe(0)
  expect(first.process().exitCode).toBeNull() // the first is still running
  await expect
    .poll(() => first.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      return win.isVisible() && !win.isMinimized()
    }))
    .toBe(true)
})

test('--quit ends the running copy', async () => {
  const first = await launch()
  const window = await first.firstWindow()
  await expect(window.locator('.gb-rail')).toBeVisible({ timeout: 60_000 })
  const closed = first.waitForEvent('close', { timeout: 30_000 })
  expect(await startAgain(['--quit'], 40_000)).toBe(0)
  await closed
})

/** The environment of this test run with TEMP and TMP moved to `temp`. */
function withTemp(temp: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [name, value] of Object.entries(process.env)) if (value !== undefined) env[name] = value
  env.TEMP = temp
  env.TMP = temp
  return env
}

/** What a folder holds, by name (null when it is not there). */
function entriesOf(path: string): string[] | null {
  return existsSync(path) ? readdirSync(path).sort() : null
}

/** Everything under a folder, as `path|size|modified` lines (null when it is not there): a file written or touched shows. */
function listing(path: string): string[] | null {
  if (!existsSync(path)) return null
  // The folder's own entry comes first, so that a file made and removed directly inside it shows by the folder's time.
  const lines: string[] = [`.|dir|${statSync(path).mtimeMs}`]
  const walk = (folder: string, prefix: string): void => {
    for (const name of readdirSync(folder).sort()) {
      const full = join(folder, name)
      const info = statSync(full)
      lines.push(`${prefix}${name}|${info.isDirectory() ? 'dir' : info.size}|${info.mtimeMs}`)
      if (info.isDirectory()) walk(full, `${prefix}${name}/`)
    }
  }
  walk(path, '')
  return lines
}

test('the window writes nothing outside its data folder', async () => {
  // Ruling R32. The Qt build had a test that ran the window with its temporary and profile folders moved and found nothing
  // written outside the data folder; this is its counterpart. TEMP and TMP point at a new, empty folder; Electron's default
  // user data folder (named for the package) must not be made or grown by the run, because main.ts moves userData into
  // <data folder>/shell before anything is written.
  const temp = mkdtempSync(join(tmpdir(), 'gb-e2e-temp-'))
  try {
    // Electron names the default folder as it names the app: `productName`, then `name`, of package.json.
    const pack = JSON.parse(readFileSync(join(SHELL, 'package.json'), 'utf8')) as { name: string; productName?: string }
    const defaultUserData = join(process.env.APPDATA ?? '', pack.productName ?? pack.name)
    expect(process.env.APPDATA, 'APPDATA names the folder Electron would use').toBeTruthy()
    const before = listing(defaultUserData) // everything in it, with sizes and times, if earlier runs made it
    const env = withTemp(temp)

    const first = await launch(env)
    const window = await first.firstWindow()
    await expect(window.locator('.gb-rail')).toBeVisible({ timeout: 60_000 })
    // The app's own idea of the folders, which the run must not have used: appData is where the default would be.
    expect(await first.evaluate(({ app }) => app.getPath('appData'))).toBe(process.env.APPDATA)
    expect(await first.evaluate(({ app }) => app.getPath('userData'))).toBe(join(folder, 'shell'))
    const closed = first.waitForEvent('close', { timeout: 30_000 })
    expect(await startAgain(['--quit'], 40_000, env)).toBe(0)
    await closed

    expect(entriesOf(temp), 'TEMP and TMP stay empty').toEqual([])
    expect(existsSync(join(folder, 'shell')), 'the shell keeps its files in <data folder>/shell').toBe(true)
    const after = listing(defaultUserData)
    if (before === null) expect(after, `${defaultUserData} was not made by this run`).toBeNull()
    else expect(after, `${defaultUserData} is as it was: no new entry, none written or touched`).toEqual(before)
  } finally {
    await rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
  }
})
