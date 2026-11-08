import { hashOf } from '../../route.ts'

/** The three tabs of the Stats page, under its title: Overview, Months and Year (the Months and Wrapped design, section 4). */
export function StatsTabs({ view }: { view: 'overview' | 'months' | 'year' }) {
  const tabs = [
    { view: 'overview', label: 'Overview', to: hashOf({ page: 'stats', view: 'overview' }) },
    { view: 'months', label: 'Months', to: hashOf({ page: 'stats', view: 'months', ym: null }) },
    { view: 'year', label: 'Year', to: hashOf({ page: 'stats', view: 'year', year: null }) },
  ] as const
  return (
    <nav className="st-tabs" aria-label="Stats pages">
      {tabs.map((tab) => (
        <a
          key={tab.view}
          className={tab.view === view ? 'on' : undefined}
          href={tab.to}
          aria-current={tab.view === view ? 'page' : undefined}
        >
          {tab.label}
        </a>
      ))}
    </nav>
  )
}
