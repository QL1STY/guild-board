/**
 * Start with Windows is one shortcut in the player's own Startup folder (startup.py). Nothing else is touched: no registry
 * and no scheduled task. It starts `guildboard-app.exe --hidden`, on the standard data folder alone, since a shortcut
 * carries no data folder: the demo and a Guild Board on any other folder leave the player's shortcut alone.
 * Nothing here touches Electron: `main.ts` hands `shell.writeShortcutLink` and the removal in through `StartupDeps`.
 */
import * as os from 'node:os'
import { win32 as path } from 'node:path'
import { shellArguments } from './desktop.js'

const SHORTCUT_NAME = 'Guild Board.lnk'

/** `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Guild Board.lnk`. */
export function startupShortcut(env: NodeJS.ProcessEnv): string {
  const roaming = env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
  return path.join(roaming, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', SHORTCUT_NAME)
}

/** Whether `folder` is the data folder the Startup shortcut starts: `%LOCALAPPDATA%\GuildBoard`, and never the demo's. */
export function isStandardFolder(folder: string, demo: boolean, env: NodeJS.ProcessEnv): boolean {
  if (demo) return false
  const local = env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
  const same = (a: string, b: string): boolean => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
  return same(folder, path.join(local, 'GuildBoard'))
}

export interface StartupDeps {
  /** `startupShortcut(process.env)`. */
  shortcut: string
  /** The program that runs now: `guildboard-app.exe` when packaged, `electron.exe` in development. */
  execPath: string
  /** The app's folder in development, null when packaged. */
  appFolder: string | null
  /** `shell.writeShortcutLink`: true when the shortcut was written. */
  writeShortcutLink(shortcut: string, operation: 'create' | 'update' | 'replace', details: { target: string; args?: string }): boolean
  /** Removes the file; no error when there is none. */
  remove(file: string): void
  /** A line for the log. */
  warn?(text: string): void
}

/** An argument as a command line carries it: in quotes when it holds a space. */
function quoted(argument: string): string {
  return /[\s"]/.test(argument) ? `"${argument.replaceAll('"', '\\"')}"` : argument
}

/**
 * Makes the shortcut, or removes it, to match the setting; only for the standard data folder. Made again each time it is
 * on, so that it points at this copy of Guild Board: a shortcut of the Qt build, to the deleted `guildboard-tray.exe`, is
 * replaced by one to `guildboard-app.exe --hidden`. Applied at every start and at every change of the setting.
 */
export function applyStartWithWindows(on: boolean, standardFolder: boolean, deps: StartupDeps): void {
  if (!standardFolder) return
  if (!on) {
    try {
      deps.remove(deps.shortcut)
    } catch {
      deps.warn?.('The Start with Windows shortcut could not be removed.')
    }
    return
  }
  const args = shellArguments(deps.appFolder, ['--hidden']).map(quoted).join(' ')
  let written = false
  try {
    written = deps.writeShortcutLink(deps.shortcut, 'create', { target: deps.execPath, args })
  } catch {
    written = false
  }
  if (!written) deps.warn?.('The Start with Windows shortcut could not be made.')
}
