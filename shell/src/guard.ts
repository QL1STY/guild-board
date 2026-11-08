/**
 * What each window's session lets through. Every window runs in a partition of its own, in memory, and the default
 * session refuses everything. The rules are pure functions; `hardenSession` and `hardenApp` only wire them to Electron.
 *
 * Electron keeps only the last `webRequest.onBeforeRequest` listener of a session, and likewise the last permission
 * request and check handlers, so a second one set anywhere would silently drop this guard. These three calls are made
 * in this file alone (forbidden.test.ts enforces it); a window that needs a rule changes it here.
 */
import { isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hostOf, inHoyoverseDomains, sameOrigin, signInSite } from './links.js'

export type Partition = 'gb-core' | 'gb-overlay' | 'gb-map' | 'gb-login' | 'gb-verify' | 'gb-dialog'

function parse(url: string): URL | null {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

/** Whether `url` is a `data:` or `blob:` address, which stay inside the page. */
function inline(url: string): boolean {
  return url.startsWith('data:') || url.startsWith('blob:')
}

/** https and wss to HoYoverse's domains. */
function hoyoverseSecure(url: string): boolean {
  const parts = parse(url)
  return parts !== null && (parts.protocol === 'https:' || parts.protocol === 'wss:') && inHoyoverseDomains(hostOf(parts))
}

/** Whether `url` is a `file:` address of a file inside `folder` (not the folder itself, and no way up out of it). */
function insideFolder(url: string, folder: string | null): boolean {
  if (folder === null) return false
  const parts = parse(url)
  if (parts === null || parts.protocol !== 'file:') return false
  let path: string
  try {
    path = fileURLToPath(parts)
  } catch {
    return false
  }
  const way = relative(resolve(folder), resolve(path))
  return way !== '' && !way.startsWith('..') && !isAbsolute(way)
}

/**
 * Whether a window of `partition` may make this request. The dashboard and the overlay reach the core's origin alone;
 * the map, HoYoverse's domains alone; the login and verification windows show only HoYoverse's and the sign-in sites
 * in their main frame, as the Qt shell does. A frame inside it loads what the page needs (HoYoLAB's captcha, reCAPTCHA
 * and hCaptcha live in frames of other hosts), and so do its pictures, fonts and scripts from the providers' own CDNs.
 * The shell's own dialog pages (gb-dialog) load files of the app's `pages` folder (`pagesFolder`) and nothing else.
 */
export function requestAllowed(
  partition: Partition,
  url: string,
  resourceType: string,
  coreOrigin: string | null,
  pagesFolder: string | null = null,
): boolean {
  switch (partition) {
    case 'gb-core':
    case 'gb-overlay':
      return inline(url) || (coreOrigin !== null && sameOrigin(url, coreOrigin))
    case 'gb-map':
      return inline(url) || hoyoverseSecure(url)
    case 'gb-login':
    case 'gb-verify':
      if (resourceType === 'mainFrame') return signInSite(url) // which accepts HoYoverse's sites too
      return true
    case 'gb-dialog':
      return insideFolder(url, pagesFolder)
    default:
      return false
  }
}

/** Only the dashboard's copy button: `clipboard-sanitized-write` from the core's origin. Nothing else is granted. */
export function permissionAllowed(partition: Partition, permission: string, origin: string, coreOrigin: string | null): boolean {
  return partition === 'gb-core' && permission === 'clipboard-sanitized-write' && coreOrigin !== null && sameOrigin(origin, coreOrigin)
}

/** The part of an Electron session that `hardenSession` uses; tests put a stand-in in its place. */
export interface SessionLike {
  webRequest: {
    onBeforeRequest(listener: (details: { url: string; resourceType: string }, callback: (response: { cancel: boolean }) => void) => void): void
  }
  setPermissionRequestHandler(
    handler: (webContents: unknown, permission: string, callback: (granted: boolean) => void, details: { requestingUrl?: string }) => void,
  ): void
  setPermissionCheckHandler(handler: (webContents: unknown, permission: string, requestingOrigin: string) => boolean): void
  /** Off, so that Electron fetches no dictionary from the browser process, outside the request filter. */
  setSpellCheckerEnabled(enabled: boolean): void
}

/** Cancels each request the partition's rule refuses, and answers every permission by `permissionAllowed`. */
export function hardenSession(
  session: SessionLike,
  partition: Partition,
  coreOrigin: () => string | null,
  pagesFolder: string | null = null,
): void {
  session.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !requestAllowed(partition, details.url, details.resourceType, coreOrigin(), pagesFolder) })
  })
  session.setPermissionRequestHandler((_contents, permission, callback, details) => {
    callback(details.requestingUrl !== undefined && permissionAllowed(partition, permission, details.requestingUrl, coreOrigin()))
  })
  session.setPermissionCheckHandler((_contents, permission, origin) => permissionAllowed(partition, permission, origin, coreOrigin()))
  session.setSpellCheckerEnabled(false)
}

/**
 * The user agent without this app's name (Electron adds ` guild-board-shell/<version>` from package.json): the sign-in
 * providers need not learn it. `Electron/<version>` stays: removing it would make the windows pass as plain Chrome, which
 * would get around Google's refusal of embedded browsers.
 */
export function withoutAppName(userAgent: string): string {
  return userAgent.replace(/ guild-board-shell\/\S+/, '')
}

/** The default session: no window of ours uses it, so it refuses every request and every permission. */
export function hardenDefaultSession(session: SessionLike): void {
  session.webRequest.onBeforeRequest((_details, callback) => callback({ cancel: true }))
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  session.setPermissionCheckHandler(() => false)
  session.setSpellCheckerEnabled(false)
}

interface NavigationEvent {
  preventDefault(): void
  url?: string
}

/** The part of an Electron web contents that `hardenApp` uses. */
export interface ContentsLike {
  on(event: string, listener: (event: NavigationEvent) => void): unknown
  setWindowOpenHandler(handler: () => { action: 'deny' }): unknown
}

export interface AppLike {
  on(event: 'web-contents-created', listener: (event: unknown, contents: ContentsLike) => void): unknown
}

// The shell's own pages are `file:`; the others are the web's.
const SCHEMES = new Set(['http:', 'https:', 'about:', 'file:'])

const NAVIGATIONS = ['will-navigate', 'will-frame-navigate', 'will-redirect']

/**
 * For every web contents that is made: no embedded guest page may attach, no pop-up opens until its window says so, and no navigation (also a redirect, or one in a
 * frame) goes to a scheme but http, https, about and file, so no address is handed to a program of Windows'.
 */
export function hardenApp(app: AppLike): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault())
    // Electron opens a pop-up unless told not to. A window that opens pop-ups sets its own handler, replacing this one.
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    for (const name of NAVIGATIONS) {
      contents.on(name, (event) => {
        const parts = parse(event.url ?? '')
        if (parts === null || !SCHEMES.has(parts.protocol)) event.preventDefault()
      })
    }
  })
}
