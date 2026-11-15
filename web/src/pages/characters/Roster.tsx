import { memo, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import './roster.css'
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
import { endgameShown } from './hidden.ts'
import { entranceDone, rosterMemory, saveRosterScroll, setRosterView, takeEntrance, useRoster, useRosterMemory } from './memory.ts'
import { rosterScale, scaleStyle, useCharactersScale } from './scale.ts'
import { ReadinessRing } from './ReadinessRing.tsx'
import {
  bannerLine, countLine, type Filters, levelLine, RARITIES, type Sort, SORTS, sorted, visible,
} from './rosterview.ts'
import { SyncLine } from './SyncLine.tsx'
import { CharactersTabs } from './Tabs.tsx'
import { ROSTER_HEADING } from './words.ts'

/** One character's card: the whole card is a link to her profile. */
const RosterCard = memo(function RosterCard({ entry }: { entry: RosterEntry }) {
  const banner = entry.owned || entry.early ? null : bannerLine(entry.banner)
  return (
    <article
      className={`cr-card ${elementClass(entry.element)}${entry.owned ? '' : ' not-owned'} whole`}
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
          {banner !== null && <span className="cr-banner">{banner}</span>}
        </span>
        {entry.owned && <ReadinessRing value={entry.readiness} size="46px" />}
      </a>
    </article>
  )
})

/** The grid of characters, one card each, in the order given. It reaches both edges of the page. */
export const RosterGrid = memo(function RosterGrid({ entries }: { entries: readonly RosterEntry[] }) {
  if (entries.length === 0) return <div className="gb-panel gb-empty">No characters match this search and these filters.</div>
  return (
    <div className="cr-grid" data-testid="roster-grid">
      {entries.map((entry) => (
        <RosterCard key={entry.key} entry={entry} />
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
  filters,
  sort,
  reversed,
  search,
  onFilters,
  onSort,
  onReverse,
  onSearch,
}: {
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
        <span className="cr-grow" />
        <span className="cr-lab">Sort</span>
        <Segmented label="Sort by" options={SORTS} value={sort} onChange={onSort} onRepeat={onReverse} way={reversed ? 'up' : 'down'} />
      </div>
    </section>
  )
}

/** The roster page (the design's section 6.1): the filters and every character. */
export function Roster({ live }: { live: Live }) {
  const scale = rosterScale(useCharactersScale())
  const { data, error } = useRoster(live.version, live.status)
  // The window remembers the search, the filters, the sort and the scroll (memory.ts): coming back shows them at once.
  const { view } = useRosterMemory()
  const { filters, sort, reversed, search } = view
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
              <span className="cr-grow" />
              {endgameShown(live.status) && <CharactersTabs view="roster" />}
            </div>
          </section>
          <Filtering
            filters={filters}
            sort={sort}
            reversed={reversed}
            search={search}
            onFilters={(next) => setRosterView({ filters: next })}
            // Another sort starts in its usual order; a second press on the chosen one turns it round.
            onSort={(next) => setRosterView({ sort: next, reversed: false })}
            onReverse={() => setRosterView({ reversed: !reversed })}
            onSearch={(next) => setRosterView({ search: next })}
          />
          <div ref={grid}>
            <RosterGrid entries={shown} />
          </div>
        </div>
      )}
    </Frame>
  )
}
