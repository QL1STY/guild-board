import type { ReactNode } from 'react'
import { left, num, plural } from '../format.ts'
import type { Backlog } from '../types.ts'
import { Bar, Seal } from '../ui/marks.tsx'
import { Sign, type SignName } from '../ui/Sign.tsx'
import { exploredShare, statusTone } from './backlogview.ts'

/** A heading of the side column: in sentence case, with its sign. */
function Heading({ id, sign, children }: { id: string; sign: SignName; children: ReactNode }) {
  return (
    <h2 className="bk-h" id={id}>
      <Sign name={sign} />
      {children}
    </h2>
  )
}

function Closest({ closest, explored }: { closest: Backlog['closest']; explored: boolean }) {
  return (
    <section className="gb-panel gb-side" aria-labelledby="side-closest">
      <Heading id="side-closest" sign="compass">
        Closest to done
      </Heading>
      {closest.length === 0 ? (
        <p className="gb-note">{explored ? 'Nothing is left to explore.' : 'Not read yet.'}</p>
      ) : (
        <ul className="gb-list">
          {closest.map((entry) => (
            <li key={entry.label} className="gb-next near">
              <span>{entry.label}</span>
              {/* The bar is the share explored; what is left is the words beside it. */}
              <div className="gb-cl">
                <Bar value={exploredShare(entry.remaining)} max={100} />
                <b>{left(entry.remaining)}</b>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Oculi({ oculi }: { oculi: Backlog['oculi'] }) {
  const listed = oculi.missing.length + oculi.unknown.length
  return (
    <section className="gb-panel gb-side" aria-labelledby="side-oculi">
      <Heading id="side-oculi" sign="oculus">
        Oculi still missing
      </Heading>
      {oculi.missing.map((type) => (
        <div key={type.type} className="gb-meter">
          <span>{type.label}</span>
          <b>
            {num(type.have)} of {num(type.total)}
          </b>
          <span className="t">
            <i style={{ width: `${Math.min(100, (type.have / type.total) * 100)}%` }} />
          </span>
        </div>
      ))}
      {oculi.unknown.map((type) => (
        <div key={type.type} className="gb-meter">
          <span>{type.label}</span>
          <b>{num(type.have)} found</b>
        </div>
      ))}
      {oculi.unknown.length > 0 && (
        <p className="gb-note">
          Guild Board has no total for {oculi.unknown.length === 1 ? 'this type' : 'these types'} yet, so only the count
          is shown.
        </p>
      )}
      {oculi.complete_count > 0 && (
        <p className="gb-note">
          {listed > 0
            ? `${plural(oculi.complete_count, 'other type')} complete`
            : `All ${plural(oculi.complete_count, 'type')} complete`}
        </p>
      )}
      {listed === 0 && oculi.complete_count === 0 && <p className="gb-note">No oculi have been counted yet.</p>}
    </section>
  )
}

function Archon({ archon }: { archon: Backlog['archon'] }) {
  const more = archon.open - archon.chapters.length
  return (
    <section className="gb-panel gb-side" aria-labelledby="side-archon">
      <Heading id="side-archon" sign="book">
        Archon Quests
      </Heading>
      {!archon.known ? (
        <p className="gb-note">Not read yet.</p>
      ) : archon.chapters.length === 0 ? (
        <p className="gb-note">All chapters finished</p>
      ) : (
        <ul className="gb-list">
          {archon.chapters.map((chapter, index) => (
            <li key={index} className="gb-next">
              <span>
                {chapter.title}
                {chapter.name !== '' && <small>{chapter.name}</small>}
              </span>
              {/* In progress is a gold seal, not started an outlined one (backlog.css). */}
              <span className={`bk-seal ${statusTone(chapter.status)}`}>
                <Seal>{chapter.status}</Seal>
              </span>
            </li>
          ))}
        </ul>
      )}
      {more > 0 && <p className="gb-note">+ {plural(more, 'more chapter')}</p>}
    </section>
  )
}

/**
 * The right-hand column of the Backlog: what is nearly done, and what is still missing. `explored` is
 * false while exploration has not been read, so that an empty list is not taken for a finished map.
 */
export function BacklogSide({ data, explored }: { data: Backlog; explored: boolean }) {
  return (
    <aside className="gb-sidecol">
      <Closest closest={data.closest} explored={explored} />
      <Oculi oculi={data.oculi} />
      <Archon archon={data.archon} />
    </aside>
  )
}
