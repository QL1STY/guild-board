import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { type Live, useModel, useTick } from '../live.ts'
import type { PresetOffer, Timer, TimersModel } from '../types.ts'
import { useFocusFollows, useStepFocus } from '../ui/focus.ts'
import { NewTimer } from './NewTimer.tsx'
import { type Send, type TimerChange, TimerCard, useSending } from './TimerCard.tsx'
import { groupTimers, offerGroups } from './timersview.ts'

const NO_TIMERS: readonly Timer[] = []

/** Longer than a double-click: Windows takes two clicks up to half a second apart as one. */
const SETTLE_MS = 500

/** What the category shows, in order: the cards of each group, then the pre-sets offered. It changes when one moves. */
function layoutOf(groups: ReturnType<typeof groupTimers>, offers: readonly PresetOffer[]): string {
  const ids = (timers: readonly Timer[]) => timers.map((timer) => timer.id).join(' ')
  return [ids(groups.ready), ids(groups.running), ids(groups.own), offers.map((offer) => offer.key).join(' ')].join('|')
}

/**
 * The cards move as the timers change: Cleared takes a ready card to Running, Remove takes it away, and Add takes its
 * offer off the list. The card or the offer after it then moves up under the pointer, and the second click of a
 * double-click would change that timer instead, as spec 24 found on the achievements' cards. So for a moment after the
 * core answers a change, and after the cards or the offers move, the category rests: its buttons that send show it
 * (aria-disabled), and a press sends nothing. `layout` is null until the timers are first read, which is no move.
 */
function useSettling(change: TimerChange, layout: string | null): { settling: boolean; send: Send } {
  const [settling, setSettling] = useState(false)
  const until = useRef(0) // as settling, but at once: a press can come before the page shows it
  const timer = useRef<number | undefined>(undefined)
  const settle = useCallback(() => {
    until.current = performance.now() + SETTLE_MS
    setSettling(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setSettling(false), SETTLE_MS)
  }, [])
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const shown = useRef(layout)
  useLayoutEffect(() => {
    const before = shown.current
    shown.current = layout
    if (before !== null && layout !== before) settle()
  }, [layout, settle])
  const send: Send = (path, body, method) =>
    performance.now() < until.current ? null : change(path, body, method).finally(settle)
  return { settling, send }
}

/**
 * A group of cards, with its count; a group with no timer is not shown. A card's panel opens across the group's row
 * right under the card's row (TimerCard.tsx).
 */
function Group({
  title,
  timers,
  read,
  clock,
  change,
  changeCount,
  settling,
  opened,
  toggle,
}: {
  title: string
  timers: readonly Timer[]
  read: number
  clock: () => Date
  change: Send
  changeCount: TimerChange
  settling: boolean
  /** The timer whose panel is open, or null. */
  opened: number | null
  toggle: (timer: number) => void
}) {
  if (timers.length === 0) return null
  return (
    <section className="tim-group" aria-label={title}>
      <h3 className="tim-group-head gb-section-h">
        <span>
          {title} <span className="c">{timers.length}</span>
        </span>
      </h3>
      <div className="tim-cards">
        {timers.map((timer) => (
          <TimerCard
            key={timer.id}
            timer={timer}
            read={read}
            clock={clock}
            change={change}
            changeCount={changeCount}
            settling={settling}
            open={opened === timer.id}
            onToggle={toggle}
          />
        ))}
      </div>
    </section>
  )
}

/**
 * Add a pre-set timer (spec 9.2): the pre-sets not in use under their group, and the fishing spots by region, each
 * with Add. The list stays open for the next one. An offer leaves it once it is added, with the Add button that had
 * the focus, and the focus goes to `opener`, the button that opened the list; after a press with the mouse, the page
 * stays where the player is in the list.
 */
function Offers({
  offers,
  change,
  settling,
  opener,
}: {
  offers: readonly PresetOffer[]
  change: Send
  settling: boolean
  opener: RefObject<HTMLButtonElement | null>
}) {
  const { busy, send } = useSending(change, settling)
  const { watch } = useStepFocus(offers.map((offer) => offer.key).join(' '), opener)
  const groups = offerGroups(offers)
  return (
    <section className="gb-panel tim-offers" aria-label="Add a pre-set timer" {...watch}>
      {groups.length === 0 && <p>Every pre-set timer is in use.</p>}
      {groups.map(({ group, regions }) => (
        <div key={group} className="tim-offer-group">
          <h3 className="tim-offer-head">{group}</h3>
          <div className="tim-regions">
            {regions.map((region) => (
              <div key={region.region ?? ''} className="tim-region">
                {region.name !== null && <h4 className="tim-region-head">{region.name}</h4>}
                <ul className="tim-offer-list">
                  {region.offers.map((offer) => (
                    <li key={offer.key}>
                      <span>{offer.name}</span>
                      <button
                        type="button"
                        className="ach-toggle"
                        aria-disabled={busy}
                        onClick={() => void send('/api/timers', { preset: offer.key })}
                      >
                        Add
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      ))}
    </section>
  )
}

type Sheet = 'new' | 'presets'

/**
 * The Timers category (spec 9.2): what comes back in the game on its own clock, ready first, then running, then the
 * player's own. Its changes go through the undo note, and after each it rests a moment (useSettling). The
 * countdowns tick once a second, on the core's clock.
 */
export function Timers({
  live,
  version,
  change,
  elsewhere,
}: {
  live: Live
  /** Goes up whenever the timers should be read again: on the core's events, and after a change that failed. */
  version: number
  change: TimerChange
  /** Where the focus goes when the card that had it is gone: the page's heading. */
  elsewhere: RefObject<HTMLElement | null>
}) {
  const { data, error, read } = useModel<TimersModel>('/api/timers', version)
  useTick(1000)
  const groups = groupTimers(data?.timers ?? NO_TIMERS)
  const { settling, send } = useSettling(change, data === null ? null : layoutOf(groups, data.presets))
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const adding = useSending(send, settling) // the new timer's Add
  const openers: Record<Sheet, RefObject<HTMLButtonElement | null>> = {
    new: useRef<HTMLButtonElement>(null),
    presets: useRef<HTMLButtonElement>(null),
  }
  // A sheet that closes takes the focus it held with it: the focus goes back to the button that opened it, unless the
  // player has put it somewhere else meanwhile.
  const opened = useRef<Sheet | null>(null)
  useLayoutEffect(() => {
    const opener = opened.current
    opened.current = sheet
    if (sheet !== null || opener === null) return
    const active = document.activeElement
    if (active === null || active === document.body) openers[opener].current?.focus()
  })
  // A card that moves to another group keeps the keyboard's place, on the same button of the same timer.
  const { list, onFocus, onBlur } = useFocusFollows(data?.timers ?? NO_TIMERS, elsewhere, 'timer')
  // The timer whose panel is open under its card's row: one at a time. A panel goes with its card to another group, and
  // a timer that is removed takes its panel.
  const [openTimer, setOpenTimer] = useState<number | null>(null)
  const toggleMore = useCallback((timer: number) => setOpenTimer((current) => (current === timer ? null : timer)), [])
  const timers = data?.timers ?? NO_TIMERS
  useEffect(() => {
    if (openTimer !== null && !timers.some((timer) => timer.id === openTimer)) setOpenTimer(null)
  }, [timers, openTimer])
  if (data === null) return <div className="gb-panel gb-empty">{error ?? 'Reading the timers…'}</div>
  const toggle = (next: Sheet) => setSheet(sheet === next ? null : next)
  const cards = {
    read, clock: live.now, change: send, changeCount: change, settling, opened: openTimer, toggle: toggleMore,
  }
  return (
    <div className="tim" data-testid="timers">
      <div className="gb-panel tim-head">
        <p>
          Things in the game that come back on their own clock. Press <b>Cleared</b> when you have done one, and its
          timer starts.
        </p>
        <div className="tim-head-buttons">
          <button
            ref={openers.new}
            type="button"
            className="gb-btn quiet"
            aria-expanded={sheet === 'new'}
            onClick={() => toggle('new')}
          >
            + New timer
          </button>
          <button
            ref={openers.presets}
            type="button"
            className="gb-btn quiet"
            aria-expanded={sheet === 'presets'}
            onClick={() => toggle('presets')}
          >
            Add a pre-set timer
          </button>
        </div>
      </div>
      {sheet === 'new' && (
        <div className="gb-panel tim-sheet">
          <NewTimer busy={adding.busy} send={adding.send} close={() => setSheet(null)} />
        </div>
      )}
      {sheet === 'presets' && (
        <Offers offers={data.presets} change={send} settling={settling} opener={openers.presets} />
      )}
      {data.timers.length === 0 ? (
        <div className="gb-panel gb-empty">
          No timer yet. + New timer makes one, and Add a pre-set timer lists the ones Guild Board knows.
        </div>
      ) : (
        <div className="tim-list" ref={list} onFocus={onFocus} onBlur={onBlur}>
          <Group title="Ready now" timers={groups.ready} {...cards} />
          <Group title="Running" timers={groups.running} {...cards} />
          <Group title="Your own timers" timers={groups.own} {...cards} />
        </div>
      )}
    </div>
  )
}
