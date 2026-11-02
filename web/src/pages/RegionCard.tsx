import { useState } from 'react'
import type { CSSProperties } from 'react'
import { pct, plural } from '../format.ts'
import type { BacklogRegion } from '../types.ts'
import { emblemColour } from '../ui/emblem.ts'
import { Picture } from '../ui/Picture.tsx'

const AREAS_SHOWN = 2

/** A complete region's areas, in one line: "4 areas, all 100%", or "1 area, 100%". */
function areasLine(count: number): string {
  return count === 1 ? '1 area, 100%' : `${plural(count, 'area')}, all 100%`
}

/**
 * One region: its emblem inside a ring that fills to the share explored, and that share beside its name; under it the
 * offering. An unfinished region's card shows its two least-explored areas as bars, and the rest on request; `onToggle`
 * tells the page that the card opened or closed, which moves the cards after it. A complete region's card is at rest,
 * its ring full from the start, and sums its areas up in one line under the offering, where it has any. `data-region` is
 * the card's id, which the page glides by.
 */
export function RegionCard({ region, onToggle }: { region: BacklogRegion; onToggle: () => void }) {
  const [open, setOpen] = useState(false)
  // The ring fills and the bars grow once, as the card first appears. That is a class that ends with the animations and
  // not a rule of the card's own: a card that the sort moves is taken out of the page and put back by the browser, and
  // a style animation would play again then. It ends with the ring's own fill (backlog.css, ring-fill), which the bars
  // end with, and not with whatever else in the card ends sooner. A complete region's card has nothing to fill.
  const [entering, setEntering] = useState(!region.complete)
  const rest = region.areas.slice(AREAS_SHOWN)
  const areas = open ? region.areas : region.areas.slice(0, AREAS_SHOWN)
  const sub = [region.parent, region.note].filter((part) => part !== null && part !== '').join(' · ')
  const more = `+ ${plural(rest.length, 'more area')}${rest.every((area) => area.pct >= 100) ? ', all 100%' : ''}`
  return (
    <article
      className={`gb-panel gb-region${region.complete ? ' done' : ''}${entering ? ' in' : ''}`}
      data-testid={region.complete ? 'region-complete' : 'region'}
      data-region={region.id}
      onAnimationEnd={(event) => {
        if (event.animationName === 'ring-fill') setEntering(false)
      }}
    >
      <div className="gb-rh">
        <div
          className="gb-ring tip-start"
          style={{ '--p': region.pct } as CSSProperties}
          data-tip={`${pct(region.pct, 1)} explored`}
        >
          {/* The region's emblem; the compass shows where there is none, or where it does not load (the demo's). */}
          <Picture
            src={region.icon}
            sign="compass"
            className="gb-emb"
            style={{ '--emblem': emblemColour(region.name, region.parent) } as CSSProperties}
          />
        </div>
        <div className="gb-rt">
          <div className="gb-rn">
            {/* Whole, on two lines where it needs them (backlog.css), so it needs no title; the line under it can be cut. */}
            <h3>{region.name}</h3>
            <b className="gb-rp">{pct(region.pct, 1)}</b>
          </div>
          {sub !== '' && (
            <div className="sub" title={sub}>
              {sub}
            </div>
          )}
          {region.complete && region.areas.length > 0 && (
            <div className="gb-areas">{areasLine(region.areas.length)}</div>
          )}
        </div>
      </div>
      {!region.complete && (
        <>
          {areas.map((area, index) => (
            <div key={index} className="gb-bar">
              <span className="n" title={area.name}>
                {area.name}
              </span>
              <span className="pct">{pct(area.pct, 1)}</span>
              <span className="t">
                <i className={area.pct >= 100 ? 'ok' : undefined} style={{ width: `${Math.min(100, area.pct)}%` }} />
              </span>
            </div>
          ))}
          {rest.length > 0 && (
            <button
              type="button"
              className="gb-link more"
              aria-expanded={open}
              onClick={() => {
                setOpen(!open)
                onToggle()
              }}
            >
              {open ? 'Show fewer areas' : more}
            </button>
          )}
        </>
      )}
    </article>
  )
}
