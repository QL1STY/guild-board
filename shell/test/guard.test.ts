import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, test } from 'vitest'
import { hardenApp, hardenDefaultSession, hardenSession, permissionAllowed, requestAllowed, withoutAppName, type Partition } from '../src/guard.js'

const CORE = 'http://127.0.0.1:5123'

type Row = [Partition, string, string, string | null, boolean]

const ROWS: Row[] = [
  // gb-core and gb-overlay: the core’s origin, data: and blob: only
  ['gb-core', `${CORE}/api/state`, 'xhr', CORE, true],
  ['gb-core', `${CORE}/`, 'mainFrame', CORE, true],
  ['gb-core', `${CORE}/api/events`, 'other', CORE, true],
  ['gb-core', 'data:image/png;base64,AAAA', 'image', CORE, true],
  ['gb-core', 'blob:http://127.0.0.1:5123/abc', 'image', CORE, true],
  ['gb-core', 'https://example.com/x.js', 'script', CORE, false],
  ['gb-core', 'https://example.com/', 'mainFrame', CORE, false],
  ['gb-core', 'http://127.0.0.1:5124/api', 'xhr', CORE, false],
  ['gb-core', 'http://localhost:5123/', 'xhr', CORE, false],
  ['gb-core', 'ws://127.0.0.1:5123/', 'webSocket', CORE, false],
  ['gb-core', 'file:///C:/x', 'mainFrame', CORE, false],
  ['gb-core', `${CORE}/api/state`, 'xhr', null, false],
  ['gb-core', 'data:text/plain,hi', 'image', null, true],
  ['gb-overlay', `${CORE}/overlay`, 'mainFrame', CORE, true],
  ['gb-overlay', 'blob:http://127.0.0.1:5123/abc', 'image', CORE, true],
  ['gb-overlay', 'https://act.hoyolab.com/x.png', 'image', CORE, false],
  ['gb-overlay', 'https://example.com/x', 'xhr', CORE, false],
  // gb-map: https and wss to HoYoverse’s domains, data: and blob:
  ['gb-map', 'https://act.hoyolab.com/ys/app/interactive-map/index.html', 'mainFrame', CORE, true],
  ['gb-map', 'https://act-webstatic.hoyoverse.com/a.js', 'script', CORE, true],
  ['gb-map', 'https://sg-public-api.hoyolab.com/x', 'xhr', CORE, true],
  ['gb-map', 'wss://webstatic.mihoyo.com/socket', 'webSocket', CORE, true],
  ['gb-map', 'data:image/png;base64,AAAA', 'image', CORE, true],
  ['gb-map', 'blob:https://act.hoyolab.com/abc', 'script', CORE, true],
  ['gb-map', 'https://apmplus.ap-southeast-1.volces.com/x', 'xhr', CORE, false],
  ['gb-map', 'https://apmplus.ap-southeast-1.volces.com/x', 'ping', null, false],
  ['gb-map', 'http://act.hoyolab.com/x', 'script', CORE, false],
  ['gb-map', 'ws://act.hoyolab.com/x', 'webSocket', CORE, false],
  ['gb-map', 'https://hoyolab.com.evil.example/', 'script', CORE, false],
  ['gb-map', `${CORE}/api/state`, 'xhr', CORE, false],
  // gb-login and gb-verify: the main frame only to HoYoverse or a sign-in site; a subframe and every other type pass,
  // as the Qt shell lets them (login.py, verify.py): a captcha lives in a subframe of another host
  ['gb-login', 'https://account.hoyolab.com/login', 'mainFrame', CORE, true],
  ['gb-login', 'https://accounts.google.com/o/oauth2', 'mainFrame', CORE, true],
  ['gb-login', 'https://discord.com/oauth2', 'subFrame', CORE, true],
  ['gb-login', 'https://www.gstatic.com/', 'image', CORE, true],
  ['gb-login', 'https://www.gstatic.com/', 'mainFrame', CORE, false],
  ['gb-login', 'https://www.gstatic.com/', 'subFrame', CORE, true],
  ['gb-login', 'https://www.google.com/recaptcha/api2/anchor', 'subFrame', null, true],
  ['gb-login', 'https://newassets.hcaptcha.com/captcha/v1/x/static/hcaptcha.html', 'subFrame', null, true],
  ['gb-verify', 'https://www.google.com/recaptcha/api2/anchor', 'subFrame', null, true],
  ['gb-verify', 'https://newassets.hcaptcha.com/captcha/v1/x/static/hcaptcha.html', 'subFrame', null, true],
  ['gb-login', 'http://account.hoyolab.com/login', 'mainFrame', CORE, false],
  ['gb-login', 'https://example.com/', 'mainFrame', null, false],
  ['gb-login', 'https://static.geetest.com/x.js', 'script', null, true],
  ['gb-verify', 'https://act.hoyolab.com/app/community-game-records-sea/index.html', 'mainFrame', CORE, true],
  ['gb-verify', 'https://x.com/i/oauth2', 'mainFrame', CORE, true],
  ['gb-verify', 'https://x.com:8080/i/oauth2', 'mainFrame', CORE, false],
  ['gb-verify', 'https://example.com/', 'mainFrame', CORE, false],
  ['gb-verify', 'https://example.com/', 'subFrame', CORE, true],
  ['gb-verify', 'https://fonts.gstatic.com/a.woff2', 'font', CORE, true],
]

test.each(ROWS)('%s %s (%s, core %s) is allowed: %s', (partition, url, type, core, expected) => {
  expect(requestAllowed(partition, url, type, core)).toBe(expected)
})

test('a made-up partition is refused', () => {
  expect(requestAllowed('default' as Partition, 'https://act.hoyolab.com/', 'mainFrame', CORE)).toBe(false)
})

test('permissions: only the clipboard write, for the dashboard, from the core', () => {
  expect(permissionAllowed('gb-core', 'clipboard-sanitized-write', CORE, CORE)).toBe(true)
  expect(permissionAllowed('gb-core', 'clipboard-sanitized-write', `${CORE}/`, CORE)).toBe(true)
  expect(permissionAllowed('gb-core', 'clipboard-sanitized-write', 'https://example.com', CORE)).toBe(false)
  expect(permissionAllowed('gb-core', 'clipboard-sanitized-write', CORE, null)).toBe(false)
  for (const partition of ['gb-overlay', 'gb-map', 'gb-login', 'gb-verify'] as const) {
    expect(permissionAllowed(partition, 'clipboard-sanitized-write', CORE, CORE)).toBe(false)
  }
  for (const partition of ['gb-core', 'gb-overlay', 'gb-map', 'gb-login', 'gb-verify'] as const) {
    for (const permission of ['notifications', 'media', 'geolocation', 'clipboard-read', 'display-capture', 'openExternal', 'fullscreen']) {
      expect(permissionAllowed(partition, permission, CORE, CORE)).toBe(false)
    }
  }
})

type Before = (details: { url: string; resourceType: string }, callback: (r: { cancel: boolean }) => void) => void
type Request = (wc: unknown, permission: string, callback: (granted: boolean) => void, details: { requestingUrl?: string }) => void
type Check = (wc: unknown, permission: string, origin: string) => boolean

// A stand-in for an Electron session that keeps the handlers it is given.
function fakeSession() {
  const state: { before?: Before; request?: Request; check?: Check; spellcheck?: boolean } = {}
  const session = {
    webRequest: { onBeforeRequest(listener: Before) { state.before = listener } },
    setPermissionRequestHandler(handler: Request) { state.request = handler },
    setPermissionCheckHandler(handler: Check) { state.check = handler },
    setSpellCheckerEnabled(enabled: boolean) { state.spellcheck = enabled },
  }
  return { session, state }
}

function passes(state: { before?: Before }, url: string, type: string): boolean {
  let cancel: boolean | null = null
  state.before!({ url, resourceType: type }, (r) => { cancel = r.cancel })
  return cancel === false
}

test('hardenSession cancels what the rules refuse, and reads the core’s origin when asked', () => {
  const { session, state } = fakeSession()
  let core: string | null = null
  hardenSession(session, 'gb-core', () => core)
  expect(passes(state, `${CORE}/api/x`, 'xhr')).toBe(false) // the core is not up yet
  core = CORE
  expect(passes(state, `${CORE}/api/x`, 'xhr')).toBe(true)
  expect(passes(state, 'https://example.com/x.js', 'script')).toBe(false)
})

test('every hardened session turns the spellchecker off, so that no dictionary is fetched outside the request filter', () => {
  const partitioned = fakeSession()
  expect(partitioned.state.spellcheck).toBeUndefined()
  hardenSession(partitioned.session, 'gb-core', () => CORE)
  expect(partitioned.state.spellcheck).toBe(false)
  const standard = fakeSession()
  hardenDefaultSession(standard.session)
  expect(standard.state.spellcheck).toBe(false)
})

test('hardenSession answers permission requests and checks by the rule', () => {
  const { session, state } = fakeSession()
  hardenSession(session, 'gb-core', () => CORE)
  const grant = (permission: string, url: string | undefined) => {
    let granted: boolean | null = null
    state.request!({}, permission, (g) => { granted = g }, { requestingUrl: url })
    return granted
  }
  expect(grant('clipboard-sanitized-write', `${CORE}/#/stats`)).toBe(true)
  expect(grant('clipboard-sanitized-write', 'https://example.com/')).toBe(false)
  expect(grant('clipboard-sanitized-write', undefined)).toBe(false)
  expect(grant('notifications', `${CORE}/`)).toBe(false)
  expect(state.check!(null, 'clipboard-sanitized-write', CORE)).toBe(true)
  expect(state.check!(null, 'notifications', CORE)).toBe(false)
  expect(state.check!(null, 'clipboard-sanitized-write', 'https://example.com')).toBe(false)
})

test('the default session refuses every request and every permission', () => {
  const { session, state } = fakeSession()
  hardenDefaultSession(session)
  expect(passes(state, `${CORE}/api/x`, 'xhr')).toBe(false)
  expect(passes(state, 'https://act.hoyolab.com/', 'mainFrame')).toBe(false)
  expect(passes(state, 'data:text/plain,hi', 'image')).toBe(false)
  let granted: boolean | null = null
  state.request!({}, 'clipboard-sanitized-write', (g) => { granted = g }, { requestingUrl: CORE })
  expect(granted).toBe(false)
  expect(state.check!(null, 'clipboard-sanitized-write', CORE)).toBe(false)
})

type Handler = (event: { preventDefault(): void; url?: string }) => void

// A stand-in for a web contents.
function fakeContents() {
  const handlers = new Map<string, Handler>()
  const opener: { handler: (() => { action: string }) | null } = { handler: null }
  return {
    on(name: string, handler: Handler) { handlers.set(name, handler) },
    setWindowOpenHandler(handler: () => { action: 'deny' }) { opener.handler = handler },
    handlers,
    opener,
  }
}

function fire(contents: ReturnType<typeof fakeContents>, name: string, url?: string): boolean {
  let prevented = false
  contents.handlers.get(name)!({ preventDefault() { prevented = true }, url })
  return prevented
}

test('hardenApp refuses a webview and every scheme but http, https, about and file', () => {
  let created: ((event: unknown, contents: ReturnType<typeof fakeContents>) => void) | null = null
  let named = ''
  hardenApp({
    on(name, listener) {
      named = name
      created = listener as unknown as typeof created
    },
  })
  expect(named).toBe('web-contents-created')
  const contents = fakeContents()
  created!({}, contents)
  expect(fire(contents, 'will-attach-webview')).toBe(true)
  // pop-ups are denied until a window sets a handler of its own
  expect(contents.opener.handler?.()).toEqual({ action: 'deny' })
  for (const name of ['will-navigate', 'will-frame-navigate', 'will-redirect']) {
    expect(fire(contents, name, 'http://127.0.0.1:5123/')).toBe(false)
    expect(fire(contents, name, 'https://act.hoyolab.com/')).toBe(false)
    expect(fire(contents, name, 'about:blank')).toBe(false)
    expect(fire(contents, name, 'file:///C:/app/index.html')).toBe(false)
    expect(fire(contents, name, 'guildboard://invite/abcdefghijklmnop')).toBe(true)
    expect(fire(contents, name, 'ms-settings:privacy')).toBe(true)
    expect(fire(contents, name, 'data:text/html,<p>x')).toBe(true)
    expect(fire(contents, name, 'javascript:alert(1)')).toBe(true)
    expect(fire(contents, name, 'blob:http://127.0.0.1:5123/abc')).toBe(true)
    expect(fire(contents, name, 'junk')).toBe(true)
  }
})

// gb-dialog: the shell's own pages, from the app's pages folder alone
const PAGES = resolve('app', 'dist', 'pages')
const page = (...parts: string[]) => pathToFileURL(join(PAGES, ...parts)).href

test('gb-dialog allows file: URLs inside the pages folder, and nothing else', () => {
  const allowed = (url: string, type = 'mainFrame', folder: string | null = PAGES) =>
    requestAllowed('gb-dialog', url, type, CORE, folder)
  expect(allowed(page('paste.html'))).toBe(true)
  expect(allowed(`${page('choose.html')}?labels=%5B%5D`)).toBe(true)
  expect(allowed(page('dialog.css'), 'stylesheet')).toBe(true)
  expect(allowed(page('paste.js'), 'script')).toBe(true)
  expect(allowed(page('sub', 'x.js'), 'script')).toBe(true)
  // outside the folder, also by a look-alike name or a way up
  expect(allowed(pathToFileURL(resolve('app', 'dist', 'pages-other', 'paste.html')).href)).toBe(false)
  expect(allowed(pathToFileURL(resolve('app', 'dist', 'main.js')).href)).toBe(false)
  expect(allowed(`${pathToFileURL(PAGES).href}/../main.js`)).toBe(false)
  expect(allowed(pathToFileURL(PAGES).href)).toBe(false) // the folder itself
  expect(allowed('file://otherhost/share/app/dist/pages/paste.html')).toBe(false)
  // no web, no data, no core
  expect(allowed('https://act.hoyolab.com/')).toBe(false)
  expect(allowed(`${CORE}/api/state`, 'xhr')).toBe(false)
  expect(allowed('data:image/png;base64,AAAA', 'image')).toBe(false)
  expect(allowed('blob:file:///abc', 'image')).toBe(false)
  expect(allowed('junk')).toBe(false)
  // no folder given: nothing
  expect(allowed(page('paste.html'), 'mainFrame', null)).toBe(false)
  // the other partitions never take a file from this folder
  for (const partition of ['gb-core', 'gb-overlay', 'gb-map'] as const) {
    expect(requestAllowed(partition, page('paste.html'), 'mainFrame', CORE, PAGES)).toBe(false)
  }
})

test('hardenSession gives gb-dialog the pages folder, and no permission at all', () => {
  const { session, state } = fakeSession()
  hardenSession(session, 'gb-dialog', () => CORE, PAGES)
  expect(passes(state, page('paste.html'), 'mainFrame')).toBe(true)
  expect(passes(state, 'https://example.com/', 'mainFrame')).toBe(false)
  expect(passes(state, `${CORE}/api/x`, 'xhr')).toBe(false)
  let granted: boolean | null = null
  state.request!({}, 'clipboard-sanitized-write', (g) => { granted = g }, { requestingUrl: page('paste.html') })
  expect(granted).toBe(false)
  for (const permission of ['clipboard-sanitized-write', 'clipboard-read', 'media', 'notifications']) {
    expect(permissionAllowed('gb-dialog', permission, CORE, CORE)).toBe(false)
    expect(state.check!(null, permission, page('paste.html'))).toBe(false)
  }
})

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) guild-board-shell/2.0.0 Chrome/140.0.7339.133 Electron/45.2.3 Safari/537.36'

test('the user agent loses the app’s name and keeps Electron’s, so the windows do not pass as plain Chrome', () => {
  const without = withoutAppName(CHROME)
  expect(without).not.toContain('guild-board-shell')
  expect(without).toContain('Electron/45.2.3')
  expect(without).toBe('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.7339.133 Electron/45.2.3 Safari/537.36')
  expect(withoutAppName(without)).toBe(without) // nothing to remove
})

test('main() sets the user agent first, before the app is ready and before any session is made', () => {
  const source = readFileSync(resolve(import.meta.dirname, '..', 'src', 'main.ts'), 'utf8')
  const set = source.indexOf('app.userAgentFallback = withoutAppName(app.userAgentFallback)')
  expect(set).toBeGreaterThan(-1)
  expect(set).toBeGreaterThan(source.indexOf('async function main()'))
  expect(set).toBeLessThan(source.indexOf('app.whenReady()'))
  expect(set).toBeLessThan(source.indexOf('session.fromPartition'))
  expect(set).toBeLessThan(source.indexOf('session.defaultSession'))
})
