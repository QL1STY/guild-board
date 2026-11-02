import { dayMonth, num, plural } from '../format.ts'
import { shortTime } from '../syncview.ts'
import { timeLeft } from '../pages/timersview.ts'
import type { Settings, Status } from '../types.ts'
import { nearTime, SERVER_NAMES } from '../widgets/widgetview.ts'

/*
 * The texts of the profile card in the rail and of the plate's Resin and primogem parts (top bar and undo design,
 * sections 3 and 4), and of the two panels' rows. Pure: the components only lay them out.
 */

type Account = NonNullable<Status['account']>

/** The server as the player knows it ("Europe"); a key the table does not know is shown as it is. */
function serverName(key: string): string {
  return SERVER_NAMES.get(key) ?? key
}

/**
 * Resin for the plate: the figure and its maximum, how long to full, and when it is full as a tooltip, in the form of
 * the Board's Resin widget ("Full 21:42" within a day, "Full Wed 09:10" beyond). The figure is the status's, counted on
 * from the last read; a full time that has come is full already, and then the count shows at least the maximum, as the
 * widget has it. Null with no account or no notes read. `sub` is empty when the notes give no full time.
 */
export function resinText(
  account: Account | null,
  now: Date,
): { value: string; max: string; sub: string; title: string | null } | null {
  if (account === null || account.resin === null || account.resin_max === null) return null
  const max = account.resin_max
  const fullAt = account.resin_full_at
  const full = account.resin >= max || (fullAt !== null && Date.parse(fullAt) <= now.getTime())
  if (full) return { value: num(Math.max(account.resin, max)), max: num(max), sub: 'Full', title: null }
  if (fullAt === null) return { value: num(account.resin), max: num(max), sub: '', title: null }
  return {
    value: num(account.resin),
    max: num(max),
    sub: `full ${timeLeft((Date.parse(fullAt) - now.getTime()) / 1000)}`,
    title: `Full ${nearTime(fullAt, now)}`,
  }
}

/**
 * The primogem part: the Pulls page's estimate of the balance now, with the pulls it makes (the fates count too, as on
 * the Pulls page), and a tooltip that names both. With no balance typed, it points to the Pulls page.
 */
export function primoText(savings: Status['savings']): { value: string; sub: string; title: string } {
  if (savings === null) return { value: 'Primogems', sub: 'Set on Pulls', title: 'Your savings from the Pulls page' }
  const gems = plural(savings.primogems, 'primogem')
  const held = savings.fates > 0 ? `${gems} and ${plural(savings.fates, 'fate')}` : gems
  return { value: num(savings.primogems), sub: `${plural(savings.pulls, 'pull')} saved`, title: `${held}, from the Pulls page` }
}

/** What a screen reader hears for the primogem part, whose figures are drawn without their words. */
export function primoName(savings: Status['savings']): string {
  if (savings === null) return 'Primogems, set on Pulls'
  return `${plural(savings.primogems, 'primogem')}, ${plural(savings.pulls, 'pull')} saved`
}

/** The card in the rail: the name, the UID with the server, and the rank for the tab on the ring. */
export function cardText(account: Account | null): { name: string; line: string; ar: string | null } {
  if (account === null) return { name: 'Not logged in', line: '', ar: null }
  const line = [account.uid === null ? null : `UID ${account.uid}`, serverName(account.server)]
  return {
    name: account.nickname,
    line: line.filter((part) => part !== null).join(' · '),
    ar: account.adventure_rank === null ? null : `AR ${account.adventure_rank}`,
  }
}

/** Whether syncing is paused: the settings say so, and before they are read, the sync's own state does. */
export function isPaused(status: Status, settings: Settings | null): boolean {
  return settings !== null ? settings.sync_paused : status.sync.state === 'paused'
}

/** The rows of the profile panel; what the core does not know is a dash. */
export function profileRows(account: Account, trackingSince: string | null): [string, string][] {
  return [
    ['UID', account.uid === null ? '—' : String(account.uid)],
    ['Server', serverName(account.server)],
    ['Days active', account.days_active === null ? '—' : num(account.days_active)],
    ['Tracking since', trackingSince === null ? '—' : `${dayMonth(trackingSince)} ${trackingSince.slice(0, 4)}`],
  ]
}

/**
 * The rows of the sync panel: the last and the next sync (the clock, with the day when it is not today), the syncs the
 * core has started today against its limit, and the interval while the game runs. Without the settings read, the last
 * row is left out.
 */
export function syncRows(status: Status, settings: Settings | null, now: Date): [string, string][] {
  const sync = status.sync
  const rows: [string, string][] = [
    ['Last sync', sync.last_ok_at === null ? 'Never' : shortTime(sync.last_ok_at, now)],
    ['Next sync', sync.next_at === null ? 'None planned' : shortTime(sync.next_at, now)],
    ['Today', `${sync.runs_today} of ${sync.daily_cap} syncs`],
  ]
  if (settings !== null) {
    const minutes = settings.in_session_interval_min
    rows.push(['While playing', minutes === 0 ? 'off' : `every ${minutes} min`])
  }
  return rows
}

/**
 * The links of the profile panel (the gift codes design, section 1): the player's page on two sites that read the public
 * showcase, and HoYoLAB's Battle Chronicle. They open in the player's browser. With no account there are none.
 */
export function linksOf(account: { uid: string } | null): { label: string; url: string }[] {
  if (account === null) return []
  return [
    { label: 'Akasha: your builds ranked', url: `https://akasha.cv/profile/${account.uid}` },
    { label: 'Enka.Network: your showcase', url: `https://enka.network/u/${account.uid}` },
    { label: 'HoYoLAB: Battle Chronicle', url: 'https://act.hoyolab.com/app/community-game-records-sea/index.html#/ys' },
  ]
}
