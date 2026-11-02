import { type FormEvent, type KeyboardEvent, useId, useLayoutEffect, useRef, useState } from 'react'
import { api, messageOf } from '../api.ts'
import type { PityCard } from '../types.ts'
import { SegmentRing, Seal } from '../ui/marks.tsx'
import {
  cardForm, cardLabel, correctionLabel, GUARANTEE_NOT_KNOWN, pathWords, pityWords, POOL_LABELS,
} from './pullsview.ts'

/** What a card's form holds, as the player typed it. */
type Draft = { pity: string; guaranteed: boolean; item: string; points: string }

/** The form as it opens: the correction the core keeps, and the path and Fate Points the card shows. */
function draftOf(card: PityCard): Draft {
  return {
    pity: card.correction === null ? '' : String(card.correction.pity),
    guaranteed: card.correction?.guaranteed ?? false,
    item: card.path?.item ?? '',
    points: String(card.path?.points ?? 0),
  }
}

/**
 * What Save sends: only what the player changed. A Fate Point that the history counts is not fixed by a press of Save
 * (the plan's call 20), and a chart that does not count while its banner is not running is not cleared. A pity left
 * empty takes the correction away. What is not a whole number goes as it is, and the core says why it is refused.
 * Null when nothing changed.
 */
function changesOf(card: PityCard, before: Draft, after: Draft): Record<string, unknown> | null {
  const body: Record<string, unknown> = {}
  if (after.pity !== before.pity || after.guaranteed !== before.guaranteed) {
    const pity = after.pity.trim()
    const correction = pity === '' ? null : { pity: Number(pity), guaranteed: card.pool !== 'standard' && after.guaranteed }
    body.corrections = { [card.pool]: correction }
  }
  if (after.item !== before.item) body[card.pool === 'weapon' ? 'charted_weapon' : 'chronicled_path'] = after.item.trim()
  if (after.points !== before.points) body.points = { [card.pool]: Number(after.points) }
  return Object.keys(body).length === 0 ? null : body
}

/**
 * The form Set… opens inside a card (the Pulls plan, Task 11, and its call 6), with what `form` says changes something
 * (cardForm): the state before the day the history starts, which it names (ruling R20), and for the weapon event and the
 * chronicled wish the item charted and the Fate Points the game shows now (call 20). It opens with the focus in its
 * first field; Escape closes it unsaved, as Cancel does. A change the core refuses says why under it.
 */
function CorrectionForm({
  card,
  form,
  close,
}: {
  card: PityCard
  form: { correction: boolean; path: boolean }
  close: () => void
}) {
  const [before] = useState(() => draftOf(card))
  const [draft, setDraft] = useState(before)
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const change = (part: Partial<Draft>) => setDraft((now) => ({ ...now, ...part }))
  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    const body = changesOf(card, before, draft)
    if (body === null) {
      close()
      return
    }
    setBusy(true)
    try {
      await api.put('/api/pulls/settings', body)
      close()
    } catch (error) {
      setRefusal(messageOf(error))
      setBusy(false)
    }
  }
  const escape = (event: KeyboardEvent) => {
    // Not while a word is being composed, where Escape belongs to the input method.
    if (event.key !== 'Escape' || event.nativeEvent.isComposing) return
    event.stopPropagation()
    close()
  }
  return (
    <form className="pl-form" noValidate onSubmit={(event) => void save(event)} onKeyDown={escape}>
      {form.correction && (
        <label className="pl-field">
          {correctionLabel(card)}
          <input
            type="number"
            min={0}
            max={card.hard - 1}
            step={1}
            value={draft.pity}
            autoFocus
            onChange={(event) => change({ pity: event.target.value })}
          />
        </label>
      )}
      {form.correction && card.pool !== 'standard' && (
        <label className="pl-field">
          and the next 5★
          <select
            value={draft.guaranteed ? 'guaranteed' : 'not'}
            onChange={(event) => change({ guaranteed: event.target.value === 'guaranteed' })}
          >
            <option value="guaranteed">guaranteed</option>
            <option value="not">{card.pool === 'weapon' ? 'a 75/25' : 'a 50/50'}</option>
          </select>
        </label>
      )}
      {form.path && (
        <label className="pl-field">
          {card.pool === 'weapon' ? 'Charted weapon' : 'Path'}
          <input
            type="text"
            maxLength={80}
            value={draft.item}
            autoFocus={!form.correction}
            onChange={(event) => change({ item: event.target.value })}
          />
        </label>
      )}
      {form.path && (
        <label className="pl-field">
          Fate Points now
          <select value={draft.points} onChange={(event) => change({ points: event.target.value })}>
            <option value="0">0</option>
            <option value="1">1</option>
          </select>
        </label>
      )}
      <span className="pl-buttons">
        <button type="submit" className="gb-btn" aria-disabled={busy}>
          Save
        </button>
        <button type="button" className="gb-btn quiet" onClick={close}>
          Cancel
        </button>
      </span>
      <p className="pl-refused" role="alert">
        {refusal}
      </p>
    </form>
  )
}

/**
 * One wish's pity card (spec 2.2, the mockup's): the ring of its hard pity, filled to the pity and marked where soft
 * pity starts, with the count inside; the wishes to soft pity and to the next 4★; what the next 5★ is, on a seal (a
 * quiet one where the history cannot tell); the path; and Set…, which opens the card's form in it, where the form has
 * something to change (cardForm).
 */
function PityCardView({ card }: { card: PityCard }) {
  const [open, setOpen] = useState(false)
  const set = useRef<HTMLButtonElement>(null)
  const self = useRef<HTMLElement>(null)
  const refocus = useRef(false)
  const words = pityWords(card)
  const path = pathWords(card)
  const form = cardForm(card)
  const settled = form === null
  const close = () => {
    refocus.current = true
    setOpen(false)
  }
  // Set… is drawn again once the form has gone, and takes the focus back.
  useLayoutEffect(() => {
    if (open || !refocus.current) return
    refocus.current = false
    set.current?.focus()
  }, [open])
  // A correction taken away can leave a card its own history settles, with no Set… to hold the focus: the card takes it.
  const wasSettled = useRef(settled)
  useLayoutEffect(() => {
    const before = wasSettled.current
    wasSettled.current = settled
    if (settled && !before && document.activeElement === document.body) self.current?.focus()
  }, [settled])
  return (
    <section
      ref={self}
      className="gb-panel pl-pity"
      data-testid="pity-card"
      data-pool={card.pool}
      aria-label={cardLabel(card)}
      tabIndex={-1}
    >
      <h3 className="gb-h">{POOL_LABELS[card.pool]}</h3>
      <div className="pl-ring">
        <SegmentRing value={card.pity} max={card.hard} segment={0} mark={card.soft}>
          <span className={card.known ? 'pl-num' : 'pl-num least'}>{words.number}</span>{' '}
          <span className="pl-of">{words.of}</span>
        </SegmentRing>
      </div>
      <p className="pl-soft">{words.soft}</p>
      <p className="pl-soft">{words.four}</p>
      {words.tag !== null && <Seal quiet={words.tag === GUARANTEE_NOT_KNOWN}>{words.tag}</Seal>}
      {path !== null && <p className="pl-path">{path}</p>}
      {form !== null &&
        (open ? (
          <CorrectionForm card={card} form={form} close={close} />
        ) : (
          <button ref={set} type="button" className="gb-btn quiet pl-set" onClick={() => setOpen(true)}>
            Set…
          </button>
        ))}
    </section>
  )
}

/** The four pity cards of spec 2.2, in a row, in the core's order, under a heading of their own for screen readers. */
export function PityCards({ cards }: { cards: readonly PityCard[] }) {
  const titleId = useId()
  return (
    <section aria-labelledby={titleId}>
      <h2 id={titleId} className="sr-only">
        Pity
      </h2>
      <div className="pl-cards">
        {cards.map((card) => (
          <PityCardView key={card.pool} card={card} />
        ))}
      </div>
    </section>
  )
}
