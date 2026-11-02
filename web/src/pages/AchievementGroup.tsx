import { type Ref, type RefObject, useEffect, useRef, useState } from 'react'
import { newestRead } from '../live.ts'
import type { AchievementGroup as AchievementGroupModel, AchievementStage } from '../types.ts'
import { type Clicked, countText, stillShown } from './achievementsview.ts'

/*
 * What an achievement's card (AchievementCard.tsx) and its panel (AchievementPanel.tsx) share with the Daily
 * commissions' and the Timers' cards: the clicks shown at once, the count with its typed number, the note's editor and
 * the wiki's link.
 */

/**
 * Sends one change to an achievement, named by its first stage's id, to the core. It resolves to whether the change
 * was made; the page says what happened.
 */
export type Change = (group: number, path: string, body: unknown) => Promise<boolean>

type Counter = NonNullable<AchievementGroupModel['counter']>

/** A control's value: what the player gave it, until the model takes over, or else the model's. */
export type Shown = <T>(key: string, saved: T) => T
/** Shows a control's new value at once and sends the change to the core. */
export type Send = (key: string, value: unknown, path: string, body: unknown) => Promise<boolean>

/**
 * The card's controls follow the click at once, as Settings' Start with Windows box does. What the player gave a
 * control, named by a key such as `status:81732` or `part:84508:2`, gives way to the model's once the change is answered
 * and a model read asked for after the answer has arrived (achievementsview.ts, stillShown), or at once when the change
 * failed. `read` is the number of the read the card's model came from. The Daily commissions' cards use it too.
 * `waiting` says whether a click still waits for its read: only then does a new `read` change anything.
 */
export function useClicked(group: number, read: number, change: Change): { shown: Shown; send: Send; waiting: boolean } {
  const [clicked, setClicked] = useState<ReadonlyMap<string, Clicked>>(() => new Map())
  const requests = useRef(0)
  useEffect(() => {
    setClicked((current) => stillShown(current, read))
  }, [read])
  function shown<T>(key: string, saved: T): T {
    const entry = clicked.get(key)
    return entry === undefined ? saved : (entry.value as T)
  }
  const send: Send = async (key, value, path, body) => {
    const request = (requests.current += 1)
    setClicked((current) => new Map(current).set(key, { value, request, answered: null }))
    const made = await change(group, path, body)
    const asked = newestRead() // the reads asked for until the answer; only a later one is sure to hold the change
    setClicked((current) => {
      const entry = current.get(key)
      if (entry === undefined || entry.request !== request) return current // a later click on it decides
      const next = new Map(current)
      if (made) next.set(key, { ...entry, answered: asked })
      else next.delete(key)
      return next
    })
    return made
  }
  return { shown, send, waiting: clicked.size > 0 }
}

/**
 * The count of an achievement that counts something: + and −, or the number the game shows, typed (spec 7.1), as an
 * achievement's panel shows it. The target it names is the first stage's not ticked, from the model, as the line that
 * offers the tick is. A timer's card shows it too, where Cleared adds nothing to the count (TimerCard.tsx).
 */
export function CounterRow({
  group,
  counter,
  stages,
  shown,
  send,
  resting = false,
}: {
  group: number
  counter: Counter
  stages: readonly Pick<AchievementStage, 'status'>[]
  shown: Shown
  send: Send
  /** While the Timers category rests, − and + send nothing, as its other buttons; a number typed is still set. */
  resting?: boolean
}) {
  const value = shown('count', counter.value)
  const [typed, setTyped] = useState<string | null>(null) // the count is set on blur or Enter
  const set = (next: number) => void send('count', next, `/api/achievements/counter/${group}`, { value: next })
  const commit = () => {
    if (typed === null) return
    setTyped(null)
    const next = Number(typed)
    // A number that is not a count is sent too: the core's answer says why it is refused.
    if (typed.trim() !== '' && Number.isFinite(next) && next !== value) set(next)
  }
  return (
    <div className="ach-counter">
      <span className="ach-count">{countText({ ...counter, value }, stages)}</span>
      {/* At 0 a press does nothing. aria-disabled, not disabled: a press from the keyboard that takes the count to 0
          would otherwise drop the focus to the page. */}
      <button
        type="button"
        className="ach-step"
        aria-label="Count down"
        data-focus="count-down"
        aria-disabled={resting || value <= 0}
        onClick={() => {
          if (!resting && value > 0) set(value - 1)
        }}
      >
        −
      </button>
      <input
        type="number"
        className="ach-num"
        aria-label="Count"
        data-focus="count"
        min={0}
        step={1}
        value={typed ?? String(value)}
        onChange={(event) => setTyped(event.target.value)}
        // With the focus and the pointer on it, the wheel would step the number, and leaving the field would set the
        // count: the field gives up the focus instead, so the wheel scrolls the page. What was typed is set, as when
        // the player leaves the field.
        onWheel={(event) => event.currentTarget.blur()}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit()
          // Escape puts back the count that was typed over and sets nothing. The field keeps that Escape, as an editor
          // keeps its own; with nothing typed, Escape goes on to the panel around it, which closes.
          if (event.key === 'Escape' && typed !== null && !event.nativeEvent.isComposing) {
            event.stopPropagation()
            setTyped(null)
          }
        }}
      />
      <button
        type="button"
        className="ach-step"
        aria-label="Count up"
        data-focus="count-up"
        aria-disabled={resting || undefined}
        onClick={() => {
          if (!resting) set(value + 1)
        }}
      >
        +
      </button>
    </div>
  )
}

/**
 * The note's editor, in an achievement's panel. It opens with the focus in its text, to type in at once. It has no
 * Cancel: Escape closes it without saving, and `close` hands the focus back to Note. That Escape is the editor's alone:
 * the panel around it, which Escape closes too, does not hear it.
 *
 * A changed note that the editor leaves behind any other way, as Note is pressed again, its panel closes or its card
 * leaves the list, is saved (`keep`), as the Board's Notes widget saves what is typed without a button. Escape is the
 * one way to drop it: in the editor, or on the panel around it (`escaped`), which then closes.
 */
export function NoteEditor({
  name,
  note,
  save,
  close,
  keep,
  escaped,
  ref,
}: {
  name: string
  note: string
  save: (text: string) => void
  close: () => void
  keep: (text: string) => void
  /** Set when Escape closed the panel around the editor. */
  escaped: RefObject<boolean>
  ref: Ref<HTMLDivElement>
}) {
  const [text, setText] = useState(note)
  // What the editor holds as it goes: its text, the note as saved, and how to save it, from its last render.
  const left = useRef({ text, note, keep })
  const dropped = useRef(false) // Escape in the editor
  useEffect(() => {
    left.current = { text, note, keep }
  })
  useEffect(
    () => () => {
      const { text: typed, note: saved, keep: saveIt } = left.current
      if (!dropped.current && !escaped.current && typed.trim() !== saved) saveIt(typed)
    },
    [escaped],
  )
  return (
    <div className="ach-editor" ref={ref}>
      <textarea
        aria-label={`Note on ${name}`}
        data-focus="note-text"
        value={text}
        rows={3}
        autoFocus
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          // Not while a word is being composed, where Escape belongs to the input method.
          if (event.key !== 'Escape' || event.nativeEvent.isComposing) return
          event.stopPropagation()
          dropped.current = true
          close()
        }}
      />
      <button type="button" className="gb-btn" data-focus="note-save" onClick={() => save(text)}>
        Save note
      </button>
    </div>
  )
}

/** Searches the wiki for an achievement, in a new tab. */
export function WikiLink({ href }: { href: string }) {
  return (
    <a className="gb-link" href={href} target="_blank" rel="noopener noreferrer" data-focus="wiki">
      Look it up
    </a>
  )
}
