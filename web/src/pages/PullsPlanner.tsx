import { type FormEvent, type RefObject, useId, useLayoutEffect, useRef, useState } from 'react'
import { api, messageOf } from '../api.ts'
import type { Pulls, WishKind } from '../types.ts'
import { Picture } from '../ui/Picture.tsx'
import { chanceWords, isCertain, plannerName, plannerWhen, typed, wishWhen } from './pullsview.ts'

/**
 * Add an entry to the wishlist (spec 2.5): its name, character or weapon, about when, and how many copies. The core
 * checks it and says why it refuses one, on the wishlist's line (`refuse`). `nameRef` is its Name field's.
 */
function WishForm({
  refuse,
  nameRef,
}: {
  refuse: (text: string | null) => void
  nameRef: RefObject<HTMLInputElement | null>
}) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<WishKind>('character')
  const [about, setAbout] = useState('')
  const [copies, setCopies] = useState('1')
  const [busy, setBusy] = useState(false)
  const add = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      await api.post('/api/pulls/wishlist', { name: name.trim(), kind, about, copies: typed(copies) })
      setName('')
      setAbout('')
      setCopies('1')
      refuse(null)
    } catch (error) {
      refuse(messageOf(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="pl-form pl-add" noValidate onSubmit={(event) => void add(event)}>
      <label className="pl-field">
        Name
        <input ref={nameRef} type="text" maxLength={80} value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <select
        className="pl-kind"
        aria-label="Character or weapon"
        value={kind}
        onChange={(event) => setKind(event.target.value === 'weapon' ? 'weapon' : 'character')}
      >
        <option value="character">Character</option>
        <option value="weapon">Weapon</option>
      </select>
      <label className="pl-field">
        About
        <input type="date" value={about} onChange={(event) => setAbout(event.target.value)} />
      </label>
      <label className="pl-field">
        Copies
        <input type="number" min={1} max={7} step={1} value={copies} onChange={(event) => setCopies(event.target.value)} />
      </label>
      <button type="submit" className="gb-btn" aria-disabled={busy}>
        Add
      </button>
    </form>
  )
}

/**
 * The wishlist (spec 2.5): each entry with its face, its day and its chance in the chain, and Remove; then the form. A
 * removed entry's Remove hands the focus to the next entry's, or to the Name field after the last. The planner takes the
 * height of the ledger beside it (the second pass, spec 3.4): the room the card has over its rows is shared by all of them,
 * the banners' and these, one share for each row, so that no band of nothing lies between them; the entries scroll, with
 * the widgets' fade, when they are more than the card holds, and the form keeps the foot of the card.
 */
function Wishlist({ model }: { model: Pulls }) {
  const [refusal, setRefusal] = useState<string | null>(null)
  const list = useRef<HTMLUListElement>(null)
  const name = useRef<HTMLInputElement>(null)
  // The entry being removed and the one after it, until the model read again leaves it out.
  const removing = useRef<{ removed: number; next: number | null } | null>(null)
  const remove = async (id: number) => {
    const at = model.wishlist.findIndex((entry) => entry.id === id)
    removing.current = { removed: id, next: model.wishlist[at + 1]?.id ?? null }
    try {
      await api.delete(`/api/pulls/wishlist/${id}`)
      setRefusal(null)
    } catch (error) {
      removing.current = null
      setRefusal(messageOf(error))
    }
  }
  useLayoutEffect(() => {
    const pending = removing.current
    if (pending === null || model.wishlist.some((entry) => entry.id === pending.removed)) return
    removing.current = null
    const next = pending.next === null ? null : list.current?.querySelector<HTMLElement>(`[data-entry="${pending.next}"]`)
    ;(next ?? name.current)?.focus()
  }, [model.wishlist])
  return (
    // The entries take a share of the card's spare room for each of them, as the banners do; the words that stand for
    // none count as one.
    <div className="pl-wishlist" data-testid="pulls-wishlist" style={{ flexGrow: Math.max(1, model.wishlist.length) }}>
      <div className="pl-wishes w-scroll" data-testid="wishes-scroll">
        {model.wishlist.length === 0 ? (
          <p className="pl-muted pl-hint">Add the characters you are saving for, with a rough date.</p>
        ) : (
          <ul ref={list} className="pl-list">
            {model.wishlist.map((entry) => (
              <li key={entry.id} className="pl-wish">
                <Picture src={entry.icon} sign={entry.kind === 'weapon' ? 'gem' : 'person'} className="pl-face" />
                <span className="pl-who">
                  <b>{entry.name}</b> <span className="pl-muted">· {wishWhen(entry)}</span>
                </span>
                <button
                  type="button"
                  className="gb-link"
                  data-entry={entry.id}
                  aria-label={`Remove ${entry.name}`}
                  onClick={() => void remove(entry.id)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="pl-wishfoot">
        <WishForm refuse={setRefusal} nameRef={name} />
        <p className="pl-refused" role="alert">
          {refusal}
        </p>
      </div>
    </div>
  )
}

/**
 * The planner (spec 2.5, the mockup's): each running banner's featured 5★, with the icon the model gives it, and its
 * chance by the banner's end, in the ready green where it is certain; then the wishlist.
 */
export function Planner({ model }: { model: Pulls }) {
  const titleId = useId()
  return (
    <section className="gb-panel pl-planner" data-testid="pulls-planner" aria-labelledby={titleId}>
      <h2 id={titleId} className="gb-h">
        Planner
      </h2>
      {model.planner.length > 0 && (
        <ul className="pl-list pl-plans" style={{ flexGrow: model.planner.length }}>
          {model.planner.map((entry) => {
            const name = plannerName(entry, model.pity)
            const kind: WishKind = entry.banner.pool === 'weapon' ? 'weapon' : 'character'
            const certain = isCertain(entry)
            return (
              <li key={entry.banner.ann_id} className="pl-plan" data-testid="plan">
                <Picture src={entry.icon} sign={kind === 'weapon' ? 'gem' : 'person'} className="pl-face" />
                <span className="pl-who">
                  <b>{name}</b> <span className="pl-muted">· {plannerWhen(entry.banner)}</span>
                </span>
                <span className={certain ? 'pl-chance good' : 'pl-chance'}>
                  {chanceWords(entry.chance, entry.certain_within, entry.pulls_by_then, entry.second)}
                </span>
              </li>
            )
          })}
        </ul>
      )}
      <Wishlist model={model} />
    </section>
  )
}
