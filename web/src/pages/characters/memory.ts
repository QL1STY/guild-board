import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react'
import { api, messageOf } from '../../api.ts'
import type { Roster, Status } from '../../types.ts'
import { type Filters, NO_FILTERS, type Sort, sorted, visible } from './rosterview.ts'

/*
 * What the window remembers of the roster, for as long as the window lives: the roster as it was last read, the search, the
 * filters and the sort, and where the page was scrolled to. Coming back to the roster, from another page or from a
 * character's card, shows all of it at once; the roster is read again quietly, and a card whose character changed is the
 * only one that is drawn again. The entrance plays once, on the first visit after the window opens. A character's card
 * reads the same memory for the order of its arrows (the roster as the player left it).
 */

/** What the player set on the roster page: `reversed` is the sort's order turned round, by a second press on it. */
export type RosterView = { search: string; filters: Filters; sort: Sort; reversed: boolean }

export type RosterMemory = {
  data: Roster | null
  view: RosterView
  scroll: number
  /** The account the roster is of: its game uid, null with no account, undefined until the status has been read. */
  account: number | null | undefined
}

const FRESH: RosterMemory = { data: null, view: { search: '', filters: NO_FILTERS, sort: 'readiness', reversed: false }, scroll: 0, account: undefined }

let memory: RosterMemory = FRESH
let entered = false
const listeners = new Set<() => void>()

function change(next: RosterMemory): void {
  memory = next
  for (const listener of listeners) listener()
}

/** What is remembered now. */
export function rosterMemory(): RosterMemory {
  return memory
}

/** Forgets everything, as a window that has just opened; for the tests. */
export function forgetRoster(): void {
  memory = FRESH
  entered = false
  listeners.clear()
}

export function setRosterData(data: Roster): void {
  if (data !== memory.data) change({ ...memory, data })
}

/** A logout or another account: the roster and its place are another's, and go before anything is drawn from them. */
export function setRosterAccount(account: number | null): void {
  if (account === memory.account) return
  if (memory.account === undefined) memory = { ...memory, account }
  else change({ ...memory, account, data: null, scroll: 0 })
}

export function setRosterView(changes: Partial<RosterView>): void {
  change({ ...memory, view: { ...memory.view, ...changes } })
}

/** The page's scroll; no page redraws for it, so it is kept without telling anyone. */
export function saveRosterScroll(scroll: number): void {
  memory = { ...memory, scroll }
}

/** True the first time it is asked after the window opens, and never again: the roster's entrance plays then. */
export function takeEntrance(): boolean {
  const first = !entered
  entered = true
  return first
}

/** Whether the entrance has played already in this window. */
export function entranceDone(): boolean {
  return entered
}

/** The keys of the characters the roster shows, in its order: the search, the filters and the sort the player left it with. */
export function rosterOrder(kept: RosterMemory): string[] {
  if (kept.data === null) return []
  return sorted(visible(kept.data.entries, kept.view.filters, kept.view.search), kept.view.sort, kept.view.reversed).map((entry) => entry.key)
}

/**
 * The order a character's arrows go in: the roster as the player left it. A character that the search or the filters leave
 * out (she was opened from a link) has the whole roster in the sort's order instead, so her arrows still lead somewhere.
 */
export function rosterOrderFor(kept: RosterMemory, key: string): string[] {
  const shown = rosterOrder(kept)
  if (kept.data === null || shown.includes(key)) return shown
  return sorted(kept.data.entries, kept.view.sort, kept.view.reversed).map((entry) => entry.key)
}

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b)

/**
 * The roster just read, made of the parts of the one before wherever they are the same: a card that did not change is the
 * same object as before (so it is not drawn again), and the whole roster is the one before when nothing changed.
 */
export function shareRoster(before: Roster | null, read: Roster): Roster {
  if (before === null) return read
  const known = new Map(before.entries.map((entry) => [entry.key, entry]))
  const entries = read.entries.map((entry) => {
    const old = known.get(entry.key)
    return old !== undefined && same(old, entry) ? old : entry
  })
  const next: Roster = {
    ...read,
    entries: entries.length === before.entries.length && entries.every((entry, index) => entry === before.entries[index]) ? before.entries : entries,
    focus: same(before.focus, read.focus) ? before.focus : read.focus,
    sync: same(before.sync, read.sync) ? before.sync : read.sync,
  }
  const unchanged = next.entries === before.entries && next.focus === before.focus && next.sync === before.sync
  return unchanged && before.owned === read.owned && before.all === read.all ? before : next
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The memory, and a redraw when it changes. */
export function useRosterMemory(): RosterMemory {
  return useSyncExternalStore(subscribe, rosterMemory)
}

/**
 * The roster: what the window remembers of it at once, and a quiet read of it again whenever `version` changes. A page that
 * comes back shows the memory while the read is on its way, and a read that changed nothing redraws nothing. `status` says
 * whose it is: after a logout or with another account the memory goes before the page is painted, and a read still on its way
 * for the account before is dropped.
 */
export function useRoster(version: number, status: Status | null): { data: Roster | null; error: string | null } {
  const { data } = useRosterMemory()
  const [error, setError] = useState<string | null>(null)
  const account = status === null ? undefined : (status.account?.uid ?? null)
  useLayoutEffect(() => {
    if (account !== undefined) setRosterAccount(account)
  }, [account])
  useEffect(() => {
    let current = true
    api.get<Roster>('/api/characters').then(
      (read) => {
        if (!current) return
        setRosterData(shareRoster(memory.data, read))
        setError(null)
      },
      (failure: unknown) => {
        if (current) setError(messageOf(failure))
      },
    )
    return () => {
      current = false
    }
  }, [version, account])
  return { data, error: data === null ? error : null }
}
