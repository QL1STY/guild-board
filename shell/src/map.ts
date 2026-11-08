/**
 * The map views of the Map page (maphost.py): one browser view for each tab the player has looked at, children of the
 * dashboard's window, laid over the empty area the Map page leaves for them.
 *
 * The interface is a page and loads nothing from the internet, so HoYoLAB's map cannot be a frame in it. Each view shows
 * only HoYoverse's own pages, all in one session kept in memory (`gb-map`), which holds the login the core gives. The core
 * knows the tabs and where the area is; this follows what it says through `follow`, and where the dashboard's page is
 * through `fragment` and `resized`.
 *
 * The login's cookies come from the core over the channel (`map_session`) and go into the session and nowhere else: they
 * are not logged, not kept in a field and not passed to a view. Nothing here touches Electron: `main.ts` hands the
 * session, the views and the dashboard's content in through `MapDeps`.
 */
import { isHoyoverse } from './links.js'
import type { Bounds } from './placement.js'
import type { CallName, MapSnapshot } from './protocol.js'

export const DISCARD_AFTER_MS = 60_000 // the views go this long after the player leaves the Map page
export const SEEN_EVERY_MS = 1_000 // a map in motion changes its address all the time: the core hears of one a second
const COOKIE_URL = 'https://act.hoyolab.com/'
const COOKIE_DOMAIN = '.hoyolab.com'
// HoYoLAB sets these HttpOnly itself.
const HIDDEN_FROM_SCRIPTS = new Set(['ltoken_v2', 'cookie_token_v2', 'ltoken', 'cookie_token'])
const REGION = /^[a-z0-9_]{1,20}$/
const DIGITS = /^[0-9]+$/
const ROLE_ARGUMENT = '--gb-map-role='
const ABORTED = -3 // Chromium's ERR_ABORTED: a load that another load replaced

/** The area, in the dashboard's CSS pixels, as the bounds it is in the window: the page draws at `zoom`. */
export function viewBounds(viewport: { x: number; y: number; w: number; h: number }, zoom: number): Bounds {
  return {
    x: Math.round(viewport.x * zoom),
    y: Math.round(viewport.y * zoom),
    width: Math.round(viewport.w * zoom),
    height: Math.round(viewport.h * zoom),
  }
}

/** Whether the dashboard's fragment is the Map page's: "#/map", or below it. */
export function onMapPage(fragment: string): boolean {
  const place = fragment.startsWith('#') ? fragment.slice(1) : fragment
  return place === '/map' || place.startsWith('/map/') || place.startsWith('/map?')
}

interface NavigationEvent {
  preventDefault(): void
  url?: string
  isMainFrame?: boolean
}

/** The part of an Electron web contents that a map view uses. */
export interface MapContentsLike {
  loadURL(url: string): Promise<void>
  reload(): void
  close(): void
  isDestroyed(): boolean
  on(event: string, listener: (...args: any[]) => void): unknown
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' }): unknown
  navigationHistory: { canGoBack(): boolean; goBack(): void }
}

/** The part of Electron's `WebContentsView` that the host uses. */
export interface MapViewLike {
  webContents: MapContentsLike
  setBounds(bounds: Bounds): void
  setVisible(visible: boolean): void
}

/** The part of the dashboard window's `contentView` that the host uses. */
export interface ContentViewLike {
  addChildView(view: MapViewLike): void
  removeChildView(view: MapViewLike): void
}

export interface MapViewOptions {
  webPreferences: {
    partition: 'gb-map'
    preload: string
    additionalArguments: string[]
    contextIsolation: true
    sandbox: true
    nodeIntegration: false
    webSecurity: true
    spellcheck: false
  }
}

export interface CookieDetails {
  url: string
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  httpOnly: boolean
}

/** The part of the `gb-map` session that the host uses. */
export interface MapSessionLike {
  cookies: { set(details: CookieDetails): Promise<void> }
  clearStorageData(options: { storages: string[] }): Promise<void>
}

export interface MapDeps {
  /** `CoreProcess.call`. */
  call(name: CallName, args?: object): Promise<unknown>
  session: MapSessionLike
  /** The dashboard window's content, or null while that window is closed. */
  holder(): ContentViewLike | null
  /** How large the dashboard's page draws now (`Dashboard.zoom`). */
  zoom(): number
  createView(options: MapViewOptions): MapViewLike
  /** The path of `map-preload.js`. */
  preload: string
  /** A line for the log; it never holds a cookie. */
  warn?(text: string): void
}

interface Seen {
  url: string
  title: string
}

interface Tab {
  id: number
  view: MapViewLike
  holder: ContentViewLike
  reloads: number
  role: string // the role argument the view was made with
  reported: Seen // the address and title the core last heard
  pending: Seen | null // newer ones, not yet told
  lastTold: number | null
  timer: ReturnType<typeof setTimeout> | null
  failed: boolean | null // what the core last heard
  loadFailed: boolean // the page in the view is Chromium's error page: set by a main-frame failure, cleared by a new navigation
}

export class MapHost {
  private snapshot: MapSnapshot | null = null
  private onPage = false
  private lastSession: number | null = null
  private sessionKnown = false
  private generation = 0
  private roleArguments: string[] = []
  private readonly tabs = new Map<number, Tab>()
  private discardTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false
  private refreshing: Promise<void> = Promise.resolve()

  constructor(private readonly deps: MapDeps) {}

  /** The core's map snapshot (the `map` event): the tabs, the active one, the area, and the session's number. */
  follow(snapshot: MapSnapshot): void {
    if (this.disposed) return
    this.snapshot = snapshot
    if (snapshot.session !== this.lastSession) {
      this.lastSession = snapshot.session
      this.refreshSession()
    }
    this.sync(this.deps.zoom())
  }

  /** The dashboard's page moved: `fragment` is its address fragment with the "#", such as "#/map". */
  fragment(fragment: string): void {
    if (this.disposed) return
    this.onPage = onMapPage(fragment)
    this.sync(this.deps.zoom())
  }

  /** The dashboard's window changed size, and its page now draws at `zoom`. */
  resized(zoom: number): void {
    if (this.disposed) return
    this.sync(zoom)
  }

  /** The dashboard's window was released: its views are no more. A window opened again makes them when the page shows. */
  windowGone(): void {
    this.dropAll()
  }

  /** As Guild Board ends: the views go, and with them the session. */
  dispose(): void {
    this.disposed = true
    this.generation += 1
    this.dropAll()
    this.deps.session.clearStorageData({ storages: ['cookies'] }).catch(() => undefined)
  }

  // ------------------------------------------------------------------ the session

  /**
   * The session changed (or is first seen). Refreshes run one after another, so an older login's cookies are never
   * written over a newer one's; one that a newer refresh has overtaken before it starts is skipped, and one under way
   * stops writing cookies at the next one.
   */
  private refreshSession(): void {
    const generation = ++this.generation
    // A refresh that throws must not stop the later ones, or a logout would never reach the map's session.
    this.refreshing = this.refreshing
      .then(() => this.runRefresh(generation))
      .catch(() => this.deps.warn?.('The session for the map could not be refreshed.'))
  }

  private async runRefresh(generation: number): Promise<void> {
    if (generation !== this.generation || this.disposed) return
    let cookies: Record<string, string> | null
    let role: { uid?: unknown; region?: unknown } | null
    try {
      ;[cookies, role] = (await Promise.all([this.deps.call('map_session'), this.deps.call('map_role')])) as [
        Record<string, string> | null,
        { uid?: unknown; region?: unknown } | null,
      ]
    } catch {
      if (this.sessionKnown) return // the views keep the session they have
      this.deps.warn?.('The session for the map could not be read; the map opens signed out.')
      cookies = null
      role = null
    }
    if (generation !== this.generation || this.disposed) return
    try {
      await this.signIn(cookies, generation)
    } catch {
      this.deps.warn?.('The session for the map could not be set.') // never with the cookies
    }
    if (generation !== this.generation || this.disposed) return
    this.roleArguments = roleArguments(role)
    const roleKey = this.roleArguments.join(' ')
    const known = this.sessionKnown
    this.sessionKnown = true
    if (known) {
      // The views already open take the session: a reload, or a new view when the game account they were told is another.
      for (const tab of [...this.tabs.values()]) {
        if (tab.role === roleKey) tab.view.webContents.reload()
        else this.destroy(tab)
      }
    }
    this.sync(this.deps.zoom())
  }

  private async signIn(cookies: Record<string, string> | null, generation: number): Promise<void> {
    await this.deps.session.clearStorageData({ storages: ['cookies'] })
    if (cookies === null) return
    for (const [name, value] of Object.entries(cookies)) {
      if (generation !== this.generation) return // a newer login has begun; it clears and sets its own
      await this.deps.session.cookies.set({
        url: COOKIE_URL,
        name,
        value,
        domain: COOKIE_DOMAIN,
        path: '/',
        secure: true,
        httpOnly: HIDDEN_FROM_SCRIPTS.has(name),
      })
    }
  }

  // ------------------------------------------------------------------ following the core

  /**
   * Brings the views to what the core says. A map holds hundreds of megabytes, so a view is made only for the active tab,
   * and only while the dashboard shows its Map page; another tab's is made when it becomes active, and the old one goes at
   * once. A view stays, hidden, while the dashboard shows another page, and goes after DISCARD_AFTER_MS.
   */
  private sync(zoom: number): void {
    const snapshot = this.snapshot
    const holder = this.deps.holder()
    if (snapshot === null || holder === null || !this.sessionKnown) {
      this.dropAll()
      return
    }
    const tabs = new Map(snapshot.tabs.map((tab) => [tab.id, tab]))
    for (const tab of [...this.tabs.values()]) {
      if (tab.holder !== holder || !tabs.has(tab.id) || tab.id !== snapshot.active) this.destroy(tab)
    }
    const active = snapshot.active
    const wanted = active === null ? undefined : tabs.get(active)
    if (this.onPage && wanted !== undefined && !this.tabs.has(wanted.id)) this.open(wanted.id, wanted.url, wanted.reload, holder)
    for (const tab of this.tabs.values()) {
      const reloads = tabs.get(tab.id)?.reload ?? 0
      if (reloads !== tab.reloads) {
        tab.reloads = reloads
        tab.view.webContents.reload()
      }
    }
    const area = snapshot.viewport
    const showing = this.onPage && area !== null && !area.hidden && area.w > 0 && area.h > 0
    for (const tab of this.tabs.values()) {
      if (showing && area !== null) {
        tab.view.setBounds(viewBounds(area, zoom))
        tab.view.setVisible(true)
      } else {
        tab.view.setVisible(false)
      }
    }
    this.schedule()
  }

  /** Away from the Map page, the views go once DISCARD_AFTER_MS has passed; coming back cancels that. */
  private schedule(): void {
    if (this.onPage || this.tabs.size === 0) {
      if (this.discardTimer !== null) clearTimeout(this.discardTimer)
      this.discardTimer = null
    } else if (this.discardTimer === null) {
      this.discardTimer = setTimeout(() => {
        this.discardTimer = null
        this.dropAll()
      }, DISCARD_AFTER_MS)
    }
  }

  private open(id: number, url: string, reloads: number, holder: ContentViewLike): void {
    const view = this.deps.createView({
      webPreferences: {
        partition: 'gb-map',
        preload: this.deps.preload,
        additionalArguments: [...this.roleArguments],
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        spellcheck: false,
      },
    })
    const tab: Tab = {
      id,
      view,
      holder,
      reloads, // a new view loads fresh: the reloads asked are done
      role: this.roleArguments.join(' '),
      reported: { url, title: '' },
      pending: null,
      lastTold: null,
      timer: null,
      failed: null,
      loadFailed: false,
    }
    this.tabs.set(id, tab)
    view.setVisible(false)
    holder.addChildView(view)
    this.wire(tab)
    void view.webContents.loadURL(url).catch(() => undefined)
  }

  private wire(tab: Tab): void {
    const contents = tab.view.webContents
    // A view stays on HoYoverse; a frame it makes for itself (about:blank, about:srcdoc) is the one exception.
    const kept = (event: NavigationEvent): void => {
      const url = event.url ?? ''
      const frame = event.isMainFrame === false && url.startsWith('about:')
      if (!isHoyoverse(url) && !frame) event.preventDefault()
    }
    for (const name of ['will-navigate', 'will-frame-navigate', 'will-redirect']) contents.on(name, kept)
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    // A load that fails is followed by a finish for Chromium's error page, with no navigation: it is no success. A new
    // main-frame navigation to another document starts afresh.
    contents.on('did-start-navigation', (details: { isMainFrame?: boolean; isSameDocument?: boolean }) => {
      if (details.isMainFrame === true && details.isSameDocument !== true) tab.loadFailed = false
    })
    contents.on('did-navigate', (_event: unknown, url: string) => {
      tab.loadFailed = false
      // An empty page (about:blank) set from another frame does not reach the checks above: back to the map.
      if (url !== '' && !isHoyoverse(url)) {
        if (contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack()
        return
      }
      this.moved(tab, url, null)
    })
    contents.on('did-navigate-in-page', (_event: unknown, url: string, isMainFrame: boolean) => {
      if (isMainFrame) this.moved(tab, url, null)
    })
    contents.on('page-title-updated', (_event: unknown, title: string) => this.moved(tab, null, title))
    contents.on('did-fail-load', (_event: unknown, code: number, _text: string, _url: string, isMainFrame: boolean) => {
      if (isMainFrame && code !== ABORTED) {
        tab.loadFailed = true
        this.loaded(tab, true)
      }
    })
    contents.on('did-finish-load', () => {
      if (!tab.loadFailed) this.loaded(tab, false)
    })
  }

  // ------------------------------------------------------------------ what the views say

  private loaded(tab: Tab, failed: boolean): void {
    if (this.tabs.get(tab.id) !== tab || tab.failed === failed) return
    tab.failed = failed
    this.deps.call('map_failed', { tab_id: tab.id, failed }).catch(() => undefined)
  }

  /** The address or the title of a view changed: the core hears the latest of them, a second apart at most. */
  private moved(tab: Tab, url: string | null, title: string | null): void {
    if (this.tabs.get(tab.id) !== tab) return
    const base = tab.pending ?? tab.reported
    tab.pending = { url: url ?? base.url, title: title ?? base.title }
    const wait = tab.lastTold === null ? 0 : Math.max(0, tab.lastTold + SEEN_EVERY_MS - Date.now())
    if (wait === 0) {
      this.tell(tab)
    } else if (tab.timer === null) {
      tab.timer = setTimeout(() => {
        tab.timer = null
        this.tell(tab)
      }, wait)
    }
  }

  private tell(tab: Tab): void {
    const news = tab.pending
    tab.pending = null
    if (news === null || this.tabs.get(tab.id) !== tab) return
    if (news.url === tab.reported.url && news.title === tab.reported.title) return
    tab.reported = news
    tab.lastTold = Date.now()
    this.deps.call('map_seen', { tab_id: tab.id, url: news.url, title: news.title }).catch(() => undefined)
  }

  // ------------------------------------------------------------------ going

  private destroy(tab: Tab): void {
    // The last position is not lost with the view (a tab switch, a discard, the end).
    if (tab.timer !== null) clearTimeout(tab.timer)
    tab.timer = null
    this.tell(tab)
    this.tabs.delete(tab.id)
    try {
      tab.holder.removeChildView(tab.view)
    } catch {
      // the window it sat on is gone already
    }
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close()
  }

  private dropAll(): void {
    for (const tab of [...this.tabs.values()]) this.destroy(tab)
    if (this.discardTimer !== null) clearTimeout(this.discardTimer)
    this.discardTimer = null
  }
}

/**
 * The preload's role argument, or none: the game account's UID and region, plain only. The HoYoLAB account number is not
 * in it (a program's argument is visible to every program of the player's): the preload reads it from the cookie.
 */
function roleArguments(role: { uid?: unknown; region?: unknown } | null): string[] {
  if (role === null) return []
  const uid = String(role.uid ?? '')
  const region = String(role.region ?? '')
  // Numbers and a plain region name only: they go into a program argument and a page's local storage.
  if (!DIGITS.test(uid) || !REGION.test(region)) return []
  return [ROLE_ARGUMENT + encodeURIComponent(JSON.stringify({ uid, region }))]
}
