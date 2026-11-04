import { dayMonth, localDay, localTime, num, pct, period, plural } from '../format.ts'
import { ageLabel, type FreshView, ringFill } from '../frame/freshview.ts'
import type {
  Banner, FiveResult, NextVersion, PityCard, Pulls, PullsImportEvent, PullsPool, SavingsRow, SavingsRowKey,
} from '../types.ts'
import { timeLeft } from './timersview.ts'

/** Each wish by the core's name for it (POOL_LABELS of pulls/__init__.py): the cards' captions and the history's. */
export const POOL_LABELS: Record<PullsPool | 'novice', string> = {
  character: 'Character event',
  weapon: 'Weapon event',
  standard: 'Standard',
  chronicled: 'Chronicled',
  novice: "Beginners' wish",
}

/** The sentence of an import that failed in a way the core gave no sentence for (the Pulls plan, Task 6). */
const UNEXPECTED = 'The import failed unexpectedly. See the log file.'

/** The words of a line, between dots, without the parts that are empty. */
function joined(...parts: string[]): string {
  return parts.filter((part) => part !== '').join(' · ')
}

/**
 * A chance from 0 to 1 as a whole percentage, rounded down: a chance short of certain never reads as "100%". The page
 * and the widgets say every chance this way.
 */
export function percent(chance: number): string {
  return pct(chance * 100)
}

/** Whether a 5★ wanted is certain: the pulls there will be by then reach the point where it is. */
export function isCertain(entry: { certain_within: number | null; pulls_by_then: number }): boolean {
  return entry.certain_within !== null && entry.certain_within <= entry.pulls_by_then
}

/** The calendar day of an instant in this PC's own time, written as the core writes days: "2026-10-24". */
export function dayOf(instant: Date): string {
  const parts = [instant.getFullYear(), instant.getMonth() + 1, instant.getDate()]
  return parts.map((part, index) => String(part).padStart(index === 0 ? 4 : 2, '0')).join('-')
}

/**
 * How long a banner has left, by the core's time `now`: "ends in 10 d 22 h", "ends in 3 h 5 min", "ends in 12 min",
 * and "ended" once its end has passed. The time left reads as a timer's does (timersview's timeLeft).
 */
export function endsIn(endsAt: string, now: Date): string {
  const left = timeLeft((Date.parse(endsAt) - now.getTime()) / 1000)
  return left === 'now' ? 'ended' : `ends ${left}`
}

export type PityWords = {
  /** "61", or "at least 61" where the history cannot tell (spec 6.1, item 2). */
  number: string
  /** "of 90" */
  of: string
  /** "13 to soft pity", or "in soft pity" from the soft pity on. */
  soft: string
  /** "4★ in 3", "4★ within 5" where the history holds no 4★ to count from (ruling R22), or "4★ now". */
  four: string
  /** What the next 5★ is, for the card's seal; null for the standard wish, and for a chronicled wish with no path. */
  tag: string | null
}

/** The seal of a card whose guarantee the history cannot tell (spec 6.1, item 2); the seal is quiet then. */
export const GUARANTEE_NOT_KNOWN = 'Guarantee not known'

/** What decides the next 5★: the item a Fate Point makes it, or the card's guarantee; null where nothing does. */
type Next = { item: string } | { guarantee: 'guaranteed' | 'fifty' | 'unknown' } | null

/**
 * What the next 5★ is. A wish with no guarantee (`none`, the standard wish's) features nothing, so there is nothing to
 * say. A Fate Point on the charted weapon or the chosen path makes it that one; the history cannot see a chart, so a
 * point counts only with a weapon charted (the Pulls plan, calls item 20). Otherwise the card's guarantee says it. A
 * chronicled wish's guarantee is its point alone, so with no path chosen there is nothing to say, and with one but no
 * point it is a 50/50.
 */
function nextOf(card: PityCard): Next {
  const item = card.path?.item ?? ''
  const point = item !== '' && (card.path?.points ?? 0) >= 1
  if (card.guarantee === 'none' || card.pool === 'standard') return null
  if (card.pool === 'chronicled') {
    if (item === '') return null
    return point ? { item } : { guarantee: 'fifty' }
  }
  if (point) return { item }
  return { guarantee: card.guarantee }
}

/** The card's seal: "Next 5★ is the featured one", "Next 5★ is a 75/25", "Next 5★ is Azurelight" and so on. */
function nextFive(card: PityCard): string | null {
  const next = nextOf(card)
  if (next === null) return null
  if ('item' in next) return `Next 5★ is ${next.item}`
  if (next.guarantee === 'unknown') return GUARANTEE_NOT_KNOWN
  if (card.pool === 'weapon') return next.guarantee === 'guaranteed' ? 'Next 5★ is a featured weapon' : 'Next 5★ is a 75/25'
  return next.guarantee === 'guaranteed' ? 'Next 5★ is the featured one' : 'Next 5★ is a 50/50'
}

/**
 * The words of a pity card (spec 2.2): its number of the hard pity, the wishes to soft pity, the wishes to the 4★ that
 * comes at the latest every ten, and what the next 5★ is. Where the history cannot tell the pity, the number is
 * "at least 61", and the wishes to soft pity are "at most 13": the card never says a number it does not know. Likewise
 * the 4★ comes "within 5" where the history holds no 4★ to count from (ruling R22).
 */
export function pityWords(card: PityCard): PityWords {
  const toSoft = card.soft - card.pity
  return {
    number: card.known ? num(card.pity) : `at least ${num(card.pity)}`,
    of: `of ${num(card.hard)}`,
    soft: toSoft <= 0 ? 'in soft pity' : `${card.known ? '' : 'at most '}${num(toSoft)} to soft pity`,
    four: card.four >= 10 ? '4★ now' : `4★ ${card.four_known ? 'in' : 'within'} ${num(10 - card.four)}`,
    tag: nextFive(card),
  }
}

/**
 * The path of the weapon event or the chronicled wish, with its Fate Points: "Epitomized Path 0 of 1 · Azurelight",
 * "No weapon charted", "Path 1 of 1 · Shenhe", "No path chosen". Null for the character event and the standard wish.
 */
export function pathWords(card: PityCard): string | null {
  if (card.pool !== 'weapon' && card.pool !== 'chronicled') return null
  const path = card.path
  if (path === null || path.item === '') return card.pool === 'weapon' ? 'No weapon charted' : 'No path chosen'
  const name = card.pool === 'weapon' ? 'Epitomized Path' : 'Path'
  return `${name} ${num(path.points)} of ${num(path.max)} · ${path.item}`
}

/**
 * What a card's Set… form holds, by the player's rule that it offers only what changes something: the correction where
 * the history cannot tell the card ("at least"), or where one is in force; and on the weapon event and the chronicled
 * wish, the item charted or chosen with its Fate Points (the plan's call 20). Null for no Set…: a character or standard
 * card that its own history settles.
 */
export function cardForm(card: PityCard): { correction: boolean; path: boolean } | null {
  const correction = !card.known || card.correction !== null
  const path = card.pool === 'weapon' || card.pool === 'chronicled'
  return correction || path ? { correction, path } : null
}

/**
 * The words of the correction's field in a card's Set… form (ruling R20): "Before 27 Apr: pity", by the day the card's
 * history starts as the model gives it, in this PC's own time. The correction is the state before that day's wishes. A
 * history read as complete, which the core's planner never gives, has no day to name.
 */
export function correctionLabel(card: PityCard): string {
  return card.from === null ? 'Before the history starts: pity' : `Before ${localDay(card.from)}: pity`
}

/** Whether a banner runs at the core's time: from its start until its end, as its countdown counts. */
export function isRunning(banner: Banner, now: Date): boolean {
  const at = now.getTime()
  return Date.parse(banner.starts_at) <= at && at < Date.parse(banner.ends_at)
}

/**
 * The banners shown at the core's time: those running and those to come, in the core's order. They are told apart by
 * their times and not by the flag read with the model, so a banner that starts or ends while the page is open moves on.
 */
export function bannersShown(banners: readonly Banner[], now: Date): Banner[] {
  return banners.filter((banner) => Date.parse(banner.ends_at) > now.getTime())
}

/** Whether a banner counts the same wishes as the first running character banner, and so "shares the same pity". */
export function sharesPity(banner: Banner, banners: readonly Banner[], now: Date): boolean {
  if (banner.pool !== 'character' || !isRunning(banner, now)) return false
  const first = banners.find((one) => one.pool === 'character' && isRunning(one, now))
  return first !== undefined && first.ann_id !== banner.ann_id
}

/** A character banner's guarantee, on the night strip; nothing for a card that has none. */
const BANNER_GUARANTEE: Record<PityCard['guarantee'], string> = {
  guaranteed: 'guaranteed',
  fifty: '50/50',
  unknown: 'guarantee not known',
  none: '',
}

/**
 * The line under a banner's name (spec 2.5, the mockup's strip): its featured 5★ with the player's pity on it, "Skirk ·
 * your pity 61 · guaranteed"; on the second character banner, which counts the same wishes, "Escoffier · shares the
 * same pity" (`shared`); the weapons with the pity, "Azurelight · Symphonist of Scents · pity 23". The featured alone
 * before any import, and "from 13 Oct" before the banner runs, by the core's time `now`.
 */
export function bannerLine(banner: Banner, shared: boolean, now: Date): string {
  if (Date.parse(banner.starts_at) > now.getTime()) return `from ${localDay(banner.starts_at)}`
  const names = banner.featured.join(' · ')
  const card = banner.pity
  if (card === null) return names
  if (shared) return joined(names, 'shares the same pity')
  const pity = pityWords(card).number
  if (banner.pool === 'character') return joined(names, `your pity ${pity}`, BANNER_GUARANTEE[card.guarantee])
  return joined(names, `pity ${pity}`)
}

/**
 * How a 5★ fell, in the words of its own wish: the character event's 50/50, the weapon event's 75/25 and Epitomized Path,
 * the chronicled wish's chosen path. The standard and the beginners' wishes have none to say.
 */
const RESULTS: Record<PullsPool | 'novice', Partial<Record<Exclude<FiveResult, null>, string>>> = {
  character: { won: 'won the 50/50', lost: 'lost the 50/50', guaranteed: 'guaranteed', featured: 'the featured one' },
  weapon: {
    won: 'won the 75/25',
    lost: 'lost the 75/25',
    guaranteed: 'guaranteed',
    featured: 'the featured one',
    path: 'Epitomized Path',
    'off-path': 'off the path',
  },
  chronicled: { path: 'the chosen path', 'off-path': 'off the path' },
  standard: {},
  novice: {},
}

/** How a 5★ of the history fell, in its wish's words: "won the 50/50", "won the 75/25", "the chosen path"; "" without. */
export function resultWords(result: FiveResult, pool: PullsPool | 'novice'): string {
  return result === null ? '' : (RESULTS[pool][result] ?? '')
}

/** How a planner's chance reads at a glance: its chip's colour. */
export type Tone = 'certain' | 'likely' | 'maybe' | 'unlikely'

/**
 * A featured 5★'s chance as a verdict (the planner's light update): "Certain" once the pulls by then reach the point
 * where it is certain even at hard pity, else "Likely · 63%" from 60%, "Maybe · 43%" from 25% and "Unlikely · 6%" below.
 * Chances are from 0 to 1, and a chance short of certain never reads 100%.
 */
export function verdict(entry: { chance: number; certain_within: number | null; pulls_by_then: number }): {
  tone: Tone
  label: string
} {
  if (isCertain(entry)) return { tone: 'certain', label: 'Certain' }
  const tone: Tone = entry.chance >= 0.6 ? 'likely' : entry.chance >= 0.25 ? 'maybe' : 'unlikely'
  const word = { likely: 'Likely', maybe: 'Maybe', unlikely: 'Unlikely' }[tone]
  return { tone, label: `${word} · ${percent(entry.chance)}` }
}

/** What a verdict rests on: "at most 29 pulls" once certain, else "86 pulls by then". */
function reach(entry: { certain_within: number | null; pulls_by_then: number }): string {
  return entry.certain_within !== null && isCertain(entry)
    ? `at most ${plural(entry.certain_within, 'pull')}`
    : `${plural(entry.pulls_by_then, 'pull')} by then`
}

/** Under a planner entry's verdict: "at most 29 pulls · 2nd copy 39%", or "86 pulls by then · 2nd copy 9%". */
export function planReason(entry: Pulls['planner'][number]): string {
  return `${reach(entry)} · 2nd copy ${percent(entry.second)}`
}

/** Under a wishlist 5★'s verdict: "at most 29 pulls", "86 pulls by then", with "for all 3 · " first for several copies. */
export function wishReason(entry: Pulls['wishlist'][number]): string {
  return entry.copies > 1 ? `for all ${entry.copies} · ${reach(entry)}` : reach(entry)
}

/** Over the banners' entries: "you have 93 pulls by 24 Nov", the pulls by the first banner's end; "" with none. */
export function bannersBudget(planner: Pulls['planner']): string {
  const first = planner[0]
  return first === undefined ? '' : `you have ${plural(first.pulls_by_then, 'pull')} by ${localDay(first.banner.ends_at)}`
}

/** The words of the ledger's balance (`balanceWords`). */
export type BalanceWords = {
  /** The pulls now, for the large figure: "75". */
  big: string
  /** "pulls now", beside it. */
  unit: string
  /** What the pulls are made of: "9,840 primogems and 14 Intertwined Fates". */
  line: string
  /** When the balance was set, for the head: "set today, estimated since", "set on 20 Oct, estimated since". */
  set: string
  /** What the forecast runs on, under it: "+130 a day, your last 30 days". */
  note: string
}

/**
 * The ledger's balance (the second pass, spec 3.1): the pulls as estimated now, large, "75" with "pulls now"; the
 * primogems and fates they are made of as estimated now, so that the two agree, "9,840 primogems and 14 Intertwined
 * Fates"; the day the balance was set, for the head; and what the forecast runs on, "+130 a day, your last 30 days",
 * with the diary's absence said where no income has been read. The forecast no longer adds the unfinished achievements,
 * so the note does not name them. Null before a balance is set. `now` is the core's time.
 */
export function balanceWords(savings: Pulls['savings'], now: Date): BalanceWords | null {
  const { set, pulls } = savings
  if (set === null || pulls === null) return null
  const balance = savings.estimated ?? set
  const when = dayOf(new Date(set.set_at)) === dayOf(now) ? 'set today' : `set on ${localDay(set.set_at)}`
  return {
    big: num(pulls),
    unit: pulls === 1 ? 'pull now' : 'pulls now',
    line: `${plural(balance.primogems, 'primogem')} and ${plural(balance.fates, 'Intertwined Fate')}`,
    set: `${when}, estimated since`,
    note:
      savings.income_per_day === null
        ? "No income read yet. Log in to HoYoLAB for the Traveler's Diary."
        : `+${num(savings.income_per_day)} a day, your last 30 days`,
  }
}

/** A whole number as typed, or none where the field is empty: the core says what it wants then. */
export function typed(text: string): number | null {
  return text.trim() === '' ? null : Number(text)
}

/** The most primogems of events the player can type for a version, which the core takes too. */
const MOST_EVENTS = 100_000

/**
 * The events count the player typed (the second pass, spec 3.2): a whole number of primogems from 0 to 100,000, or none.
 * The page sends nothing for any other text, and says so.
 */
export function eventsCount(text: string): number | null {
  const digits = text.trim()
  if (!/^\d{1,6}$/.test(digits)) return null
  const count = Number(digits)
  return count <= MOST_EVENTS ? count : null
}

/**
 * The forecast's line (spec 2.3): "By 3 Nov, when these banners end: about 86" on the default day, "By 11 Nov: about
 * 112" on a day the player picked. With no banner running the default day is today, when nothing ends, and the line
 * names no banners. `now` is the core's time.
 */
export function forecastLine(forecast: Pulls['savings']['forecast'], now: Date): string {
  const about = `about ${num(forecast.pulls)}`
  return forecast.default_by && forecast.by > dayOf(now)
    ? `By ${dayMonth(forecast.by)}, when these banners end: ${about}`
    : `By ${dayMonth(forecast.by)}: ${about}`
}

// ---------------------------------------------------------------- the ledger (the second pass, spec 3.1)

/** Primogems with the fates that come with them, where there are any: "2,520", "680 and 4 fates". */
function withFates(primogems: number, fates: number): string {
  return fates > 0 ? `${num(primogems)} and ${plural(fates, 'fate')}` : num(primogems)
}

/** The ledger's head over the next version: "Version 7.2, 4 Nov to 16 Dec"; "The next version, …" with no number. */
export function versionTitle(next: NextVersion): string {
  return `${next.number === null ? 'The next version' : `Version ${next.number}`}, ${period(next.starts_on, next.ends_on)}`
}

/** The quiet line under it, which says every source is counted whole (spec 2, item 8): "everything 7.2 offers". */
export function versionOffers(next: NextVersion): string {
  return `everything ${next.number ?? 'it'} offers`
}

/** What the version brings in all, its switched-on sources: "about 12,980", "about 13,660 and 4 fates". */
export function versionAmount(next: NextVersion): string {
  return `about ${withFates(next.primogems, next.fates)}`
}

/** The sources by their names in the ledger; the two switches carry the names of their rows. */
export const ROW_LABELS: Record<SavingsRowKey, string> = {
  commissions: 'Daily commissions',
  events: 'Events, estimated',
  endgame: 'Spiral Abyss, Imaginarium Theater and Stygian Onslaught',
  update: 'The update and its codes',
  quests: 'Quests and trials, estimated',
  welkin: 'Blessing of the Welkin Moon',
  gnostic_hymn: 'Gnostic Hymn',
}

/** A source's name in the ledger. The events lose "estimated" once the player has typed the community's count. */
export function rowLabel(row: SavingsRow): string {
  return row.key === 'events' && !row.estimated ? 'Events' : ROW_LABELS[row.key]
}

/** A source's amount, switched on or off: "2,520", "680 and 4 fates". */
export function rowAmount(row: SavingsRow): string {
  return withFates(row.primogems, row.fates)
}

/** The total's line: "By 16 Dec, when 7.2 ends", "By 16 Dec, when the next version ends" with no number. */
export function totalLine(next: NextVersion): string {
  return `By ${dayMonth(next.ends_on)}, when ${next.number ?? 'the next version'} ends`
}

/** The total, an estimate in pulls: "about 172 pulls". */
export function totalAmount(pulls: number): string {
  return `about ${plural(pulls, 'pull')}`
}

/** The quiet line under the total: what the unfinished achievements would add, outside it. Null for none. */
export function achievementsNote(pulls: number): string | null {
  return pulls > 0 ? `and about ${num(pulls)} more if you finish your remaining achievements` : null
}

/** One of the history's three tiles (spec 3.3): a label, a figure with what it is of, and a note against a typical player. */
export type LuckTile = {
  label: string
  /** The figure, large; null where the history holds none yet, and the note says so. */
  value: string | null
  /** "of 8", small beside the figure. */
  of: string | null
  note: string
}

export type LuckTiles = {
  average: LuckTile
  /** The 50/50s won and lost, for the bar under its figure. */
  fifty: LuckTile & { won: number; lost: number }
  kept: LuckTile
}

/**
 * The history's three tiles (the second pass, spec 3.3), each against what a typical player gets: the average 5★ pity
 * of the character event with the soft pity model's mean and, where the core can tell, the share of players it beats;
 * the 50/50s won of those won and lost; the wishes kept with how many are 5★. The average and the 50/50s count the
 * character event alone, as the model gives them. A tile with nothing to show yet says so, with no figure.
 */
export function luckTiles(history: Pulls['history']): LuckTiles {
  const { average_pity: average, luckier_than: luckier, won, lost, count, fives } = history
  const fifties = won + lost
  return {
    average: {
      label: 'Average 5★ pity, character event',
      value: average === null ? null : num(average),
      of: null,
      note:
        average === null
          ? 'No character-event 5★ with a known pity yet.'
          : `A typical player: about ${num(history.typical_average)}. Lower is luckier.` +
            (luckier === null ? '' : ` Luckier than ${percent(luckier)} of players.`),
    },
    fifty: {
      label: '50/50s won',
      value: fifties === 0 ? null : num(won),
      of: fifties === 0 ? null : `of ${num(fifties)}`,
      note: fifties === 0 ? 'No 50/50 yet.' : 'With Capturing Radiance a typical player wins about 55%.',
      won,
      lost,
    },
    kept: {
      label: 'Wishes kept',
      value: num(count),
      of: null,
      note: fives === 0 ? 'No 5★ yet.' : `${num(fives)} of them 5★, one in every ${num(count / fives)} wishes.`,
    },
  }
}

/** A wish by its pool's key or label, as a sentence names it: "the character event wish", "the beginners' wish". */
function wishName(pool: string): string {
  const label = (Object.hasOwn(POOL_LABELS, pool) ? POOL_LABELS[pool as keyof typeof POOL_LABELS] : pool).toLowerCase()
  return label.endsWith('wish') ? `the ${label}` : `the ${label} wish`
}

/** An import's progress or its end, as an event of the stream gives it, or the model while one runs or after one failed. */
function progressLine(progress: PullsImportEvent): string {
  if (progress.state === 'running') {
    if (progress.pool === null) return 'Importing…'
    return `Importing ${wishName(progress.pool)}, page ${num(progress.pages)} · ${num(progress.found)} new`
  }
  if (progress.state === 'done') {
    return progress.found === 0
      ? 'Nothing new. The history is up to date.'
      : `Imported ${plural(progress.found, 'new wish', 'new wishes')}.`
  }
  return progress.message ?? UNEXPECTED
}

/**
 * The import's line in the top bar (the Pulls plan, calls item 15). The stream's newest event says what this window saw
 * happen: "Importing the character event wish, page 3 · 41 new", then "Imported 41 new wishes." or "Nothing new. The
 * history is up to date.", or a failure's sentence. Without one, the model says what the core knows: its import of this
 * session, running or how it ended, else when the last import that ended well finished, "Last import 13 Oct, 10:02" in
 * this PC's own time; "" before any.
 */
export function importLine(state: PullsImportEvent | null, model: Pulls['import']): string {
  if (state !== null) return progressLine(state)
  const known = model.state
  if (known !== 'idle') return progressLine({ ...model, state: known })
  return model.last_at === null ? '' : `Last import ${localTime(model.last_at)}`
}

/**
 * The top bar's line with the kept link's sentence after the import's own (the second pass, spec 3.5): "Imported 41 new
 * wishes. Updates itself until 19:52 tomorrow." The import's words end with a full stop first where they have none, as
 * the line of the last import does; either alone where the other is empty.
 */
export function importWithAuto(sentence: string, auto: string | null): string {
  if (auto === null) return sentence
  if (sentence === '') return auto
  return `${/[.!?]$/.test(sentence) ? sentence : `${sentence}.`} ${auto}`
}

/** The hour and minute of an instant in this PC's own time: "19:52". */
function clockOf(instant: Date): string {
  return `${String(instant.getHours()).padStart(2, '0')}:${String(instant.getMinutes()).padStart(2, '0')}`
}

/**
 * The sentence after the import line's own (the second pass, spec 3.5) about the link Import keeps for a day. While the
 * core keeps it: "Updates itself until 19:52 tomorrow." and, after an update, "Updated 20:22, and again until 19:52
 * tomorrow." (an update of another day names the day). When HoYoverse refused it: "The link from Wish → History has
 * expired. Open it in the game, then press Import." Null with no kept link, and once its day is past by the core's time
 * `now`, since the core drops the link without a word of its own.
 */
export function autoLine(model: Pulls['import'], now: Date): string | null {
  if (model.auto_stopped === 'expired') {
    return 'The link from Wish → History has expired. Open it in the game, then press Import.'
  }
  const auto = model.auto
  if (auto === null || Date.parse(auto.until) <= now.getTime()) return null
  const end = new Date(auto.until)
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  const day = dayOf(end)
  const when = day === dayOf(now) ? 'today' : day === dayOf(tomorrow) ? 'tomorrow' : `on ${localDay(auto.until)}`
  const until = `${clockOf(end)} ${when}`
  if (auto.last_at === null) return `Updates itself until ${until}.`
  const last = new Date(auto.last_at)
  const at = dayOf(last) === dayOf(now) ? clockOf(last) : localTime(auto.last_at)
  return `Updated ${at}, and again until ${until}.`
}

/** What the line says after the import's own while the history updates itself with the HoYoLAB login. */
export const LOGIN_UPDATES = 'Updates automatically with your HoYoLAB login.'
/** While the keys for an update with the login are asked for: an Import pressed then is refused as busy. */
export const LOGIN_MINTING = 'Getting a key from HoYoLAB…'
/** After the last update with the login did not end well; the core tries again in half an hour. */
export const LOGIN_FAILED = 'The last automatic update did not finish. Guild Board tries again in half an hour.'

/** Once HoYoverse refused the login a key was asked for with, on the page whose Import is from the place named. */
export function loginRefused(where: string): string {
  return `Automatic updates need a fresh HoYoLAB login. Log in again, or open ${where} in the game and press Import.`
}

/**
 * The top bar's line while the history updates itself with the HoYoLAB login and no link of a press is kept: at rest,
 * "Updated automatically with your HoYoLAB login · last 13 Oct, 10:02" (this PC's own time), or that it updates itself
 * before any import; after an import or an update of this session, its sentence and then that it updates itself. While
 * a key is asked for, that; after an update that did not end well, or once the login was refused, its sentence and then
 * a plain notice of that.
 */
export function loginImportLine(state: PullsImportEvent | null, model: Pulls['import']): string {
  if (model.login === 'minting') return LOGIN_MINTING
  if (model.login === 'refused') return importWithAuto(importLine(state, model), loginRefused('Wish → History'))
  if (model.login === 'failed') return importWithAuto(importLine(state, model), LOGIN_FAILED)
  if (state === null && model.state === 'idle') {
    return model.last_at === null
      ? LOGIN_UPDATES
      : `Updated automatically with your HoYoLAB login · last ${localTime(model.last_at)}`
  }
  return importWithAuto(importLine(state, model), LOGIN_UPDATES)
}

/** What the ring's tip ends with where the history does not update itself. */
export const PRESS_IMPORT = 'Press Import to update it.'

/** The later of two instants, either of which may be missing. */
function newest(first: string | null, second: string | null): string | null {
  if (first === null) return second
  if (second === null) return first
  return Date.parse(second) > Date.parse(first) ? second : first
}

/**
 * The empty page's sentence before any wish is kept: that Guild Board is reading the history now where the HoYoLAB login
 * updates it, else how to start an import from the game.
 */
export function emptyLine(login: Pulls['import']['login']): string {
  return login === 'on' || login === 'minting'
    ? 'No wish history yet. Guild Board is reading it now with your HoYoLAB login.'
    : 'No wish history yet. Open Wish → History in the game, then press Import.'
}

/**
 * Whether an import or an update goes now, for the Import button and the ring: the stream's word, else the model's, and
 * also while the keys for an update with the login are asked for, when the core already holds the importer and refuses a
 * second press as busy.
 */
export function pullsRunning(model: Pulls['import'], event: PullsImportEvent | null): boolean {
  return (event?.state ?? model.state) === 'running' || model.login === 'minting'
}

/**
 * The freshness ring of the Pulls page (freshness design, section 1). The tip is the sentence the top bar used to show,
 * built by the functions above; this adds the tone, the fill, the few words beside the ring, and whether it turns. While an
 * import or an update runs the words are its progress ("page 3 · 41 new"); amber where the player has to act (HoYoverse
 * refused the login, or the link from Wish → History expired), or a read failed; gold while the history updates itself
 * (`every_minutes` set), else grey with a tip that says to press Import. `refusal` is what the core said to a press it
 * refused: it is the tip, in place of the sentence. The age is that of the newest of the last import and the kept link's
 * last update. `now` is the core's time.
 */
export function pullsFresh(
  model: Pulls['import'],
  event: PullsImportEvent | null,
  refusal: string | null,
  now: Date,
): FreshView {
  const progress: PullsImportEvent | null = event ?? (model.state === 'idle' ? null : { ...model, state: model.state })
  const running = progress?.state === 'running'
  const read = newest(model.last_at, model.auto?.last_at ?? null)
  const fill = ringFill(read, model.every_minutes, now)
  const age = ageLabel(read, now)
  const kept = running ? null : autoLine(model, now)
  const expired = kept !== null && model.auto_stopped === 'expired'
  const login = !running && kept === null && model.login !== null
  const sentence = expired
    ? kept
    : login
      ? loginImportLine(event, model)
      : importWithAuto(importLine(event, model), kept)
  const tip = (rest: string): string => refusal ?? rest
  if (progress !== null && running) {
    const label = progress.pool === null ? 'Importing…' : `page ${num(progress.pages)} · ${num(progress.found)} new`
    return { tone: 'gold', fill, label, tip: tip(sentence), turning: true }
  }
  if (model.login === 'minting') return { tone: 'gold', fill, label: 'Importing…', tip: tip(sentence), turning: true }
  if (expired) return { tone: 'amber', fill, label: 'Open Wish History', tip: tip(sentence), turning: false }
  if (login && model.login === 'refused') return { tone: 'amber', fill, label: 'Log in', tip: tip(sentence), turning: false }
  if (login && model.login === 'failed') return { tone: 'amber', fill, label: 'Will retry', tip: tip(sentence), turning: false }
  if (progress?.state === 'failed') return { tone: 'amber', fill, label: 'Import failed', tip: tip(sentence), turning: false }
  if (model.every_minutes === null) {
    return { tone: 'grey', fill, label: age, tip: refusal ?? importWithAuto(sentence, PRESS_IMPORT), turning: false }
  }
  return { tone: 'gold', fill, label: age, tip: tip(sentence), turning: false }
}

/** The earliest of some instants. */
function earliest(instants: readonly string[]): string {
  return instants.reduce((soonest, at) => (Date.parse(at) < Date.parse(soonest) ? at : soonest))
}

/**
 * The night strip's title (the mockup's), by the core's time `now`: "Wishing now · ends in 10 d 22 h", by the running
 * banner that ends first; while none runs, "Coming next · from 13 Nov", by the banner to come that starts first; and
 * "Wishing now" with none announced.
 */
export function skyTitle(banners: readonly Banner[], now: Date): string {
  const running = banners.filter((banner) => isRunning(banner, now))
  if (running.length > 0) return `Wishing now · ${endsIn(earliest(running.map((banner) => banner.ends_at)), now)}`
  const coming = banners.filter((banner) => Date.parse(banner.starts_at) > now.getTime())
  if (coming.length > 0) return `Coming next · from ${localDay(earliest(coming.map((banner) => banner.starts_at)))}`
  return 'Wishing now'
}

/**
 * A pity card's name for screen readers: "Weapon event: pity 23 of 80, next 5★ is a featured weapon", what the next 5★
 * is in its seal's words, with "at least" where the history cannot tell the pity, and no more where it has no seal.
 */
export function cardLabel(card: PityCard): string {
  const words = pityWords(card)
  const head = `${POOL_LABELS[card.pool]}: pity ${words.number} ${words.of}`
  return words.tag === null ? head : `${head}, ${words.tag.charAt(0).toLowerCase()}${words.tag.slice(1)}`
}

/** When a planner entry's banner runs: "until 3 Nov", its end in this PC's own time. */
export function plannerWhen(banner: Banner): string {
  return `until ${localDay(banner.ends_at)}`
}

/**
 * A wishlist entry's day, with its copies when several: "about 11 Nov", "about 16 Dec · 3 copies". A 4★ has no verdict
 * beside it: the chain does not count it (the plan's call 7), so the model gives it no chance.
 */
export function wishWhen(entry: Pulls['wishlist'][number]): string {
  const about = `about ${dayMonth(entry.about)}`
  return entry.copies > 1 ? `${about} · ${entry.copies} copies` : about
}

/** The featured name a planner entry is for: the charted weapon on the weapon banner, else the banner's first featured. */
export function plannerName(entry: Pulls['planner'][number], cards: readonly PityCard[]): string {
  if (entry.banner.pool === 'weapon') {
    const charted = cards.find((card) => card.pool === 'weapon')?.path?.item ?? ''
    if (charted !== '') return charted
  }
  return entry.banner.featured[0] ?? entry.banner.name
}

/** The history's caption (the mockup's): "History · 387 pulls kept". */
export function historyCaption(count: number): string {
  return `History · ${plural(count, 'pull')} kept`
}

/**
 * The sentence over a history of another game account than the HoYoLAB login's (the plan's review focus, item 3):
 * "This history is UID 700000002. Guild Board's HoYoLAB account is UID 700000001." Null when they agree, or either is
 * missing.
 */
export function uidLine(uid: number | null, accountUid: number | null): string | null {
  if (uid === null || accountUid === null || uid === accountUid) return null
  return `This history is UID ${uid}. Guild Board's HoYoLAB account is UID ${accountUid}.`
}
