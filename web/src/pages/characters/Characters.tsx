import './elements.css'
import './characters.css'
import { Frame } from '../../frame/Frame.tsx'
import type { Live } from '../../live.ts'
import type { Route } from '../../route.ts'
import { Endgame } from './Endgame.tsx'
import { Planner } from './Planner.tsx'
import { Profile } from './Profile.tsx'
import { Roster } from './Roster.tsx'

/**
 * The Characters page: the view its address names (route.ts). Each view is its own page; those not built yet are a
 * plain line.
 */
export function Characters({ live, route }: { live: Live; route: Extract<Route, { page: 'characters' }> }) {
  if (route.view === 'roster') return <Roster live={live} />
  if (route.view === 'profile') return <Profile live={live} characterKey={route.key} />
  if (route.view === 'endgame') return <Endgame live={live} />
  if (route.view === 'plan') return <Planner live={live} characterKey={route.key} key={route.key} />
  return (
    <Frame page="characters" live={live}>
      <div className="gb-panel gb-empty">{route.view}</div>
    </Frame>
  )
}
