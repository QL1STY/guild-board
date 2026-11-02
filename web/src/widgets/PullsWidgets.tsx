import { num, plural } from '../format.ts'
import { useModel, useTick } from '../live.ts'
import {
  bannerLine, bannersShown, endsIn, GUARANTEE_NOT_KNOWN, isRunning, pityWords, POOL_LABELS, sharesPity,
} from '../pages/pullsview.ts'
import type { Banner, PityCard, Pulls, PullsPool, Widget, WishKind } from '../types.ts'
import { SegmentRing, Seal } from '../ui/marks.tsx'
import { Picture } from '../ui/Picture.tsx'
import { useHead, type WidgetContext, type WidgetType } from './widget.ts'
import {
  faceTitle, fiftyRecord, lastFive, LUCK_WHAT, savingsBy, savingsSet, wishShort,
} from './widgetview.ts'

/*
 * The six Pulls widgets (the Pulls plan, Task 12; the sketch pulls-widgets.html), on the Board and on the overlay's list:
 * Wishing now, Pity, Savings, Wishlist, Last pulls and Luck. Each reads the Pulls model once for itself, and again on
 * the core's events, as the Board's widgets read theirs. Each says so while it reads, and that there is no wish history
 * before an import. They draw with the widget roles alone (widgets.css).
 */

const MINUTE_MS = 60_000
const READING = 'Reading the pulls…'
const NO_HISTORY = 'No wish history yet.'
const PRIMOGEM = '/api/icon/static.primogem'

/** The sign of an item that has no picture: a character's head and shoulders, or a weapon's gem. */
const signOf = (kind: WishKind) => (kind === 'weapon' ? 'gem' : 'person')

/** The Pulls model, as a widget reads it. */
function usePulls(ctx: WidgetContext): Pulls | null {
  return useModel<Pulls>('/api/pulls', ctx.version).data
}

/** What a widget says while it reads, or before any import; null once it has a history to show. */
function waiting(data: Pulls | null) {
  if (data === null) return <p className="wid-line">{READING}</p>
  if (data.uid === null) {
    return (
      <p className="wid-line" data-centre>
        {NO_HISTORY}
      </p>
    )
  }
  return null
}

// ---------------------------------------------------------------- Wishing now

/**
 * The banner a Wishing now widget shows, by the core's time: the one chosen for it by its id, else the first running,
 * else the first to come; null with none announced. A chosen banner that is no longer announced, or has ended, gives
 * way to the first running.
 */
function chosenBanner(data: Pulls, choice: unknown, now: Date): Banner | null {
  const shown = bannersShown(data.banners, now)
  const chosen = typeof choice === 'string' ? shown.find((banner) => String(banner.ann_id) === choice) : undefined
  return chosen ?? shown.find((banner) => isRunning(banner, now)) ?? shown[0] ?? null
}

/**
 * Wishing now (the sketch's): the banner's art fills the body, its sign on the plate where there is none (the demo
 * downloads nothing), with its name and line on a strip along the bottom. The heading says how long it has left, a
 * minute at a time.
 */
function WishingNowView({ widget, ctx }: { widget: Widget; ctx: WidgetContext }) {
  useTick(MINUTE_MS)
  const data = usePulls(ctx)
  const now = ctx.live.now()
  const banner = data === null || data.uid === null ? null : chosenBanner(data, widget.settings.banner, now)
  useHead({ meta: banner !== null && isRunning(banner, now) ? endsIn(banner.ends_at, now) : null })
  const wait = waiting(data)
  if (wait !== null || data === null) return wait
  if (banner === null) {
    return (
      <p className="wid-line" data-centre>
        No banners are announced right now.
      </p>
    )
  }
  return (
    <div className="wn" data-centre>
      <Picture src={banner.art} sign="banner" className="wn-art" />
      <p className="wn-over">
        <b>{banner.name}</b> <span>· {bannerLine(banner, sharesPity(banner, data.banners, now), now)}</span>
      </p>
    </div>
  )
}

function WishingNowSettings({
  widget,
  ctx,
  change,
}: {
  widget: Widget
  ctx: WidgetContext
  change: (settings: Record<string, unknown>) => void
}) {
  const data = usePulls(ctx)
  const banners = data === null ? [] : bannersShown(data.banners, ctx.live.now())
  const choice = typeof widget.settings.banner === 'string' ? widget.settings.banner : 'first'
  return (
    <label className="wid-field">
      Banner
      <select
        aria-label="Banner"
        value={banners.some((banner) => String(banner.ann_id) === choice) ? choice : 'first'}
        onChange={(event) => change({ ...widget.settings, banner: event.target.value })}
      >
        <option value="first">The first running banner</option>
        {banners.map((banner) => (
          <option key={banner.ann_id} value={String(banner.ann_id)}>
            {banner.name}
          </option>
        ))}
      </select>
    </label>
  )
}

// ---------------------------------------------------------------- Pity

type Shown = PullsPool | 'all'

const SHOWN: readonly Shown[] = ['character', 'weapon', 'standard', 'chronicled', 'all']

/** What a Pity widget shows: one wish, the character event unless another is chosen, or all four. */
function shownOf(widget: Widget): Shown {
  const { show } = widget.settings
  return SHOWN.find((one) => one === show) ?? 'character'
}

/** A card's ring: the pity of its hard pity, with the count inside, "61", or "61+" where the history cannot tell. */
function PityRing({ card }: { card: PityCard }) {
  return (
    <SegmentRing value={card.pity} max={card.hard} segment={0}>
      <span className="py-num">{card.known ? num(card.pity) : `${num(card.pity)}+`}</span>
    </SegmentRing>
  )
}

/**
 * Pity (the sketch's): one wish's ring of its hard pity with the count inside, and beside it what the next 5★ is, on a
 * seal (a quiet one where the history cannot tell), the wishes to soft pity and to the next 4★; the heading names the
 * wish. All four: each ring with its wish's name under it, in a row from four cells wide and two by two below that.
 */
function PityView({ widget, ctx }: { widget: Widget; ctx: WidgetContext }) {
  const data = usePulls(ctx)
  const show = shownOf(widget)
  useHead({ meta: show === 'all' || data === null || data.uid === null ? null : POOL_LABELS[show].toLowerCase() })
  const wait = waiting(data)
  if (wait !== null || data === null) return wait
  if (show === 'all') {
    return (
      <ul className="py-all" data-centre>
        {data.pity.map((card) => (
          <li key={card.pool} className="py-one">
            <PityRing card={card} />
            <span className="py-label">{POOL_LABELS[card.pool]}</span>
          </li>
        ))}
      </ul>
    )
  }
  const card = data.pity.find((one) => one.pool === show)
  if (card === undefined) return <p className="wid-line">{NO_HISTORY}</p>
  const words = pityWords(card)
  return (
    <div className="py">
      <div className="py-ring" data-centre>
        <PityRing card={card} />
      </div>
      <div className="py-words">
        {words.tag !== null && <Seal quiet={words.tag === GUARANTEE_NOT_KNOWN}>{words.tag}</Seal>}
        <p className="py-line">{words.soft}</p>
        <p className="py-line">{words.four}</p>
      </div>
    </div>
  )
}

function PitySettings({
  widget,
  change,
}: {
  widget: Widget
  ctx: WidgetContext
  change: (settings: Record<string, unknown>) => void
}) {
  return (
    <label className="wid-field">
      Wish
      <select aria-label="Wish" value={shownOf(widget)} onChange={(event) => change({ ...widget.settings, show: event.target.value })}>
        {SHOWN.map((one) => (
          <option key={one} value={one}>
            {one === 'all' ? 'All four' : POOL_LABELS[one]}
          </option>
        ))}
      </select>
    </label>
  )
}

// ---------------------------------------------------------------- Savings

/**
 * Savings (the sketch's, without its bars: the plan's call 19): the pulls as estimated now, large, with the pulls by the
 * next version's end under them, the card's total (the second pass); the heading says when the balance was set.
 */
function SavingsView({ ctx }: { widget: Widget; ctx: WidgetContext }) {
  const data = usePulls(ctx)
  const set = data === null || data.uid === null ? null : data.savings.set
  useHead({ meta: set === null ? null : savingsSet(set, ctx.live.now()) })
  const wait = waiting(data)
  if (wait !== null || data === null) return wait
  const { pulls } = data.savings
  if (set === null || pulls === null) {
    return (
      <p className="wid-line" data-centre>
        Set the balance on the Pulls page.
      </p>
    )
  }
  return (
    <div className="sv" data-centre>
      <p className="sv-big">
        <Picture src={PRIMOGEM} sign="gem" className="sv-gem" />
        {plural(pulls, 'pull')}
      </p>
      <p className="sv-by">{savingsBy(data.savings)}</p>
    </div>
  )
}

// ---------------------------------------------------------------- Wishlist

type Face = { key: string; name: string; kind: WishKind; rank: number; icon: string | null; when: string }

/**
 * Wishlist (the sketch's): the player's own wishlist, each a face in its rarity's frame, gold for a 5★ and purple for a
 * 4★, with its name and whether the pulls reach it; the running banners stay on the Pulls page's planner (the player,
 * 2026-10-24). A list taller than the body scrolls in it.
 */
function WishlistView({ ctx }: { widget: Widget; ctx: WidgetContext }) {
  const data = usePulls(ctx)
  const wait = waiting(data)
  if (wait !== null || data === null) return wait
  const faces: Face[] = data.wishlist.map((entry) => ({
    key: String(entry.id), name: entry.name, kind: entry.kind, rank: entry.rank, icon: entry.icon, when: wishShort(entry),
  }))
  if (faces.length === 0) {
    return (
      <p className="wid-line" data-centre>
        Add the characters you are saving for, with a rough date.
      </p>
    )
  }
  return (
    <ul className="wl w-scroll" data-centre>
      {faces.map((face) => (
        <li key={face.key}>
          <Picture src={face.icon} sign={signOf(face.kind)} className={face.rank >= 5 ? 'wl-face r5' : 'wl-face r4'} />
          <span className="wl-text">
            <b>{face.name}</b> <span className="wl-when">· {face.when}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------- Last pulls

/**
 * Last pulls (the sketch's): the newest twelve as faces, newest first, 5★ in gold and 4★ in purple, a 3★ plain with
 * its weapon's sign; each titled with its name and its pity. Under them the newest 5★ and how it fell; the heading
 * counts the wishes kept.
 */
function LastPullsView({ ctx }: { widget: Widget; ctx: WidgetContext }) {
  const data = usePulls(ctx)
  useHead({ meta: data === null || data.uid === null ? null : `${num(data.history.count)} kept` })
  const wait = waiting(data)
  if (wait !== null || data === null) return wait
  const five = lastFive(data)
  return (
    <div className="lp">
      <ul className="lp-faces" data-centre>
        {data.history.rows.slice(0, 12).map((row) => (
          <li key={row.id} className={`lp-face r${row.rank}`} title={faceTitle(row)}>
            <span className="sr-only">{faceTitle(row)}</span>
            <Picture src={row.icon} sign={signOf(row.kind)} className="lp-pic" />
          </li>
        ))}
      </ul>
      {five !== null && <p className="wid-line lp-five">{five}</p>}
    </div>
  )
}

// ---------------------------------------------------------------- Luck

/**
 * Luck (the sketch's): the average 5★ pity of the character event, large, and the 50/50 record, won then lost; "No 5★
 * yet" before one.
 */
function LuckView({ ctx }: { widget: Widget; ctx: WidgetContext }) {
  const data = usePulls(ctx)
  const wait = waiting(data)
  if (wait !== null || data === null) return wait
  const { history } = data
  if (history.fives === 0) {
    return (
      <p className="wid-line" data-centre>
        No 5★ yet
      </p>
    )
  }
  return (
    <div className="lk" data-centre>
      {history.average_pity !== null && (
        <>
          <p className="lk-big">{num(history.average_pity)}</p>
          <p className="lk-what">{LUCK_WHAT}</p>
        </>
      )}
      {history.won + history.lost > 0 && (
        <span className="lk-bar" aria-hidden="true">
          <i className="lk-won" style={{ flexGrow: history.won }} />
          <i className="lk-lost" style={{ flexGrow: history.lost }} />
        </span>
      )}
      <p className="lk-fifty">
        <b>{fiftyRecord(history)}</b> 50/50
      </p>
    </div>
  )
}

// ---------------------------------------------------------------- the types (the plan's call 14)

export const WISHING_NOW: WidgetType = {
  id: 'wishing-now',
  name: 'Wishing now',
  about: 'The banner running now, with your pity on it.',
  sign: 'banner',
  min: { w: 3, h: 2 },
  max: { w: 6, h: 4 },
  start: { w: 3, h: 2 },
  settings: { banner: 'first' },
  View: WishingNowView,
  Settings: WishingNowSettings,
}

export const PITY: WidgetType = {
  id: 'pity',
  name: 'Pity',
  about: 'Your pity and guarantee on one wish, or all four.',
  sign: 'ring',
  min: { w: 2, h: 2 },
  max: { w: 6, h: 3 },
  start: { w: 2, h: 2 },
  settings: { show: 'character' },
  View: PityView,
  Settings: PitySettings,
}

export const SAVINGS: WidgetType = {
  id: 'savings',
  name: 'Savings',
  about: 'Your pulls now and by the end of the next version.',
  sign: 'gem',
  min: { w: 2, h: 2 },
  max: { w: 4, h: 3 },
  start: { w: 2, h: 2 },
  settings: {},
  View: SavingsView,
}

export const WISHLIST: WidgetType = {
  id: 'wishlist',
  name: 'Wishlist',
  about: 'Who you are saving for, and whether you get there.',
  sign: 'wish',
  min: { w: 2, h: 2 },
  max: { w: 4, h: 4 },
  start: { w: 2, h: 2 },
  settings: {},
  View: WishlistView,
}

export const LAST_PULLS: WidgetType = {
  id: 'last-pulls',
  name: 'Last pulls',
  about: 'Your newest pulls as faces, and the last 5★.',
  sign: 'cards',
  min: { w: 2, h: 2 },
  max: { w: 4, h: 3 },
  start: { w: 2, h: 2 },
  settings: {},
  View: LastPullsView,
}

export const LUCK: WidgetType = {
  id: 'luck',
  name: 'Luck',
  about: 'Your average 5★ pity and your 50/50 record.',
  sign: 'dice',
  min: { w: 1, h: 2 },
  max: { w: 3, h: 2 },
  start: { w: 1, h: 2 },
  settings: {},
  View: LuckView,
}
