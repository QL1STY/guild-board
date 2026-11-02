import { useId, useState } from 'react'
import type { Timer, TimerRule } from '../types.ts'
import type { Send } from './TimerCard.tsx'

/** What the form holds, as the player typed it. */
type Draft = {
  name: string
  place: string
  kind: TimerRule['kind']
  /** "After a time": a number of hours or days. */
  length: string
  unit: 'hours' | 'days'
  /** "At the daily reset": after how many resets. */
  resets: string
  /** Empty for a timer without an end. */
  visits: string
}

const EMPTY: Draft = { name: '', place: '', kind: 'hours', length: '', unit: 'hours', resets: '1', visits: '' }

/**
 * The form a timer of the player's own opens with: empty for a new one, or the timer as it is. A length of whole days
 * from 48 hours on is given in days, as its rule line reads it (timersview.ts, ruleText).
 */
function draftOf(timer: Timer | undefined): Draft {
  if (timer === undefined) return EMPTY
  const visits = timer.visits === null ? '' : String(timer.visits.of)
  const draft: Draft = { ...EMPTY, name: timer.name, place: timer.place, visits }
  const { rule } = timer
  if (rule.kind === 'hours') {
    const days = rule.hours >= 48 && rule.hours % 24 === 0
    return { ...draft, length: String(days ? rule.hours / 24 : rule.hours), unit: days ? 'days' : 'hours' }
  }
  if (rule.kind === 'resets') return { ...draft, kind: 'resets', resets: String(rule.resets) }
  return { ...draft, kind: 'weekly' }
}

/** The rule the form gives. What is not a number goes as it is, and the core says why it is refused. */
function ruleOf(draft: Draft): TimerRule {
  if (draft.kind === 'resets') return { kind: 'resets', resets: Number(draft.resets) }
  if (draft.kind === 'weekly') return { kind: 'weekly' }
  const length = Number(draft.length)
  return { kind: 'hours', hours: draft.unit === 'days' ? length * 24 : length }
}

/**
 * + New timer, and Edit on the player's own timers (spec 9.2): a name and an optional place, when it comes back, and
 * optional visits. It opens with the focus in the name; Escape closes it unsaved, as Cancel does, and only it: in a
 * timer's panel, the panel stays. The core says why a timer is refused, so the browser checks nothing (noValidate).
 * `close` hears of Cancel, and of a timer saved. In a timer's panel, its data-focus is Edit's, where the focus goes when
 * the card is drawn anew in another group (Timers.tsx).
 */
export function NewTimer({
  timer,
  busy,
  send,
  close,
}: {
  /** The timer to edit; none for a new one. */
  timer?: Timer
  busy: boolean
  send: Send
  close: () => void
}) {
  const [draft, setDraft] = useState(() => draftOf(timer))
  const set = (changes: Partial<Draft>) => setDraft((current) => ({ ...current, ...changes }))
  const id = useId() // one form's radio buttons apart from another's, and the visits' hint
  const choice = (kind: Draft['kind'], label: string) => (
    <label className="tim-check">
      <input type="radio" name={`${id}-kind`} checked={draft.kind === kind} onChange={() => set({ kind })} />
      {label}
    </label>
  )
  const save = () => {
    const visits = draft.visits.trim() === '' ? null : Number(draft.visits)
    const body = { name: draft.name, place: draft.place, rule: ruleOf(draft), visits }
    const going = timer === undefined ? send('/api/timers', body) : send(`/api/timers/${timer.id}`, body, 'PUT')
    void going?.then((made) => {
      if (made) close()
    })
  }
  return (
    <form
      className="tim-new"
      aria-label={timer === undefined ? 'New timer' : 'Edit timer'}
      data-focus={timer === undefined ? undefined : 'edit'}
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        save()
      }}
      onKeyDown={(event) => {
        // Not while a word is being composed, where Escape belongs to the input method.
        if (event.key !== 'Escape' || event.nativeEvent.isComposing) return
        event.stopPropagation()
        close()
      }}
    >
      <div className="tim-fields">
        <label className="tim-field">
          Name
          <input type="text" value={draft.name} autoFocus onChange={(event) => set({ name: event.target.value })} />
        </label>
        <label className="tim-field">
          Place (optional)
          <input type="text" value={draft.place} onChange={(event) => set({ place: event.target.value })} />
        </label>
      </div>
      <fieldset className="tim-comes">
        <legend>Comes back</legend>
        <div className="tim-choice">
          {choice('hours', 'After a time')}
          <input
            type="number"
            className="tim-num"
            aria-label="Length"
            min={1}
            step={1}
            value={draft.length}
            onChange={(event) => set({ length: event.target.value, kind: 'hours' })}
          />
          <select
            aria-label="Hours or days"
            value={draft.unit}
            onChange={(event) => set({ unit: event.target.value === 'days' ? 'days' : 'hours', kind: 'hours' })}
          >
            <option value="hours">hours</option>
            <option value="days">days</option>
          </select>
        </div>
        <div className="tim-choice">
          {choice('resets', 'At the daily reset')}
          <span>
            after{' '}
            <input
              type="number"
              className="tim-num"
              aria-label="Resets"
              min={1}
              step={1}
              value={draft.resets}
              onChange={(event) => set({ resets: event.target.value, kind: 'resets' })}
            />{' '}
            resets
          </span>
        </div>
        <div className="tim-choice">{choice('weekly', 'At the weekly reset')}</div>
      </fieldset>
      <label className="tim-field">
        Visits (optional)
        <input
          type="number"
          className="tim-num"
          min={2}
          step={1}
          value={draft.visits}
          aria-describedby={`${id}-visits`}
          onChange={(event) => set({ visits: event.target.value })}
        />
      </label>
      <p id={`${id}-visits`} className="gb-note">
        Leave it empty for a timer without an end
      </p>
      <div className="ach-buttons">
        <button type="submit" className="gb-btn" aria-disabled={busy}>
          {timer === undefined ? 'Add' : 'Save'}
        </button>
        <button type="button" className="gb-btn quiet" onClick={close}>
          Cancel
        </button>
      </div>
    </form>
  )
}
