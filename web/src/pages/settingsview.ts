import { num } from '../format.ts'
import type { OnlineView } from '../onlinetypes.ts'
import { SERVER_NAMES } from '../widgets/widgetview.ts'
import { nameText } from './friendsview.ts'

/**
 * Whether Settings asks for the game's screenshot folder: only when the gallery (GET /api/gallery) says it could not find
 * it, `{ folder_missing: true }`. No answer, as when the gallery cannot be read, asks for nothing.
 */
export function galleryFolderMissing(answer: unknown): boolean {
  return typeof answer === 'object' && answer !== null && (answer as { folder_missing?: unknown }).folder_missing === true
}

/** The line under the nickname: "Europe · UID 700000001 · logged in to HoYoLAB", or "· the demo account" in the demo. */
export function accountLine(account: { server: string; uid: number | null }, mode: 'demo' | 'live'): string {
  const parts = [SERVER_NAMES.get(account.server) ?? account.server]
  if (account.uid !== null) {
    parts.push(`UID ${account.uid}`)
    parts.push(mode === 'demo' ? 'the demo account' : 'logged in to HoYoLAB')
  }
  return parts.join(' · ')
}

/** The Online group's sentence for each state of the account (the online design, section 5). */
export function onlineLine(view: Pick<OnlineView, 'state' | 'name' | 'tag'>): string {
  switch (view.state) {
    case 'signed_out':
      return 'Sign in to add friends and copy your data to your account. Discord tells Guild Board your name, and is not asked for your e-mail address.'
    case 'waiting':
      return 'Finish signing in in your browser.'
    case 'signed_in': {
      // The name and the tag come from the online server: read as text, as the pages of Friends read them (audit M17).
      const [name, tag] = [nameText(view.name), nameText(view.tag)]
      return name === '' || tag === '' ? 'Signed in with Discord' : `Signed in with Discord as ${name}#${tag}`
    }
    case 'sign_in_again':
      return 'Your session has ended, so friends and sync are paused.'
  }
}

/** What the Sync my data row says (the online design, section 5): whether it is on, and when the last sync was. */
export function syncDataLine(sync: { on: boolean; last_at: string | null; needs_choice: boolean }, timeOf: (iso: string) => string): string {
  if (!sync.on) return 'Your data stays on this PC'
  if (sync.needs_choice) return 'Waiting for your choice below'
  return `Your data is copied to your account · ${sync.last_at === null ? 'not synced yet' : `last synced ${timeOf(sync.last_at)}`}`
}

/** The sentence for an account that holds no place while the places are taken (the same as the core's, cloud/models.py). */
export const NO_PLACE_FREE = 'All the places for syncing are taken right now. Your data stays on this PC, and friends and stats still work.'
const SYNC_WILL_STOP = 'Sync will stop taking new changes when this space is full. They stay on this PC.'
/** From this share of its room, either of bytes or of items, an account is told that sync will stop. */
const NEARLY_FULL = 0.9

/**
 * A size in plain units: KB up to 1,000 of them and MB after, to one decimal, with no ".0". A KB is 1,024 bytes and an MB 1,048,576,
 * so that an account's 4 MiB reads as the 4 MB it is. Anything above nothing is at least 1 KB.
 */
export function spaceText(bytes: number): string {
  const kilobytes = bytes / 1024
  if (kilobytes < 999.5) return `${bytes > 0 ? Math.max(1, Math.round(kilobytes)) : 0} KB`
  const megabytes = (Math.round((bytes / 1_048_576) * 10) / 10).toString()
  return `${megabytes} MB`
}

/** What the Online group says of the room the copy takes (sync_usage, shown by the core as `usage`): the meter and its words, or only that no place is free. */
export type CloudSpace =
  | { kind: 'space'; line: string; items: string; value: number; max: number; note: string | null }
  | { kind: 'full'; sentence: string }

export function cloudSpace(usage: NonNullable<OnlineView['usage']>): CloudSpace {
  if (usage.seats_full && !usage.has_place) return { kind: 'full', sentence: NO_PLACE_FREE }
  const share = Math.max(usage.bytes_held / usage.bytes_limit, usage.rows_held / usage.rows_limit)
  return {
    kind: 'space',
    line: `Cloud space: ${spaceText(usage.bytes_held)} of ${spaceText(usage.bytes_limit)} used`,
    items: `${num(usage.rows_held)} of ${num(usage.rows_limit)} items`,
    value: usage.bytes_held,
    max: usage.bytes_limit,
    note: share >= NEARLY_FULL ? SYNC_WILL_STOP : null,
  }
}

/** The question of the first sync, when this PC and the account both hold data (the online plan, Task C5), and its two answers. */
export const BOTH_HOLD_DATA = 'This PC and your account both hold data.'
export const KEEP_THIS_PC = "Keep this PC's data"
export const KEEP_REPLACES = "Replaces the data on your account with this PC's, or sends only this PC's changed settings if that is all it holds."
export const USE_THE_ACCOUNT = "Use the account's data"
export const USE_REPLACES = "Replaces this PC's data with your account's. A backup of this PC's data is made first."

const KEPT = 'a copy is kept each day for 14 days'

/** The Backups row's sentence: when the newest copy was made (the core lists them newest first), and how long they stay. */
export function backupLine(copies: readonly { made_at: string }[] | null, timeOf: (iso: string) => string): string {
  if (copies === null) return KEPT.charAt(0).toUpperCase() + KEPT.slice(1)
  if (copies.length === 0) return `No backup yet · ${KEPT}`
  return `Last backup ${timeOf(copies[0].made_at)} · ${KEPT}`
}

/** Whether a location hash asks Settings to open its sync log: "#/settings/log", where the plate's See the log goes. */
export function opensSyncLog(hash: string): boolean {
  return /^#\/settings\/log(?:[?/]|$)/.test(hash)
}

/** The Overlay row's sentence, with the hotkey that opens it. */
export function overlayLine(hotkey: string): string {
  return `A small panel over the game · ${hotkey}`
}

/** The settings of the three Characters notices (the design's section 6.6): each kind can be switched off, and all are on to begin with. */
export type NoticeKey = 'characters_notice_weekly' | 'characters_notice_domain' | 'characters_notice_ready'
export type NoticeSwitches = Partial<Record<NoticeKey, boolean>>

const NOTICES: readonly { key: NoticeKey; name: string; sentence: string }[] = [
  { key: 'characters_notice_weekly', name: 'Characters: weekly bosses', sentence: 'A notification on Sunday at 18:00 server time while a weekly boss in your plan is not done' },
  { key: 'characters_notice_domain', name: 'Characters: domains', sentence: 'A notification when the day opens a domain that your plan uses' },
  { key: 'characters_notice_ready', name: 'Characters: level-ups', sentence: 'A notification when everything for a goal of your plan is in' },
]

/** The notices' rows for Settings, each with whether it is on. */
export function noticeSwitches(settings: NoticeSwitches): { key: NoticeKey; name: string; sentence: string; on: boolean }[] {
  return NOTICES.map((notice) => ({ ...notice, on: settings[notice.key] !== false }))
}
