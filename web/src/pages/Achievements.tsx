import {
  type CSSProperties, type FocusEvent, type RefObject, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from 'react'
import '../styles/achievements.css'
import { num, plural } from '../format.ts'
import { Frame } from '../frame/Frame.tsx'
import { type Live, useModel } from '../live.ts'
import { hashOfPlace, placeOfHash } from '../route.ts'
import type {
  AchievementGroup as AchievementGroupModel, Achievements as AchievementsModel, AchievementStatus,
} from '../types.ts'
import { Bar } from '../ui/marks.tsx'
import { CountUp } from '../ui/motion.tsx'
import { Picture } from '../ui/Picture.tsx'
import { Segmented } from '../ui/Segmented.tsx'
import { tickedPercent } from '../widgets/widgetview.ts'
import { AchievementCard } from './AchievementCard.tsx'
import type { Change } from './AchievementGroup.tsx'
import {
  categoryName, categoryTicked, changesListing, contentTitle, emptyLine, type FocusControl, keptAfter, type LostFocus,
  matchingControl, modelPath, type Place, placeAfter, sentSearch, shareGroups, takesPlace, unlistedDetails,
} from './achievementsview.ts'
import { Commissions } from './Commissions.tsx'
import { CheckButton, ListPanel, type ListUpdates, useListUpdates } from './ListPanel.tsx'
import { Timers } from './Timers.tsx'
import { useChanges } from '../ui/changes.tsx'
import { useUndoKey } from '../ui/note.tsx'

type Query = AchievementsModel['query']

const VIEWS = [
  { value: 'left', label: 'Left' },
  { value: 'done', label: 'Done' },
  { value: 'all', label: 'All' },
] as const

const SEARCH_WAIT_MS = 250

/** The categories' bars grow one after another as the page opens, at most this many steps apart (look pass spec 6.3). */
const STAGGERED_AT_MOST = 12

const STATUSES: Record<AchievementStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  done: 'Done',
}


/**
 * Keeps the page's scroll padding at the bar's real height, which grows when its tools wrap, so that what the keyboard
 * moves to is scrolled into view below the bar, never under it (achievements.css). A ref callback: React calls what it
 * returns when the bar goes.
 */
function followBarHeight(bar: HTMLDivElement | null): (() => void) | undefined {
  if (bar === null) return undefined
  const root = document.documentElement
  const observer = new ResizeObserver(() => root.style.setProperty('--ach-bar-height', `${bar.offsetHeight}px`))
  observer.observe(bar)
  return () => {
    observer.disconnect()
    root.style.removeProperty('--ach-bar-height')
  }
}

/**
 * The ticks against all and what is left (look pass spec 11.1): the ticks, which count up once, a bar of the ticks
 * against all with its percentage at its end, and the primogems the stages left are worth, with the primogem's picture.
 * HoYoLAB's count is not shown: the player does not want it (look pass spec 2). The page's one Check for new
 * achievements (spec 12.3) opens its panel under the top line; the panel's Close hands the focus to `check`.
 */
function TopLine({
  data,
  updates,
  check,
}: {
  data: AchievementsModel
  updates: ListUpdates
  check: RefObject<HTMLButtonElement | null>
}) {
  const { totals } = data
  return (
    <div className="gb-panel ach-top" data-testid="ach-top">
      <div className="ach-ticks">
        <p className="ach-counts">
          <b className="ach-fig">
            <CountUp value={totals.done} />
          </b>{' '}
          <span className="ach-of">of {num(totals.stages)} ticked</span>
        </p>
        <p className="ach-left">{num(totals.left)} left</p>
      </div>
      <div className="ach-meter">
        <Bar value={totals.done} max={totals.stages} />
        <span className="ach-percent">{tickedPercent(totals.done, totals.stages)}%</span>
      </div>
      <div className="ach-top-end">
        <p className="ach-earn">
          <Picture src="/api/icon/static.primogem" sign="gem" className="ach-top-gem" />
          <b className="ach-earn-n">
            <CountUp value={totals.primogems_left} />
          </b>{' '}
          <span className="ach-of">{totals.primogems_left === 1 ? 'primogem' : 'primogems'} to earn</span>
        </p>
        <CheckButton updates={updates} button={check} />
      </div>
    </div>
  )
}

function PlaceButton({
  label,
  count,
  current,
  onClick,
}: {
  label: string
  /** What a special category counts: the timers ready, the commission achievements left, the achievements pinned. */
  count: number
  current: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={current ? 'ach-cat on' : 'ach-cat'}
      aria-current={current ? 'true' : undefined}
      onClick={onClick}
    >
      <span>{label}</span> {count > 0 && <span className="n">{num(count)}</span>}
    </button>
  )
}

/**
 * A game category (look pass spec 11.2): its name, how many stages are left (none at 0), and a thin bar of its stages
 * ticked against its stages, gold on the dark plate when it is the one shown. The share ticked is in the button's name
 * and in its tip, which shows on hover and on keyboard focus (frame.css, data-tip). `order` staggers the bars' growth as
 * the page opens.
 */
function CategoryButton({
  category,
  order,
  current,
  onClick,
}: {
  category: AchievementsModel['categories'][number]
  order: number
  current: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={current ? 'ach-cat on' : 'ach-cat'}
      aria-current={current ? 'true' : undefined}
      aria-label={categoryName(category)}
      data-tip={categoryTicked(category)}
      style={{ '--k': Math.min(order, STAGGERED_AT_MOST) } as CSSProperties}
      onClick={onClick}
    >
      <span>{category.name}</span> {category.left > 0 && <span className="n">{num(category.left)}</span>}
      <Bar value={category.stages - category.left} max={category.stages} />
    </button>
  )
}

/**
 * The special categories first, Timers, Daily commissions and Pinned, with their counts, then the game's, with how many
 * are left in each and a bar of their ticks (spec 12.3, look pass spec 11.2). `special` is the special category with an
 * address of its own that the page shows, or null.
 */
function Categories({
  data,
  special,
  choose,
}: {
  data: AchievementsModel
  special: Place['special']
  choose: (place: Partial<Place>) => void
}) {
  const [showComplete, setShowComplete] = useState(false)
  const shown = data.query
  const listed = special === null // the page shows achievements, not Timers or Daily commissions
  const inCategory = listed && !shown.pinned && !shown.unlisted && shown.search.trim() === ''
  const open = data.categories.filter((category) => category.left > 0)
  const complete = data.categories.filter((category) => category.left === 0)
  const button = (category: AchievementsModel['categories'][number], order: number) => (
    <CategoryButton
      key={category.key}
      category={category}
      order={order}
      current={inCategory && shown.category === category.key}
      onClick={() => choose({ category: category.key, pinned: false, unlisted: false })}
    />
  )
  return (
    <nav className="gb-panel ach-cats" aria-label="Categories">
      <PlaceButton
        label="Timers"
        count={data.special.timers_ready}
        current={special === 'timers'}
        onClick={() => choose({ special: 'timers' })}
      />
      <PlaceButton
        label="Daily commissions"
        count={data.special.commissions_left}
        current={special === 'commissions'}
        onClick={() => choose({ special: 'commissions' })}
      />
      <PlaceButton
        label="Pinned"
        count={data.pinned}
        current={listed && shown.pinned && !shown.unlisted}
        onClick={() => choose({ pinned: true, unlisted: false })}
      />
      {data.unlisted > 0 && (
        <PlaceButton
          label="Not in the current list"
          count={data.unlisted}
          current={listed && shown.unlisted}
          onClick={() => choose({ pinned: false, unlisted: true })}
        />
      )}
      <hr className="ach-sep" />
      {open.map(button)}
      {complete.length > 0 && (
        <button
          type="button"
          className="gb-link ach-fold"
          aria-expanded={showComplete}
          onClick={() => setShowComplete(!showComplete)}
        >
          {showComplete
            ? 'Hide complete categories'
            : `Show ${plural(complete.length, 'complete category', 'complete categories')}`}
        </button>
      )}
      {showComplete && complete.map(button)}
    </nav>
  )
}

/**
 * Asks for its search 250 ms after the last key, not at every key. `onSearch` may change only along with `search`: a
 * new one at another moment would start the wait again.
 */
function SearchBox({ search, onSearch }: { search: string; onSearch: (search: string) => void }) {
  const [typed, setTyped] = useState(search)
  useEffect(() => {
    if (typed === search) return
    const timer = window.setTimeout(() => onSearch(typed), SEARCH_WAIT_MS)
    return () => window.clearTimeout(timer)
  }, [typed, search, onSearch])
  return (
    <input
      type="search"
      className="ach-search"
      aria-label="Search achievements"
      placeholder="Search achievements"
      value={typed}
      onChange={(event) => setTyped(event.target.value)}
    />
  )
}


/** Progress on stages that the installed list does not hold. It is kept (spec 6.3): status, note, pin, parts and count. */
function Unlisted({ rows }: { rows: AchievementsModel['unlisted_rows'] }) {
  return (
    <div className="gb-panel ach-unlisted" data-testid="unlisted">
      <p className="gb-note">
        The installed list does not hold these achievements. Guild Board keeps your progress on them.
      </p>
      <ul className="ach-rows">
        {rows.map((row) => {
          const details = unlistedDetails(row)
          return (
            <li key={row.id}>
              <span>
                Achievement {row.id}
                {row.note !== '' && <small>{row.note}</small>}
                {details !== null && <small>{details}</small>}
              </span>
              <b>{STATUSES[row.status]}</b>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** Whether a control is ticked or pressed, or null for one that is neither. */
function stateOf(control: HTMLElement): boolean | null {
  if (control instanceof HTMLInputElement && control.type === 'checkbox') return control.checked
  const pressed = control.getAttribute('aria-pressed')
  return pressed === null ? null : pressed === 'true'
}

function asFocusControl(control: HTMLElement): FocusControl {
  return { kind: control.dataset.focus ?? '', usable: !control.matches(':disabled'), state: stateOf(control) }
}

/** The control in the cards that has the focus, or had it last, and its card. */
type Focused = LostFocus & { group: number }

/**
 * Keeps the keyboard's place in the cards. The cards the page changes stay until the player moves on, but a change made
 * elsewhere, as from another window, can take a card off the list while a control in it has the focus, and the focus
 * would fall back to the start of the page. It moves instead to the matching control of the card that took the place,
 * or to the heading when no card is left.
 */
function useFocusKept(
  groups: AchievementGroupModel[],
  title: RefObject<HTMLHeadingElement | null>,
) {
  const cards = useRef<HTMLDivElement>(null)
  const focused = useRef<Focused | null>(null)
  const shownIds = useRef<number[]>([])
  useLayoutEffect(() => {
    const before = shownIds.current
    const after = groups.map((group) => group.id)
    shownIds.current = after
    const lost = focused.current
    if (lost === null || after.includes(lost.group)) return
    focused.current = null
    const active = document.activeElement
    if (active !== null && active !== document.body) return // the focus is somewhere else already
    const place = takesPlace(before, after, lost.group)
    const card = place === null ? null : cards.current?.querySelector(`[data-group="${place}"]`)
    const controls = card ? [...card.querySelectorAll<HTMLElement>('[data-focus]')] : []
    const target = controls[matchingControl(controls.map(asFocusControl), lost)] ?? title.current
    target?.focus()
  }, [groups, title])
  const onFocus = (event: FocusEvent<HTMLElement>) => {
    const control = event.target.closest<HTMLElement>('[data-focus]')
    const card = control?.closest<HTMLElement>('[data-group]')
    if (!control || !card) return
    const kind = control.dataset.focus ?? ''
    const ordinal = [...card.querySelectorAll(`[data-focus="${kind}"]`)].indexOf(control)
    focused.current = { group: Number(card.dataset.group), kind, ordinal, state: stateOf(control) }
  }
  const onBlur = (event: FocusEvent<HTMLElement>) => {
    // A move to something outside the cards forgets the control. When its card leaves the list, the focus goes to no
    // element, and the control is kept for the effect above.
    const next = event.relatedTarget
    if (next instanceof Node && !event.currentTarget.contains(next)) focused.current = null
  }
  return { cards, onFocus, onBlur }
}

/**
 * The groups of each read, made of the ones before wherever they are the same (shareGroups), so that a card whose
 * achievement did not change is not drawn again at a core event (audit L22).
 */
function useSharedGroups(groups: AchievementGroupModel[]): AchievementGroupModel[] {
  const before = useRef<AchievementGroupModel[] | null>(null)
  const shared = useMemo(() => shareGroups(before.current, groups), [groups])
  useEffect(() => {
    before.current = shared
  }, [shared])
  return shared
}

function Content({
  data,
  read,
  change,
  title,
  moves,
}: {
  data: AchievementsModel
  /** The number of the model read that `data` came from. */
  read: number
  change: Change
  title: RefObject<HTMLHeadingElement | null>
  /** How many times the player has moved on (Achievements): an open panel closes then. */
  moves: number
}) {
  const groups = useSharedGroups(data.groups)
  const { cards, onFocus, onBlur } = useFocusKept(groups, title)
  // The cards with a click that waits for a read: only they are given each read's number, which the others do not need.
  const [waiting, setWaiting] = useState<ReadonlySet<number>>(() => new Set())
  const onWaiting = useCallback((group: number, on: boolean) => {
    setWaiting((current) => {
      if (current.has(group) === on) return current
      const next = new Set(current)
      if (on) next.add(group)
      else next.delete(group)
      return next
    })
  }, [])
  // The achievement whose panel is open under its card's row, one at a time (look pass spec 11.4), and when it opened.
  // It stays open while the player changes things on the page, and closes when the player moves on. A card that
  // leaves the list takes its panel.
  const [opened, setOpened] = useState<{ group: number; moves: number } | null>(null)
  const open = opened !== null && opened.moves === moves ? opened.group : null
  const toggle = useCallback(
    (group: number) =>
      setOpened((current) => (current?.group === group && current.moves === moves ? null : { group, moves })),
    [moves],
  )
  useEffect(() => {
    if (opened !== null && !groups.some((group) => group.id === opened.group)) setOpened(null)
  }, [groups, opened])
  const shown = data.query
  if (shown.unlisted && data.unlisted_rows.length > 0) return <Unlisted rows={data.unlisted_rows} />
  if (groups.length === 0) return <div className="gb-panel gb-empty">{emptyLine(shown)}</div>
  // Pinned and a search show achievements of every category, so each card names its own.
  const everyCategory = shown.pinned || shown.search.trim() !== ''
  return (
    <div className="ach-cards" ref={cards} onFocus={onFocus} onBlur={onBlur}>
      {groups.map((group) => (
        <AchievementCard
          key={group.id}
          group={group}
          read={waiting.has(group.id) ? read : 0}
          change={change}
          showCategory={everyCategory}
          open={open === group.id}
          onToggle={toggle}
          onWaiting={onWaiting}
        />
      ))}
    </div>
  )
}

export function Achievements({ live }: { live: Live }) {
  const [view, setView] = useState<Query['view']>('left')
  // The address opens Timers or Daily commissions (route.ts, placeOfHash).
  const [place, setPlace] = useState<Place>(() => ({
    category: null, pinned: false, unlisted: false, special: placeOfHash(window.location.hash),
  }))
  const [search, setSearch] = useState('')
  // How many times the player moved on with a choice in the categories: each ends the search, with a new, empty box, and
  // the cards Daily commissions kept in their places leave them.
  const [movedOn, setMovedOn] = useState(0)
  // The achievements the page changed since the player last moved on. They stay in the list, with fresh data, so that
  // a tick in Left does not move the next card up under the pointer.
  const [kept, setKept] = useState<number[]>([])
  // How many times the player moved on, with a choice in the categories, another view or another search. An open
  // achievement's panel closes then.
  const [moves, setMoves] = useState(0)
  const title = useRef<HTMLHeadingElement>(null) // where the focus goes when nothing else can take it
  const { failures, change, undo } = useChanges()
  useUndoKey(undo, true)
  const updates = useListUpdates() // the top line's check, and its panel
  const check = useRef<HTMLButtonElement>(null)
  // The panel's Close takes the button the player pressed away with the panel: the focus goes back to the check.
  const closeList = () => {
    if (updates.close()) check.current?.focus()
  }
  // Both numbers only go up, so their sum moves on whenever either does.
  const { data, error, read } = useModel<AchievementsModel>(
    modelPath({ view, ...place, search, keep: kept }),
    live.version + failures,
  )
  useEffect(() => {
    if (data !== null) setPlace((current) => placeAfter(current, data.query))
  }, [data])
  const changeGroup = useCallback<Change>(
    (group, path, body) => {
      if (changesListing(body)) setKept((current) => keptAfter(current, group))
      return change(path, body)
    },
    [change],
  )
  // The player moves on with a choice in the categories, another view or another search, and the changed cards leave
  // then. A choice of the place already shown is moving on too: it ends the search and tidies the list without leaving
  // it. An Undo is not moving on, nor a click on the view already chosen, nor spaces at the ends of the search.
  const moveOn = useCallback((next: Partial<Place>) => {
    setPlace((current) => ({ ...current, ...next }))
    setSearch('')
    setMovedOn((count) => count + 1)
    setKept([])
    setMoves((count) => count + 1)
  }, [])
  // A choice names its special category, or none. The address follows, in place: the browser's history gains no step,
  // and a reload, or the shell's window opened again, comes back to the special category.
  const choose = (next: Partial<Place>) => {
    const special = next.special ?? null
    moveOn({ ...next, special })
    window.history.replaceState(window.history.state, '', hashOfPlace(special))
  }
  // A change of the address opens the special category it names, as the shell's after a click on a reminder (spec 10);
  // the address of the page itself, as the rail's link, leaves it.
  useEffect(() => {
    const follow = () => moveOn({ special: placeOfHash(window.location.hash) })
    window.addEventListener('hashchange', follow)
    return () => window.removeEventListener('hashchange', follow)
  }, [moveOn])
  const chooseView = (next: Query['view']) => {
    if (next === view) return // the view already chosen; Segmented does not call for it either
    setView(next)
    setKept([])
    setMoves((count) => count + 1)
  }
  const searchFor = useCallback(
    (next: string) => {
      setSearch(next)
      // The core gets the search without the spaces at its ends, so a change of those alone is the same search.
      if (sentSearch(next) === sentSearch(search)) return
      setKept([])
      setMoves((count) => count + 1)
    },
    [search],
  )
  return (
    <Frame page="achievements" live={live}>
      {data === null ? (
        <div className="gb-panel gb-empty">{error ?? 'Reading the achievements…'}</div>
      ) : (
        <div className="ach">
          <TopLine data={data} updates={updates} check={check} />
          {/* Outside the sticky bar, which keeps its size. */}
          {updates.asked && (
            <div className="gb-panel ach-sheet">
              <ListPanel list={data.list} read={read} updates={updates} close={closeList} />
            </div>
          )}
          <Categories data={data} special={place.special} choose={choose} />
          <div className="ach-main">
            <div className="ach-bar" data-testid="ach-bar" ref={followBarHeight}>
              <div className="ach-tools">
                <h2 ref={title} className="ach-title" tabIndex={-1}>
                  {contentTitle(data, place.special)}
                </h2>
                {/* Pinned shows every pinned achievement, whatever the view; the rows the list does not hold have
                    neither a view nor a search, and nor have Timers and Daily commissions. */}
                {place.special === null && !place.pinned && !place.unlisted && (
                  <Segmented label="Show" options={VIEWS} value={view} onChange={chooseView} />
                )}
                {place.special === null && !place.unlisted && (
                  <SearchBox key={movedOn} search={search} onSearch={searchFor} />
                )}
              </div>
            </div>
            {place.special === 'timers' && (
              <Timers live={live} version={live.version + failures} change={change} elsewhere={title} />
            )}
            {place.special === 'commissions' && (
              <Commissions version={live.version + failures} change={change} elsewhere={title} movedOn={movedOn} />
            )}
            {place.special === null && (
              <Content
                data={data}
                read={read}
                change={changeGroup}
                title={title}
                moves={moves}
              />
            )}
          </div>
        </div>
      )}
    </Frame>
  )
}
