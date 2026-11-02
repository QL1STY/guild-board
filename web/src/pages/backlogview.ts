import { num } from '../format.ts'
import type { Backlog } from '../types.ts'
import type { SignName } from '../ui/Sign.tsx'

type Counter = Backlog['counters'][number]

/** The sign beside each counter (spec 13); the Archon Quests have the book. A counter this page does not know has none. */
const COUNTER_SIGNS: Record<string, SignName> = {
  chests: 'chest',
  oculi: 'oculus',
  achievements: 'cup',
  waypoints: 'waypoint',
  archon: 'book',
}

export function counterSign(id: string): SignName | null {
  return COUNTER_SIGNS[id] ?? null
}

/**
 * What a counter shows: the number that counts up, with the words after it when the core gives them ("2 open": the
 * number counts, and `unit` is " open"), or words that are not a number and its unit ("All finished"), shown as they
 * are.
 */
export function counterFigure(counter: Counter): { value: number; unit: string } | { text: string } {
  if (counter.text === null) return { value: counter.value, unit: '' }
  const number = num(counter.value)
  if (counter.text.startsWith(number) && /^\s/.test(counter.text.slice(number.length))) {
    return { value: counter.value, unit: counter.text.slice(number.length) }
  }
  return { text: counter.text }
}

/** How much of an entry of Closest to done is explored, from 0 to 100: what is not left. */
export function exploredShare(remaining: number): number {
  return Math.min(100, Math.max(0, 100 - remaining))
}

/** How a chapter's status is drawn as a seal: in progress in gold, anything else outlined. */
export function statusTone(status: string): 'gold' | 'outline' {
  return status === 'In progress' ? 'gold' : 'outline'
}
