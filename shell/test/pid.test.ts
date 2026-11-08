import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { aliveByTasklist, imageNameOf, pidFile, readPid, removePidIfMine, tasklistPath, tryWritePid, writePid } from '../src/pid.js'

let folder: string
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'gb-pid-'))
})
afterEach(() => {
  rmSync(folder, { recursive: true, force: true })
})

test('the pid file is guildboard.pid in the shell folder of the data folder', () => {
  expect(pidFile('C:\\Users\\Mia\\AppData\\Local\\GuildBoard')).toBe('C:\\Users\\Mia\\AppData\\Local\\GuildBoard\\shell\\guildboard.pid')
})

test('a pid is written, read and removed only by the process that wrote it', () => {
  const file = join(folder, 'sub', 'guildboard.pid')
  expect(readPid(file)).toBeNull()
  writePid(file, 4242)
  expect(readFileSync(file, 'utf8').trim()).toBe('4242')
  expect(readPid(file)).toBe(4242)
  removePidIfMine(file, 1)
  expect(readPid(file)).toBe(4242)
  removePidIfMine(file, 4242)
  expect(readPid(file)).toBeNull()
})

test('a pid file with anything but a positive whole number reads as none, and nothing throws', () => {
  const file = join(folder, 'guildboard.pid')
  for (const text of ['', 'abc', '-5', '0', '12 34', '1e3', '99999999999999999999']) {
    writeFileSync(file, text)
    expect(readPid(file)).toBeNull()
  }
  expect(readPid(folder)).toBeNull() // a folder where the file should be
  expect(() => removePidIfMine(join(folder, 'missing.pid'), 1)).not.toThrow()
})

test('the process list is read by the full path of tasklist.exe', () => {
  expect(tasklistPath({ SystemRoot: 'C:\\Windows' })).toBe('C:\\Windows\\System32\\tasklist.exe')
  expect(tasklistPath({ SystemRoot: '' })).toBe('C:\\Windows\\System32\\tasklist.exe')
  expect(tasklistPath({})).toBe('C:\\Windows\\System32\\tasklist.exe')
})

test('the shell’s own image is guildboard-app.exe packaged and electron.exe in development', () => {
  expect(imageNameOf(true)).toBe('guildboard-app.exe')
  expect(imageNameOf(false)).toBe('electron.exe')
})

function run(output: string | null) {
  const calls: { program: string; args: string[] }[] = []
  return {
    calls,
    run(program: string, args: string[]): string | null {
      calls.push({ program, args })
      return output
    },
  }
}

test('a process is alive when its row names the shell’s image', () => {
  const r = run('"electron.exe","4242","Console","1","80,000 K"\r\n')
  expect(aliveByTasklist(4242, 'electron.exe', r.run)).toBe(true)
  expect(r.calls).toEqual([{ program: expect.stringMatching(/tasklist\.exe$/), args: ['/FI', 'PID eq 4242', '/FO', 'CSV', '/NH'] }])
})

test('the image name is compared whatever the case', () => {
  expect(aliveByTasklist(7, 'guildboard-app.exe', run('"Guildboard-App.EXE","7","Console","1","1 K"').run)).toBe(true)
})

test('a pid that now belongs to another program counts as gone', () => {
  expect(aliveByTasklist(4242, 'electron.exe', run('"GenshinImpact.exe","4242","Console","1","1 K"').run)).toBe(false)
})

test('a pid with no row counts as gone', () => {
  expect(aliveByTasklist(4242, 'electron.exe', run('INFO: No tasks are running which match the specified criteria.').run)).toBe(false)
  expect(aliveByTasklist(4242, 'electron.exe', run('').run)).toBe(false)
})

test('a row for another pid does not count', () => {
  expect(aliveByTasklist(4242, 'electron.exe', run('"electron.exe","9999","Console","1","1 K"').run)).toBe(false)
})

test('when the list cannot be read the process counts as alive, so --quit never answers early, and nothing throws', () => {
  expect(aliveByTasklist(4242, 'electron.exe', run(null).run)).toBe(true)
  expect(
    aliveByTasklist(4242, 'electron.exe', () => {
      throw new Error('spawn failed')
    }),
  ).toBe(true)
})

test('a pid that is not a positive whole number is never asked about and counts as gone', () => {
  const r = run('"electron.exe","1","Console","1","1 K"')
  expect(aliveByTasklist(0, 'electron.exe', r.run)).toBe(false)
  expect(aliveByTasklist(-3, 'electron.exe', r.run)).toBe(false)
  expect(aliveByTasklist(1.5, 'electron.exe', r.run)).toBe(false)
  expect(r.calls).toEqual([])
})

test('a pid that cannot be written is told to the log and the start goes on', () => {
  const warnings: string[] = []
  const blocker = join(folder, 'a file')
  writeFileSync(blocker, 'x')
  // The folder of the file is a file: the write fails, as in a data folder that is read-only.
  expect(() => tryWritePid(join(blocker, 'guildboard.pid'), 4242, (text) => warnings.push(text))).not.toThrow()
  expect(warnings).toEqual(['The pid file could not be written; --quit will not find this copy.'])
  const good = join(folder, 'guildboard.pid')
  tryWritePid(good, 4242, (text) => warnings.push(text))
  expect(readPid(good)).toBe(4242)
  expect(warnings).toHaveLength(1)
})
