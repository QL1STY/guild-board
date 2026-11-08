/**
 * The pid file of the Guild Board that holds a data folder, and the question whether a process is still running. The id
 * in the file may be stale, and may now belong to the game, so it is looked up in the process list and the process is
 * never opened (the hands-off rules): `tasklist.exe` reads a snapshot, and an id counts as alive only when its row is the
 * shell's own program.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, win32 as path } from 'node:path'

/** `<data folder>\shell\guildboard.pid`: the shell's folder is Electron's `userData`. */
export function pidFile(dataFolder: string): string {
  return path.join(dataFolder, 'shell', 'guildboard.pid')
}

/** The id in the file, or null when there is none or it is not a positive whole number. Never throws. */
export function readPid(file: string): number | null {
  try {
    const text = readFileSync(file, 'utf8').trim()
    if (!/^[0-9]{1,10}$/.test(text)) return null
    const pid = Number(text)
    return Number.isSafeInteger(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

export function writePid(file: string, pid: number): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${pid}\n`)
}

/**
 * The pid file only serves `--quit`: a folder that cannot be written (read-only, say) is a warning, and the start goes on.
 * Never throws.
 */
export function tryWritePid(file: string, pid: number, warn: (text: string) => void): void {
  try {
    writePid(file, pid)
  } catch {
    warn('The pid file could not be written; --quit will not find this copy.')
  }
}

/** As the shell ends: the file goes when it still holds this process's id, and a later start's is left alone. */
export function removePidIfMine(file: string, pid: number): void {
  try {
    if (readPid(file) === pid) rmSync(file, { force: true })
  } catch {
    // nothing to do: a later start finds the id dead
  }
}

/** The shell's own program as the process list names it. */
export function imageNameOf(packaged: boolean): string {
  return packaged ? 'guildboard-app.exe' : 'electron.exe'
}

/** Windows' own tasklist by its full path (a bare name is looked for in the current folder first). */
export function tasklistPath(env: NodeJS.ProcessEnv): string {
  return path.join(env.SystemRoot || 'C:\\Windows', 'System32', 'tasklist.exe')
}

/** Runs a program and gives its output, or null when it could not be run. */
export type Run = (program: string, args: string[]) => string | null

export function runTasklist(program: string, args: string[]): string | null {
  const done = spawnSync(program, args, { encoding: 'utf8', windowsHide: true, timeout: 10_000 })
  return done.error || done.status !== 0 || typeof done.stdout !== 'string' ? null : done.stdout
}

/**
 * Whether the process `pid` is running and is the shell's own program (`image`). Another program on a reused id counts as
 * gone. When the list cannot be read the process counts as alive: `--quit` then waits and says it is still running,
 * rather than letting an installer replace the files of a copy that runs. Never throws.
 */
export function aliveByTasklist(pid: number, image: string, run: Run = runTasklist, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  let output: string | null
  try {
    output = run(tasklistPath(env), ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'])
  } catch {
    return true
  }
  if (output === null) return true
  for (const line of output.split(/\r?\n/)) {
    const cells = [...line.matchAll(/"([^"]*)"/g)].map((m) => m[1])
    if (cells.length >= 2 && cells[1] === String(pid)) return cells[0].toLowerCase() === image.toLowerCase()
  }
  return false
}
