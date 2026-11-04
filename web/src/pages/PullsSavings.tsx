import { Fragment, type FormEvent, type KeyboardEvent, useId, useLayoutEffect, useRef, useState } from 'react'
import { api, messageOf } from '../api.ts'
import type { Pulls } from '../types.ts'
import { Picture } from '../ui/Picture.tsx'
import { Switch } from '../ui/Switch.tsx'
import {
  achievementsNote, balanceWords, dayOf, eventsCount, forecastLine, ROW_LABELS, rowAmount, rowLabel, totalAmount,
  totalLine, typed, versionAmount, versionOffers, versionTitle,
} from './pullsview.ts'

/** The primogem's picture in the core's icon cache; the demo, which downloads nothing, shows its sign. */
const PRIMOGEM = '/api/icon/static.primogem'

/** Closes a form on Escape, as its Cancel does. Not while a word is being composed: Escape belongs to the input method. */
function escapeTo(close: (() => void) | undefined) {
  return (event: KeyboardEvent) => {
    if (close === undefined || event.key !== 'Escape' || event.nativeEvent.isComposing) return
    event.stopPropagation()
    close()
  }
}

/**
 * The balance as the player types it (spec 6.1, item 4): primogems and Intertwined Fates, set now. With `close` it was
 * opened by Set the balance, takes the focus and can be closed unsaved; without, it is there because no balance is set.
 * `saved` hears of a balance the core took.
 */
function BalanceForm({ close, saved }: { close?: () => void; saved: () => void }) {
  const [primogems, setPrimogems] = useState('')
  const [fates, setFates] = useState('')
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      await api.put('/api/pulls/balance', { primogems: typed(primogems), fates: typed(fates) })
      setRefusal(null)
      setBusy(false)
      saved()
    } catch (error) {
      setRefusal(messageOf(error))
      setBusy(false)
    }
  }
  return (
    <form className="pl-form" noValidate onSubmit={(event) => void save(event)} onKeyDown={escapeTo(close)}>
      <label className="pl-field">
        Primogems
        <input
          type="number"
          min={0}
          step={1}
          value={primogems}
          autoFocus={close !== undefined}
          onChange={(event) => setPrimogems(event.target.value)}
        />
      </label>
      <label className="pl-field">
        Intertwined Fates
        <input type="number" min={0} step={1} value={fates} onChange={(event) => setFates(event.target.value)} />
      </label>
      <span className="pl-buttons">
        <button type="submit" className="gb-btn" aria-disabled={busy}>
          Save
        </button>
        {close !== undefined && (
          <button type="button" className="gb-btn quiet" onClick={close}>
            Cancel
          </button>
        )}
      </span>
      <p className="pl-refused" role="alert">
        {refusal}
      </p>
    </form>
  )
}

/**
 * The events count of the community, typed for the next version (the second pass, spec 3.2): the events line of their
 * count, never its total, so that nothing is counted twice. It replaces the estimate. Where one is typed, Use the
 * estimate sends none and the estimate comes back. A value that is not a whole number of primogems from 0 to 100,000 is
 * said, and sent nowhere. `close` closes the form and hands the focus back; the core's refusal is said on its line.
 */
function EventsForm({ version, current, close }: { version: string; current: number | null; close: () => void }) {
  const [text, setText] = useState(current === null ? '' : String(current))
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const send = async (primogems: number | null) => {
    if (busy) return
    setBusy(true)
    try {
      await api.put('/api/pulls/settings', { events_typed: { version, primogems } })
      setBusy(false)
      close()
    } catch (error) {
      setRefusal(messageOf(error))
      setBusy(false)
    }
  }
  const save = (event: FormEvent) => {
    event.preventDefault()
    const count = eventsCount(text)
    if (count === null) setRefusal('Type a whole number of primogems.')
    else void send(count)
  }
  return (
    <form className="pl-form" noValidate onSubmit={save} onKeyDown={escapeTo(close)}>
      <label className="pl-field">
        Events, as the community counts them
        <input type="number" min={0} max={100000} step={1} value={text} autoFocus onChange={(event) => setText(event.target.value)} />
      </label>
      <span className="pl-buttons">
        <button type="submit" className="gb-btn" aria-disabled={busy}>
          Save
        </button>
        <button type="button" className="gb-btn quiet" onClick={close}>
          Cancel
        </button>
        {current !== null && (
          <button type="button" className="gb-btn quiet" aria-disabled={busy} onClick={() => void send(null)}>
            Use the estimate
          </button>
        )}
      </span>
      <p className="pl-refused" role="alert">
        {refusal}
      </p>
    </form>
  )
}

/**
 * The two purchases that add to the next version, each over its drawn sign (spec 3.1). The repository holds no address
 * of the game's own picture for either, so `src` is none and the sign shows; an address on one of the icon cache's
 * hosts goes here to show the picture.
 */
const SWITCHES = [
  { key: 'welkin', src: null, sign: 'moon' },
  { key: 'gnostic_hymn', src: null, sign: 'scroll' },
] as const

/**
 * The Blessing of the Welkin Moon and the Gnostic Hymn, as two pill switches under the balance, kept per game uid. A
 * press sends the other state; the page shows it once the core has answered and the model is read again. The one the
 * player has shows in full colour with a gold edge, the other muted.
 */
function Switches({ owned }: { owned: Pulls['savings']['owned'] }) {
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const press = async (key: (typeof SWITCHES)[number]['key']) => {
    if (busy) return
    setBusy(true)
    try {
      await api.put('/api/pulls/settings', { [key]: !owned[key] })
      setRefusal(null)
    } catch (error) {
      setRefusal(messageOf(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <div className="pl-owned">
        {SWITCHES.map(({ key, src, sign }) => (
          <Switch
            key={key}
            on={owned[key]}
            picture={<Picture src={src} sign={sign} />}
            testId={`switch-${key}`}
            onPress={() => void press(key)}
          >
            {ROW_LABELS[key]}
          </Switch>
        ))}
      </div>
      {refusal !== null && (
        <p className="pl-refused pl-centred" role="alert">
          {refusal}
        </p>
      )}
    </>
  )
}

/**
 * Savings, the ledger (the second pass, spec 3.1; the accepted mockup savings-chosen.html): the balance in pulls now and
 * what it is made of, the Welkin Moon and Gnostic Hymn switches, the next version's primogems source by source, the
 * total by that version's end with what the unfinished achievements would add outside it, then the forecast to a day
 * with the day to pick, and Set the balance. With no balance set it shows the version's sources all the same, the
 * balance form in the balance's place and no total.
 */
export function PullsSavings({
  savings,
  now,
  by,
  onBy,
  problem,
}: {
  savings: Pulls['savings']
  /** The core's time. */
  now: Date
  /** The forecast's day as the player picked it, or null for the default. */
  by: string | null
  onBy: (day: string | null) => void
  /** Why the model to the picked day could not be read. */
  problem: string | null
}) {
  const titleId = useId()
  const words = balanceWords(savings, now)
  const hasBalance = words !== null
  const { next } = savings
  const [setting, setSetting] = useState(false)
  const [typing, setTyping] = useState(false)
  const set = useRef<HTMLButtonElement>(null)
  const events = useRef<HTMLButtonElement>(null)
  // Where the focus goes back to once the form that has it is gone.
  const refocus = useRef<'set' | 'events' | null>(null)
  const closeBalance = () => {
    refocus.current = 'set'
    setSetting(false)
  }
  const closeEvents = () => {
    refocus.current = 'events'
    setTyping(false)
  }
  // Set the balance and the events button are drawn again once their form has gone, and take the focus back: at once
  // after Cancel or a save, and for the form shown before any balance, once the model read again has the balance.
  useLayoutEffect(() => {
    if (refocus.current === 'set' && !setting && hasBalance) {
      refocus.current = null
      set.current?.focus()
    } else if (refocus.current === 'events' && !typing) {
      refocus.current = null
      events.current?.focus()
    }
  }, [setting, typing, hasBalance])
  const note = achievementsNote(savings.achievements_pulls)
  return (
    <section className="gb-panel pl-ledger" data-testid="pulls-savings" aria-labelledby={titleId}>
      <div className="pl-lhead">
        <h2 id={titleId} className="gb-h">
          Savings
        </h2>
        {words !== null && <span className="pl-quiet">{words.set}</span>}
      </div>
      {words === null ? (
        <div className="pl-open">
          <p className="pl-line">Type your primogems and fates to see your savings as pulls.</p>
          <BalanceForm saved={closeBalance} />
        </div>
      ) : (
        <>
          <p className="pl-hero" data-testid="ledger-hero">
            <Picture src={PRIMOGEM} sign="gem" className="pl-primo" />
            <b data-testid="ledger-pulls">{words.big}</b>
            <span className="pl-unit">{words.unit}</span>
          </p>
          <p className="pl-sub">{words.line}</p>
        </>
      )}
      <Switches owned={savings.owned} />
      <div className="pl-rule" aria-hidden="true" />
      <div className="pl-version">
        <strong>{versionTitle(next)}</strong>
        <span className="pl-tab" data-testid="version-amount">
          {versionAmount(next)}
        </span>
      </div>
      <p className="pl-quiet pl-offers">{versionOffers(next)}</p>
      <ul className="pl-sources" data-testid="ledger-rows">
        {next.rows.map((row) => (
          <Fragment key={row.key}>
            <li className={row.on ? 'pl-source' : 'pl-source off'} data-testid="ledger-row" data-key={row.key}>
              <span className="pl-source-name" data-testid="ledger-name">
                {rowLabel(row)}
                {!row.on && <span className="sr-only">, switched off</span>}
                {row.key === 'events' && next.number !== null && !typing && (
                  <button ref={events} type="button" className="gb-btn quiet pl-mini" onClick={() => setTyping(true)}>
                    {next.events_typed === null ? 'Type the events count' : 'Change'}
                  </button>
                )}
              </span>
              <span className="pl-source-val" data-testid="ledger-amount">
                {rowAmount(row)}
              </span>
            </li>
            {row.key === 'events' && next.number !== null && typing && (
              <li className="pl-source-form">
                <EventsForm version={next.number} current={next.events_typed} close={closeEvents} />
              </li>
            )}
          </Fragment>
        ))}
      </ul>
      {savings.by_next_end !== null && (
        <>
          <div className="pl-rule" aria-hidden="true" />
          <p className="pl-total" data-testid="ledger-total">
            <span>{totalLine(next)}</span>
            <b className="pl-tab">{totalAmount(savings.by_next_end)}</b>
          </p>
          {note !== null && <p className="pl-quiet pl-outside">{note}</p>}
        </>
      )}
      {words !== null && (
        <div className="pl-foot">
          <p className="pl-forecast">
            {forecastLine(savings.forecast, now)}
            <input
              type="date"
              className="pl-day"
              aria-label="Forecast day"
              min={dayOf(now)}
              value={by ?? savings.forecast.by}
              onChange={(event) => onBy(event.target.value === '' ? null : event.target.value)}
            />
          </p>
          {problem !== null && (
            <p className="pl-refused" role="alert">
              {problem}
            </p>
          )}
          <p className="pl-note">{words.note}</p>
        </div>
      )}
      {words !== null &&
        (setting ? (
          <BalanceForm close={closeBalance} saved={closeBalance} />
        ) : (
          <button ref={set} type="button" className="gb-btn quiet pl-set" onClick={() => setSetting(true)}>
            Set the balance
          </button>
        ))}
    </section>
  )
}
