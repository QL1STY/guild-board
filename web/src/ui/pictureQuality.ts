import { useSyncExternalStore } from 'react'

/**
 * The picture quality the player chose in Settings (the Characters design, 11.7): how large the big pictures of the Characters
 * pages are fetched. `high`, the default, is the original; `medium` a copy of at most 1,536 pixels; `low` one of at most 1,024.
 * The settings tell it here (live.ts), and every picture that is on the page asks again at once: no restart.
 */
export type PictureQuality = 'high' | 'medium' | 'low'

export const PICTURE_QUALITIES: readonly PictureQuality[] = ['high', 'medium', 'low']

let current: PictureQuality = 'high'
const listeners = new Set<() => void>()

export function pictureQuality(): PictureQuality {
  return current
}

/** What the settings say; a word that is none of the three, or none, is high. */
export function setPictureQuality(quality: string | undefined): void {
  const next = PICTURE_QUALITIES.find((each) => each === quality) ?? 'high'
  if (next === current) return
  current = next
  for (const listener of [...listeners]) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The quality now, and a new render when it changes. */
export function usePictureQuality(): PictureQuality {
  return useSyncExternalStore(subscribe, pictureQuality, pictureQuality)
}
