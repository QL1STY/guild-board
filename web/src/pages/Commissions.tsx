import { type RefObject, useCallback, useLayoutEffect, useRef, useState } from 'react'
import { num } from '../format.ts'
import { useModel, useTick } from '../live.ts'
import type { Commission, CommissionsModel, Region } from '../types.ts'
import { useFocusFollows } from '../ui/focus.ts'
import { Segmented } from '../ui/Segmented.tsx'
import type { Change } from './AchievementGroup.tsx'
import { keptAfter } from './achievementsview.ts'
import { CommissionCard } from './CommissionCard.tsx'
import { hoyolabLine, lookingFor, placeCards, regionLine } from './commissionsview.ts'

const NO_IDS: readonly number[] = []

/**
 * Keeps the room of what sits above the cards while `holding`. The commissions to look for and the region's sentence
 * follow the model, and a line they lose, or a sentence that goes, would move every card after them up under the
 * pointer. So while the cards the player changed stay in their places, the element around them is never shorter than
 * it has been since the first of those changes, and it lets go of that room when the player moves on.
 */
function useHeldRoom(holding: boolean) {
  const room = useRef<HTMLDivElement>(null)
  const held = useRef(0)
  useLayoutEffect(() => {
    if (!holding) held.current = 0
    const box = room.current
    if (box === null) return
    // Measured with the room it holds already: that room stays, and a taller one, as after a change made elsewhere, is
    // held from then on.
    if (holding) held.current = Math.max(held.current, box.getBoundingClientRect().height)
    box.style.minHeight = holding ? `${held.current}px` : ''
  })
  return room
}

/**
 * The game day turns at 04:00 server time, and the core tells the pages nothing then. So the category reads its model
 * again once a minute: Appeared today comes back, and the day before's HoYoLAB count goes, within a minute of the
 * reset.
 */
const READ_AGAIN_MS = 60_000

const idsOf = (cards: readonly Commission[]): number[] => cards.map((card) => card.id)

/**
 * The Daily commissions category (spec 11): the commission achievements of one region, which opens on the region set
 * in Settings. Over the cards, HoYoLAB's count of the day's commissions and the commission names to look for; the done
 * ones fold away. Each change goes through the page's undo note. A card the player changes stays where it is, with
 * fresh data, until the player moves on, as the achievements' cards do (spec 24): with another region, or with a choice
 * in the categories, which `movedOn` counts. Meanwhile what sits above the cards keeps its room, so that no card moves
 * under the pointer: the commissions to look for wait for a card unticked in the fold (lookingFor), and a line or a
 * sentence that goes leaves its room (useHeldRoom).
 */
export function Commissions({
  version,
  change,
  elsewhere,
  movedOn,
}: {
  /** Goes up whenever the model should be read again: on the core's events, and after a change that failed. */
  version: number
  /** Sends one change; the undo note names it (Achievements.tsx, useChanges). */
  change: (path: string, body?: unknown) => Promise<boolean>
  /** Where the focus goes when the card that had it is gone: the page's heading. */
  elsewhere: RefObject<HTMLElement | null>
  /** Goes up each time the player moves on with a choice in the categories, even of Daily commissions itself. */
  movedOn: number
}) {
  const minutes = useTick(READ_AGAIN_MS)
  // Until the player picks a region, the model is asked for without one, and the core answers for the region set in
  // Settings.
  const [region, setRegion] = useState<Region | null>(null)
  const path = region === null ? '/api/commissions' : `/api/commissions?region=${region}`
  // Both numbers only go up, so their sum moves on whenever either does.
  const { data, error, read } = useModel<CommissionsModel>(path, version + minutes)
  const [showDone, setShowDone] = useState(false)
  // The cards changed since the player last moved on, the most recent last, with the moves they were changed after.
  const [changed, setChanged] = useState<{ movedOn: number; ids: readonly number[] }>({ movedOn, ids: NO_IDS })
  const kept = changed.movedOn === movedOn ? changed.ids : NO_IDS
  const changeCard = useCallback<Change>(
    (id, cardPath, body) => {
      setChanged((current) => ({ movedOn, ids: keptAfter(current.movedOn === movedOn ? current.ids : NO_IDS, id) }))
      return change(cardPath, body)
    },
    [change, movedOn],
  )
  // The cards as last drawn, by id: the cards kept stay in those places.
  const before = useRef<{ above: readonly number[]; fold: readonly number[] }>({ above: NO_IDS, fold: NO_IDS })
  const placed = data === null ? null : placeCards(data, before.current, kept)
  useLayoutEffect(() => {
    if (placed !== null) before.current = { above: idsOf(placed.above), fold: idsOf(placed.fold) }
  })
  // A card that moves into the fold or out of it keeps the keyboard's place, on the same control.
  const layout = placed === null ? '' : `${idsOf(placed.above).join(' ')}|${idsOf(placed.fold).join(' ')}`
  const { list, onFocus, onBlur } = useFocusFollows(layout, elsewhere, 'card')
  // While the cards the player changed stay in their places, what sits above them keeps its room too.
  const top = useHeldRoom(kept.length > 0)
  // The card whose panel is open under its row, one at a time, with where the player was when it opened: moving on, to
  // another region or with a choice in the categories, closes it. A card that leaves takes its panel.
  const place = `${movedOn} ${region ?? ''}`
  const [opened, setOpened] = useState<{ card: number; place: string } | null>(null)
  const open = opened !== null && opened.place === place ? opened.card : null
  const toggle = useCallback(
    (id: number) => setOpened((current) => (current?.card === id && current.place === place ? null : { card: id, place })),
    [place],
  )
  if (data === null || placed === null) {
    return <div className="gb-panel gb-empty">{error ?? 'Reading the daily commissions…'}</div>
  }
  // Another region is moving on. A click on the region shown is not: Segmented does not call for it.
  const chooseRegion = (next: Region) => {
    setRegion(next)
    setChanged({ movedOn, ids: NO_IDS })
  }
  const options = data.regions.map((one) => ({ value: one.key, label: `${one.name} ${num(one.left)}` }))
  const hoyolab = hoyolabLine(data.hoyolab)
  const looking = lookingFor(data, placed.above)
  const empty = regionLine(data)
  const card = (one: Commission) => (
    <CommissionCard key={one.id} card={one} read={read} change={changeCard} open={open === one.id} onToggle={toggle} />
  )
  return (
    <div className="com" data-testid="commissions" ref={list} onFocus={onFocus} onBlur={onBlur}>
      <div className="com-head">
        <Segmented label="Region" options={options} value={region ?? data.region} onChange={chooseRegion} />
        {hoyolab !== null && <p className="com-hoyolab">{hoyolab}</p>}
      </div>
      <div className="com-top" ref={top}>
        <section className="gb-panel com-look" aria-labelledby="com-look-head">
          <h3 id="com-look-head" className="com-look-head">
            Commissions to look for
          </h3>
          {looking.length === 0 ? (
            <p className="com-nothing">Nothing to look for here.</p>
          ) : (
            <ul className="com-look-list">
              {looking.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          )}
        </section>
        {placed.above.length === 0 && empty !== null && <div className="gb-panel gb-empty">{empty}</div>}
      </div>
      {placed.above.length > 0 && <div className="com-cards">{placed.above.map(card)}</div>}
      {placed.fold.length > 0 && (
        <>
          <button
            type="button"
            className="gb-link com-fold"
            aria-expanded={showDone}
            onClick={() => setShowDone(!showDone)}
          >
            {showDone ? 'Hide done' : `Show ${num(placed.fold.length)} done`}
          </button>
          {showDone && (
            <section className="com-cards" aria-label="Done">
              {placed.fold.map(card)}
            </section>
          )}
        </>
      )}
    </div>
  )
}
