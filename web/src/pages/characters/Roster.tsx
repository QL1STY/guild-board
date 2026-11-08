import { memo, type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import './roster.css'
import { api, messageOf } from '../../api.ts'
import { Frame } from '../../frame/Frame.tsx'
import type { Live } from '../../live.ts'
import { hashOf } from '../../route.ts'
import type { RosterEntry } from '../../types.ts'
import { rise, useGlide } from '../../ui/motion.tsx'
import { Segmented } from '../../ui/Segmented.tsx'
import { Sign } from '../../ui/Sign.tsx'
import { Avatar } from './Avatar.tsx'
import { ELEMENTS, elementClass, WEAPON_TYPES, weaponSign } from './elements.ts'
import { ElementChip } from './ElementChip.tsx'
import { weekShown } from './hidden.ts'
import { entranceDone, rosterMemory, saveRosterScroll, setRosterView, takeEntrance, useRoster, useRosterMemory } from './memory.ts'
import { rosterScale, scaleStyle, useCharactersScale } from './scale.ts'
import { ReadinessRing } from './ReadinessRing.tsx'
import {
  bannerLine, countLine, FOCUS_MAX, type Filters, focusCards, levelLine, RARITIES, type Sort, SORTS, sorted, toggleFocus, visible,
} from './rosterview.ts'
import { SyncLine } from './SyncLine.tsx'
import { CharactersTabs } from './Tabs.tsx'
import { ROSTER_HEADING } from './words.ts'

/** The focus strip, the week page's focus cards: the characters in the player's focus in their order, and a plain line in each slot left. */
export function FocusStrip({ cards, onToggle }: { cards: readonly RosterEntry[]; onToggle: (key: string) => void }) {
  const empty = Math.max(0, FOCUS_MAX - cards.length)
  return (
    <div className="cr-focus-wrap">
      {cards.length === 0 && <p className="cr-focus-hint">Choose up to four characters to plan for.</p>}
      <div className="cr-focus" data-testid="focus-strip">
        {cards.map((entry, index) => (
          <div key={entry.key} className={`cr-fc ${elementClass(entry.element)}`}>
            <Avatar src={entry.icon} element={entry.element} size="56px" />
            <div className="cr-fc-text">
              <b>
                {index + 1}. {entry.name}
              </b>
              <span className="cr-fc-goal">{levelLine(entry)}</span>
              <span className="cr-fc-when">{entry.readiness}% ready</span>
            </div>
            <button type="button" className="cr-fc-x" aria-label={`Take ${entry.name} out of the focus`} onClick={() => onToggle(entry.key)}>
              <Sign name="cross" />
            </button>
          </div>
        ))}
        {Array.from({ length: empty }, (_, index) => (
          <div key={`empty-${index}`} className="cr-fc empty">
            Choose a character below
          </div>
        ))}
      </div>
    </div>
  )
}

/** One character's card: a link to her profile, and a button of its own for the focus; without the focus the whole card is the link. */
const RosterCard = memo(function RosterCard({
  entry,
  onToggle,
  focusShown,
}: {
  entry: RosterEntry
  onToggle: (key: string) => void
  focusShown: boolean
}) {
  const banner = entry.owned || entry.early ? null : bannerLine(entry.banner)
  const inFocus = entry.focus !== null
  return (
    <article
      className={`cr-card ${elementClass(entry.element)}${entry.owned ? '' : ' not-owned'}${focusShown ? '' : ' whole'}`}
      data-key={entry.key}
      data-glide={entry.key}
      data-rise
    >
      <a className="cr-link" href={hashOf({ page: 'characters', view: 'profile', key: entry.key })}>
        <Avatar src={entry.icon} element={entry.element} size="56px" lazy />
        <span className="cr-who">
          <b className="cr-name">{entry.name}</b>
          <span className="cr-level">{entry.early ? 'Not out yet' : levelLine(entry)}</span>
          <span className="cr-kind">
            <ElementChip element={entry.element} />
            <span>
              {entry.rarity}★ {entry.weapon}
            </span>
          </span>
          {!focusShown && banner !== null && <span className="cr-banner">{banner}</span>}
        </span>
        {entry.owned && <ReadinessRing value={entry.readiness} size="46px" />}
      </a>
      {focusShown && (
        <div className="cr-foot">
          <button
            type="button"
            className={inFocus ? 'cr-focus-btn on' : 'cr-focus-btn'}
            aria-pressed={inFocus}
            onClick={() => onToggle(entry.key)}
          >
            {inFocus ? `In focus, ${entry.focus}` : 'Add to focus'}
          </button>
          {banner !== null && <span className="cr-banner">{banner}</span>}
        </div>
      )}
    </article>
  )
})

/** The grid of characters, one card each, in the order given. It reaches both edges of the page. */
export const RosterGrid = memo(function RosterGrid({
  entries,
  onToggle,
  focusShown = true,
}: {
  entries: readonly RosterEntry[]
  onToggle: (key: string) => void
  /** The focus goes with Your week (hidden.ts): while that is hidden a card is its link alone. */
  focusShown?: boolean
}) {
  if (entries.length === 0) return <div className="gb-panel gb-empty">No characters match this search and these filters.</div>
  return (
    <div className="cr-grid" data-testid="roster-grid">
      {entries.map((entry) => (
        <RosterCard key={entry.key} entry={entry} onToggle={onToggle} focusShown={focusShown} />
      ))}
    </div>
  )
})

/** A pill that is on or off: one filter's value. */
function Pill({ on, onPress, children }: { on: boolean; onPress: () => void; children: ReactNode }) {
  return (
    <button type="button" className="cr-pill" aria-pressed={on} onClick={onPress}>
      {children}
    </button>
  )
}

/** The search box: a name, an element or a weapon type, or several words. Escape clears it. */
function SearchBox({ search, onSearch }: { search: string; onSearch: (next: string) => void }) {
  return (
    <div className="cr-search">
      <input
        type="text"
        value={search}
        placeholder="Search by name, element or weapon"
        aria-label="Search characters"
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => onSearch(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && search !== '') {
            event.preventDefault()
            event.stopPropagation()
            onSearch('')
          }
        }}
      />
      {search !== '' && (
        <button type="button" className="cr-search-x" aria-label="Clear the search" onClick={() => onSearch('')}>
          <Sign name="cross" />
        </button>
      )}
    </div>
  )
}

function Filtering({
  focusShown,
  filters,
  sort,
  reversed,
  search,
  onFilters,
  onSort,
  onReverse,
  onSearch,
}: {
  focusShown: boolean
  filters: Filters
  sort: Sort
  reversed: boolean
  search: string
  onFilters: (next: Filters) => void
  onSort: (next: Sort) => void
  onReverse: () => void
  onSearch: (next: string) => void
}) {
  return (
    <section className="gb-panel cr-filters" aria-label="Filters" data-rise>
      <div className="cr-row">
        <SearchBox search={search} onSearch={onSearch} />
        <span className="cr-lab">Element</span>
        {ELEMENTS.map((element) => (
          <Pill
            key={element}
            on={filters.element === element}
            onPress={() => onFilters({ ...filters, element: filters.element === element ? null : element })}
          >
            <ElementChip element={element} />
          </Pill>
        ))}
        <span className="cr-grow" />
        <span className="cr-lab">Show</span>
        <Segmented
          label="Show"
          options={[
            { value: 'all', label: 'All characters' },
            { value: 'owned', label: 'Owned' },
          ]}
          value={filters.owned ? 'owned' : 'all'}
          onChange={(value) => onFilters({ ...filters, owned: value === 'owned' })}
        />
      </div>
      <div className="cr-row">
        <span className="cr-lab">Weapon</span>
        {WEAPON_TYPES.map((weapon) => (
          <Pill
            key={weapon}
            on={filters.weapon === weapon}
            onPress={() => onFilters({ ...filters, weapon: filters.weapon === weapon ? null : weapon })}
          >
            <Sign name={weaponSign(weapon)} />
            {weapon}
          </Pill>
        ))}
        <span className="cr-lab cr-lab-next">Rarity</span>
        {RARITIES.map((rarity) => (
          <Pill
            key={rarity}
            on={filters.rarity === rarity}
            onPress={() => onFilters({ ...filters, rarity: filters.rarity === rarity ? null : rarity })}
          >
            {rarity}★
          </Pill>
        ))}
        {focusShown && (
          <Pill on={filters.inFocus} onPress={() => onFilters({ ...filters, inFocus: !filters.inFocus })}>
            In focus
          </Pill>
        )}
        <span className="cr-grow" />
        <span className="cr-lab">Sort</span>
        <Segmented label="Sort by" options={SORTS} value={sort} onChange={onSort} onRepeat={onReverse} way={reversed ? 'up' : 'down'} />
      </div>
    </section>
  )
}

/** The roster page (the design's section 6.1): the focus, the filters and every character. */
export function Roster({ live }: { live: Live }) {
  const scale = rosterScale(useCharactersScale())
  const [changed, setChanged] = useState(0)
  const { data, error } = useRoster(live.version + changed, live.status)
  // The window remembers the search, the filters, the sort and the scroll (memory.ts): coming back shows them at once.
  const { view } = useRosterMemory()
  const { filters, sort, reversed, search } = view
  const [refusal, setRefusal] = useState<string | null>(null)
  const page = useRef<HTMLDivElement>(null)
  const grid = useRef<HTMLDivElement>(null)

  // The page comes in once after the window opens, when its model first arrives: the sheets, the focus cards and the grid
  // one after another. A page that comes back shows itself at once.
  const ready = data !== null
  const [still] = useState(entranceDone) // decided as the page opens, so that nothing of the entrance starts (roster.css)
  useLayoutEffect(() => {
    if (page.current !== null && ready && !still && takeEntrance()) {
      rise(page.current.querySelectorAll<HTMLElement>('[data-rise]'), { step: 0.035, start: 0.05 })
    }
  }, [ready, still])

  // Where the page was scrolled to is kept as it is left, and given back as it comes back.
  const scrolled = useRef(false)
  useLayoutEffect(() => {
    if (ready && !scrolled.current) {
      scrolled.current = true
      window.scrollTo(0, rosterMemory().scroll)
    }
  }, [ready])
  useEffect(() => {
    let here = true
    const save = () => {
      if (here) saveRosterScroll(window.scrollY)
    }
    // A page that opens is shorter, and the window then scrolls by itself: what is kept is the place that was left.
    const leave = () => {
      save()
      here = false
    }
    window.addEventListener('scroll', save, { passive: true })
    window.addEventListener('hashchange', leave)
    return () => {
      window.removeEventListener('scroll', save)
      window.removeEventListener('hashchange', leave)
    }
  }, [])

  const shown = data === null ? [] : sorted(visible(data.entries, filters, search), sort, reversed)
  // A card that a filter or the sort moves glides to its place.
  useGlide(grid, 'data-glide', shown.map((entry) => entry.key).join())

  const toggle = async (key: string) => {
    if (data === null) return
    const next = toggleFocus(data.focus, key)
    if ('refused' in next) {
      setRefusal(next.refused)
      return
    }
    setRefusal(null)
    try {
      await api.put('/api/focus', { characters: next.focus })
    } catch (failure) {
      setRefusal(messageOf(failure))
    }
    setChanged((count) => count + 1)
  }
  // The cards are drawn again only when their character changed: the handler they hold stays the same one.
  const latest = useRef(toggle)
  latest.current = toggle
  const onToggle = useCallback((key: string) => void latest.current(key), [])

  return (
    <Frame page="characters" live={live} controls={data !== null && <SyncLine live={live} sync={data.sync} />}>
      {data === null ? (
        <div className="gb-panel gb-empty">{error ?? 'Reading your characters…'}</div>
      ) : (
        <div className={still ? 'gb-page cr-page still' : 'gb-page cr-page'} ref={page} style={scaleStyle(scale)}>
          <section className="gb-panel cr-top" data-rise>
            <div className="cr-head">
              <h2>{ROSTER_HEADING}</h2>
              <span className="cr-count">{countLine(data)}</span>
              {refusal !== null && (
                <span className="cr-refusal" role="status">
                  {refusal}
                </span>
              )}
              <span className="cr-grow" />
              {weekShown(live.status) && <CharactersTabs view="roster" />}
            </div>
            {weekShown(live.status) && <FocusStrip cards={focusCards(data)} onToggle={onToggle} />}
          </section>
          <Filtering
            focusShown={weekShown(live.status)}
            filters={filters}
            sort={sort}
            reversed={reversed}
            search={search}
            onFilters={(next) => {
              setRefusal(null)
              setRosterView({ filters: next })
            }}
            // Another sort starts in its usual order; a second press on the chosen one turns it round.
            onSort={(next) => setRosterView({ sort: next, reversed: false })}
            onReverse={() => setRosterView({ reversed: !reversed })}
            onSearch={(next) => {
              setRefusal(null)
              setRosterView({ search: next })
            }}
          />
          <div ref={grid}>
            <RosterGrid entries={shown} onToggle={onToggle} focusShown={weekShown(live.status)} />
          </div>
        </div>
      )}
    </Frame>
  )
}
