import type { ReactNode } from 'react'
import type { Ledger } from '../../ledgertypes.ts'
import type { Live } from '../../live.ts'
import { AgainstView, BecameView, CompareView, LuckView, RankView, RowsView, WelkinView, WhereView } from './KindCards.tsx'
import { type ChartKey, KindChart } from './KindChart.tsx'
import { SpentCard } from './SpentCard.tsx'
import { LedgerChart } from './LedgerChart.tsx'
import { Transactions } from './Transactions.tsx'
import { monthTitle } from './ledgerdays.ts'
import {
  CRYSTAL_WORDS, MARK, REGROWN_A_DAY, artifactBars, artifactBecame, artifactCost, artifactHead, artifactLuck, artifactTop, artifactWhere,
  crystalBalanceDays, crystalBars, crystalCompare, crystalHead, crystalWhere, crystalsHeld, resinAgainst, resinBars, resinHead, resinBosses, resinMost, resinWhere,
  welkinCard,
} from './ledgerkinds.ts'

/**
 * The layout every kind shares with the Primogems view (the Ledger revamp design, section 3): the chart, the transactions
 * under it or down the right, and two columns of cards that end on one line. A column of two cards is `two`.
 */
function Layout({ chart, tx, first, second, twoSecond }: { chart: ReactNode; tx: ReactNode; first: ReactNode; second: ReactNode; twoSecond?: boolean }) {
  return (
    <div className="ld-layout">
      {chart}
      {tx}
      <div className="ld-side">
        <div className="ld-col">{first}</div>
        <div className={twoSecond === true ? 'ld-col two' : 'ld-col'}>{second}</div>
      </div>
    </div>
  )
}

type ViewProps = { model: Ledger; today: string; txKey: string }

const CRYSTAL_KEYS: ChartKey[] = [
  { color: MARK.gold, text: 'Bought' },
  { color: MARK.blue, text: 'Exchanged for primogems' },
  { color: MARK.taupe, text: 'Shop' },
]
const RESIN_KEYS: ChartKey[] = [{ color: MARK.gold, text: 'Resin spent in a day' }, { ref: true, text: '180, what a full refill regrows in a day' }]
const ARTIFACT_KEYS: ChartKey[] = [{ color: MARK.gold, text: 'From domains' }, { color: MARK.taupe, text: 'Elsewhere' }]

/** The Crystals view: the crystals bought and where they went; Spent on Genshin takes its place at the top of the cards. */
export function Crystals({ model, today, txKey, live }: ViewProps & { live: Live }) {
  const monthName = monthTitle(today)
  const spent =
    live.settings === null ? (
      <section className="gb-panel ld-card" data-testid="ledger-spent">
        <h2 className="gb-section-h ld-h">Spent on Genshin</h2>
      </section>
    ) : (
      <SpentCard spent={model.spent} live={live} />
    )
  return (
    <Layout
      chart={
        crystalsHeld(model.crystal_days) ? (
          // A balance answers through the one interface (the design, 8a): the view is "held", as the primogems'.
          <LedgerChart days={crystalBalanceDays(model.crystal_days)} today={today} words={CRYSTAL_WORDS} />
        ) : (
          <KindChart
            days={model.crystal_days}
            today={today}
            bars={crystalBars}
            head={(shown, at, range) => crystalHead(shown, at, range, monthName)}
            keys={CRYSTAL_KEYS}
            label="Genesis Crystals bought and spent each day"
            minHi={300}
          />
        )
      }
      tx={<Transactions key={`crystal${txKey}`} kind="crystal" today={today} />}
      first={
        <>
          {spent}
          <WhereView card={crystalWhere(model.crystal_days, today)} id="where" />
        </>
      }
      second={
        <>
          <CompareView card={crystalCompare(model.crystal_days, today, model.crystal_month.packs)} id="compare" />
          <WelkinView card={welkinCard(model.crystal_month.welkin, today)} />
        </>
      }
      twoSecond
    />
  )
}

/** The Resin view: the resin spent each day in the chart's gold, against the 180 a day that regrows. */
export function Resin({ model, today, txKey }: ViewProps) {
  const monthName = monthTitle(today)
  return (
    <Layout
      chart={
        <KindChart
          days={model.resin_days}
          today={today}
          bars={resinBars}
          head={(shown, at, range) => resinHead(shown, at, range, monthName)}
          keys={RESIN_KEYS}
          label="Resin spent each day"
          minHi={200}
          ref={{ value: REGROWN_A_DAY, label: String(REGROWN_A_DAY) }}
        />
      }
      tx={<Transactions key={`resin${txKey}`} kind="resin" today={today} />}
      first={
        <>
          <WhereView card={resinWhere(model.resin_days, today)} id="where" />
          <RankView card={resinMost(model.resin_month)} id="most" />
        </>
      }
      second={
        <>
          <AgainstView card={resinAgainst(model.resin_days, today)} />
          <RowsView title="Bosses" card={resinBosses(model.resin_days, model.resin_month.weekly, today)} id="bosses" />
        </>
      }
      twoSecond
    />
  )
}

/** The Artifacts view: the five-stars each day, from domains and from elsewhere, what became of them, and the domain's luck. */
export function Artifacts({ model, today, txKey }: ViewProps) {
  const monthName = monthTitle(today)
  const month = model.artifact_month
  return (
    <Layout
      chart={
        <KindChart
          days={model.artifact_days}
          today={today}
          bars={artifactBars}
          head={(shown, at, range) => artifactHead(shown, at, range, monthName, month)}
          keys={ARTIFACT_KEYS}
          label="Five-star artifacts each day"
          minHi={4}
        />
      }
      tx={<Transactions key={`artifact${txKey}`} kind="artifact" today={today} />}
      first={
        <>
          <WhereView card={artifactWhere(model.artifact_days, month, today)} id="where" />
          <BecameView card={artifactBecame(model.artifact_days, today)} />
        </>
      }
      second={
        <>
          <RankView card={artifactTop(month)} id="top" />
          <LuckView card={artifactLuck(model.artifact_days, month, today)} />
          <RowsView title="Resin for each five-star" card={artifactCost(month, model.resin_days, today)} id="cost" />
        </>
      }
    />
  )
}
