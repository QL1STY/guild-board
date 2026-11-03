import { hashOf } from '../../route.ts'
import type { Element } from '../../types.ts'
import { Avatar } from './Avatar.tsx'

/**
 * The title of a character's pages (freshness design, section 4, option A): where the player is, "Characters › Sandrone",
 * with "Characters" a link back to the roster (the title's own star stands before it). It is drawn inside the page's
 * heading (the Frame's `heading`), so it holds nothing else: the switch of her two views is `PageSwitch`, beside the title.
 * The endgame has the trail alone, and the roster keeps its plain title.
 */
export function Trail({
  here,
  character,
}: {
  here: string
  character: { key: string; icon: string | null; element: Element } | null
}) {
  return (
    <span className="cx-trail">
      <a className="cx-crumb" href={hashOf({ page: 'characters', view: 'roster' })}>
        Characters
      </a>
      <span className="cx-sep" aria-hidden="true">
        ›
      </span>
      {character !== null && <Avatar src={character.icon} element={character.element} size="30px" />}
      <span className="cx-here">{here}</span>
    </span>
  )
}

/**
 * The switch of a character's two views, in the Frame's `beside` slot right after the title: two links, Profile and Planner,
 * the one shown dark and marked as the current page.
 */
export function PageSwitch({ here, characterKey, view }: { here: string; characterKey: string; view: 'profile' | 'plan' }) {
  return (
    <div className="cx-switch" role="group" aria-label={`${here}'s pages`}>
      <a
        href={hashOf({ page: 'characters', view: 'profile', key: characterKey })}
        aria-current={view === 'profile' ? 'page' : undefined}
      >
        Profile
      </a>
      <a
        href={hashOf({ page: 'characters', view: 'plan', key: characterKey })}
        aria-current={view === 'plan' ? 'page' : undefined}
      >
        Planner
      </a>
    </div>
  )
}
