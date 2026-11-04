import { type ReactNode, type RefObject, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { api, messageOf } from '../api.ts'
import { localDay } from '../format.ts'
import type { Pulls, WishChoice, WishChoices, WishKind } from '../types.ts'
import { Picture } from '../ui/Picture.tsx'
import { Segmented } from '../ui/Segmented.tsx'
import {
  bannersBudget,
  dayOf,
  planReason,
  plannerName,
  plannerWhen,
  POOL_LABELS,
  verdict,
  wishReason,
  wishWhen,
} from './pullsview.ts'

/** The most copies an entry takes (MAX_COPIES of pulls/planner.py). */
const MAX_COPIES = 7

/**
 * A featured 5★'s verdict (the planner's light update): the chip, what it rests on, and a bar of the chance, green once it
 * is certain.
 */
function Verdict({
  entry,
  reason,
}: {
  entry: { chance: number; certain_within: number | null; pulls_by_then: number }
  reason: string
}) {
  const { tone, label } = verdict(entry)
  const width = tone === 'certain' ? 1 : Math.max(0, Math.min(1, entry.chance))
  return (
    <span className="pl-verdict">
      <span className={`pl-chip ${tone}`}>{label}</span>
      <span className="pl-why">{reason}</span>
      <span className="pl-bar" aria-hidden="true">
        <i className={tone} style={{ width: `${width * 100}%` }} />
      </span>
    </span>
  )
}

/** One row of the planner: a face, the name over its day, and on the right its verdict and, on the wishlist, Remove. */
function Row({
  icon,
  kind,
  name,
  tag,
  when,
  right,
  remove,
  testId,
}: {
  icon: string | null
  kind: WishKind
  name: string
  tag?: ReactNode
  when: string
  right: ReactNode
  remove?: ReactNode
  testId?: string
}) {
  return (
    <li className="pl-item" data-testid={testId}>
      <Picture src={icon} sign={kind === 'weapon' ? 'gem' : 'person'} className="pl-face" />
      <span className="pl-who">
        <span className="pl-title">
          <b>{name}</b>
          {tag}
        </span>
        <span className="pl-when">{when}</span>
      </span>
      {right}
      {remove ?? <span aria-hidden="true" />}
    </li>
  )
}

/**
 * The wishlist (spec 2.5): each entry with its face, its day and its verdict in the chain, and Remove; then Add a wish. A
 * removed entry's Remove hands the focus to the next entry's, or to Add a wish after the last. The planner takes the height
 * of the ledger beside it (the second pass, spec 3.4): the room the card has over its rows is shared by all of them, the
 * banners' and these, one share for each row, so that no band of nothing lies between them; the entries scroll, with the
 * widgets' fade, when they are more than the card holds, and the foot keeps the bottom of the card.
 */
function Wishlist({ model, add, addRef }: { model: Pulls; add: () => void; addRef: RefObject<HTMLButtonElement | null> }) {
  const [refusal, setRefusal] = useState<string | null>(null)
  const list = useRef<HTMLUListElement>(null)
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
    ;(next ?? addRef.current)?.focus()
  }, [model.wishlist, addRef])
  return (
    // The rows keep their own height; the card's spare room goes to a dashed place under the last entry, which opens Add a
    // wish as the button at the foot does (a pointer's shortcut: the keyboard has the button), so no band of nothing lies
    // between the rows and the foot.
    <div className="pl-wishlist" data-testid="pulls-wishlist">
      <p className="pl-group">Your wishlist</p>
      <div className="pl-wishes w-scroll" data-testid="wishes-scroll">
        {model.wishlist.length > 0 && (
          <ul ref={list} className="pl-list">
            {model.wishlist.map((entry) => (
              <Row
                key={entry.id}
                icon={entry.icon}
                kind={entry.kind}
                name={entry.name}
                tag={entry.soon ? <span className="pl-tag">not out yet</span> : undefined}
                when={wishWhen(entry)}
                right={entry.rank >= 5 ? <Verdict entry={entry} reason={wishReason(entry)} /> : <span />}
                remove={
                  <button
                    type="button"
                    className="pl-remove"
                    data-entry={entry.id}
                    aria-label={`Remove ${entry.name}`}
                    title="Remove"
                    onClick={() => void remove(entry.id)}
                  >
                    ×
                  </button>
                }
              />
            ))}
          </ul>
        )}
        <button type="button" className="pl-filler" data-testid="wishes-filler" tabIndex={-1} aria-hidden="true" onClick={add}>
          <span>{model.wishlist.length === 0 ? 'Add the characters you are saving for, with a rough date.' : '+ Add a wish'}</span>
        </button>
      </div>
      <div className="pl-wishfoot" data-testid="wishes-foot">
        <span className="pl-key">
          Certain: enough pulls even at hard pity. Likely from 60%, Maybe from 25%, Unlikely below.
        </span>
        <button ref={addRef} type="button" className="gb-btn" onClick={add}>
          + Add a wish
        </button>
        <p className="pl-refused" role="alert">
          {refusal}
        </p>
      </div>
    </div>
  )
}

const KINDS: readonly { value: WishKind; label: string }[] = [
  { value: 'character', label: 'Characters' },
  { value: 'weapon', label: 'Weapons' },
]

const GROUP_NAMES: Record<WishChoice['group'], string> = {
  soon: 'Coming soon',
  now: 'On the banners now',
  five: 'Every 5★',
  four: 'Every 4★',
}

/** Under a choice's name: "not out yet" for one coming soon, "until 24 Nov" for one on a banner now. */
function choiceNote(choice: WishChoice): string {
  if (choice.group === 'soon') return 'not out yet'
  return choice.ends_at === null ? '' : `until ${localDay(choice.ends_at)}`
}

/**
 * Add a wish (the planner's light update): the characters or the weapons to pick, by their faces, in their groups, with a
 * search; a name the lists lack can be added as typed. A pick asks for its day, the end of its banner when it is on one, and
 * its copies, then Add. Cancel, or Escape, goes back to the planner.
 */
function WishPicker({ done }: { done: () => void }) {
  const [choices, setChoices] = useState<WishChoices | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [kind, setKind] = useState<WishKind>('character')
  const [query, setQuery] = useState('')
  const [chosen, setChosen] = useState<{ name: string; kind: WishKind } | null>(null)
  const [about, setAbout] = useState('')
  const [copies, setCopies] = useState(1)
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const search = useRef<HTMLInputElement>(null)
  const dayField = useRef<HTMLInputElement>(null)
  useEffect(() => {
    let live = true
    api
      .get<WishChoices>('/api/pulls/choices')
      .then((answer) => live && setChoices(answer))
      .catch((error: unknown) => live && setFailed(messageOf(error)))
    search.current?.focus()
    return () => {
      live = false
    }
  }, [])
  const shown = useMemo(() => {
    const all = choices === null ? [] : kind === 'weapon' ? choices.weapons : choices.characters
    const wanted = query.trim().toLocaleLowerCase()
    return wanted === '' ? all : all.filter((choice) => choice.name.toLocaleLowerCase().includes(wanted))
  }, [choices, kind, query])
  const pick = (name: string, pickedKind: WishKind, endsAt: string | null) => {
    setChosen({ name, kind: pickedKind })
    setAbout(endsAt === null ? '' : dayOf(new Date(endsAt)))
    setCopies(1)
    setRefusal(null)
    requestAnimationFrame(() => dayField.current?.focus())
  }
  const add = async () => {
    if (busy || chosen === null) return
    setBusy(true)
    try {
      await api.post('/api/pulls/wishlist', { name: chosen.name, kind: chosen.kind, about, copies })
      done()
    } catch (error) {
      setRefusal(messageOf(error))
      setBusy(false)
    }
  }
  const typed = query.trim()
  return (
    <div
      className="pl-picker"
      data-testid="wish-picker"
      role="group"
      aria-label="Add a wish"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.nativeEvent.isComposing) return
        event.preventDefault()
        done()
      }}
    >
      <div className="pl-pickhead">
        <Segmented label="Characters or weapons" options={KINDS} value={kind} onChange={setKind} />
        <input
          ref={search}
          type="search"
          className="pl-search"
          aria-label="Search by name"
          placeholder="Search by name…"
          maxLength={80}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="pl-choices w-scroll" data-testid="wish-choices">
        {failed !== null && <p className="pl-refused">{failed}</p>}
        {choices !== null &&
          (['soon', 'now', 'five', 'four'] as const).map((group) => {
            const members = shown.filter((choice) => choice.group === group)
            if (members.length === 0) return null
            return (
              <section key={group} className="pl-choicegroup" aria-label={GROUP_NAMES[group]}>
                <p className="pl-group">{GROUP_NAMES[group]}</p>
                <div className="pl-faces">
                  {members.map((choice) => {
                    const on = chosen?.name === choice.name && chosen.kind === choice.kind
                    return (
                      <button
                        key={choice.name}
                        type="button"
                        className={on ? 'pl-cell on' : 'pl-cell'}
                        aria-pressed={on}
                        onClick={() => pick(choice.name, choice.kind, choice.ends_at)}
                      >
                        <Picture
                          src={choice.icon}
                          sign={choice.kind === 'weapon' ? 'gem' : 'person'}
                          className={choice.group === 'soon' ? 'pl-face soon' : 'pl-face'}
                          lazy
                        />
                        <span className="pl-cellname">{choice.name}</span>
                        <span className="pl-cellnote">{choiceNote(choice)}</span>
                      </button>
                    )
                  })}
                </div>
              </section>
            )
          })}
        {choices !== null && shown.length === 0 && typed !== '' && (
          <p className="pl-astyped">
            <span className="pl-muted">No {kind === 'weapon' ? 'weapon' : 'character'} by that name. </span>
            <button type="button" className="gb-link" onClick={() => pick(typed, kind, null)}>
              Add “{typed}” as typed
            </button>
          </p>
        )}
      </div>
      <div className="pl-choose">
        <b className="pl-chosen">{chosen === null ? 'Pick a face above' : chosen.name}</b>
        <label className="pl-field">
          About when
          <input ref={dayField} type="date" value={about} onChange={(event) => setAbout(event.target.value)} />
        </label>
        <span className="pl-field">
          Copies
          <span className="pl-step" role="group" aria-label="Copies">
            <button
              type="button"
              aria-label="One copy fewer"
              aria-disabled={copies <= 1}
              onClick={() => setCopies((count) => Math.max(1, count - 1))}
            >
              −
            </button>
            <output aria-live="polite">{copies}</output>
            <button
              type="button"
              aria-label="One copy more"
              aria-disabled={copies >= MAX_COPIES}
              onClick={() => setCopies((count) => Math.min(MAX_COPIES, count + 1))}
            >
              +
            </button>
          </span>
        </span>
        <span className="pl-buttons">
          <button type="button" className="gb-btn" aria-disabled={busy || chosen === null} onClick={() => void add()}>
            Add
          </button>
          <button type="button" className="gb-btn quiet" onClick={done}>
            Cancel
          </button>
        </span>
        <p className="pl-refused" role="alert">
          {refusal}
        </p>
      </div>
    </div>
  )
}

/**
 * The planner (spec 2.5, the light update): each running banner's featured 5★, with the icon the model gives it, and its
 * verdict by the banner's end; then the wishlist; or, after Add a wish, the picker in their place.
 */
export function Planner({ model }: { model: Pulls }) {
  const titleId = useId()
  const [picking, setPicking] = useState(false)
  const addRef = useRef<HTMLButtonElement>(null)
  const back = useRef(false)
  useEffect(() => {
    if (picking || !back.current) return
    back.current = false
    addRef.current?.focus() // Cancel, Escape or Add hands the focus back to Add a wish
  }, [picking])
  const budget = bannersBudget(model.planner)
  return (
    <section className="gb-panel pl-planner" data-testid="pulls-planner" aria-labelledby={titleId}>
      <h2 id={titleId} className="gb-h">
        {picking ? 'Add a wish' : 'Planner'}
      </h2>
      {picking ? (
        <WishPicker
          done={() => {
            back.current = true
            setPicking(false)
          }}
        />
      ) : (
        <>
          {model.planner.length > 0 && (
            <>
              <p className="pl-group">
                On the banners now {budget !== '' && <span className="pl-muted">{budget}</span>}
              </p>
              <ul className="pl-list pl-plans">
                {model.planner.map((entry) => {
                  const kind: WishKind = entry.banner.pool === 'weapon' ? 'weapon' : 'character'
                  return (
                    <Row
                      key={entry.banner.ann_id}
                      testId="plan"
                      icon={entry.icon}
                      kind={kind}
                      name={plannerName(entry, model.pity)}
                      tag={<span className="pl-pool">{POOL_LABELS[entry.banner.pool as keyof typeof POOL_LABELS] ?? ''}</span>}
                      when={plannerWhen(entry.banner)}
                      right={<Verdict entry={entry} reason={planReason(entry)} />}
                    />
                  )
                })}
              </ul>
            </>
          )}
          <Wishlist model={model} add={() => setPicking(true)} addRef={addRef} />
        </>
      )}
    </section>
  )
}
