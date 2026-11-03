import { useEffect, useId, useState } from 'react'
import '../styles/pulls.css'
import { api, messageOf } from '../api.ts'
import { Frame } from '../frame/Frame.tsx'
import { FreshRing } from '../frame/FreshRing.tsx'
import { pressed, useNewFlash, withFlash } from '../frame/freshview.ts'
import { type Live, useModel, useTick } from '../live.ts'
import type { Banner, Pulls as PullsModel } from '../types.ts'
import { Picture } from '../ui/Picture.tsx'
import { PityCards } from './PullsCards.tsx'
import { PullsHistory } from './PullsHistory.tsx'
import { Planner } from './PullsPlanner.tsx'
import { PullsSavings } from './PullsSavings.tsx'
import { bannerLine, bannersShown, emptyLine, pullsFresh, pullsRunning, sharesPity, skyTitle, uidLine } from './pullsview.ts'

/**
 * What a press of Import does, shared by the button in the top bar and the freshness ring beside the title. A press
 * starts an import in the core; the ring follows its progress from the event stream, or says what the core knows of the
 * last one. The button rests while one runs (aria-disabled, which keeps the focus). A press the core refuses says why, in
 * the ring's tip, until the next press, or until the stream tells of an import, as one started from another window does.
 */
function useImport(live: Live, model: PullsModel | null) {
  const [pressing, setPressing] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  useEffect(() => setRefusal(null), [live.pullsImport])
  const running = pressing || (model === null ? live.pullsImport?.state === 'running' : pullsRunning(model.import, live.pullsImport))
  const press = async () => {
    if (running) return
    setPressing(true)
    setRefusal(null)
    try {
      await api.post('/api/pulls/import')
    } catch (error) {
      setRefusal(messageOf(error))
    } finally {
      setPressing(false)
    }
  }
  return { pressing, refusal, running, press }
}

/** The Import button in the top bar. */
function ImportButton({ running, press }: { running: boolean; press: () => Promise<void> }) {
  return (
    <button
      type="button"
      className="gb-btn"
      aria-disabled={running}
      title="Import: reads your history with your HoYoLAB login, or, without one, from the link the game writes when you open Wish → History."
      onClick={() => void press()}
    >
      {running ? 'Importing…' : 'Import'}
    </button>
  )
}

/**
 * The freshness ring beside the title (freshness design, section 1): when the history was last read, whether it updates
 * itself, and the sentence the top bar used to show as its tip. "+N new" shows for six seconds after an import that found
 * wishes.
 */
function ImportRing({ live, model, pressing, refusal }: { live: Live; model: PullsModel; pressing: boolean; refusal: string | null }) {
  useTick(60_000) // the age and the ring's fill move on
  const flash = useNewFlash(live.pullsImport)
  const view = withFlash(pullsFresh(model.import, live.pullsImport, refusal, live.now()), flash)
  return <FreshRing view={pressing ? pressed(view) : view} testId="pulls-import" />
}

/**
 * The night strip (the accepted mockup): the banners running now and those to come, by the core's time, each with its
 * official art (its sign where there is none, as in the demo) and its line. Its sky is still: nothing in it moves
 * (spec 3).
 */
function NightSky({ banners, now }: { banners: readonly Banner[]; now: Date }) {
  const titleId = useId()
  const shown = bannersShown(banners, now)
  return (
    <section className="pl-sky on-dark" data-testid="pulls-sky" aria-labelledby={titleId}>
      <h2 id={titleId} className="pl-sky-title">
        {skyTitle(shown, now)}
      </h2>
      {shown.length === 0 ? (
        <p className="pl-sky-empty">No banners are announced right now.</p>
      ) : (
        <ul className="pl-banners">
          {shown.map((banner) => (
            <li key={banner.ann_id} className="pl-banner" data-testid="pulls-banner">
              <Picture src={banner.art} sign="banner" className="pl-art" />
              <p className="pl-over">
                <b>{banner.name}</b>
                <span>{bannerLine(banner, sharesPity(banner, shown, now), now)}</span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * The Pulls page (the Pulls design; the accepted mockup pulls-chosen.html): the night strip with the banners, the four
 * pity cards, the Savings ledger beside the planner, which take one height (the second pass), then the history, which
 * opens with its luck tiles and the graph of the wishes each month. Before any import it says how to start one. A picked
 * forecast day reads the model to that day (`by`).
 */
export function Pulls({ live }: { live: Live }) {
  useTick(60_000) // the strip's time left moves on once a minute
  const [by, setBy] = useState<string | null>(null)
  const { data, error } = useModel<PullsModel>(by === null ? '/api/pulls' : `/api/pulls?by=${by}`, live.version)
  const press = useImport(live, data)
  const now = live.now()
  const other = data === null ? null : uidLine(data.uid, data.account_uid)
  return (
    <Frame
      page="pulls"
      live={live}
      beside={data !== null && <ImportRing live={live} model={data} pressing={press.pressing} refusal={press.refusal} />}
      controls={<ImportButton running={press.running} press={press.press} />}
    >
      {data === null ? (
        <div className="gb-panel gb-empty">{error ?? 'Reading the pulls…'}</div>
      ) : data.uid === null ? (
        <div className="gb-panel gb-empty">{emptyLine(data.import.login)}</div>
      ) : (
        <div className="gb-page pl-page">
          {other !== null && <p className="pl-uid">{other}</p>}
          <NightSky banners={data.banners} now={now} />
          <PityCards cards={data.pity} />
          <div className="pl-row">
            <PullsSavings savings={data.savings} now={now} by={by} onBy={setBy} problem={by === null ? null : error} />
            <Planner model={data} />
          </div>
          {/* Older rows read with Show more belong to the newest the model had: a new import starts the list again. */}
          <PullsHistory key={data.history.rows[0]?.id ?? ''} history={data.history} />
        </div>
      )}
    </Frame>
  )
}
