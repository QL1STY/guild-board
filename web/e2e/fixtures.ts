import { test as base } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const coreProgram = path.join(projectRoot, '.venv', 'Scripts', 'guildboard.exe')
const pythonProgram = path.join(projectRoot, '.venv', 'Scripts', 'python.exe')

/** Every demo core starts at this instant, so every run shows the same numbers. */
export const DEMO_NOW = '2026-10-13T08:00:00+00:00'

/** A proxy address where nothing listens. */
const NOWHERE = 'http://127.0.0.1:9'

/**
 * No browser test can reach the internet or the player's files, so every core starts in an environment of its own:
 * - APPDATA is a folder inside the core's own data folder, so a core never finds a player's files there, and
 *   LOCALAPPDATA is another, so nothing reaches the player's own Guild Board folder. USERPROFILE is a third, so that a
 *   core never finds the game's log, which an Import reads from the player's profile (the Pulls design, section 4).
 * - HTTPS_PROXY and HTTP_PROXY point at a port where nothing listens. netpolicy's opener is urllib's, which honours
 *   them, so a download that a live core attempts by mistake, such as the primogem icon, fails at once instead of
 *   reaching the internet, and so does the read of HoYoverse's announcements that a live core makes once the risk
 *   statement is read. (On Windows "at once" is about 2 seconds, while the refused connection is tried again.)
 *   The runner's NO_PROXY is left out, so that nothing goes around them.
 */
function coreEnvironment(dataDir: string): NodeJS.ProcessEnv {
  const own: NodeJS.ProcessEnv = {
    APPDATA: path.join(dataDir, 'appdata'),
    LOCALAPPDATA: path.join(dataDir, 'localappdata'),
    USERPROFILE: path.join(dataDir, 'userprofile'),
    HTTPS_PROXY: NOWHERE,
    HTTP_PROXY: NOWHERE,
  }
  const replaced = new Set([...Object.keys(own), 'NO_PROXY'])
  // Windows does not tell apart names that differ only in case, so the runner's own spelling of each is left out.
  const inherited = Object.entries(process.env).filter(([name]) => !replaced.has(name.toUpperCase()))
  return { ...Object.fromEntries(inherited), ...own }
}

export type Core = {
  /** For example http://127.0.0.1:51234 */
  origin: string
  /** The link that exchanges the launch secret for the session cookie. */
  launch: string
  /** The core's own temporary data folder. Its APPDATA is the folder "appdata" inside it. */
  dataDir: string
  /** Ends the core's process, as if Guild Board had been closed. */
  stop(): void
}

export type Api = {
  get<T = unknown>(path: string): Promise<T>
  post<T = unknown>(path: string, body?: unknown): Promise<T>
  put<T = unknown>(path: string, body: unknown): Promise<T>
  /** Make the demo account fail in the given way; "none" ends it. */
  fault(kind: string): Promise<void>
  /** Move the demo clock forward. */
  advance(seconds: number): Promise<void>
  /** Move past the cooldown, run a sync and wait for its end. Answers the state it ended in. */
  sync(): Promise<string>
}

type Options = {
  /**
   * "demo" runs on the demo account. "live" is a core without a login, which contacts nothing before the risk statement
   * is read, and then only HoYoverse's announcements, which the dead proxy stops.
   */
  mode: 'demo' | 'live'
  /** false marks the risk statement as read, so that a test starts on the dashboard. */
  firstRun: boolean
  /** The instant the demo core starts at; the Characters tests start it on a Sunday morning (2026-10-25). */
  demoNow: string
  /**
   * Whether Your week and Endgame are shown (the core hides them, `characters.WEEK_AND_ENDGAME`). The tests of those pages
   * run with them shown, as they will when the switch is back on; the tests of the hidden state set this false.
   */
  weekAndEndgame: boolean
  /** The demo core of tools/memory_core.py, whose pictures are as large as the real ones; the memory measure uses it. */
  bigArt: boolean
  /** The folder of the real charts for the demo core of tools/stars_core.py, which the stars' proof uses; empty for none. */
  realCharts: string
  /** The demo core of tools/site_demo_core.py, whose models name each picture of the demo's list (the site's screenshots use it). */
  siteArt: boolean
}

function firstLine(child: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    const lines = createInterface({ input: child.stdout! })
    const timer = setTimeout(() => reject(new Error('the core did not print its launch link')), 30_000)
    lines.once('line', (line) => {
      clearTimeout(timer)
      resolve(line.trim())
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`the core ended early, with code ${code}`))
    })
  })
}

export const test = base.extend<Options & { core: Core; api: Api }>({
  mode: ['demo', { option: true }],
  firstRun: [false, { option: true }],
  demoNow: [DEMO_NOW, { option: true }],
  weekAndEndgame: [true, { option: true }],
  bigArt: [false, { option: true }],
  realCharts: ['', { option: true }],
  siteArt: [false, { option: true }],

  core: async ({ mode, demoNow, weekAndEndgame, bigArt, realCharts, siteArt }, use) => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'guildboard-e2e-'))
    const args = ['--no-shell', '--port', '0', '--data-dir', dataDir]
    if (mode === 'demo') args.unshift('--demo', '--demo-now', demoNow)
    if (mode === 'demo' && weekAndEndgame) args.push('--week-and-endgame')
    const program = (bigArt || realCharts !== '' || siteArt) && mode === 'demo' ? pythonProgram : coreProgram
    if (bigArt && mode === 'demo') {
      args.splice(0, args.length, path.join(projectRoot, 'tools', 'memory_core.py'), '--data-dir', dataDir, '--demo-now', demoNow)
      if (weekAndEndgame) args.push('--week-and-endgame')
    } else if (siteArt && mode === 'demo') {
      args.splice(0, args.length, path.join(projectRoot, 'tools', 'site_demo_core.py'), '--data-dir', dataDir, '--demo-now', demoNow)
      if (weekAndEndgame) args.push('--week-and-endgame')
    } else if (realCharts !== '' && mode === 'demo') {
      args.splice(0, args.length, path.join(projectRoot, 'tools', 'stars_core.py'), '--data-dir', dataDir, '--demo-now', demoNow, '--charts', realCharts)
    }
    const child = spawn(program, args, {
      cwd: projectRoot,
      env: coreEnvironment(dataDir),
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    const launch = await firstLine(child)
    let stopped = false
    const stop = () => {
      if (stopped) return
      stopped = true
      // Through the handle Node holds, never by the process id: once a process has ended, Windows may give its id to
      // another program, the game included. The program's Python, a child of its own, ends with it.
      child.kill()
    }
    const ended = new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) resolve()
      else child.once('exit', () => resolve())
    })
    await use({ origin: new URL(launch).origin, launch, dataDir, stop })
    stop()
    // The folder goes once the core has ended: a core still writing, as the gallery's thumbnails are, would leave a file
    // in a folder being removed.
    await ended
    try {
      rmSync(dataDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
    } catch (failure) {
      // Windows can hold a file that was just written (the art cache's copies) a while after its process has ended; the
      // folder is in the temp folder and holds only the run's own made-up data, so it is left for the next clean-up.
      console.warn(`The core's data folder ${dataDir} could not be removed yet: ${(failure as Error).message}`)
    }
  },

  api: async ({ context, core, firstRun }, use) => {
    const call = async <T>(method: 'get' | 'post' | 'put', route: string, body?: unknown): Promise<T> => {
      const options = body === undefined ? {} : { data: body }
      const response = await context.request[method](core.origin + route, options)
      if (!response.ok()) {
        throw new Error(`${method.toUpperCase()} ${route} answered ${response.status()}: ${await response.text()}`)
      }
      return (await response.json()) as T
    }
    const settled = async (): Promise<string> => {
      for (let attempt = 0; attempt < 400; attempt += 1) {
        const status = await call<{ sync: { state: string } }>('get', '/api/status')
        if (status.sync.state !== 'syncing') return status.sync.state
        await new Promise((done) => setTimeout(done, 50))
      }
      throw new Error('the sync did not end')
    }
    // The page shares its cookies with these requests: this sets the session for both.
    await context.request.get(core.launch, { maxRedirects: 0 })
    await settled() // the sync that runs at start-up is over before a test begins
    if (!firstRun) await call('put', '/api/settings', { risk_acknowledged: true })
    await use({
      get: (route) => call('get', route),
      post: (route, body) => call('post', route, body),
      put: (route, body) => call('put', route, body),
      fault: async (kind) => {
        await call('post', '/api/demo/fault', { kind })
      },
      advance: async (seconds) => {
        await call('post', '/api/demo/clock', { advance_seconds: seconds })
      },
      sync: async () => {
        await call('post', '/api/demo/clock', { advance_seconds: 360 })
        const answer = await call<{ started: boolean; reason: string }>('post', '/api/sync')
        return answer.started ? settled() : answer.reason
      },
    })
  },

  page: async ({ page, core, api }, use) => {
    void api // the session exists before the page loads
    await page.goto(core.origin + '/')
    await use(page)
    // A test can end while one of its routes is still fetching from the core (route.fetch, as changeAnswer does), for
    // a read the page asked for just before the test's last check. The core stops after this fixture and cuts that
    // fetch, which must not fail a test that has passed. So the routes come off first, and what they are still doing
    // is let go: its errors are ignored, and a route that a test still holds is not waited for.
    await page.unrouteAll({ behavior: 'ignoreErrors' })
    await page.context().unrouteAll({ behavior: 'ignoreErrors' })
  },
})

export { expect } from '@playwright/test'
