import { localTime, num } from '../format.ts'
import type { FishingRegion, PresetOffer, Region, Timer, TimerRule } from '../types.ts'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WEEK_MS = 7 * 86_400_000

export const REGION_NAMES: Record<Region, string> = {
  mondstadt: 'Mondstadt',
  liyue: 'Liyue',
  inazuma: 'Inazuma',
  sumeru: 'Sumeru',
  fontaine: 'Fontaine',
  natlan: 'Natlan',
}

export const FISHING_REGION_NAMES: Record<FishingRegion, string> = {
  ...REGION_NAMES,
  nod_krai: 'Nod-Krai',
  snezhnaya: 'Snezhnaya',
}

const FISHING_NOTE = 'Guides disagree, so Settings → Achievements can change this for every fishing spot.'

/**
 * How long until a timer is ready (spec 9.4): "in 1 d 10 h", "in 10 h 5 min", "in 5 min", and seconds only under one
 * minute, "in 42 s". The whole minutes or hours left, counted down; a part of a second still to wait counts as one.
 * "now" once the time has come.
 */
export function timeLeft(seconds: number): string {
  const whole = Math.ceil(seconds)
  if (whole <= 0) return 'now'
  if (whole < 60) return `in ${whole} s`
  const minutes = Math.floor(whole / 60)
  const hours = Math.floor(minutes / 60)
  if (hours >= 24) return `in ${Math.floor(hours / 24)} d ${hours % 24} h`
  if (hours > 0) return `in ${hours} h ${minutes % 60} min`
  return `in ${minutes} min`
}

/**
 * When a timer is ready, in this PC's own time (spec 9.4): "Tue 21:42", with the date a week ahead or more, when the
 * weekday alone would name the wrong day: "Tue 3 Nov, 21:42". `now` is the core's time.
 */
export function readyTime(at: string, now: Date): string {
  const then = new Date(at)
  const day = WEEKDAYS[then.getDay()]
  if (then.getTime() - now.getTime() >= WEEK_MS) return `${day} ${localTime(at)}`
  const clock = [then.getHours(), then.getMinutes()].map((part) => String(part).padStart(2, '0')).join(':')
  return `${day} ${clock}`
}

/**
 * A card's state: "Ready", "Tue 21:42 · in 1 d 10 h" while it runs, or "All 3 visits done". The state is the model's;
 * a running timer whose time has come counts down to "now" until the model is read again.
 */
export function stateLine(timer: Timer, now: Date): string {
  if (timer.state === 'finished') return `All ${num(timer.visits?.of ?? 0)} visits done`
  if (timer.state === 'ready' || timer.ready_at === null) return 'Ready'
  const seconds = (Date.parse(timer.ready_at) - now.getTime()) / 1000
  return `${readyTime(timer.ready_at, now)} · ${timeLeft(seconds)}`
}

/**
 * The rule of a timer the player made: "Every hour", "Every 166 hours", or in whole days from 48 hours on, "Every 3
 * days"; "At the next daily reset (04:00 server time)", "After 3 daily resets (04:00 server time)"; or "At the weekly
 * reset (Monday 04:00 server time)".
 */
export function ruleText(rule: TimerRule): string {
  if (rule.kind === 'hours') {
    if (rule.hours === 1) return 'Every hour'
    if (rule.hours >= 48 && rule.hours % 24 === 0) return `Every ${num(rule.hours / 24)} days`
    return `Every ${num(rule.hours)} hours`
  }
  if (rule.kind === 'resets') {
    return rule.resets === 1
      ? 'At the next daily reset (04:00 server time)'
      : `After ${num(rule.resets)} daily resets (04:00 server time)`
  }
  return 'At the weekly reset (Monday 04:00 server time)'
}

/**
 * A card's rule line: a pre-set's own sentence, or the rule of a timer the player made, "Every 166 hours · made by
 * you". A fishing spot's sentence follows the fishing setting, which guides disagree on (spec 9.3), so the line says
 * where to change it. A pre-set that a later file no longer holds has no sentence, and reads its rule.
 */
export function ruleLine(timer: Pick<Timer, 'own' | 'rule' | 'about'>): string {
  const { rule, about } = timer
  if (rule.kind === 'fishing') return about === null ? FISHING_NOTE : `${about}. ${FISHING_NOTE}`
  if (timer.own) return `${ruleText(rule)} · made by you`
  return about ?? ruleText(rule)
}

/**
 * The Timers category's groups, as the accepted mockup has them (spec 9.2): the ready timers of every kind, then the
 * running pre-sets, then the player's own timers that run or have done all their visits. Each keeps the model's
 * order: ready longest first, then soonest first.
 */
export function groupTimers(timers: readonly Timer[]): { ready: Timer[]; running: Timer[]; own: Timer[] } {
  return {
    ready: timers.filter((timer) => timer.state === 'ready'),
    running: timers.filter((timer) => timer.state !== 'ready' && !timer.own),
    own: timers.filter((timer) => timer.state !== 'ready' && timer.own),
  }
}

/** "2 of 4 visits" (spec 9.1). */
export function visitsText(visits: { done: number; of: number }): string {
  return `${num(visits.done)} of ${num(visits.of)} visits`
}

/**
 * How far a running timer is, from 0 at the start of its countdown to 1 at its ready time; null when it does not run
 * or its start is unknown. `now` is the core's time.
 */
export function progressOf(timer: Timer, now: Date): number | null {
  if (timer.state !== 'running' || timer.started_at === null || timer.ready_at === null) return null
  const start = Date.parse(timer.started_at)
  const length = Date.parse(timer.ready_at) - start
  if (!(length > 0)) return null
  return Math.min(1, Math.max(0, (now.getTime() - start) / length))
}

/** The pre-sets of one group that "Add a pre-set timer" lists under one region, or under none. */
export type OfferRegion = { region: FishingRegion | null; name: string | null; offers: PresetOffer[] }

/**
 * "Add a pre-set timer" lists the pre-sets not in use under their group, and the fishing spots by region, in the order
 * the core gives them, which is the file's.
 */
export function offerGroups(offers: readonly PresetOffer[]): { group: string; regions: OfferRegion[] }[] {
  const groups = new Map<string, Map<FishingRegion | null, OfferRegion>>()
  for (const offer of offers) {
    let regions = groups.get(offer.group)
    if (regions === undefined) {
      regions = new Map()
      groups.set(offer.group, regions)
    }
    let region = regions.get(offer.region)
    if (region === undefined) {
      region = { region: offer.region, name: offer.region === null ? null : FISHING_REGION_NAMES[offer.region], offers: [] }
      regions.set(offer.region, region)
    }
    region.offers.push(offer)
  }
  return [...groups].map(([group, regions]) => ({ group, regions: [...regions.values()] }))
}
