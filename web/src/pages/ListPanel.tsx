import { Fragment, type RefObject, useRef, useState } from 'react'
import '../styles/achievements.css'
import { api, messageOf } from '../api.ts'
import { plural } from '../format.ts'
import { newestRead } from '../live.ts'
import type { ListCheck, ListMeta } from '../types.ts'
import { useStepFocus } from '../ui/focus.ts'
import {
  changedStages, checkLine, goBackOffered, listLineParts, moreLine, type Named, newStages,
} from './achievementsview.ts'

/**
 * What the panel says: what the last step did, the list a check found, or why the last step failed. While the line of
 * a going back stands, `wentBack` is the number of the newest model read asked for by its answer (live.ts, newestRead).
 */
type Said = { result: string | null; found: ListCheck | null; refusal: string | null; wentBack: number | null }

const NOTHING_SAID: Said = { result: null, found: null, refusal: null, wentBack: null }

export type ListUpdates = Said & {
  /** What is out: the check, or an install or a going back. A press meanwhile sends nothing. */
  busy: 'check' | 'change' | null
  /** Whether the Achievements page shows the panel: from a press of Check for new achievements until Close. */
  asked: boolean
  check: () => void
  install: () => void
  goBack: () => void
  /** The page's Close: the panel closes, and what it said goes. Not while a step is out; false then. */
  close: () => boolean
}

/**
 * Checks for a new achievement list, installs it and goes back to the earlier one, each only when the player asks
 * (spec 4 and 6.3). One request at a time. A step that fails changes nothing in the core, and its sentence takes the
 * place of what was said, so that the player can try again. The core tells the pages when the installed list changes,
 * and they read it again then. Shared by the Achievements page's top line and its panel.
 */
export function useListUpdates(): ListUpdates {
  const [said, setSaid] = useState<Said>(NOTHING_SAID)
  const [busy, setBusy] = useState<ListUpdates['busy']>(null)
  const [asked, setAsked] = useState(false)
  const out = useRef(false) // as busy, but at once: two presses before the page shows the first send one request
  const run = (kind: 'check' | 'change', request: () => Promise<Said>) => {
    if (out.current) return
    out.current = true
    setBusy(kind)
    void request()
      .then(setSaid, (error: unknown) => setSaid({ ...NOTHING_SAID, refusal: messageOf(error) }))
      .finally(() => {
        out.current = false
        setBusy(null)
      })
  }
  const check = () => {
    setAsked(true)
    run('check', async () => {
      const found = await api.post<ListCheck>('/api/achievements/list/check')
      return { ...NOTHING_SAID, result: checkLine(found), found: found.up_to_date ? null : found }
    })
  }
  const install = () => {
    if (said.found === null) return
    const { sha256 } = said.found
    run('change', async () => {
      const list = await api.post<ListMeta>('/api/achievements/list/install', { sha256 })
      return { ...NOTHING_SAID, result: `Installed version ${list.version}, ${plural(list.stages, 'achievement')}.` }
    })
  }
  const goBack = () =>
    run('change', async () => {
      const list = await api.post<ListMeta>('/api/achievements/list/undo')
      return { ...NOTHING_SAID, result: `Went back to version ${list.version}.`, wentBack: newestRead() }
    })
  const close = () => {
    if (out.current) return false
    setAsked(false)
    setSaid(NOTHING_SAID)
    return true
  }
  return { ...said, busy, asked, check, install, goBack, close }
}

/**
 * Check for new achievements, in Settings' panel and in the Achievements page's top line. While a step is out it keeps
 * the focus (aria-disabled, not disabled, which would drop the focus to the page) and a press sends nothing.
 */
export function CheckButton({
  updates,
  button,
}: {
  updates: ListUpdates
  /** The button itself, for the focus to come back to, as after the page's Close. */
  button?: RefObject<HTMLButtonElement | null>
}) {
  return (
    <button
      ref={button}
      type="button"
      className="gb-btn quiet"
      aria-disabled={updates.busy !== null}
      onClick={updates.check}
    >
      {updates.busy === 'check' ? 'Checking…' : 'Check for new achievements'}
    </button>
  )
}

function Names({ stages }: { stages: readonly Named[] }) {
  return (
    <ul className="ach-names">
      {stages.map((stage) => (
        <li key={stage.id}>{stage.name}</li>
      ))}
    </ul>
  )
}

/** "And 12 more." after a list cut at 50; nothing when none is left out. */
function More({ count }: { count: number }) {
  const line = moreLine(count)
  return line === null ? null : <p className="ach-more">{line}</p>
}

/**
 * A list that a check found, before it is installed (spec 6.3): the new stages by version and category, the stages
 * whose name, description or reward changed, and every stage no longer listed.
 */
function Found({ check, busy, install }: { check: ListCheck; busy: boolean; install: () => void }) {
  const added = newStages(check.added)
  const changed = changedStages(check.changed)
  return (
    <div className="ach-found">
      {added.versions.map((group) => (
        <div key={group.version}>
          <p className="ach-found-head">Added in {group.version}</p>
          {group.categories.map((category, index) => (
            <div key={index}>
              <p className="ach-found-cat">{category.category}</p>
              <Names stages={category.stages} />
            </div>
          ))}
        </div>
      ))}
      <More count={added.more} />
      {changed.stages.length > 0 && (
        <>
          <p className="ach-found-head">Changed</p>
          <Names stages={changed.stages} />
          <More count={changed.more} />
        </>
      )}
      {check.removed.length > 0 && (
        <>
          <p className="ach-found-head">No longer listed</p>
          <Names stages={check.removed} />
        </>
      )}
      <div className="ach-buttons">
        <button type="button" className="gb-btn" aria-disabled={busy} onClick={install}>
          Install this list
        </button>
      </div>
    </div>
  )
}

/**
 * The installed list (spec 12.5), Go back to the earlier list when there is one, and what the last step said. In
 * Settings the panel has its own Check for new achievements and is part of its section; on the Achievements page the
 * top line holds the check, and the panel has Close.
 */
export function ListPanel({
  list,
  read,
  updates,
  withCheck = false,
  close,
}: {
  list: ListMeta
  /** The number of the model read that `list` came from (live.ts, useModel). */
  read: number
  updates: ListUpdates
  withCheck?: boolean
  /** Close, which the panel shows when it is given. */
  close?: () => void
}) {
  const { result, found, refusal, busy, wentBack } = updates
  // Once it has gone back, Go back to the earlier list waits for a list read after it: until then the list shown still
  // names the earlier list it went back to, which is gone, and a second press would be refused.
  const canGoBack = goBackOffered(list, read, wentBack)
  // Install this list goes with what the check found, and Go back to the earlier list once it has gone back: the focus
  // goes to the line that says what happened.
  const target = refusal !== null ? 'refusal' : result !== null ? 'result' : 'list'
  const { line, watch } = useStepFocus(`${target}:${found !== null}:${canGoBack}`)
  return (
    <div data-testid="list-panel" {...watch}>
      <p ref={target === 'list' ? line : undefined} tabIndex={-1}>
        {/* The date stays on one line: "2026-09-23" would otherwise break at a hyphen in a narrow column. */}
        {listLineParts(list).map((part, index) =>
          part.date ? (
            <span key={index} className="ach-date">
              {part.text}
            </span>
          ) : (
            <Fragment key={index}>{part.text}</Fragment>
          ),
        )}
      </p>
      {(withCheck || canGoBack || close !== undefined) && (
        <div className="ach-buttons">
          {withCheck && <CheckButton updates={updates} />}
          {canGoBack && (
            <button type="button" className="gb-btn quiet" aria-disabled={busy !== null} onClick={updates.goBack}>
              Go back to the earlier list
            </button>
          )}
          {close !== undefined && (
            <button type="button" className="gb-btn quiet" aria-disabled={busy !== null} onClick={close}>
              Close
            </button>
          )}
        </div>
      )}
      {/* Both lines are always there, so that a screen reader hears each new sentence. */}
      <p ref={target === 'result' ? line : undefined} className="ach-result" role="status" tabIndex={-1}>
        {result}
      </p>
      {found !== null && <Found check={found} busy={busy !== null} install={updates.install} />}
      <p ref={target === 'refusal' ? line : undefined} className="ach-problem" role="alert" tabIndex={-1}>
        {refusal}
      </p>
    </div>
  )
}
