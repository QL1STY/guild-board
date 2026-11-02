import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { api } from '../api.ts'
import { newestRead } from '../live.ts'
import type { Timer } from '../types.ts'
import type { ChangeMethod, QueuedChange } from '../ui/changes.tsx'
import { Dial, Seal } from '../ui/marks.tsx'
import { Picture } from '../ui/Picture.tsx'
import { RowPanel, usePanelPresence } from '../ui/RowPanel.tsx'
import { Sign } from '../ui/Sign.tsx'
import { CountSteps } from '../widgets/CountSteps.tsx'
import { readySince, timeLead, timerSign } from '../widgets/widgetview.ts'
import { CounterRow, useClicked } from './AchievementGroup.tsx'
import { countText } from './achievementsview.ts'
import { NewTimer } from './NewTimer.tsx'
import { progressOf, ruleLine, stateLine, visitsText } from './timersview.ts'

export type { ChangeMethod } from '../ui/changes.tsx'

/** Sends one change to the timers to the core; the undo note names it (ui/changes.tsx, useChanges). */
export type TimerChange = QueuedChange

/**
 * Sends a change, or answers null when it sends nothing: while another is out, and while the category rests after a
 * change (Timers.tsx, useSettling).
 */
export type Send = (path: string, body?: unknown, method?: ChangeMethod) => Promise<boolean> | null

/**
 * One request at a time, as the list's and the import's panels send theirs (ListPanel.tsx): while one is out, and while
 * the category rests (`settling`), the buttons that send keep the focus (aria-disabled, not disabled, which would drop
 * it to the page), and a press sends nothing.
 */
export function useSending(change: Send, settling = false): { busy: boolean; send: Send } {
  const out = useRef(false) // as busy, but at once: two presses before the page shows the first send one request
  const [busy, setBusy] = useState(false)
  const send: Send = (path, body, method) => {
    if (out.current) return null
    const going = change(path, body, method)
    if (going === null) return null
    out.current = true
    setBusy(true)
    return going.finally(() => {
      out.current = false
      setBusy(false)
    })
  }
  return { busy: busy || settling, send }
}

/** Far beyond anything the core takes, but still a time: the core refuses it with its own sentence. */
const FARTHEST_SECONDS = 1000 * 366 * 86_400

/** The instant `seconds` after `now`, as the core takes a time: ISO 8601 with its offset. */
function instant(now: Date, seconds: number): string {
  const bounded = Math.max(-FARTHEST_SECONDS, Math.min(FARTHEST_SECONDS, Number.isFinite(seconds) ? seconds : 0))
  return new Date(now.getTime() + bounded * 1000).toISOString()
}

/** A number field's value as the form counts it: an empty field is 0. */
function amount(text: string): number {
  return text.trim() === '' ? 0 : Number(text)
}

/**
 * A time as the game shows it, in hours and minutes: "Cleared [h] h [min] min ago" or "Ready in [h] h [min] min"
 * (spec 9.1). It opens with the focus in its hours; Escape closes it unsaved, as Cancel does, and only it: the panel
 * around it stays. The core says why a time is refused, so the browser checks nothing (noValidate). Its data-focus is
 * the button's that opened it, where the focus goes when the card is drawn anew in another group (Timers.tsx).
 */
function TimeForm({
  form,
  label,
  before,
  after,
  busy,
  save,
  cancel,
}: {
  form: Form
  label: string
  before: string
  after: string
  busy: boolean
  /** With the time given, in seconds. */
  save: (seconds: number) => void
  cancel: () => void
}) {
  const [hours, setHours] = useState('')
  const [minutes, setMinutes] = useState('')
  return (
    <form
      className="tim-form"
      aria-label={label}
      data-focus={form}
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        save(amount(hours) * 3600 + amount(minutes) * 60)
      }}
      onKeyDown={(event) => {
        // Not while a word is being composed, where Escape belongs to the input method.
        if (event.key !== 'Escape' || event.nativeEvent.isComposing) return
        event.stopPropagation()
        cancel()
      }}
    >
      {before}
      <input
        type="number"
        className="tim-num"
        aria-label="Hours"
        min={0}
        step={1}
        value={hours}
        autoFocus
        onChange={(event) => setHours(event.target.value)}
      />
      h
      <input
        type="number"
        className="tim-num"
        aria-label="Minutes"
        min={0}
        max={59}
        step={1}
        value={minutes}
        onChange={(event) => setMinutes(event.target.value)}
      />
      {after}
      <span className="tim-form-buttons">
        <button type="submit" className="gb-btn" aria-disabled={busy}>
          Save
        </button>
        <button type="button" className="gb-btn quiet" onClick={cancel}>
          Cancel
        </button>
      </span>
    </form>
  )
}

type Form = 'earlier' | 'ready' | 'edit'

/** The address of a timer's panel, which its card's More names (aria-controls). */
function panelId(timer: number): string {
  return `tim-panel-${timer}`
}

/**
 * One timer as an even card (look pass spec 11.6), one height for the whole category, in four rows: the timer's dial
 * (its picture in the ring of its time passed, green with a tick when it is ready), its name and place, and the bell;
 * its state, the time left first or the Ready seal and since when; the achievement it serves with its count, alone where
 * Cleared adds to it (the hilichurl) or between − and + where it does not (a teapot field's items), else its rule on one
 * line; and Cleared (solid when the timer is ready, quiet while it runs), Pin to Board and More, one size.
 *
 * More opens the timer's panel under the card's row (RowPanel), with the rule in full, the visits, the count's typed
 * number, Cleared earlier…, Set ready time…, Edit for the player's own, and Remove; the forms open in the panel. `open`
 * says whether the panel is open, and `onToggle` asks the category to open or close it: one at a time. The card's and
 * the panel's data-timer and each button's data-focus let the page keep the keyboard's place when the card moves to
 * another group (Timers.tsx), its panel with it.
 */
export function TimerCard({
  timer,
  read,
  clock,
  change,
  changeCount,
  settling,
  open,
  onToggle,
}: {
  timer: Timer
  /** The number of the model read that `timer` came from (live.ts, useModel). */
  read: number
  /** The core's time (live.ts, Live.now). */
  clock: () => Date
  change: Send
  /**
   * Sends a change to the achievement's count in the page's order of changes, as the Daily commissions' cards send
   * theirs: a count moves no card, so it neither waits for the category's rest nor makes it rest.
   */
  changeCount: TimerChange
  /** The category rests after a change, and the card's buttons send nothing (Timers.tsx, useSettling). */
  settling: boolean
  open: boolean
  onToggle: (timer: number) => void
}) {
  const { busy, send } = useSending(change, settling)
  // The count follows − and + at once, as on the Achievements page, so that quick presses add up.
  const counting = useClicked(timer.achievement?.id ?? 0, read, (_group, countPath, body) => changeCount(countPath, body))
  const path = `/api/timers/${timer.id}`
  // The bell follows the press at once, as the achievements' toggles do, until a model read asked for after the core's
  // answer holds it (achievementsview.ts, stillShown); a press that is refused gives way at once.
  const [pressed, setPressed] = useState<{ on: boolean; answered: number | null } | null>(null)
  useEffect(() => {
    setPressed((current) => (current !== null && current.answered !== null && read > current.answered ? null : current))
  }, [read])
  const bell = pressed?.on ?? timer.bell
  const ring = () => {
    const on = !bell
    const going = send(`${path}/bell`, { on })
    if (going === null) return
    setPressed({ on, answered: null })
    void going.then((made) => setPressed(made ? { on, answered: newestRead() } : null))
  }
  // Pin to Board (spec 9.2) follows the press at once in the same way. It is a change to the Board's layout, not one to
  // undo, so it goes to the core straight away rather than through the undo note.
  const [pinPress, setPinPress] = useState<{ on: boolean; answered: number | null } | null>(null)
  useEffect(() => {
    setPinPress((current) => (current !== null && current.answered !== null && read > current.answered ? null : current))
  }, [read])
  const pinned = pinPress?.on ?? timer.pinned
  const pin = () => {
    const on = !pinned
    setPinPress({ on, answered: null })
    api.post(`${path}/pin`, { on }).then(
      () => setPinPress({ on, answered: newestRead() }),
      () => setPinPress(null),
    )
  }

  const article = useRef<HTMLElement>(null)
  const more = useRef<HTMLButtonElement>(null)
  // The panel stays in the page while it shrinks away after it is closed; a form open in it closes with it.
  const present = usePanelPresence(open)
  const [form, setForm] = useState<Form | null>(null)
  if (!present && form !== null) setForm(null)
  // Escape in the panel: it closes, and the focus it holds goes back to More.
  const closePanel = () => {
    more.current?.focus()
    onToggle(timer.id)
  }
  const openers: Record<Form, RefObject<HTMLButtonElement | null>> = {
    earlier: useRef<HTMLButtonElement>(null),
    ready: useRef<HTMLButtonElement>(null),
    edit: useRef<HTMLButtonElement>(null),
  }
  // A form that closes takes the focus it held with it: the focus goes back to the button that opened it, unless the
  // player has put it somewhere else meanwhile, as the note's editor hands it back to Note (AchievementPanel.tsx).
  const opened = useRef<Form | null>(null)
  useLayoutEffect(() => {
    const opener = opened.current
    opened.current = form
    if (form !== null || opener === null) return
    const active = document.activeElement
    if (active === null || active === document.body) openers[opener].current?.focus()
  })
  const toggle = (next: Form) => setForm(form === next ? null : next)
  const closeOnSave = (going: Promise<boolean> | null) => {
    void going?.then((made) => {
      if (made) setForm(null)
    })
  }
  // Cleared earlier and Set ready time take the time the game shows, from the core's now.
  const cleared = (seconds: number) => closeOnSave(send(`${path}/cleared`, { at: instant(clock(), -seconds) }))
  const readyIn = (seconds: number) => closeOnSave(send(`${path}/ready`, { at: instant(clock(), seconds) }))

  const now = clock()
  const ready = timer.state === 'ready'
  const lead = timeLead(timer, now)
  const since = readySince(timer, now)
  const { achievement, visits } = timer
  const counter = achievement?.counter ?? null
  const count = counter === null ? 0 : counting.shown('count', counter.value)
  const heading = `timer-${timer.id}`
  const classes = ['gb-panel', 'tim-card', ready && 'ready', open && 'open'].filter(Boolean)
  return (
    <>
      <article
        ref={article}
        className={classes.join(' ')}
        aria-labelledby={heading}
        data-testid="timer"
        data-timer={timer.id}
      >
        {/* The timer's picture, through the core's icon cache, or its sign where there is none or it does not load. */}
        <Dial progress={progressOf(timer, now)} ready={ready} size="46px">
          <Picture src={timer.icon} sign={timerSign(timer)} />
        </Dial>
        <div className="tim-who">
          <h4 id={heading} className="tim-name">
            {timer.name}
          </h4>
          <p className="tim-place">{timer.place}</p>
        </div>
        <button
          type="button"
          className="ach-toggle tim-bell"
          data-focus="bell"
          aria-pressed={bell}
          aria-disabled={busy}
          onClick={ring}
        >
          Remind me
        </button>
        <p className="tim-state" data-testid="timer-state">
          {ready ? (
            <>
              <Seal>Ready</Seal>
              {since !== null && ` ${since}`}
            </>
          ) : lead !== null ? (
            <>
              <b>{lead.lead}</b> · {lead.at}
            </>
          ) : (
            stateLine(timer, now)
          )}
        </p>
        <div className="tim-serves">
          {achievement === null ? (
            <span className="tim-rule">{ruleLine(timer)}</span>
          ) : (
            <>
              <span className="tim-ach">{achievement.name}</span>
              {counter?.cleared_adds && <b className="tim-count">{countText(counter, achievement.stages)}</b>}
              {counter !== null && !counter.cleared_adds && (
                <CountSteps
                  className="tim-steps"
                  value={count}
                  text={countText({ ...counter, value: count }, achievement.stages)}
                  resting={busy}
                  set={(next) => void counting.send('count', next, `/api/achievements/counter/${achievement.id}`, { value: next })}
                />
              )}
            </>
          )}
        </div>
        <div className="tim-actions">
          {/* On a running timer too: it starts again and counts again, as for a second hilichurl (spec 22). */}
          <button
            type="button"
            className={ready ? 'gb-btn' : 'gb-btn quiet'}
            data-focus="cleared"
            aria-disabled={busy}
            onClick={() => void send(`${path}/cleared`, {})}
          >
            Cleared
          </button>
          <button type="button" className="ach-toggle" data-focus="pin" aria-pressed={pinned} onClick={pin}>
            Pin to Board
          </button>
          <button
            ref={more}
            type="button"
            className="ach-toggle ach-panel-btn"
            data-focus="more"
            aria-expanded={open}
            aria-controls={present ? panelId(timer.id) : undefined}
            onClick={() => onToggle(timer.id)}
          >
            More
            <Sign name="chevron" />
          </button>
        </div>
      </article>
      {present && (
        <RowPanel
          id={panelId(timer.id)}
          labelledBy={heading}
          card={article}
          closing={!open}
          close={closePanel}
          holder={{ 'data-timer': timer.id }}
          className="tim-panel"
          testId="timer-panel"
        >
          <p className="tim-rule-full">{ruleLine(timer)}</p>
          {(visits !== null || (counter !== null && !counter.cleared_adds)) && (
            <div className="tim-facts">
              {visits !== null && <span className="tim-count">{visitsText(visits)}</span>}
              {achievement !== null && counter !== null && !counter.cleared_adds && (
                <CounterRow
                  group={achievement.id}
                  counter={counter}
                  stages={achievement.stages}
                  shown={counting.shown}
                  send={counting.send}
                  resting={busy}
                />
              )}
            </div>
          )}
          <div className="tim-actions">
            <button
              ref={openers.earlier}
              type="button"
              className="ach-toggle"
              data-focus="earlier"
              aria-expanded={form === 'earlier'}
              onClick={() => toggle('earlier')}
            >
              Cleared earlier…
            </button>
            <button
              ref={openers.ready}
              type="button"
              className="ach-toggle"
              data-focus="ready"
              aria-expanded={form === 'ready'}
              onClick={() => toggle('ready')}
            >
              Set ready time…
            </button>
            {/* A pre-set keeps its name and its rule. */}
            {timer.own && (
              <button
                ref={openers.edit}
                type="button"
                className="ach-toggle"
                data-focus="edit"
                aria-expanded={form === 'edit'}
                onClick={() => toggle('edit')}
              >
                Edit
              </button>
            )}
            {/* With its history; Undo can put both back. */}
            <button
              type="button"
              className="ach-toggle"
              data-focus="remove"
              aria-disabled={busy}
              onClick={() => void send(path, undefined, 'DELETE')}
            >
              Remove
            </button>
          </div>
          {form === 'earlier' && (
            <TimeForm
              form="earlier"
              label="Cleared earlier"
              before="Cleared"
              after="min ago"
              busy={busy}
              save={cleared}
              cancel={() => setForm(null)}
            />
          )}
          {form === 'ready' && (
            <TimeForm
              form="ready"
              label="Set ready time"
              before="Ready in"
              after="min"
              busy={busy}
              save={readyIn}
              cancel={() => setForm(null)}
            />
          )}
          {form === 'edit' && <NewTimer timer={timer} busy={busy} send={send} close={() => setForm(null)} />}
        </RowPanel>
      )}
    </>
  )
}
