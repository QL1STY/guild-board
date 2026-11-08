import type { Live } from '../live.ts'
import type { Route } from '../route.ts'
import { Months } from './stats/Months.tsx'
import { Overview } from './stats/Overview.tsx'
import { Year } from './stats/Year.tsx'

/** The Stats page: its tabs, Overview, Months and Year, picked by the address. */
export function Stats({ live, route }: { live: Live; route: Extract<Route, { page: 'stats' }> }) {
  if (route.view === 'months') return <Months live={live} ym={route.ym} />
  if (route.view === 'year') return <Year live={live} year={route.year} />
  return <Overview live={live} />
}
