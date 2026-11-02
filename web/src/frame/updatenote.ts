import type { UpdateStatus } from '../types.ts'

/** What the update notice at the bottom of the page says, and what it offers. */
export type Notice = {
  /** The first line, with the version. */
  heading: string
  /** The second line: the first change, the download's progress, "Restarting…" or the failure. */
  sub: string
  /** While downloading, the part done, 0 to 1; else null and no bar. */
  progress: number | null
  /** Whether Update now can be pressed: not while the download or the install runs. */
  canInstall: boolean
  /** Whether What's new is offered: only when the release came with notes. */
  hasNotes: boolean
}

/**
 * The notice of a newer Guild Board, or null while there is none. It has no close button and stays until the update
 * runs, so every state of the update is one of its states. `refused` is the core's answer to a press of Update now that
 * it did not take, which takes the place of the second line.
 */
export function noticeOf(update: UpdateStatus, refused: string | null = null): Notice | null {
  if (update.state === 'none' || update.version === null) return null
  const heading = `A new Guild Board is ready: ${update.version}`
  const hasNotes = update.notes.length > 0
  const base = { heading, progress: null, canInstall: true, hasNotes }
  switch (update.state) {
    case 'available':
      return {
        ...base,
        sub: refused ?? update.notes[0]?.title ?? 'Update now installs it and opens Guild Board again.',
      }
    case 'downloading': {
      const part = Math.min(1, Math.max(0, update.progress ?? 0))
      return { ...base, sub: `Downloading… ${Math.round(part * 100)} %`, progress: part, canInstall: false }
    }
    case 'installing':
      return { ...base, sub: 'Restarting…', canInstall: false }
    case 'failed':
      return { ...base, sub: refused ?? update.message ?? 'The update did not work.' }
    default:
      return null
  }
}
