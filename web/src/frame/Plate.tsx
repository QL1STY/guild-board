import { type MouseEvent, useEffect } from 'react'
import { api, messageOf } from '../api.ts'
import { type Live, useTick } from '../live.ts'
import { hashOf } from '../route.ts'
import { PLATE_ACTIONS, type PlateAction, type PlateView, syncPlate } from '../syncview.ts'
import type { Status } from '../types.ts'
import { showNote } from '../ui/note.tsx'
import { refusedNote } from '../ui/noteview.ts'
import { Picture } from '../ui/Picture.tsx'
import { Sign } from '../ui/Sign.tsx'
import { Panel, PanelRows, usePanel } from './Panel.tsx'
import { isPaused, primoName, primoText, resinText, syncRows } from './profileview.ts'

type Answer = { started: boolean; reason: string; wait_seconds: number }

/** Why a sync was not started, where the plate and the button do not already say so. */
const REFUSALS: Record<string, string> = {
  daily_cap: 'The daily limit of 24 syncs is reached.',
  busy: 'A sync is already running.',
}

/** A refusal or a failure, in the brown note: it stays until it is closed, and moves nothing in the plate. */
function refuse(message: string) {
  showNote((id) => refusedNote(id, message))
}

/** The ring round the Sync button: a circle of radius 22 on a 48 unit square, which `ring` (1 full, 0 empty) draws. */
const RING_LENGTH = 2 * Math.PI * 22

function SyncButton({ view, onPress }: { view: NonNullable<PlateView['button']>; onPress(): void }) {
  return (
    <button
      type="button"
      className={view.busy ? 'gb-sbtn spin' : 'gb-sbtn'}
      aria-disabled={view.disabled || undefined}
      aria-label={view.name}
      onClick={() => {
        // aria-disabled keeps the focus where a disabled button would drop it to the page; it sends nothing.
        if (!view.disabled) onPress()
      }}
    >
      <svg className="gb-sbtn-ring" viewBox="0 0 48 48" aria-hidden="true">
        <circle className="gb-sbtn-track" cx="24" cy="24" r="22" />
        <circle
          className="gb-sbtn-arc"
          cx="24"
          cy="24"
          r="22"
          strokeDasharray={RING_LENGTH}
          strokeDashoffset={RING_LENGTH * (1 - view.ring)}
        />
      </svg>
      <Sign name="sync" />
    </button>
  )
}

/**
 * The plate in the top right (top bar and undo design, sections 4 and 5): Resin, the primogems and the sync, in one
 * piece. The sync part has one width in the everyday states, with the round Sync button at the plate's right edge, so
 * that nothing moves while the wait counts down; a warning may widen it. A click on its text opens the sync panel, which
 * is not offered while the core does not answer: nothing about the sync is claimed then.
 */
export function Plate({ live, status }: { live: Live; status: Status }) {
  useTick(1000) // the wait and "full in" count down
  const panel = usePanel()
  const now = live.now()
  // While the core does not answer, the last numbers stay, but nothing is claimed about the sync.
  const connected = live.problem === null
  const elapsed = (now.getTime() - Date.parse(status.now)) / 1000
  const view = syncPlate(status, now, elapsed, connected)
  const resin = resinText(status.account, now)
  const primo = primoText(status.savings)
  const { opener, close } = panel
  useEffect(() => {
    if (!connected && opener !== null) close(false)
  }, [connected, opener, close])

  const syncNow = async () => {
    try {
      const answer = await api.post<Answer>('/api/sync')
      const reason = answer.started ? undefined : REFUSALS[answer.reason]
      if (reason !== undefined) refuse(reason)
    } catch (error) {
      refuse(messageOf(error))
    }
    await live.refresh()
  }
  const request = async (path: string) => {
    try {
      await api.post(path)
    } catch (error) {
      refuse(messageOf(error))
    }
    await live.refresh()
  }
  const openPanel = (from: HTMLElement) => {
    if (connected) panel.toggle(from)
  }
  const act = (kind: PlateAction, from: HTMLElement) => {
    if (kind === 'log') window.location.hash = `${hashOf('settings')}/log` // Settings opens its sync log for it
    else if (kind === 'panel') openPanel(from)
    else void request(PLATE_ACTIONS[kind])
  }
  const paused = isPaused(status, live.settings)
  const action = view.action
  return (
    <div ref={panel.scope} className="gb-plate-wrap">
      <div className="gb-plate" data-testid="plate">
        {resin !== null && (
          <div className="gb-plate-cell gb-plate-resin" title={resin.title ?? undefined}>
            <Picture src="/api/icon/static.resin" sign="moon" className="gb-plate-ico gb-resin-ico" />
            <span className="gb-two">
              <b>
                <span className="sr-only">Resin </span>
                {resin.value} <small>/ {resin.max}</small>
              </b>
              <small>{resin.sub}</small>
            </span>
          </div>
        )}
        <a className="gb-plate-cell" href={hashOf('pulls')} title={primo.title} aria-label={primoName(status.savings)}>
          <Picture src="/api/icon/static.primogem" sign="gem" className="gb-plate-ico gb-primo-ico" />
          <span className="gb-two">
            <b>{primo.value}</b>
            <small>{primo.sub}</small>
          </span>
        </a>
        <div className={view.amber ? 'gb-plate-cell gb-plate-sync gb-need' : 'gb-plate-cell gb-plate-sync'} data-testid="sync">
          {view.amber && <Sign name="warn" className="gb-warn-ico" />}
          <button
            type="button"
            className="gb-two gb-sync-text"
            aria-haspopup={connected ? 'dialog' : undefined}
            aria-expanded={connected ? panel.opener !== null : undefined}
            onClick={(event: MouseEvent<HTMLButtonElement>) => openPanel(event.currentTarget)}
          >
            <span className="gb-state">
              {view.dot !== null && <span className={`gb-dot ${view.dot}`} aria-hidden="true" />}
              {view.state}
            </span>
            {view.sub !== null && <small>{view.sub}</small>}
          </button>
          {view.button !== null && <SyncButton view={view.button} onPress={() => void syncNow()} />}
          {action !== null && (
            <button
              type="button"
              className="gb-btn gb-act"
              aria-haspopup={action.kind === 'panel' ? 'dialog' : undefined}
              aria-expanded={action.kind === 'panel' ? panel.opener !== null : undefined}
              onClick={(event) => act(action.kind, event.currentTarget)}
            >
              {action.label}
            </button>
          )}
        </div>
      </div>
      {connected && panel.opener !== null && (
        <Panel
          label="Sync"
          testId="sync-panel"
          className="gb-pop-plate"
          opener={panel.opener}
          scope={panel.scope}
          onClose={panel.close}
        >
          <h2>Sync</h2>
          {view.detail !== null && <p className="gb-pop-detail">{view.detail}</p>}
          <PanelRows rows={syncRows(status, live.settings, now)} />
          <div className="gb-pop-acts">
            <button
              type="button"
              className="gb-btn quiet"
              onClick={() => {
                panel.close(false)
                window.location.hash = hashOf('settings')
              }}
            >
              See the sync log
            </button>
            <button type="button" className="gb-btn quiet" onClick={() => void request(paused ? '/api/sync/resume' : '/api/sync/pause')}>
              {paused ? 'Resume syncing' : 'Pause syncing'}
            </button>
          </div>
        </Panel>
      )}
    </div>
  )
}
