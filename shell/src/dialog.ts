/**
 * The shell's own dialogs (login.py: PasteDialog and AccountChooser): small pages of the app's `pages` folder in a window
 * of their own, in the in-memory partition `gb-dialog`. A page reaches the shell through `window.gbDialog` alone
 * (`pages/dialog-preload.ts`), which sends a value or a cancel; this side hears them from its own window and no other.
 * The pages carry the CSP `default-src 'self'` and fetch nothing remote.
 *
 * Nothing here touches Electron: `main.ts` hands the window and `ipcMain` in through `DialogDeps`.
 */
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { backgroundOf, type ThemeName } from './theme.js'

// The preload (pages/dialog-preload.ts) cannot load this file, so it writes the same two names; dialog.test.ts checks.
export const SUBMIT_CHANNEL = 'gb-dialog:submit'
export const CANCEL_CHANNEL = 'gb-dialog:cancel'
const LONGEST_VALUE = 65_536 // a pasted cookie line is a few thousand characters

export type PageName = 'paste' | 'choose' | 'bar'

/** The address of a page of the pages folder, with its parameters in the query. */
export function pageUrl(pagesFolder: string, page: PageName, params: Record<string, string> = {}): string {
  const url = pathToFileURL(join(pagesFolder, `${page}.html`))
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value)
  return url.href
}

/** The part of Electron's `ipcMain` that the dialogs use. */
export interface IpcLike {
  on(channel: string, listener: (event: { sender: unknown }, ...args: unknown[]) => void): unknown
  removeListener(channel: string, listener: (event: { sender: unknown }, ...args: unknown[]) => void): unknown
}

/** Hears what the page of `contents` sends, and no other page. A value is a string or a finite number, and not too long. */
export function listen(
  ipc: IpcLike,
  contents: unknown,
  handlers: { submit(value: string | number): void; cancel(): void },
): () => void {
  const submit = (event: { sender: unknown }, value: unknown): void => {
    if (event.sender !== contents) return
    if (typeof value === 'string' && value.length <= LONGEST_VALUE) handlers.submit(value)
    else if (typeof value === 'number' && Number.isFinite(value)) handlers.submit(value)
  }
  const cancel = (event: { sender: unknown }): void => {
    if (event.sender === contents) handlers.cancel()
  }
  ipc.on(SUBMIT_CHANNEL, submit)
  ipc.on(CANCEL_CHANNEL, cancel)
  return () => {
    ipc.removeListener(SUBMIT_CHANNEL, submit)
    ipc.removeListener(CANCEL_CHANNEL, cancel)
  }
}

/** The preferences of a dialog page: the bridge preload, and everything else shut. */
export function dialogWebPreferences(preload: string): DialogWebPreferences {
  return {
    partition: 'gb-dialog',
    preload,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webSecurity: true,
    spellcheck: false,
  }
}

export interface DialogWebPreferences {
  partition: 'gb-dialog'
  preload: string
  contextIsolation: true
  sandbox: true
  nodeIntegration: false
  webSecurity: true
  spellcheck: false
}

export interface DialogContentsLike {
  loadURL(url: string): Promise<void>
  on(event: string, listener: (...args: any[]) => void): unknown
  setWindowOpenHandler(handler: () => { action: 'deny' }): unknown
}

export interface DialogWindowLike {
  webContents: DialogContentsLike
  on(event: string, listener: (...args: any[]) => void): unknown
  setMenu(menu: null): void
  show(): void
  focus(): void
  close(): void
  isDestroyed(): boolean
}

export interface DialogWindowOptions {
  title: string
  /** The app's icon file (`appIconPath`), for the title bar. */
  icon: string
  width: number
  height: number
  /** The native window the dialog sits on (modal), or null. */
  parent: unknown
  modal: boolean
  show: false
  minimizable: false
  maximizable: false
  backgroundColor: string
  webPreferences: DialogWebPreferences
}

export interface DialogDeps {
  /** `<app>/dist/pages`. */
  pagesFolder: string
  /** `<app>/dist/pages/dialog-preload.js`. */
  preload: string
  /** The app's icon file (`appIconPath`). */
  icon: string
  ipc: IpcLike
  /** The theme the window and its page wear when made. Default Parchment. */
  theme?(): ThemeName
  createWindow(options: DialogWindowOptions): DialogWindowLike
}

const DIALOGS = {
  paste: { title: 'Paste a HoYoLAB login', width: 600, height: 460 },
  choose: { title: 'Choose a game account', width: 560, height: 420 },
} as const

/**
 * Opens the `paste` or `choose` page over `parent` and resolves with what the page submits: the pasted text, or the
 * number of the row chosen. Cancel, and closing the window, resolve null.
 */
export function askDialog(
  deps: DialogDeps,
  page: 'paste' | 'choose',
  params: Record<string, string>,
  parent: unknown,
): Promise<string | number | null> {
  return new Promise((resolve) => {
    const { title, width, height } = DIALOGS[page]
    const theme = deps.theme?.() ?? 'parchment'
    const win = deps.createWindow({
      title,
      icon: deps.icon,
      width,
      height,
      parent,
      modal: parent !== null,
      show: false,
      minimizable: false,
      maximizable: false,
      backgroundColor: backgroundOf(theme),
      webPreferences: dialogWebPreferences(deps.preload),
    })
    let done = false
    const finish = (value: string | number | null): void => {
      if (done) return
      done = true
      stop()
      resolve(value)
      if (!win.isDestroyed()) win.close()
    }
    const stop = listen(deps.ipc, win.webContents, {
      submit: (value) => {
        // The paste page sends text, and the chooser the number of its row.
        if (page === 'paste' ? typeof value === 'string' : Number.isInteger(value) && (value as number) >= 0) finish(value)
      },
      cancel: () => finish(null),
    })
    win.setMenu(null)
    win.on('closed', () => finish(null))
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    // The page never leaves itself.
    for (const name of ['will-navigate', 'will-frame-navigate', 'will-redirect']) {
      win.webContents.on(name, (event: { preventDefault(): void }) => event.preventDefault())
    }
    win.webContents.loadURL(pageUrl(deps.pagesFolder, page, { ...params, theme })).catch(() => finish(null))
    win.show()
    win.focus()
  })
}
