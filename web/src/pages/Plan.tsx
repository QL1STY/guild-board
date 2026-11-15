import { useEffect, useRef, useState } from 'react'
import '../styles/plan.css'
import { api, messageOf } from '../api.ts'
import { Frame } from '../frame/Frame.tsx'
import type { Live } from '../live.ts'
import { hashOf } from '../route.ts'
import type { PlanModel, PlanRow } from '../types.ts'
import { Picture } from '../ui/Picture.tsx'
import { Sign, type SignName } from '../ui/Sign.tsx'
import { NO_MATCH } from './characters/words.ts'
import {
  bossLine, DAY_HEADS, dayName, idleCards, idleEmpty, nextLine, notReadNote, searchAddable, summaryLine, tagsOf, turnsLine, weaponLine, weaponSub, withKey,
  withoutKey,
} from './planview.ts'
import { usePlanModel } from './useplan.ts'

/** The most the addable list shows before it needs a search box. */
const SEARCH_FROM = 12

type Who = { key: string; name: string; icon: string | null }

/** A character's face, with her name always beside it. */
function Face({ who, size }: { who: Who; size?: 'large' }) {
  return <Picture src={who.icon} sign="bust" className={size === 'large' ? 'pln-face large' : 'pln-face'} />
}

/** A press on a character opens her planner. */
const plannerHash = (key: string): string => hashOf({ page: 'characters', view: 'plan', key })

/** A material's picture, over the drawn sign that stands in for it while the art cache has none. */
function Material({ icon, sign }: { icon: string | null; sign: SignName }) {
  return <Picture src={icon} sign={sign} className="pln-mat" />
}

/** One open series in a Today card: its picture, its name, what it is for, and the faces of the characters who need it. */
function TodayRow({ icon, sign, title, sub, who }: { icon: string | null; sign: SignName; title: string; sub: string; who: Who[] }) {
  return (
    <li className="pln-row">
      <Material icon={icon} sign={sign} />
      <div>
        <b>{title}</b>
        <small>{sub}</small>
        <div className="pln-faces">
          {who.map((one) => (
            <a key={one.key} href={plannerHash(one.key)} title={one.name} aria-label={`${one.name}, planner`}>
              <Face who={one} />
            </a>
          ))}
        </div>
      </div>
    </li>
  )
}

function Today({ plan, whoOf }: { plan: PlanModel; whoOf: (key: string) => Who }) {
  const names = (keys: string[]) => keys.map((key) => whoOf(key).name).join(', ')
  return (
    <div className="pln-today" data-testid="plan-today">
      <section className="pln-t" aria-label="Talent books open today">
        <h3>Talent books open today</h3>
        {plan.books.length === 0 ? (
          <p className="pln-none">No planned character&apos;s book is open today.</p>
        ) : (
          <ul className="pln-list">
            {plan.books.map((book) => (
              <TodayRow key={book.series} icon={book.icon} sign="book" title={`Teachings of ${book.series}`} sub={names(book.who)} who={book.who.map(whoOf)} />
            ))}
          </ul>
        )}
      </section>
      <section className="pln-t" aria-label="Weapon materials open today">
        <h3>Weapon materials open today</h3>
        {plan.weapons.length === 0 ? (
          <p className="pln-none">No planned weapon&apos;s material is open today.</p>
        ) : (
          <ul className="pln-list">
            {plan.weapons.map((weapon) => (
              <TodayRow key={weapon.series} icon={weapon.icon} sign="sword" title={weapon.series} sub={weaponSub(names(weapon.who), weapon.weapons)} who={weapon.who.map(whoOf)} />
            ))}
          </ul>
        )}
      </section>
      <section className="pln-t" aria-label="Nothing open today">
        <h3>Nothing open today</h3>
        {idleEmpty(plan) !== null ? (
          <p className="pln-none">{idleEmpty(plan)}</p>
        ) : (
          <ul className="pln-list">
            {idleCards(plan).map((one) => {
              const who = whoOf(one.key)
              return (
                <li key={one.key} className="pln-row">
                  <a href={plannerHash(one.key)} aria-label={`${who.name}, planner`}>
                    <Face who={who} size="large" />
                  </a>
                  <div>
                    <b>{who.name}</b>
                    <small>{nextLine(one)}</small>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}

/** One planned character's row of the week: her, a button to take her off, and what is open for her each day. */
function GridRow({ row, today, onDrop, busy }: { row: PlanRow; today: number; onDrop: (key: string) => void; busy: boolean }) {
  const note = notReadNote(row)
  return (
    <div className="pln-tr" role="row" data-key={row.key}>
      <div className="pln-who" role="rowheader">
        <a className="pln-who-link" href={plannerHash(row.key)}>
          <Face who={row} size="large" />
          <span className="pln-who-text">
            <b>{row.name}</b>
            <small>{weaponLine(row)}</small>
            {note !== null && <small className="pln-unread">{note}</small>}
          </span>
        </a>
        <button type="button" className="pln-x" aria-label={`Take ${row.name} off the plan`} title="Take off the plan" disabled={busy} onClick={() => onDrop(row.key)}>
          <Sign name="cross" />
        </button>
      </div>
      {DAY_HEADS.map((head, day) => (
        <div key={head} className={day === today ? 'pln-c now' : 'pln-c'} role="cell" aria-label={day === today ? `${dayName(day)}, today` : dayName(day)}>
          {tagsOf(row, day).map((tag) => (
            <span key={tag.kind} className="pln-tag" title={tag.kind === 'book' ? `Teachings of ${tag.series}` : `${tag.series} weapon material`}>
              <Picture src={tag.icon} sign={tag.kind === 'book' ? 'book' : 'sword'} className="pln-tag-pic" />
              {tag.series}
            </span>
          ))}
        </div>
      ))}
    </div>
  )
}

function Week({ plan, onDrop, onAdd, refusal, busy }: { plan: PlanModel; onDrop: (key: string) => void; onAdd: (key: string) => void; refusal: string | null; busy: boolean }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const sheet = useRef<HTMLDivElement>(null)
  const found = searchAddable(plan.addable, search)
  // The sheet opens with the pictures of the characters who can still be added.
  useEffect(() => {
    if (open) sheet.current?.querySelector<HTMLElement>('input, button')?.focus({ preventScroll: true })
  }, [open])
  return (
    <section className="pln-panel gb-panel" aria-label="The week">
      <h3 className="pln-h">The week</h3>
      {plan.rows.length > 0 && (
        <div className="pln-scroll">
          <div className="pln-grid" role="table" aria-label="Talent books and weapon materials, by day" data-testid="plan-grid">
            <div className="pln-tr pln-head" role="row">
              <div className="pln-corner" role="columnheader" aria-label="Character" />
              {DAY_HEADS.map((head, day) => (
                <div key={head} className={day === plan.weekday ? 'pln-h-day now' : 'pln-h-day'} role="columnheader" aria-label={dayName(day)}>
                  {head}
                </div>
              ))}
            </div>
            {plan.rows.map((row) => (
              <GridRow key={row.key} row={row} today={plan.weekday} onDrop={onDrop} busy={busy} />
            ))}
          </div>
        </div>
      )}
      <div className="pln-foot">
        <button type="button" className="pln-btn" aria-expanded={open} aria-controls="plan-sheet" onClick={() => setOpen((on) => !on)}>
          Add a character
        </button>
        <span className="pln-note">
          {plan.rows.length === 0 ? 'Choose the characters you plan for.' : 'The green column is today. Sunday opens every domain.'}
        </span>
        {refusal !== null && (
          <span className="pln-refusal" role="status">
            {refusal}
          </span>
        )}
      </div>
      {open && (
        <div className="pln-sheet" id="plan-sheet" ref={sheet} data-testid="plan-sheet" onKeyDown={(event) => event.key === 'Escape' && setOpen(false)}>
          {plan.addable.length > SEARCH_FROM && (
            <input
              type="text"
              className="pln-find"
              value={search}
              placeholder="Search by name"
              aria-label="Search characters to add"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setSearch(event.target.value)}
            />
          )}
          <div className="pln-pills">
            {found.map((one) => (
              <button key={one.key} type="button" className="pln-pill" disabled={busy} onClick={() => onAdd(one.key)}>
                <Face who={one} />
                {one.name}
              </button>
            ))}
            {plan.addable.length === 0 && <span className="pln-none">Everyone is in the plan.</span>}
            {plan.addable.length > 0 && found.length === 0 && <span className="pln-none">{NO_MATCH}</span>}
          </div>
        </div>
      )}
    </section>
  )
}

function Bosses({ plan, whoOf }: { plan: PlanModel; whoOf: (key: string) => Who }) {
  return (
    <section className="pln-panel gb-panel" aria-label="Weekly bosses">
      <h3 className="pln-h">Weekly bosses</h3>
      <div className="pln-boss" data-testid="plan-bosses">
        {plan.weekly.map((boss) => (
          <span key={boss.material} className="pln-b">
            <Picture src={boss.icon} sign="boss" className="pln-b-pic" />
            {boss.material} <small>· {boss.who.map((key) => whoOf(key).name).join(', ')}</small>
          </span>
        ))}
        {plan.weekly.length === 0 && <span className="pln-none">{plan.count === 0 ? 'No weekly boss material to show until you add a character.' : 'No weekly boss material is read from the wiki yet.'}</span>}
        <span className="pln-end">{bossLine(plan)}</span>
      </div>
    </section>
  )
}

/**
 * The Plan page (the Plan design, section 4): what is open today for the planned characters, the week as a grid, and the
 * weekly bosses. The planned list is changed here alone: "Add a character" and the × of a row, each a `PUT` whose answer is the
 * page's new model.
 */
export function Plan({ live }: { live: Live }) {
  const { data, error } = usePlanModel(live, live.version)
  // What the core answered to a change, until a newer read of the page takes over.
  const [answer, setAnswer] = useState<{ base: PlanModel; plan: PlanModel } | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const plan = data === null ? null : answer !== null && answer.base === data ? answer.plan : data

  const change = async (keys: string[]) => {
    if (data === null) return
    setBusy(true)
    try {
      const next = await api.put<PlanModel>('/api/plan/characters', { characters: keys })
      setAnswer({ base: data, plan: next })
      setRefusal(null)
    } catch (failure) {
      setRefusal(messageOf(failure))
    } finally {
      setBusy(false)
    }
  }

  const known = new Map<string, Who>()
  if (plan !== null) for (const one of [...plan.addable, ...plan.rows]) known.set(one.key, one)
  const whoOf = (key: string): Who => known.get(key) ?? { key, name: key, icon: null }
  const keys = plan === null ? [] : plan.rows.map((row) => row.key)

  return (
    <Frame page="plan" live={live}>
      {plan === null ? (
        <div className="gb-panel gb-empty">{error ?? 'Reading your plan…'}</div>
      ) : (
        <div className="gb-page pln">
          <section className="pln-panel gb-panel" aria-label="Today">
            <div className="pln-day">
              <h2>{dayName(plan.weekday)}</h2>
              <span>{summaryLine(plan)}</span>
              <span className="pln-end">{turnsLine(plan.turns_at, live.now())}</span>
            </div>
            {plan.count === 0 ? (
              <p className="pln-none">
                Nobody is in the plan yet. Add the characters you plan for, and this page shows when their talent books and weapon materials are open.
              </p>
            ) : (
              <Today plan={plan} whoOf={whoOf} />
            )}
          </section>
          <Week plan={plan} busy={busy} refusal={refusal} onDrop={(key) => void change(withoutKey(keys, key))} onAdd={(key) => void change(withKey(keys, key))} />
          <Bosses plan={plan} whoOf={whoOf} />
        </div>
      )}
    </Frame>
  )
}
