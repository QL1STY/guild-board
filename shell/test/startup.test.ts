import { expect, test } from 'vitest'
import { applyStartWithWindows, isStandardFolder, startupShortcut, type StartupDeps } from '../src/startup.js'

const SHORTCUT = 'C:\\Users\\Mia\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\Guild Board.lnk'

test('the shortcut is Guild Board.lnk in the Startup folder of the player’s Start menu', () => {
  expect(startupShortcut({ APPDATA: 'C:\\Users\\Mia\\AppData\\Roaming' })).toBe(SHORTCUT)
})

function fake(options: { packaged?: boolean; existing?: string; writes?: boolean } = {}) {
  // The shortcuts that exist, by path, with the target each points at.
  const files = new Map<string, { target: string; args: string }>()
  if (options.existing !== undefined) files.set(SHORTCUT, { target: options.existing, args: '' })
  const writes: { path: string; operation: string; target: string; args: string }[] = []
  const removed: string[] = []
  const warnings: string[] = []
  const deps: StartupDeps = {
    shortcut: SHORTCUT,
    execPath: options.packaged === false ? 'Z:\\repo\\shell\\node_modules\\electron\\dist\\electron.exe' : 'C:\\Users\\Mia\\AppData\\Local\\Programs\\Guild Board\\guildboard-app.exe',
    appFolder: options.packaged === false ? 'Z:\\my repo\\shell' : null,
    writeShortcutLink(path, operation, details) {
      writes.push({ path, operation, target: details.target, args: details.args ?? '' })
      if (options.writes === false) return false
      files.set(path, { target: details.target, args: details.args ?? '' })
      return true
    },
    remove(path) {
      removed.push(path)
      files.delete(path)
    },
    warn: (text) => warnings.push(text),
  }
  return { deps, files, writes, removed, warnings }
}

test('shortcut rewritten: a shortcut to the deleted tray program is replaced to start guildboard-app.exe hidden', () => {
  const f = fake({ existing: 'C:\\Users\\Mia\\AppData\\Local\\Programs\\Guild Board\\guildboard-tray.exe' })
  applyStartWithWindows(true, true, f.deps)
  expect(f.files.get(SHORTCUT)).toEqual({
    target: 'C:\\Users\\Mia\\AppData\\Local\\Programs\\Guild Board\\guildboard-app.exe',
    args: '--hidden',
  })
  expect(f.writes).toHaveLength(1)
  expect(f.writes[0].path).toBe(SHORTCUT)
})

test('turned on with no shortcut yet, it makes one', () => {
  const f = fake()
  applyStartWithWindows(true, true, f.deps)
  expect(f.files.get(SHORTCUT)?.args).toBe('--hidden')
})

test('in development the shortcut starts electron.exe with the app’s folder first', () => {
  const f = fake({ packaged: false })
  applyStartWithWindows(true, true, f.deps)
  expect(f.files.get(SHORTCUT)).toEqual({
    target: 'Z:\\repo\\shell\\node_modules\\electron\\dist\\electron.exe',
    args: '"Z:\\my repo\\shell" --hidden',
  })
})

test('turned off, the shortcut is removed', () => {
  const f = fake({ existing: 'C:\\x\\guildboard-app.exe' })
  applyStartWithWindows(false, true, f.deps)
  expect(f.removed).toEqual([SHORTCUT])
  expect(f.files.size).toBe(0)
})

test('a folder that is not the standard one writes and removes nothing, on or off', () => {
  const f = fake({ existing: 'C:\\x\\guildboard-app.exe' })
  applyStartWithWindows(true, false, f.deps)
  applyStartWithWindows(false, false, f.deps)
  expect(f.writes).toEqual([])
  expect(f.removed).toEqual([])
  expect(f.files.get(SHORTCUT)?.target).toBe('C:\\x\\guildboard-app.exe')
})

test('a shortcut that Windows would not write is told to the log, and nothing throws', () => {
  const f = fake({ writes: false })
  expect(() => applyStartWithWindows(true, true, f.deps)).not.toThrow()
  expect(f.warnings).toEqual(['The Start with Windows shortcut could not be made.'])
})

test('a shortcut that cannot be removed is told to the log, and nothing throws', () => {
  const f = fake({ existing: 'C:\\x\\guildboard-app.exe' })
  f.deps.remove = () => {
    throw new Error('locked')
  }
  expect(() => applyStartWithWindows(false, true, f.deps)).not.toThrow()
  expect(f.warnings).toEqual(['The Start with Windows shortcut could not be removed.'])
})

test('the standard folder is %LOCALAPPDATA%\\GuildBoard, whatever the case, and never the demo’s', () => {
  const env = { LOCALAPPDATA: 'C:\\Users\\Mia\\AppData\\Local' }
  expect(isStandardFolder('C:\\Users\\Mia\\AppData\\Local\\GuildBoard', false, env)).toBe(true)
  expect(isStandardFolder('c:\\users\\mia\\appdata\\local\\guildboard\\', false, env)).toBe(true)
  expect(isStandardFolder('C:\\Users\\Mia\\AppData\\Local\\GuildBoard-demo', false, env)).toBe(false)
  expect(isStandardFolder('C:\\Users\\Mia\\AppData\\Local\\GuildBoard', true, env)).toBe(false)
  expect(isStandardFolder('D:\\GuildBoard', false, env)).toBe(false)
})
