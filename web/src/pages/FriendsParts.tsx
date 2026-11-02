import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, api, messageOf } from '../api.ts'
import { type Live, newestOnly } from '../live.ts'
import type { Friend, FriendsModel, OnlineView } from '../onlinetypes.ts'
import { hashOf } from '../route.ts'
import { Picture } from '../ui/Picture.tsx'
import { Sign } from '../ui/Sign.tsx'
import { arText, type Chip, compareState, gateText, POLL_MS, staleText, type StatusLine } from './friendsview.ts'

/** The parts the pages of Friends share: reading, a face, a status, the chips of a row, and what the pages say while signed out. */

/**
 * Goes up each minute while the window is shown, and at once when it is shown again. A window hidden to the tray asks for nothing:
 * the core's own read every five minutes goes on without it (the online design, section 7).
 */
function useShownMinutes(): number {
  const [minutes, setMinutes] = useState(0)
  useEffect(() => {
    const next = () => {
      if (document.visibilityState !== 'hidden') setMinutes((count) => count + 1)
    }
    const timer = window.setInterval(next, POLL_MS)
    document.addEventListener('visibilitychange', next)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', next)
    }
  }, [])
  return minutes
}

/**
 * A model of the online account, read when the page opens and each minute while it is shown (the online design, section 7),
 * and again when the core says something changed. `path` is null while nothing should be read (the player is signed out); the
 * model is then none. With `before`, that address is asked first and its answer left alone: the friends are read afresh, so
 * that a page of one friend shows their present state. `take` sets the model to what the core answered to a change, at once,
 * and an answer that comes late is not shown over it. A friend who is not on the list any more leaves no model behind.
 * `version` is the core's events it is read again on: every one, or for a read that reaches the online server only the
 * online account's (live.onlineVersion; audit L24).
 */
export function usePolled<T>(
  path: string | null,
  live: Live,
  before: string | null = null,
  version: number = live.version,
): { data: T | null; error: string | null; take: (next: T) => void } {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [newest] = useState(newestOnly)
  const tick = useShownMinutes()
  useEffect(() => {
    if (path === null) {
      setData(null) // a player who signs out leaves nothing behind for the next account
      setError(null)
      return undefined
    }
    let current = true
    const isNewest = newest()
    const read = async () => {
      if (before !== null) await api.get(before).catch(() => undefined)
      return api.get<T>(path)
    }
    read().then(
      (next) => {
        if (!current || !isNewest()) return
        setData(next)
        setError(null)
      },
      (failure: unknown) => {
        if (!current || !isNewest()) return
        setError(messageOf(failure))
        if (failure instanceof ApiError && failure.status === 404) setData(null)
      },
    )
    return () => {
      current = false
    }
  }, [path, before, version, tick, newest])
  const take = useCallback(
    (next: T) => {
      newest() // a read that is still on its way is older than this
      setData(next)
      setError(null)
    },
    [newest],
  )
  return { data, error, take }
}

/** The address of a friend's picture. Only a friend asks for it: row level security gives it to accepted friends alone. */
export const pictureOf = (user: string) => `/api/friends/${user}/picture`

/**
 * A face in a gold ring with the Adventure Rank on a tab at its foot, and with `dot` a dot of the friend's status at its
 * corner (the profile pages). With no `src` the sign shows, as it does when the picture does not load: a card of a request
 * or an invite has no picture, whatever the player behind it has (decision 1 of the task).
 */
export function Avatar({ src, ar, dot, size = 'normal' }: { src: string | null; ar?: unknown; dot?: StatusLine['tone']; size?: 'small' | 'normal' | 'big' }) {
  const tab = arText(ar)
  return (
    <span className={size === 'normal' ? 'frd-ava' : `frd-ava ${size}`}>
      <Picture src={src} sign="person" className="frd-pic" />
      {dot !== undefined && dot !== 'none' && <span className={`frd-dot ${dot}`} aria-hidden="true" />}
      {tab !== null && <span className="frd-ar">{tab}</span>}
    </span>
  )
}

/** What a friend is doing, with the dot of their status before it; nothing at all where the friend does not share it. */
export function Doing({ line }: { line: StatusLine }) {
  if (line.tone === 'none') return <span className="frd-st none" />
  return (
    <span className={`frd-st ${line.tone}`}>
      {line.text}
      {line.when !== '' && <span className="frd-w"> {line.when}</span>}
    </span>
  )
}

/** The chips of a row or of the preview: the game's picture or the app's sign, the figure, and its label. */
export function Chips({ chips }: { chips: readonly Chip[] }) {
  return (
    <>
      {chips.map((chip) => (
        <span key={chip.key} className="frd-chip" title={chip.title}>
          {chip.picture !== null ? (
            <Picture src={chip.picture} sign={chip.sign} className="frd-ico" />
          ) : (
            <Sign name={chip.sign} className="frd-ico" />
          )}
          <b>{chip.value}</b>
          {chip.label !== '' && <span> {chip.label}</span>}
        </span>
      ))}
    </>
  )
}

/** In place of a page of Friends while the player is not signed in: what is needed, and the way to Settings, where it is done. */
export function Gate({ view }: { view: OnlineView }) {
  return (
    <div className="gb-panel frd-card frd-gate" data-testid="friends-signin">
      <p>{gateText(view)}</p>
      <a className="gb-btn" href={hashOf('settings')}>
        Open Settings
      </a>
    </div>
  )
}

/**
 * The mark on what could not be updated: it is the last known state, and when that was read. After a lost session it has the
 * way to Settings, where the player signs in again.
 */
export function OldMark({ age, view, now }: { age: Pick<FriendsModel, 'stale' | 'read_at'>; view: OnlineView; now: Date }) {
  const lost = view.state === 'sign_in_again'
  const text = staleText(age, now, lost)
  if (text === null) return null
  return (
    <p className="frd-stale" role="status" data-testid="friends-stale">
      <span>{text}</span>
      {lost && (
        <a className="gb-link" href={hashOf('settings')}>
          Open Settings
        </a>
      )}
    </p>
  )
}

/**
 * Copies a text to the clipboard, and says how it went for a while. `said` is the sentence to show, null once it has gone.
 * A copy that the window refuses is said too, so that the player copies by hand.
 */
export function useCopy(): { said: string | null; copy: (text: string, done: string, failed: string) => Promise<boolean> } {
  const [said, setSaid] = useState<string | null>(null)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const copy = useCallback(async (text: string, done: string, failed: string) => {
    let ok = true
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      ok = false
    }
    setSaid(ok ? done : failed)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setSaid(null), 6_000)
    return ok
  }, [])
  return { said, copy }
}

/**
 * The one Compare button of a friend, in their row and on their profile. It is off, with its reason as a tooltip, while the
 * two of you share no stat: aria-disabled keeps the focus where disabled would drop it, and a press then does nothing.
 */
export function CompareButton({ friend, className = '' }: { friend: Pick<Friend, 'compare' | 'name' | 'user_id'>; className?: string }) {
  const state = compareState(friend)
  return (
    <button
      type="button"
      className={`gb-btn frd-btn tip-end ${className}`.trim()}
      aria-disabled={state.enabled ? undefined : true}
      data-tip={state.tip ?? undefined}
      onClick={() => {
        if (state.enabled) window.location.hash = hashOf({ page: 'friends', view: 'compare', user: friend.user_id })
      }}
    >
      Compare
    </button>
  )
}
