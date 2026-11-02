import { useEffect, useId, useState } from 'react'
import '../styles/pulls.css'
import { api, messageOf } from '../api.ts'
import { Frame } from '../frame/Frame.tsx'
import { type Live, useModel, useTick } from '../live.ts'
import type { Banner, Pulls as PullsModel } from '../types.ts'
import { Picture } from '../ui/Picture.tsx'
import { PityCards } from './PullsCards.tsx'
import { PullsHistory } from './PullsHistory.tsx'
import { Planner } from './PullsPlanner.tsx'
import { PullsSavings } from './PullsSavings.tsx'
import {
  autoLine, bannerLine, bannersShown, importLine, importWithAuto, loginImportLine, sharesPity, skyTitle, uidLine,
} from './pullsview.ts'

/**
 * The Import button and its line in the top bar (the Pulls plan, calls item 15). A press starts an import in the core;
 * the line follows its progress from the event stream, or says what the core knows of the last one. The button rests
 * while one runs (aria-disabled, which keeps the focus). A press the core refuses says why until the next press, or
 * until the stream tells of an import, as one started from another window does. While no import runs, the sentence about
 * the link Import keeps for a day (the second pass) follows the line: how long it updates itself. Once HoYoverse has
 * refused that link, its sentence stands alone, in place of the failed update's own words: it says what to do.
 */
function ImportControls({ live, model }: { live: Live; model: PullsModel | null }) {
  const [pressing, setPressing] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  useEffect(() => setRefusal(null), [live.pullsImport])
  const running = pressing || (live.pullsImport?.state ?? model?.import.state) === 'running'
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
  const resting = refusal === null && model !== null && !running
  const kept = resting && model !== null ? autoLine(model.import, live.now()) : null
  const expired = kept !== null && model?.import.auto_stopped === 'expired'
  // With the HoYoLAB login the history updates itself; a link a press keeps is said instead while it lives.
  const login = resting && kept === null && model !== null && model.import.login !== null
  const line =
    refusal ??
    (model === null
      ? ''
      : expired
        ? kept
        : login
          ? loginImportLine(live.pullsImport, model.import)
          : importWithAuto(importLine(live.pullsImport, model.import), kept))
  return (
    <>
      <button
        type="button"
        className="gb-btn"
        aria-disabled={running}
        title="Import from the game: reads the link the game writes when you open Wish → History."
        onClick={() => void press()}
      >
        {running ? 'Importing…' : 'Import'}
      </button>
      <span className="gb-status pl-import" data-testid="pulls-import" role="status">
        {line}
      </span>
    </>
  )
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
  const now = live.now()
  const other = data === null ? null : uidLine(data.uid, data.account_uid)
  return (
    <Frame page="pulls" live={live} controls={<ImportControls live={live} model={data} />}>
      {data === null ? (
        <div className="gb-panel gb-empty">{error ?? 'Reading the pulls…'}</div>
      ) : data.uid === null ? (
        <div className="gb-panel gb-empty">No wish history yet. Open Wish → History in the game, then press Import.</div>
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
