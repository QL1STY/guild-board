import { useState } from 'react'
import '../styles/update.css'
import { api, messageOf } from '../api.ts'
import type { Live } from '../live.ts'
import type { UpdateStatus } from '../types.ts'
import { noticeOf } from './updatenote.ts'

/** Presses Update now: asks the core to download and start the installer. `refused` is its answer when it did not. */
export function useInstall(live: Live): { install: () => Promise<void>; refused: string | null } {
  const [refused, setRefused] = useState<string | null>(null)
  const install = async () => {
    setRefused(null)
    try {
      await api.post('/api/update/install')
      await live.refresh()
    } catch (error) {
      setRefused(messageOf(error))
    }
  }
  return { install, refused }
}

/**
 * The notice of a newer Guild Board (the update notice design, toast T2): a card at the bottom centre of the page area,
 * where the undo note is, with a soft gold pulse. It has no close button and stays until the update runs; the undo note,
 * when there is one, stands just above it (update.css).
 */
export function UpdateNotice({
  update,
  install,
  refused,
  onNotes,
}: {
  update: UpdateStatus
  install: () => Promise<void>
  refused: string | null
  onNotes: () => void
}) {
  const notice = noticeOf(update, refused)
  if (notice === null) return null
  return (
    <div className="up-host">
      <div className="up-toast" data-testid="update-notice" data-state={update.state}>
        <span className="up-mark" aria-hidden="true">
          ✦
        </span>
        <div className="up-text">
          {/* Only the heading is announced: the line under it changes at every step of a download. */}
          <b role="status">{notice.heading}</b>
          <small data-testid="update-sub">{notice.sub}</small>
          {notice.progress !== null && (
            <span className="up-bar" role="progressbar" aria-label="Download" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(notice.progress * 100)}>
              <i style={{ width: `${Math.round(notice.progress * 100)}%` }} />
            </span>
          )}
        </div>
        {notice.hasNotes && (
          <button type="button" className="gb-btn quiet up-btn" onClick={onNotes}>
            What's new
          </button>
        )}
        <button
          type="button"
          className="gb-btn up-btn"
          disabled={!notice.canInstall}
          onClick={() => void install()}
        >
          Update now
        </button>
      </div>
    </div>
  )
}
