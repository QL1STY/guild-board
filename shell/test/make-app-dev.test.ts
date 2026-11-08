import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Data, NtExecutable, NtExecutableResource, Resource } from 'resedit'
import { afterEach, beforeEach, expect, test } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPT = resolve(HERE, '..', 'scripts', 'make-app-dev.mjs')
const ICON = resolve(HERE, '..', 'assets', 'icon.ico')
const STAMP = 'guild-board-stamp.json'
const EN_US = { lang: 1033, codepage: 1200 }
const RT_ICON = 3

const sha256 = (data: ArrayBuffer | Uint8Array): string => createHash('sha256').update(new Uint8Array(data)).digest('hex')

/**
 * A small Windows program shaped as Electron's is where the copy changes it: one version resource that says Electron,
 * and one icon group, here with a single picture that is not the app's.
 */
function fakeElectron(): Buffer {
  const exe = NtExecutable.createEmpty()
  const res = NtExecutableResource.from(exe)
  const version = Resource.VersionInfo.createEmpty()
  version.setStringValues(EN_US, { FileDescription: 'Electron', ProductName: 'Electron', OriginalFilename: 'electron.exe' })
  version.outputToResourceEntries(res.entries)
  Resource.IconGroupEntry.replaceIconsForResource(res.entries, 1, 1033, [Data.RawIconItem.from(Buffer.from('not the app icon'), 16, 16, 32)])
  res.outputResource(exe)
  return Buffer.from(exe.generate())
}

/** What the copy changes in a program: its version strings, and its icon group's pictures, each as its bytes' hash. */
function resources(program: Buffer): { strings: Record<string, string>; icons: string[] } {
  const entries = NtExecutableResource.from(NtExecutable.from(program)).entries
  const versions = Resource.VersionInfo.fromEntries(entries)
  const groups = Resource.IconGroupEntry.fromEntries(entries)
  expect(versions).toHaveLength(1)
  expect(groups).toHaveLength(1)
  const icons = groups[0].icons.map((item) => entries.find((entry) => entry.type === RT_ICON && entry.id === item.iconID)!.bin)
  return { strings: versions[0].getStringValues(EN_US), icons: icons.map(sha256) }
}

/** The pictures of an .ico file, in its order, each as its bytes' hash. */
function icoPictures(ico: Buffer): string[] {
  return Array.from({ length: ico.readUInt16LE(4) }, (_, at) => {
    const size = ico.readUInt32LE(6 + 16 * at + 8)
    const offset = ico.readUInt32LE(6 + 16 * at + 12)
    return sha256(ico.subarray(offset, offset + size))
  })
}

/** Every file of a folder, by its path inside it, with its bytes' hash. */
function snapshot(folder: string): Record<string, string> {
  const files: Record<string, string> = {}
  for (const name of readdirSync(folder, { recursive: true, withFileTypes: true })) {
    if (name.isFile()) files[join(name.parentPath, name.name).slice(folder.length + 1)] = sha256(readFileSync(join(name.parentPath, name.name)))
  }
  return files
}

const stampIn = (folder: string): unknown => JSON.parse(readFileSync(join(folder, STAMP), 'utf8'))

let root: string
let dist: string
let target: string
let icon: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'gb-app-dev-'))
  dist = join(root, 'dist')
  target = join(root, 'app-dev')
  icon = join(root, 'icon.ico')
  mkdirSync(join(dist, 'resources'), { recursive: true })
  mkdirSync(join(dist, 'locales'))
  writeFileSync(join(dist, 'electron.exe'), fakeElectron())
  writeFileSync(join(dist, 'version'), '45.2.3')
  writeFileSync(join(dist, 'ffmpeg.dll'), 'a library')
  writeFileSync(join(dist, 'resources', 'default_app.asar'), 'the default app')
  writeFileSync(join(dist, 'locales', 'en-US.pak'), 'words')
  copyFileSync(ICON, icon)
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** The script as setup.ps1 runs it, pointed at the scratch folders; with no `icon`, it takes the app's own. */
function run(options: { script?: string; target?: string; icon?: string } = {}) {
  const argv = [options.script ?? SCRIPT, '--dist', dist, '--target', options.target ?? target]
  if (options.icon !== undefined) argv.push('--icon', options.icon)
  return spawnSync(process.execPath, argv, { encoding: 'utf8', timeout: 60_000 })
}

test('the copy holds Electron’s folder, and its electron.exe says Guild Board and has the app’s icon', () => {
  const electron = readFileSync(join(dist, 'electron.exe'))
  const done = run()
  expect(done.status, done.stderr).toBe(0)
  expect(done.stdout).toBe(`Made the copy of Electron 45.2.3 named for Guild Board in ${target}.\n`)
  for (const name of ['ffmpeg.dll', join('resources', 'default_app.asar'), join('locales', 'en-US.pak'), 'version']) {
    expect(readFileSync(join(target, name)), name).toEqual(readFileSync(join(dist, name)))
  }
  // It keeps the name electron.exe, by which Electron knows it runs a checkout (app.isPackaged), and adds only its stamp.
  expect(readdirSync(target).sort()).toEqual(['electron.exe', 'ffmpeg.dll', STAMP, 'locales', 'resources', 'version'])
  const before = resources(electron)
  const after = resources(readFileSync(join(target, 'electron.exe')))
  expect(before.strings).toMatchObject({ FileDescription: 'Electron', ProductName: 'Electron' })
  expect(after.strings).toEqual({ ...before.strings, FileDescription: 'Guild Board', ProductName: 'Guild Board' })
  expect(before.icons).not.toEqual(icoPictures(readFileSync(ICON)))
  expect(after.icons).toEqual(icoPictures(readFileSync(ICON)))
  // The stamp says what the copy was made from: Electron's version, the icon file's SHA-256 and the name.
  expect(stampIn(target)).toEqual({ electron: '45.2.3', iconSha256: sha256(readFileSync(ICON)), name: 'Guild Board' })
  expect(readFileSync(join(dist, 'electron.exe'))).toEqual(electron) // Electron's own program is left as it was
})

test('a copy made for the same Electron is kept as it is, and another version of Electron makes it again', () => {
  expect(run().status).toBe(0)
  writeFileSync(join(target, 'left-by-the-first-copy'), '')
  const kept = run()
  expect(kept.status, kept.stderr).toBe(0)
  expect(kept.stdout).toBe(`The copy of Electron 45.2.3 named for Guild Board in ${target} is up to date.\n`)
  expect(existsSync(join(target, 'left-by-the-first-copy'))).toBe(true) // nothing was copied again
  writeFileSync(join(dist, 'version'), '45.3.0')
  const made = run()
  expect(made.status, made.stderr).toBe(0)
  expect(made.stdout).toContain('Made the copy of Electron 45.3.0')
  expect(existsSync(join(target, 'left-by-the-first-copy'))).toBe(false) // made afresh, with nothing of the old copy
  expect(readFileSync(join(target, 'version'), 'utf8')).toBe('45.3.0')
  expect(stampIn(target)).toMatchObject({ electron: '45.3.0' })
})

test('another icon makes the copy again, with its pictures', () => {
  expect(run({ icon }).status).toBe(0)
  writeFileSync(join(target, 'left-by-the-first-copy'), '')
  expect(run({ icon }).stdout).toContain('is up to date')
  const other = Data.IconFile.from(readFileSync(ICON))
  other.icons = other.icons.slice(0, 3) // the 16, 20 and 24 pixel pictures alone: another icon file
  writeFileSync(icon, Buffer.from(other.generate()))
  const done = run({ icon })
  expect(done.status, done.stderr).toBe(0)
  expect(done.stdout).toContain('Made the copy of Electron 45.2.3')
  expect(existsSync(join(target, 'left-by-the-first-copy'))).toBe(false)
  expect(resources(readFileSync(join(target, 'electron.exe'))).icons).toEqual(icoPictures(readFileSync(icon)))
  expect(stampIn(target)).toEqual({ electron: '45.2.3', iconSha256: sha256(readFileSync(icon)), name: 'Guild Board' })
})

test('a stamp that differs in any part, or cannot be read, makes the copy again', () => {
  expect(run().status).toBe(0)
  const made = stampIn(target) as Record<string, string>
  for (const stamp of [
    JSON.stringify({ ...made, electron: '45.2.2' }),
    JSON.stringify({ ...made, iconSha256: '0'.repeat(64) }),
    JSON.stringify({ ...made, name: 'Electron' }),
    'not a stamp',
  ]) {
    writeFileSync(join(target, STAMP), stamp)
    const done = run()
    expect(done.status, done.stderr).toBe(0)
    expect(done.stdout, stamp).toContain('Made the copy')
    expect(stampIn(target)).toEqual(made)
  }
})

test('a copy cut short before its stamp was written is made again', () => {
  expect(run().status).toBe(0)
  rmSync(join(target, STAMP))
  writeFileSync(join(target, 'left-by-the-first-copy'), '')
  const done = run()
  expect(done.status, done.stderr).toBe(0)
  expect(done.stdout).toContain('Made the copy')
  expect(existsSync(join(target, 'left-by-the-first-copy'))).toBe(false)
  expect(stampIn(target)).toMatchObject({ electron: '45.2.3' })
})

test('a program it cannot name makes no copy, and says so', () => {
  writeFileSync(join(dist, 'electron.exe'), 'not a Windows program')
  const done = run()
  expect(done.status).toBe(1)
  expect(done.stderr).toContain('could not be named for Guild Board')
  expect(existsSync(target)).toBe(false) // it is named before anything is written
})

test('a newer Electron it cannot name leaves the copy made before as it was, so the shortcut still starts', () => {
  expect(run().status).toBe(0)
  const before = snapshot(target)
  writeFileSync(join(dist, 'electron.exe'), 'not a Windows program')
  writeFileSync(join(dist, 'version'), '45.3.0')
  const done = run()
  expect(done.status).toBe(1)
  expect(done.stderr).toContain('could not be named for Guild Board')
  expect(snapshot(target)).toEqual(before)
})

test('the copy’s folder may not be Electron’s folder, lie inside it, or hold it, and nothing is touched then', () => {
  const before = snapshot(dist)
  for (const folder of [dist, join(dist, 'app-dev'), root]) {
    const done = run({ target: folder })
    expect(done.status, folder).toBe(1)
    expect(done.stderr).toContain(`The copy's folder ${folder} must lie outside Electron's folder ${dist}, and must not hold it.`)
    expect(snapshot(dist), folder).toEqual(before)
  }
  expect(existsSync(join(dist, 'app-dev'))).toBe(false)
  expect(existsSync(target)).toBe(false)
})

test('with no Electron program to copy it says so and makes nothing', () => {
  rmSync(dist, { recursive: true })
  const done = run()
  expect(done.status).toBe(1)
  expect(done.stderr).toContain(`Electron's program is not in ${dist}.`)
  expect(existsSync(target)).toBe(false)
})

test('without the package resedit it says so plainly and makes nothing', () => {
  // A copy of the script where no node_modules holds resedit.
  const script = join(root, 'elsewhere', 'scripts', 'make-app-dev.mjs')
  mkdirSync(dirname(script), { recursive: true })
  copyFileSync(SCRIPT, script)
  const done = run({ script })
  expect(done.status).toBe(1)
  expect(done.stderr).toBe("The package resedit is missing. Install the shell's packages first (npm ci in shell).\n")
  expect(existsSync(target)).toBe(false)
})
