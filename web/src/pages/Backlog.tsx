import { useRef, useState } from 'react'
import '../styles/backlog.css'
import { change, num } from '../format.ts'
import { Frame } from '../frame/Frame.tsx'
import { type Live, useModel } from '../live.ts'
import type { Backlog as BacklogModel, BacklogRegion } from '../types.ts'
import { Glint } from '../ui/Glint.tsx'
import { CountUp, useGlide } from '../ui/motion.tsx'
import { Segmented } from '../ui/Segmented.tsx'
import { Sign } from '../ui/Sign.tsx'
import { counterFigure, counterSign } from './backlogview.ts'
import { BacklogSide } from './BacklogSide.tsx'
import { RegionCard } from './RegionCard.tsx'

const SORTS = [
  { value: 'least', label: 'Least explored' },
  { value: 'closest', label: 'Closest to done' },
  { value: 'game', label: 'Game order' },
] as const

type Sort = (typeof SORTS)[number]['value']

/**
 * The counters, each with its sign. The number counts up when the page opens; screen readers have the number it ends on.
 * A number that a later read changes glints once (look pass spec 14.2), as it counts to its new value.
 */
function Counters({ counters }: { counters: BacklogModel['counters'] }) {
  return (
    <div className="gb-counters">
      {counters.map((counter) => {
        const sign = counterSign(counter.id)
        const figure = counterFigure(counter)
        return (
          <div key={counter.id} className="gb-panel gb-counter" data-testid={`counter-${counter.id}`}>
            {sign !== null && (
              <span className="bk-sign">
                <Sign name={sign} />
              </span>
            )}
            <div className="k">{counter.label}</div>
            <div className="vd">
              <Glint className="v" value={'text' in figure ? figure.text : figure.value}>
                {'text' in figure ? (
                  figure.text
                ) : (
                  <CountUp value={figure.value} format={(shown) => `${num(shown)}${figure.unit}`} />
                )}
              </Glint>
              {counter.delta !== null && counter.delta !== 0 && (
                <span className={counter.delta > 0 ? 'd' : 'd flat'}>
                  {change(counter.delta)}
                  {counter.delta_note !== null && ` ${counter.delta_note}`}
                </span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** True before the first sync: the core has nothing about the account yet. */
function isEmpty(data: BacklogModel): boolean {
  return data.counters.length === 0 && data.regions.length === 0 && data.complete.length === 0
}

export function Backlog({ live }: { live: Live }) {
  const [sort, setSort] = useState<Sort>('least')
  const { data, error } = useModel<BacklogModel>(`/api/backlog?sort=${sort}`, live.version)
  // The cards glide to their new places when their order changes, by a new sort or by new data. The sort is not the
  // version: the order changes when the answer for the sort arrives, a render after the sort does. A card that is
  // opened or closed moves the ones after it, which counts as a change, so that the places a glide starts from are
  // where the cards were seen. The complete regions' cards come after the unfinished ones, in game order, whatever the
  // sort, so the unfinished ones' order is the one that changes.
  const regions = useRef<HTMLDivElement>(null)
  const [opened, setOpened] = useState(0)
  useGlide(regions, 'data-region', `${data === null ? '' : data.regions.map((region) => region.id).join(',')}|${opened}`)
  const card = (region: BacklogRegion) => (
    <RegionCard key={region.id} region={region} onToggle={() => setOpened((count) => count + 1)} />
  )
  // The page and what it says before it has data read a third larger than the other pages (backlog.css, .bk-page).
  return (
    <Frame page="backlog" live={live}>
      {data === null ? (
        <div className="gb-panel gb-empty bk-larger">{error ?? 'Reading the backlog…'}</div>
      ) : isEmpty(data) ? (
        <div className="gb-panel gb-empty bk-larger">Nothing to show yet. This page fills in after the first sync.</div>
      ) : (
        <div className="gb-page bk-page">
          <Counters counters={data.counters} />
          <div className="gb-body">
            <div>
              <div className="gb-toolbar">
                <h2 className="gb-section-h">Unfinished regions</h2>
                <Segmented label="Order of the regions" options={SORTS} value={sort} onChange={setSort} />
              </div>
              {data.regions.length === 0 &&
                (data.complete.length > 0 ? (
                  <div className="gb-panel gb-empty">Every region is fully explored.</div>
                ) : (
                  // The notes can arrive without the overview, for example when a sync is only partly successful.
                  <div className="gb-panel gb-empty">Exploration has not been read yet.</div>
                ))}
              {/*
               * Every region is a card, in one grid: the unfinished ones in the sort's order, then under a heading of their
               * own, a row across the grid, the complete ones. The heading glides with the cards, by its own key.
               */}
              {data.regions.length + data.complete.length > 0 && (
                <div className="gb-regions" ref={regions}>
                  {data.regions.map(card)}
                  {data.complete.length > 0 && (
                    <h2 key="complete" className="bk-h" data-region="complete">
                      Complete · {data.complete.length}
                    </h2>
                  )}
                  {data.complete.map(card)}
                </div>
              )}
            </div>
            <BacklogSide data={data} explored={data.regions.length > 0 || data.complete.length > 0} />
          </div>
        </div>
      )}
    </Frame>
  )
}
