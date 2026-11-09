import { useEffect, useRef, useState } from 'react'
import '../styles/ledger.css'
import '../styles/ledgerpage.css'
import { LEDGER_PATH, ledgerApi, messageOf } from '../api.ts'
import { Frame } from '../frame/Frame.tsx'
import { FreshRing } from '../frame/FreshRing.tsx'
import { pressed, useNewFlash, withFlash } from '../frame/freshview.ts'
import type { Ledger as LedgerModel, LedgerKind } from '../ledgertypes.ts'
import { type Live, useModel, useTick } from '../live.ts'
import { Segmented } from '../ui/Segmented.tsx'
import { Compared, Commissions, Wishes } from './ledger/Insights.tsx'
import { Artifacts, Crystals, Resin } from './ledger/KindViews.tsx'
import { LedgerChart } from './ledger/LedgerChart.tsx'
import { addDays, monthTitle } from './ledger/ledgerdays.ts'
import { SpentCard } from './ledger/SpentCard.tsx'
import { Sources } from './ledger/Sources.tsx'
import { Transactions } from './ledger/Transactions.tsx'
import { KIND_LABELS, ledgerFresh, ledgerRunning } from './ledgerview.ts'

/** The page's tabs, one view each (the Ledger revamp design, sections 3 and 8a): a tab for another kind is one entry here. */
const KINDS: readonly LedgerKind[] = ['primogem', 'crystal', 'resin', 'artifact']
const TABS = KINDS.map((value) => ({ value, label: KIND_LABELS[value] }))

/**
 * What a press of Import does, shared by the button in the top bar and the freshness ring beside the title: the Pulls
 * page's Import, which reads the wishes and then the four logs. The button rests while one runs. A press the core refuses
 * says why in the ring's tip until the next press.
 */
function useImport(running: boolean, onPressed: () => void) {
  const [pressing, setPressing] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const busy = pressing || running
  const press = async () => {
    if (busy) return
    setPressing(true)
    setRefusal(null)
    try {
      await ledgerApi.importFromGame()
    } catch (error) {
      setRefusal(messageOf(error))
    } finally {
      setPressing(false)
      onPressed()
    }
  }
  return { pressing, refusal, busy, press }
}

/** The Import button in the top bar. */
export function ImportButton({ busy, press }: { busy: boolean; press: () => Promise<void> }) {
  return (
    <button
      type="button"
      className="gb-btn"
      aria-disabled={busy}
      title="Import: reads your history with your HoYoLAB login, or, without one, from the link the game writes when you open Feedback."
      onClick={() => void press()}
    >
      {busy ? 'Importing…' : 'Import'}
    </button>
  )
}

/**
 * The freshness ring beside the title (freshness design, section 1): when the game's history was last read, whether it
 * updates itself, and the sentence the top bar used to show as its tip. "+N new" shows for six seconds after a reading of
 * the logs that found new entries (the ledger's own count, not the wishes').
 */
function ImportRing({ live, model, pressing, refusal }: { live: Live; model: LedgerModel; pressing: boolean; refusal: string | null }) {
  useTick(60_000) // the age and the ring's fill move on
  const flash = useNewFlash(model.import.ledger)
  const view = withFlash(ledgerFresh(model.import, model.last_import, live.pullsImport, refusal, live.now()), flash)
  return <FreshRing view={pressing ? pressed(view) : view} testId="ledger-import" />
}

/** The core's today: the last day of the chart's days, the game's day the core works in. */
function todayOf(model: LedgerModel, now: Date): string {
  const last = model.days[model.days.length - 1]
  if (last !== undefined) return last.day
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/** The Primogems view: the chart over the days on the left, the cards on the right (full screen: a feed down the right). */
function Primogems({ model, live }: { model: LedgerModel; live: Live }) {
  const today = todayOf(model, live.now())
  const monthName = monthTitle(today)
  const previousName = monthTitle(addDays(`${today.slice(0, 8)}01`, -1))
  return (
    <div className="ld-layout">
      <LedgerChart days={model.days} today={today} />
      <Transactions key={model.last_import ?? ''} kind="primogem" today={today} />
      <div className="ld-side">
        <div className="ld-col">
          {live.settings === null ? (
            <section className="gb-panel ld-card" data-testid="ledger-spent">
              <h2 className="gb-section-h ld-h">Spent on Genshin</h2>
            </section>
          ) : (
            <SpentCard spent={model.spent} live={live} />
          )}
          <Sources month={model.month} monthName={monthName} />
        </div>
        <div className="ld-col">
          <Compared month={model.month} monthName={monthName} previousName={previousName} />
          <Commissions commissions={model.commissions} />
          <Wishes wishes={model.wishes} />
        </div>
      </div>
    </div>
  )
}

/**
 * The Ledger page (the Ledger revamp design, sections 3 to 5): what the game's own histories say, kept after the game forgets
 * them. The Primogems view is a balance and its chart with the days under it and, beside them, Spent on Genshin, where the
 * primogems came from and three insights; the Crystals, Resin and Artifacts views are the same frame with a bar chart of what
 * came in and went out, since they keep no balance.
 * Before any import it says that it is reading them with the HoYoLAB login, or, without one, how to get the game's history
 * link: open Feedback in the game, then press Import. The model is read again on every event of an import, and every 1.5 s
 * while one runs, so the reading's progress shows.
 */
export function Ledger({ live }: { live: Live }) {
  const [bump, setBump] = useState(0)
  const firstEvent = useRef(live.pullsImport)
  useEffect(() => {
    if (live.pullsImport !== firstEvent.current) setBump((count) => count + 1)
  }, [live.pullsImport])
  const { data, error } = useModel<LedgerModel>(LEDGER_PATH, live.version + bump)
  const running = data === null ? live.pullsImport?.state === 'running' : ledgerRunning(data.import, live.pullsImport)
  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => setBump((count) => count + 1), 1500)
    return () => window.clearInterval(timer)
  }, [running])
  const press = useImport(running, () => setBump((count) => count + 1))
  const [kind, setKind] = useState<LedgerKind>('primogem')
  return (
    <Frame
      page="ledger"
      live={live}
      beside={
        data !== null && (
          <>
            <ImportRing live={live} model={data} pressing={press.pressing} refusal={press.refusal} />
            {!data.empty && <Segmented label="Ledger view" options={TABS} value={kind} onChange={setKind} />}
          </>
        )
      }
      controls={<ImportButton busy={press.busy} press={press.press} />}
    >
      {data === null ? (
        <div className="gb-panel gb-empty">{error ?? 'Reading the ledger…'}</div>
      ) : data.empty && (data.import.login === 'on' || data.import.login === 'minting') ? (
        <div className="gb-panel gb-empty ld-start" data-testid="ledger-empty">
          <p>
            This page shows the histories the game keeps: primogems, Genesis Crystals, resin and artifacts. Guild Board is
            reading them now with your HoYoLAB login. The first reading can take about ten minutes.
          </p>
          <p className="gb-note">
            It reads them with a read-only key HoYoverse gives your login, the same way it reads your wishes, and only
            reads. It keeps every entry after the game forgets it.
          </p>
        </div>
      ) : data.empty ? (
        <div className="gb-panel gb-empty ld-start" data-testid="ledger-empty">
          <p>
            This page shows the histories the game keeps: primogems, Genesis Crystals, resin and artifacts. To read them,
            open Feedback from the Paimon menu in the game once, then press Import.
          </p>
          <p className="gb-note">
            Guild Board reads the history link the game writes when Feedback opens, the same way it reads your wishes,
            and only reads. It keeps every entry after the game forgets it.
          </p>
        </div>
      ) : (
        <div className="ld-wrap">
          {kind === 'primogem' ? (
            <Primogems model={data} live={live} />
          ) : kind === 'crystal' ? (
            <Crystals model={data} live={live} today={todayOf(data, live.now())} txKey={data.last_import ?? ''} />
          ) : kind === 'resin' ? (
            <Resin model={data} today={todayOf(data, live.now())} txKey={data.last_import ?? ''} />
          ) : (
            <Artifacts model={data} today={todayOf(data, live.now())} txKey={data.last_import ?? ''} />
          )}
        </div>
      )}
    </Frame>
  )
}
