import { ago, countdown, localDay, localTime } from './format.ts'
import type { Status } from './types.ts'

// ---------------------------------------------------------------------------------------------------- the plate

/** What an amber state offers in place of the Sync button. `panel` opens the sync panel; `log` opens Settings. */
export type PlateAction = 'verify' | 'login' | 'resume' | 'log' | 'panel'

/** The sync part of the top bar's plate in one state (spec 2026-10-25, section 5). */
export type PlateView = {
  /** null in the amber states */
  dot: 'green' | 'busy' | 'grey' | null
  amber: boolean
  /** the bold line */
  state: string
  /** the small line */
  sub: string | null
  /** null when an action takes the button's place */
  button: { disabled: boolean; busy: boolean; ring: number; name: string } | null
  action: { kind: PlateAction; label: string } | null
  /** the sentence at the top of the sync panel */
  detail: string | null
}

/** The endpoints the amber actions post to, as the banner's actions did. `log` and `panel` only open a view. */
export const PLATE_ACTIONS: Record<'verify' | 'login' | 'resume', string> = {
  verify: '/api/auth/verify',
  login: '/api/auth/login',
  resume: '/api/sync/resume',
}

const SYNC_NOW = 'Sync now'
/** What tells the core's sentence for a login of another game account than the history (core.py) from any other. */
const ANOTHER_ACCOUNT = 'is of another game account'

/**
 * The Sync button: off while syncing and at the daily limit, in any state that shows the button (the core refuses a
 * manual sync at the limit whatever the state); otherwise by the wait.
 */
function plateButton(sync: Status['sync'], wait: number): NonNullable<PlateView['button']> {
  if (sync.state === 'syncing') return { disabled: true, busy: true, ring: 0, name: SYNC_NOW }
  if (sync.runs_today >= sync.daily_cap) return { disabled: true, busy: false, ring: 0, name: SYNC_NOW }
  if (wait > 0) {
    const ring = Math.min(1, Math.max(0, wait / sync.manual_gap_seconds))
    return { disabled: true, busy: false, ring, name: `${SYNC_NOW}, in ${countdown(wait)}` }
  }
  return { disabled: false, busy: false, ring: 0, name: SYNC_NOW }
}

/** The clock of an instant in the PC's time ("02:45"), with its day when that is not today's ("14 Oct, 02:45"). */
export function shortTime(instant: string, now: Date): string {
  const when = localTime(instant)
  return localDay(instant) === localDay(now.toISOString()) ? when.split(', ')[1] : when
}

/**
 * What the plate shows of the sync, one view for each row of the spec's table. `elapsedSeconds` is the time since the
 * status was read, which the wait counts down by. `connected` is false while the core does not answer: then nothing is
 * claimed about the sync (the alert about the core says the rest).
 */
export function syncPlate(status: Status, now: Date, elapsedSeconds: number, connected: boolean): PlateView {
  const sync = status.sync
  if (!connected) {
    return {
      dot: 'grey', amber: false, state: 'Not connected', sub: null,
      button: { disabled: true, busy: false, ring: 0, name: SYNC_NOW }, action: null, detail: null,
    }
  }
  const wait = Math.max(0, sync.manual_wait_seconds - elapsedSeconds)
  const amber = (state: string, sub: string | null, kind: PlateAction, label: string, detail: string): PlateView => ({
    dot: null, amber: true, state, sub, button: null, action: { kind, label }, detail,
  })
  switch (sync.state) {
    case 'ok': {
      const button = plateButton(sync, wait)
      const limit = sync.runs_today >= sync.daily_cap
      if (sync.last_ok_at === null) {
        return { dot: 'grey', amber: false, state: 'Not synced yet', sub: null, button, action: null, detail: null }
      }
      const sub = limit ? 'daily limit reached' : wait > 0 ? `again in ${countdown(wait)}` : ago(sync.last_ok_at, now)
      return { dot: 'green', amber: false, state: 'Synced', sub, button, action: null, detail: null }
    }
    case 'syncing':
      return {
        dot: 'busy', amber: false, state: 'Syncing…', sub: 'reading HoYoLAB', button: plateButton(sync, wait),
        action: null, detail: null,
      }
    case 'offline':
      return {
        dot: 'grey', amber: false, state: 'No connection',
        sub: sync.next_at !== null ? `next try at ${shortTime(sync.next_at, now)}` : null,
        button: plateButton(sync, wait), action: null,
        detail: 'No connection. Guild Board will try again at the next sync.',
      }
    case 'login_needed': {
      // A login of another account than the history is no signing out, and the core's sentence names the two accounts.
      const another = sync.message?.includes(ANOTHER_ACCOUNT) ? sync.message : null
      return amber(
        'Log in needed', another === null ? 'you were signed out' : null, 'login', 'Log in',
        another ?? 'Log in to HoYoLAB so that Guild Board can read your account.',
      )
    }
    case 'verification_needed':
      return amber(
        'Check needed', 'HoYoLAB asks for a check', 'verify', 'Verify',
        'HoYoLAB asked for a verification check. Syncing is paused until you have passed it.',
      )
    case 'paused':
      return amber('Syncing paused', null, 'resume', 'Resume', 'Syncing is paused.')
    case 'switch_off':
      return amber('A switch is off', 'in HoYoLAB', 'panel', 'How to fix', sync.message ?? 'A HoYoLAB privacy switch is off.')
    case 'error':
      return amber('Sync failed', 'see the log', 'log', 'See the log', sync.message ?? 'The last sync failed.')
  }
}
