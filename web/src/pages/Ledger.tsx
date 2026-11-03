import { useEffect, useRef, useState } from 'react'
import '../styles/ledger.css'
import { LEDGER_PATH, ledgerApi, messageOf } from '../api.ts'
import { num } from '../format.ts'
import { Frame } from '../frame/Frame.tsx'
import { FreshRing } from '../frame/FreshRing.tsx'
import { pressed, useNewFlash, withFlash } from '../frame/freshview.ts'
import type { Ledger as LedgerModel, LedgerEntry, LedgerKind } from '../ledgertypes.ts'
import { type Live, useModel, useTick } from '../live.ts'
import { Segmented } from '../ui/Segmented.tsx'
import {
  CURRENCY_NAMES, KIND_LABELS, fivesNote, historyRow, ledgerFresh, ledgerRunning, luckLine, priceParts, money, signed,
  sinceLine, topOutLine,
} from './ledgerview.ts'

const KINDS: readonly LedgerKind[] = ['primogem', 'crystal', 'resin', 'artifact']
const FIVE = '★★★★★'

/** Stars in the rarity's colour; a screen reader hears "5 stars". */
function Stars({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <span className={`ld-stars r${count}`} role="img" aria-label={`${count} stars`}>
      {'★'.repeat(count)}
    </span>
  )
}

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

function Tiles({ model }: { model: LedgerModel }) {
  const { spent, month, artifacts } = model
  const price = priceParts(spent.total, spent.currency)
  const fives = artifacts.five_domain + artifacts.five_other
  const luck = luckLine(artifacts)
  const note = fivesNote(artifacts)
  const monthNote = [month.bought > 0 ? `${signed(month.bought)} from crystals` : '', topOutLine(month)]
    .filter((part) => part !== '')
    .join(' · ')
  return (
    <div className="ld-tiles">
      <div className="gb-panel ld-tile" data-testid="ledger-spent">
        <div className="ld-k">Spent on Genshin</div>
        <div className="ld-v ld-gold">
          {spent.total === 0 ? '' : 'about '}
          {price.before}
          {price.figure}
          {price.after !== '' && <small> {price.after}</small>}
        </div>
        <div className="ld-n">{sinceLine(spent)}</div>
      </div>
      <div className="gb-panel ld-tile" data-testid="ledger-month">
        <div className="ld-k">Primogems this month</div>
        <div className="ld-v">
          {signed(month.earned)} <small>earned</small> · {signed(-month.out)} <small>out</small>
        </div>
        <div className="ld-n">{monthNote}</div>
      </div>
      <div className="gb-panel ld-tile" data-testid="ledger-fives">
        <div className="ld-k">Five-star artifacts, 30 days</div>
        <div className="ld-v">
          {num(fives)} {note !== '' && <small>{note}</small>}
        </div>
        <div className="ld-n">
          {luck !== null
            ? luck.replace(/^Luck: /, '')
            : `${num(artifacts.five_domain)} from domains, ${num(artifacts.five_other)} from elsewhere`}
        </div>
      </div>
    </div>
  )
}

function Spending({ spent }: { spent: LedgerModel['spent'] }) {
  return (
    <section className="gb-panel ld-panel" aria-labelledby="ld-spending">
      <h2 id="ld-spending" className="ld-h">
        Spending
      </h2>
      <p className="ld-hs">Every Genesis Crystal top-up the game remembers, kept after the game forgets it</p>
      {spent.rows.length === 0 ? (
        <p className="ld-empty">No purchases in the history the game keeps.</p>
      ) : (
        <ul className="ld-packs" data-testid="ledger-packs">
          {spent.rows.map((row) => (
            <li key={row.id}>
              <span>{row.label}</span>
              <span>×{num(row.count)}</span>
              <span>{money(row.total, spent.currency)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="ld-note">
        Prices are an estimate in {CURRENCY_NAMES[spent.currency]}, from the official price list.{' '}
        <a href="#/settings">Change currency or prices</a>
      </p>
    </section>
  )
}

/**
 * The raw history of one log, newest first, as the game wrote it. Show more reads the entries before the last one shown
 * and adds them below. A new import starts the list again (its key).
 */
function History() {
  const [kind, setKind] = useState<LedgerKind>('primogem')
  const [entries, setEntries] = useState<LedgerEntry[] | null>(null)
  const [more, setMore] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    let current = true
    setEntries(null)
    setProblem(null)
    ledgerApi.history(kind, null).then(
      (page) => {
        if (!current) return
        setEntries(page.entries)
        setMore(page.more)
      },
      (failure: unknown) => {
        if (current) setProblem(messageOf(failure))
      },
    )
    return () => {
      current = false
    }
  }, [kind])
  const showMore = async () => {
    const last = entries?.[entries.length - 1]
    if (last === undefined || loading) return
    setLoading(true)
    try {
      const page = await ledgerApi.history(kind, last.id)
      setEntries((shown) => [...(shown ?? []), ...page.entries])
      setMore(page.more)
    } catch (failure) {
      setProblem(messageOf(failure))
    } finally {
      setLoading(false)
    }
  }
  return (
    <section className="gb-panel ld-panel" aria-labelledby="ld-history">
      <div className="ld-head">
        <h2 id="ld-history" className="ld-h">
          History
        </h2>
        <Segmented
          label="History of"
          options={KINDS.map((value) => ({ value, label: KIND_LABELS[value] }))}
          value={kind}
          onChange={setKind}
        />
      </div>
      <p className="ld-hs">Newest first, as the game wrote it</p>
      {entries === null ? (
        <p className="ld-empty">{problem ?? 'Reading the history…'}</p>
      ) : entries.length === 0 ? (
        <p className="ld-empty">Nothing in this history yet.</p>
      ) : (
        <ul className="ld-rows" data-testid="ledger-rows">
          {entries.map((entry) => {
            const row = historyRow(entry, kind)
            return (
              <li key={entry.id}>
                <span className="ld-t">{row.time}</span>
                <span className="ld-r">
                  {row.text}
                  {row.stars > 0 && <> <Stars count={row.stars} /></>}
                  {row.note !== undefined && <small>{row.note}</small>}
                </span>
                <span className={`ld-a ${row.tone}`}>{row.amount}</span>
              </li>
            )
          })}
        </ul>
      )}
      {entries !== null && problem !== null && <p className="ld-empty">{problem}</p>}
      {entries !== null && more && (
        <button type="button" className="gb-btn quiet ld-more" aria-disabled={loading} onClick={() => void showMore()}>
          Show more
        </button>
      )}
    </section>
  )
}

function Artifacts({ artifacts }: { artifacts: LedgerModel['artifacts'] }) {
  const luck = luckLine(artifacts)
  return (
    <section className="gb-panel ld-panel ld-artifacts" aria-labelledby="ld-artifacts" data-testid="ledger-artifacts">
      <h2 id="ld-artifacts" className="ld-h">
        Artifacts
      </h2>
      <p className="ld-hs">Last 30 days, from the game's artifact history</p>
      <div className="ld-figures">
        <div>
          <div className="ld-k">From domains</div>
          <div className="ld-v">
            {num(artifacts.five_domain)} <small className="ld-stars r5">{FIVE}</small>
          </div>
          <div className="ld-n">{artifacts.top_domain === null ? '' : `Most from ${artifacts.top_domain}`}</div>
        </div>
        <div>
          <div className="ld-k">From the strongbox and others</div>
          <div className="ld-v">
            {num(artifacts.five_other)} <small className="ld-stars r5">{FIVE}</small>
          </div>
          <div className="ld-n">and {num(artifacts.four_other)} four-star</div>
        </div>
        <div>
          <div className="ld-k">Fed or salvaged</div>
          <div className="ld-v">{num(artifacts.fed)}</div>
          <div className="ld-n">{num(artifacts.fed_five)} of them five-star</div>
        </div>
      </div>
      {luck !== null && <p className="ld-note">{luck}</p>}
    </section>
  )
}

/**
 * The Ledger page (the ledger design, sections 0 and 6; the accepted mockup, screen 2): what the game's own histories
 * say, kept after the game forgets them. Three tiles, then Spending beside the History, then the Artifacts. Before any
 * import it says that it is reading them with the HoYoLAB login, or, without one, how to get the game's history link:
 * open Feedback in the game, then press Import. The model is read
 * again on every event of an import, and every 1.5 s while one runs, so the reading's progress shows.
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
  return (
    <Frame
      page="ledger"
      live={live}
      beside={data !== null && <ImportRing live={live} model={data} pressing={press.pressing} refusal={press.refusal} />}
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
        <div className="gb-page ld-page">
          <Tiles model={data} />
          <div className="ld-row">
            <Spending spent={data.spent} />
            <History key={data.last_import ?? ''} />
          </div>
          <Artifacts artifacts={data.artifacts} />
        </div>
      )}
    </Frame>
  )
}
