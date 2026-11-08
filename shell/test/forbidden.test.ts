import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(HERE, '..', 'src')
const HANDSOFF = resolve(HERE, '..', '..', 'tests', 'test_handsoff.py')

/** The string literals of `FORBIDDEN_NAMES = ( ... )` in the Python test, read from its text, not copied. */
function forbiddenNames(): string[] {
  const text = readFileSync(HANDSOFF, 'utf8')
  const start = text.indexOf('FORBIDDEN_NAMES = (')
  expect(start).toBeGreaterThan(-1)
  const end = text.indexOf('\n)', start)
  expect(end).toBeGreaterThan(start)
  const body = text
    .slice(start + 'FORBIDDEN_NAMES = ('.length, end)
    .split('\n')
    .filter((line) => !line.trim().startsWith('#')) // the comments hold apostrophes
    .join('\n')
  return [...body.matchAll(/"([^"\n]+)"/g)].map((m) => m[1])
}

// The shell's own bans, as patterns: whitespace around a colon does not hide one.
const SHELL_ONLY: RegExp[] = [
  /desktopCapturer/, /forward\s*:\s*true/, /sendInputEvent/, /persist:/, /nodeIntegration\s*:\s*true/,
  /nodeIntegrationInSubFrames\s*:\s*true/, /nodeIntegrationInWorker\s*:\s*true/, /contextIsolation\s*:\s*false/,
  /sandbox\s*:\s*false/, /webSecurity\s*:\s*false/, /allowRunningInsecureContent/, /enableBlinkFeatures/,
  /experimentalFeatures/, /<webview/,
  // On Windows it opens the target process, and a pid read from a file may now be the game's (the hands-off rules). The
  // `process` global is always there, so the module is needed in no form: every import or require of it names it as a
  // string, which CODE_ONLY bans in code (a `process` in a comment or a page's id is not code).
  /\bprocess\s*\??\.\s*kill\b/, /\bprocess\s*\??\.?\s*\[\s*["'`]kill["'`]\s*\]/,
  /\{[^{}]*\bkill\b[^{}]*\}\s*=\s*(process\b|require\(\s*["'](node:)?process["']\s*\))/,
  /\bimport\s*([\w$]+\s*,\s*)?\{[^{}]*\bkill\b[^{}]*\}\s*from\s*["'](node:)?process["']/,
  // A session made from a path stays on disk without `persist:`; a switch given at run time loosens the engine.
  /\bfromPath\s*\(/, /webviewTag/, /appendSwitch\s*\(/, /appendArgument\s*\(/,
]

// Read in the code of the TypeScript and of the pages' scripts, without comments (`// Each step: process, check, write.` is
// not code), and not in the HTML: the module's name as a string at all, and the global given another name (`const proc =
// process`, `{ p: process }`, `globalThis.process`), so that an alias cannot call kill. What this cannot see (a call on an
// alias, a computed key, a variable holding a name) waits for a pin built on the TypeScript parser (ruling R36).
const CODE_ONLY: RegExp[] = [
  /["'`](node:)?process["'`]/,
  /(?<![=!<>])\b\w+\s*(:\s*[\w.<>| ]+)?=(?!=)\s*((globalThis|global)\s*\.\s*)?process\b(?![\w$.[(?])/,
  /\b\w+\s*:\s*((globalThis|global)\s*\.\s*)?process\s*[,}]/,
  /\b(globalThis|global)\s*(\.\s*process\b|\[\s*["'`]process["'`]\s*\])/,
]

/** The code of a file without its comments: `//` to the end of the line and block comments, as they stand outside a string. */
function stripComments(text: string): string {
  let out = ''
  let quote = ''
  for (let at = 0; at < text.length; at++) {
    const char = text[at]
    const pair = text.slice(at, at + 2)
    if (quote !== '') {
      out += char
      if (char === '\\') out += text[++at] ?? ''
      else if (char === quote || (char === '\n' && quote !== '`')) quote = ''
    } else if (pair === '//') {
      const end = text.indexOf('\n', at)
      at = end < 0 ? text.length : end - 1
    } else if (pair === '/*') {
      const end = text.indexOf('*/', at + 2)
      at = end < 0 ? text.length : end + 1
    } else {
      if (char === "'" || char === '"' || char === '`') quote = char
      out += char
    }
  }
  return out
}

// The main process has its own Node networking and Electron's `net`, which no session filter sees: the shell asks no one
// but the core, over the channel.
const NETWORK: RegExp[] = [
  /\bfetch\s*\(/, /\bnet\s*\.\s*(request|fetch)\b/, /\bXMLHttpRequest\b/, /\bWebSocket\b/, /\bEventSource\b/,
  /\bdownloadURL\b/, /\bautoUpdater\b/,
  /(\bfrom\s*|\brequire\s*\(\s*|\bimport\s*\(\s*|\bimport\s+)["'`](node:)?(http|https|http2|net|tls|dgram|dns)(\/\w+)?["'`]/,
  /\bimport\s*(type\s*)?\{[^{}]*\bnet\b[^{}]*\}\s*from\s*["']electron["']/,
  /\{[^{}]*\bnet\b[^{}]*\}\s*=\s*require\(\s*["']electron["']/, /require\(\s*["']electron["']\s*\)\s*\.\s*net\b/,
]

// Electron keeps only the last listener or handler of a session, so these are set in guard.ts alone.
const ONE_PLACE: RegExp[] = [/onBeforeRequest\s*\(/, /setPermissionRequestHandler\s*\(/, /setPermissionCheckHandler\s*\(/]
const GUARD = join(SRC, 'guard.ts')

function files(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const full = join(folder, name)
    return statSync(full).isDirectory() ? files(full) : [full]
  })
}

test('the Python test’s list is read whole', () => {
  const names = forbiddenNames()
  expect(names.length).toBeGreaterThan(50)
  for (const known of ['OpenProcess', 'os.kill', 'SetWindowsHookEx', 'SendInput', 'BitBlt', 'FindWindow', 'QLockFile', 'QSettings']) {
    expect(names).toContain(known)
  }
})

test('the shell’s own patterns see the spaced spellings', () => {
  expect(SHELL_ONLY.some((p) => p.test('{ forward:true }'))).toBe(true)
  expect(SHELL_ONLY.some((p) => p.test('nodeIntegration : true'))).toBe(true)
  expect(SHELL_ONLY.some((p) => p.test('nodeIntegrationInSubFrames:true'))).toBe(true)
  expect(SHELL_ONLY.some((p) => p.test('nodeIntegrationInWorker :  true'))).toBe(true)
  expect(SHELL_ONLY.some((p) => p.test('sandbox  :false'))).toBe(true)
  expect(SHELL_ONLY.some((p) => p.test('process.kill(pid, 0)'))).toBe(true)
  expect(ONE_PLACE.some((p) => p.test('ses.webRequest.onBeforeRequest ((d, cb) => {})'))).toBe(true)
  expect(SHELL_ONLY.some((p) => p.test('contextIsolation: true, sandbox: true'))).toBe(false)
})

test('the network and process bans see the spellings that hide a request or a kill', () => {
  for (const bad of [
    'await fetch(url)', 'session.fetch(url)', 'net.request({})', "import http from 'node:http'", "const https = require('https')",
    "await import('node:dns/promises')", 'new WebSocket(u)', 'x.downloadURL(u)', "import { app, net } from 'electron'",
    "const { net } = require('electron')", "require('electron').net",
  ]) expect(NETWORK.some((p) => p.test(bad)), bad).toBe(true)
  for (const good of ['prefetch(x)', "import { app } from 'electron'", "import { spawn } from 'node:child_process'", "import path from 'node:path'"]) {
    expect(NETWORK.some((p) => p.test(good)), good).toBe(false)
  }
  for (const bad of [
    "process['kill'](1)", "session.fromPath('C:/x')", '{ webviewTag: true }', "app.commandLine.appendSwitch('x')",
    'const { kill } = process', "const { pid, kill: stop } = require('node:process')", "import { kill } from 'node:process'",
  ]) expect(SHELL_ONLY.some((p) => p.test(bad)), bad).toBe(true)
  for (const bad of [
    // The module named in any import or require, read in the code without its comments.
    "import * as proc from 'node:process'", "import proc from 'process'", "require('node:process').kill(pid)", "import 'process'",
    'const proc = process', 'let p: NodeJS.Process = process;', 'proc = globalThis.process', 'var q = process as any',
    'const o = { p: process }', 'foo(globalThis.process)', "const g = globalThis['process']",
    "const m = 'node:process'; require(m)", "createRequire(import.meta.url)('process')",
  ]) expect(CODE_ONLY.some((p) => p.test(stripComments(bad))), bad).toBe(true)
  for (const good of [
    'nativeImage.createFromPath(p)', 'process.env.SystemRoot', 'child.kill()', 'subprocess.kill()', '// the `process` of the page',
    '<div id="process">', 'const { env } = process', 'env: NodeJS.ProcessEnv = process.env', 'if (x === process.pid) {}',
  ]) {
    expect(SHELL_ONLY.some((p) => p.test(good)), good).toBe(false)
  }
  // Comments and ordinary code that the code patterns leave alone.
  for (const good of [
    '// Each step: process, check, write.', "// the lock's scope = process-wide", '/* the `process` of the page */',
    "// we never import 'process'", '// the pid comes from `process`',
    'const { env } = process', 'const x = process.env', 'env: NodeJS.ProcessEnv = process.env', 'if (x === process.pid) {}',
    'const { title, partition } = options', "const url = 'https://example.invalid/process'", "process.on('exit', stop)",
  ]) expect(CODE_ONLY.some((p) => p.test(stripComments(good))), good).toBe(false)
  expect(stripComments("a = 'https://x.y/z' // gone\n/* gone */ b")).toBe("a = 'https://x.y/z' \n b")
})

test('no file of the shell names a forbidden API', () => {
  const names = forbiddenNames()
  const found = files(SRC)
  expect(found.length).toBeGreaterThan(0)
  for (const file of found) {
    const text = readFileSync(file, 'utf8')
    for (const pattern of [...SHELL_ONLY, ...NETWORK]) {
      expect(pattern.test(text), `${pattern} appears in ${file}`).toBe(false)
    }
    if (/\.(ts|js)$/.test(file)) {
      for (const pattern of CODE_ONLY) {
        expect(pattern.test(stripComments(text)), `${pattern} appears in the code of ${file}`).toBe(false)
      }
    }
    for (const name of names) {
      expect(text.includes(name), `${name} appears in ${file}`).toBe(false)
    }
  }
})

test('the session’s request and permission handlers are set in guard.ts alone', () => {
  const guard = readFileSync(GUARD, 'utf8')
  for (const pattern of ONE_PLACE) expect(pattern.test(guard), `${pattern} is missing from guard.ts`).toBe(true)
  for (const file of files(SRC).filter((f) => f !== GUARD)) {
    const text = readFileSync(file, 'utf8')
    for (const pattern of ONE_PLACE) {
      expect(pattern.test(text), `${pattern} appears in ${file}`).toBe(false)
    }
  }
})
