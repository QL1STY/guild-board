// Makes shell\app-dev: a copy of Electron's own program (node_modules\electron\dist) whose electron.exe carries Guild
// Board's name and icon, for the desktop shortcut that setup.ps1 makes. Electron's program says "Electron" in Task
// Manager, on the taskbar and on the tray's balloons; the copy says "Guild Board" (its FileDescription and ProductName)
// and has the app's icon (assets\icon.ico).
//
//     node scripts/make-app-dev.mjs [--dist <Electron's folder>] [--target <the copy's folder>] [--icon <an .ico file>]
//
// The copy keeps the name electron.exe: Electron tells a checkout from an installed app by the program's name
// (app.isPackaged), and the shell must stay in development mode, so that it starts the core from .venv.
//
// The copy holds a stamp of what it was made from: Electron's version, the icon file's SHA-256 and the name. It is made
// again only when one of them is not the stamp's. The program is named before the old copy goes, so a program that cannot
// be named leaves the old copy working; it is written whole under another name and then renamed, and the stamp is
// written last, so a copy cut short holds no half-written program and is made again.
import { createHash } from 'node:crypto'
import { cpSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const NAME = 'Guild Board'
const PROGRAM = 'electron.exe'
const STAMP = 'guild-board-stamp.json'

function fail(text) {
  console.error(text)
  process.exit(1)
}

const reason = (error) => (error instanceof Error ? error.message : String(error))

let resedit
try {
  resedit = await import('resedit')
} catch {
  fail("The package resedit is missing. Install the shell's packages first (npm ci in shell).")
}
const { Data, NtExecutable, NtExecutableResource, Resource } = resedit

const shellRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { values } = parseArgs({ options: { dist: { type: 'string' }, target: { type: 'string' }, icon: { type: 'string' } } })
const dist = resolve(values.dist ?? join(shellRoot, 'node_modules', 'electron', 'dist'))
const target = resolve(values.target ?? join(shellRoot, 'app-dev'))
const icon = resolve(values.icon ?? join(shellRoot, 'assets', 'icon.ico'))

/** Whether `inner` is `outer` or lies inside it. */
function within(inner, outer) {
  const route = relative(outer, inner)
  return route === '' || (route !== '..' && !route.startsWith(`..${sep}`) && !isAbsolute(route))
}

// The copy's folder is emptied before the copy is made: it may not be Electron's folder, lie inside it or hold it.
if (within(target, dist) || within(dist, target)) {
  fail(`The copy's folder ${target} must lie outside Electron's folder ${dist}, and must not hold it.`)
}

/** Electron's program (its bytes) with Guild Board's name and the pictures of `ico` (an .ico file's bytes) as its icon. */
function named(program, ico) {
  const exe = NtExecutable.from(program)
  const res = NtExecutableResource.from(exe)
  const groups = Resource.IconGroupEntry.fromEntries(res.entries)
  const versions = Resource.VersionInfo.fromEntries(res.entries)
  if (groups.length !== 1 || versions.length !== 1) throw new Error('it has not one icon and one version resource')
  const languages = versions[0].getAllLanguagesForStringValues()
  if (languages.length !== 1) throw new Error('its version strings are not in one language')
  const pictures = Data.IconFile.from(ico).icons.map((item) => item.data)
  Resource.IconGroupEntry.replaceIconsForResource(res.entries, groups[0].id, groups[0].lang, pictures)
  versions[0].setStringValues(languages[0], { FileDescription: NAME, ProductName: NAME })
  versions[0].outputToResourceEntries(res.entries)
  res.outputResource(exe)
  return Buffer.from(exe.generate())
}

function readText(file) {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

const version = existsSync(join(dist, PROGRAM)) ? readText(join(dist, 'version'))?.trim() || null : null
if (version === null) fail(`Electron's program is not in ${dist}. Install the shell's packages first (npm ci in shell).`)
let ico
try {
  ico = readFileSync(icon)
} catch {
  fail(`The icon ${icon} could not be read.`)
}
const stamp = { electron: version, iconSha256: createHash('sha256').update(ico).digest('hex'), name: NAME }

let found = null
try {
  found = JSON.parse(readText(join(target, STAMP)) ?? 'null')
} catch {
  found = null // a stamp that cannot be read is no stamp
}
const same = found !== null && typeof found === 'object' && Object.keys(stamp).every((key) => found[key] === stamp[key])
if (same && existsSync(join(target, PROGRAM))) {
  console.log(`The copy of Electron ${version} named for Guild Board in ${target} is up to date.`)
  process.exit(0)
}

let program
try {
  program = named(readFileSync(join(dist, PROGRAM)), ico)
} catch (error) {
  fail(`Electron's program could not be named for Guild Board (${reason(error)}).`)
}
try {
  rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
} catch {
  fail(`${target} could not be replaced: a program may still be running from it. Quit Guild Board and run this again.`)
}
try {
  // Everything but the program, which is named, and the stamp, which comes last.
  cpSync(dist, target, { recursive: true, filter: (from) => relative(dist, from) !== PROGRAM })
} catch (error) {
  fail(`Electron's program could not be copied to ${target} (${reason(error)}).`)
}
try {
  const part = join(target, `${PROGRAM}.part`)
  writeFileSync(part, program)
  renameSync(part, join(target, PROGRAM))
  writeFileSync(join(target, STAMP), `${JSON.stringify(stamp, null, 2)}\n`)
} catch (error) {
  fail(`The copy of Electron's program could not be written to ${target} (${reason(error)}).`)
}
console.log(`Made the copy of Electron ${version} named for Guild Board in ${target}.`)
