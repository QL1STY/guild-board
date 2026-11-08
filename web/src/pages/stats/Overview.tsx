import { useState } from 'react'
import '../../styles/stats.css'
import { ChestsOpened } from '../../charts/ChestsOpened.tsx'
import { EndgameCard, EndgameWaiting } from '../../charts/EndgameCard.tsx'
import { ExplorationGained } from '../../charts/ExplorationGained.tsx'
import { PlaytimeCalendar } from '../../charts/PlaytimeCalendar.tsx'
import { PrimogemsEarned, PrimogemsPerDay } from '../../charts/PrimogemsEarned.tsx'
import { WhenYouPlay } from '../../charts/WhenYouPlay.tsx'
import { CalendarChip } from '../../frame/CalendarChip.tsx'
import { Frame } from '../../frame/Frame.tsx'
import { type Live, useModel } from '../../live.ts'
import { hashOf } from '../../route.ts'
import type { EndgameCardModel, Stats as StatsModel } from '../../types.ts'
import { Segmented } from '../../ui/Segmented.tsx'
import { RANGES, type Range, rangeChip } from '../statsview.ts'
import { Tiles } from '../Tiles.tsx'
import { StatsTabs } from './StatsTabs.tsx'

/** The Overview tab: the Stats page as it was before the tabs. */
export function Overview({ live }: { live: Live }) {
  const [range, setRange] = useState<Range>('30')
  const { data, error } = useModel<StatsModel>(`/api/stats?range=${range}`, live.version)
  const endgame = useModel<EndgameCardModel>('/api/stats/endgame', live.version)
  const chip = data === null ? null : rangeChip(data.period.first, data.period.last, data.coverage)
  const controls = <Segmented label="Period" options={RANGES} value={range} onChange={setRange} />
  // Spec section 11: playtime is only measured while Guild Board runs, and the page says so until it starts with Windows.
  const measured = live.settings !== null && !live.settings.start_with_windows
  return (
    <Frame
      page="stats"
      live={live}
      beside={
        <>
          <StatsTabs view="overview" />
          {chip !== null && <CalendarChip label={chip.label} tip={chip.tip} testId="period" />}
        </>
      }
      controls={controls}
    >
      {data === null ? (
        <div className="gb-panel gb-empty">{error ?? 'Reading the statistics…'}</div>
      ) : data.coverage.tracking_since === null ? (
        <div className="gb-panel gb-empty">Nothing to show yet. Statistics build up from the first sync.</div>
      ) : (
        <div className="gb-page">
          <Tiles stats={data} />
          {measured && (
            <p className="gb-note st-note">
              Playtime is measured only while Guild Board is running. Turn on Start with Windows in{' '}
              <a href={hashOf('settings')}>Settings</a> to catch every session.
            </p>
          )}
          {/* Spec 12.4, two cards a row. The second row has its narrower card first, where When you play fits. */}
          <div className="cg">
            <ExplorationGained stats={data} />
            <PlaytimeCalendar stats={data} />
          </div>
          <div className="cg flip">
            <WhenYouPlay stats={data} />
            <ChestsOpened stats={data} />
          </div>
          <div className="cg">
            <PrimogemsPerDay stats={data} />
            <PrimogemsEarned stats={data} />
          </div>
          {endgame.data === null ? <EndgameWaiting error={endgame.error} /> : <EndgameCard model={endgame.data} />}
        </div>
      )}
    </Frame>
  )
}
