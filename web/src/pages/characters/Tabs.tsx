import { hashOf } from '../../route.ts'

/** The two tabs of the Characters page: the roster and the endgame readiness (the design's section 3). */
export function CharactersTabs({ view }: { view: 'roster' | 'endgame' }) {
  const tabs = [
    { view: 'roster', label: 'Roster' },
    { view: 'endgame', label: 'Endgame' },
  ] as const
  return (
    <nav className="cr-tabs" aria-label="Characters pages">
      {tabs.map((tab) => (
        <a
          key={tab.view}
          className={tab.view === view ? 'on' : undefined}
          href={hashOf({ page: 'characters', view: tab.view })}
          aria-current={tab.view === view ? 'page' : undefined}
        >
          {tab.label}
        </a>
      ))}
    </nav>
  )
}
