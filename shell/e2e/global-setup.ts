import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const GAME_PROGRAMS = ['GenshinImpact.exe', 'YuanShen.exe']

/**
 * The e2e never runs beside the game: it starts windows and, when one does not end, kills a process tree. It fails
 * closed: a game that runs, or a list of programs that cannot be read, stops the run before any test starts.
 */
export default function globalSetup(): void {
  const tasklist = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tasklist.exe')
  for (const program of GAME_PROGRAMS) {
    const done = spawnSync(tasklist, ['/FI', `IMAGENAME eq ${program}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true, timeout: 30_000 })
    if (done.error || done.status !== 0) {
      throw new Error(`The e2e did not run: the list of programs could not be read, so ${program} could not be ruled out.`)
    }
    if (done.stdout.toLowerCase().includes(`"${program.toLowerCase()}"`)) {
      throw new Error(`The e2e did not run: ${program} is running. Close the game and run it again.`)
    }
  }
}
