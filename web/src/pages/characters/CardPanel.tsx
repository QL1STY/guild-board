import { type ReactNode, useEffect, useId, useRef, useState } from 'react'
import './card.css'
import { api, messageOf } from '../../api.ts'
import { type Live, useModel } from '../../live.ts'
import type { Element, Profile, Slot, Weight } from '../../types.ts'
import { Segmented } from '../../ui/Segmented.tsx'
import { Sign } from '../../ui/Sign.tsx'
import { Switch } from '../../ui/Switch.tsx'
import {
  addItem, backBody, type CardExtra, type CardFieldName, type CardFields, cardPath, checkedLine, editBody, fieldIsYours,
  GROUPS, goalBody, goalRows, type Group, groupYours, moveItem, PRONOUN_PRESETS, pronounsIndex, removeItem, ROLES, roleToggle, setChoice,
} from './cardview.ts'
import { ELEMENTS } from './elements.ts'
import { nextWeight, mainOptions, statLabel } from './plannerview.ts'

const WEIGHT_WORDS: Record<Weight, string> = { wants: 'Wants', some: 'Some use', none: 'No use' }
const TALENTS = [
  { value: 'normal', label: 'Normal Attack' },
  { value: 'skill', label: 'Elemental Skill' },
  { value: 'burst', label: 'Elemental Burst' },
] as const
const SCALING = [
  { value: 'atk', label: 'ATK' },
  { value: 'hp', label: 'HP' },
  { value: 'def', label: 'DEF' },
  { value: 'em', label: 'Elemental Mastery' },
] as const
const SLOTS: readonly { key: 'sands' | 'goblet' | 'circlet'; label: string }[] = [
  { key: 'sands', label: 'Sands' },
  { key: 'goblet', label: 'Goblet' },
  { key: 'circlet', label: 'Circlet' },
]
/** What a group of one field says beside its heading: its lists are in the card's order. */
const HINTS: Partial<Record<Group['key'], string>> = { mains: 'best first', sets: 'best first', weapons: 'best first' }
const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/** One field of the card: its name, its control, and, when the player edited it, "yours" and its own "Back to the card". */
function Field({ name, field, edited, onBack, children }: { name: string; field: CardFieldName; edited: readonly string[]; onBack: (field: CardFieldName) => void; children: ReactNode }) {
  const yours = fieldIsYours(edited, field)
  return (
    <div className="cp-field" data-field={field}>
      <div className="cp-fname">
        <b>{name}</b>
        {yours && <span className="cp-yours">yours</span>}
        {yours && (
          <button type="button" className="cp-back" onClick={() => onBack(field)}>
            Back to the card
          </button>
        )}
      </div>
      <div className="cp-ctl">{children}</div>
    </div>
  )
}

/** An ordered list that moves, loses and gains items: the card's choices, best first. */
function Ordered({
  items, label, onChange, add, none, what,
}: {
  items: readonly string[]
  label: (item: string) => string
  onChange: (next: string[]) => void
  add: { key: string; label: string }[]
  none: string
  what: string
}) {
  const [pick, setPick] = useState('')
  const free = add.filter((option) => !items.includes(option.key))
  return (
    <div className="cp-list">
      {items.length === 0 && <p className="cp-none">{none}</p>}
      {items.map((item, index) => (
        <div key={item} className="cp-item">
          <span className="cp-n">{index + 1}</span>
          <span className="cp-label">{label(item)}</span>
          <button type="button" className="cp-mini" aria-label={`Move ${label(item)} earlier`} disabled={index === 0} onClick={() => onChange(moveItem(items, index, -1))}>
            <span className="up">
              <Sign name="chevron" />
            </span>
          </button>
          <button type="button" className="cp-mini" aria-label={`Move ${label(item)} later`} disabled={index === items.length - 1} onClick={() => onChange(moveItem(items, index, 1))}>
            <Sign name="chevron" />
          </button>
          <button type="button" className="cp-mini" aria-label={`Take ${label(item)} out`} onClick={() => onChange(removeItem(items, item))}>
            <Sign name="cross" />
          </button>
        </div>
      ))}
      {free.length > 0 && (
        <div className="cp-add">
          <select aria-label={`Add ${what}`} value={pick} onChange={(event) => setPick(event.target.value)}>
            <option value="">Add {what}…</option>
            {free.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="gb-btn quiet"
            disabled={pick === ''}
            onClick={() => {
              onChange(addItem(items, pick))
              setPick('')
            }}
          >
            Add
          </button>
        </div>
      )}
    </div>
  )
}

/** A set of toggles: each one pressed or not, as a chip with its name. */
function Chips({ options, on, onToggle }: { options: readonly { key: string; label: string }[]; on: readonly string[]; onToggle: (key: string) => void }) {
  return (
    <div className="cp-chips">
      {options.map((option) => (
        <button key={option.key} type="button" className="cp-chip" aria-pressed={on.includes(option.key)} onClick={() => onToggle(option.key)}>
          {option.label}
        </button>
      ))}
    </div>
  )
}

/** A goal's box: it takes what is typed when the player leaves it or presses Enter, and says when it is not a number. */
function GoalBox({ row, onSet }: { row: ReturnType<typeof goalRows>[number]; onSet: (text: string) => boolean }) {
  const [text, setText] = useState(row.text)
  const [bad, setBad] = useState(false)
  useEffect(() => setText(row.text), [row.text])
  const commit = () => {
    if (text === row.text) return
    const ok = onSet(text)
    setBad(!ok)
    if (!ok) setText(row.text)
  }
  return (
    <label className="cp-goal">
      <span>{row.label}</span>
      <input
        inputMode="decimal"
        value={text}
        aria-invalid={bad}
        placeholder="none"
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit()
        }}
      />
      <em>{row.unit}</em>
    </label>
  )
}

/** The panel's body: every group of the card, with the card's own words last. Everything it shows comes from `profile.card`. */
export function CardBody({
  profile, card, onEdit, onBack,
}: {
  profile: Profile
  card: CardExtra
  onEdit: (body: Record<string, unknown>) => void
  onBack: (field: CardFieldName) => void
}) {
  const fields = card.fields
  const edited = profile.card.edited
  const weaponName = (key: string) => card.options.weapons.find((one) => one.key === key)?.name ?? key
  const setName = (key: string) => card.options.sets.find((one) => one.key === key)?.name ?? key
  const set = <F extends CardFieldName>(field: F, value: CardFields[F]) => onEdit(editBody(field, value))
  // A group of one field has no second heading: its control stands under the group's own, which carries "yours" and the way back.
  const field = (name: string, key: CardFieldName, children: ReactNode) =>
    GROUPS.some((group) => group.fields.length === 1 && group.fields[0] === key) ? (
      <div className="cp-field solo" data-field={key}>
        <div className="cp-ctl">{children}</div>
      </div>
    ) : (
      <Field name={name} field={key} edited={edited} onBack={onBack}>
        {children}
      </Field>
    )
  const body: Record<Group['key'], ReactNode> = {
    role: (
      <>
        {field(
          'Roles',
          'roles',
          <Chips options={ROLES.map((role) => ({ key: role, label: cap(role) }))} on={fields.roles} onToggle={(role) => set('roles', roleToggle(fields.roles, role))} />,
        )}
        {field(
          'Keeps the team alive',
          'keeps_alive',
          <Switch on={fields.keeps_alive} onPress={() => set('keeps_alive', !fields.keeps_alive)}>
            {fields.keeps_alive ? 'Yes' : 'No'}
          </Switch>,
        )}
        {field('Scaling stat', 'scaling', <Segmented label="Scaling stat" options={SCALING} value={fields.scaling} onChange={(value) => set('scaling', value)} />)}
        {field('Damage talent', 'damage_talent', <Segmented label="Damage talent" options={TALENTS} value={fields.damage_talent} onChange={(value) => set('damage_talent', value)} />)}
        {field(
          'Talent order',
          'talent_priority',
          <Ordered
            items={fields.talent_priority}
            label={(item) => TALENTS.find((one) => one.value === item)?.label ?? item}
            onChange={(next) => set('talent_priority', next as CardFields['talent_priority'])}
            add={[]}
            none="No order."
            what="talent"
          />,
        )}
      </>
    ),
    goals: field(
      'Goals',
      'goals',
      <div className="cp-goals">
        {goalRows(fields).map((row) => (
          <GoalBox
            key={row.key}
            row={row}
            onSet={(text) => {
              const body = goalBody(row.key, text)
              if (body === null) return false
              onEdit(body)
              return true
            }}
          />
        ))}
      </div>,
    ),
    mains: field(
      'Main stats, best first',
      'mains',
      <div className="cp-slots">
        {SLOTS.map((slot) => (
          <div key={slot.key} className="cp-slot">
            <h4>{slot.label}</h4>
            <Ordered
              items={fields.mains[slot.key] ?? []}
              label={(item) => statLabel(item, profile.element)}
              onChange={(next) => set('mains', { ...fields.mains, [slot.key]: next })}
              add={mainOptions(slot.key as Slot, profile.element as Element).map((option) => ({ key: option.key, label: option.label }))}
              none="Any."
              what="a stat"
            />
          </div>
        ))}
      </div>,
    ),
    substats: field(
      'Substats',
      'weights',
      <div className="cp-weights">
        {Object.entries(fields.weights).map(([key, weight]) => (
          <div key={key} className="cp-weight">
            <span>{statLabel(key, profile.element)}</span>
            <button type="button" className="cp-wbtn" data-weight={weight} onClick={() => set('weights', { ...fields.weights, [key]: nextWeight(weight) })}>
              {WEIGHT_WORDS[weight]}
            </button>
          </div>
        ))}
      </div>,
    ),
    sets: field(
      'Sets, best first',
      'sets',
      <SetList sets={fields.sets} name={setName} options={card.options.sets} onChange={(next) => set('sets', next)} />,
    ),
    weapons: field(
      'Weapons, best first',
      'weapons',
      <Ordered
        items={fields.weapons}
        label={weaponName}
        onChange={(next) => set('weapons', next)}
        add={card.options.weapons.map((one) => ({ key: one.key, label: one.name }))}
        none="None chosen."
        what="a weapon"
      />,
    ),
    partners: (
      <>
        {field('Partner elements', 'partners', <Chips options={ELEMENTS.map((element) => ({ key: element, label: element }))} on={fields.partners} onToggle={(element) => set('partners', fields.partners.includes(element) ? removeItem(fields.partners, element) : addItem(fields.partners, element))} />)}
        {field('Partner roles', 'partner_roles', <Chips options={ROLES.map((role) => ({ key: role, label: cap(role) }))} on={fields.partner_roles} onToggle={(role) => set('partner_roles', fields.partner_roles.includes(role) ? removeItem(fields.partner_roles, role) : addItem(fields.partner_roles, role))} />)}
      </>
    ),
    pronouns: field(
      'Pronouns',
      'pronouns',
      <Segmented
        label="Pronouns"
        options={PRONOUN_PRESETS.map((preset, index) => ({ value: String(index), label: `${preset[0]} / ${preset[1]}` }))}
        value={String(pronounsIndex(fields.pronouns))}
        onChange={(value) => set('pronouns', [...PRONOUN_PRESETS[Number(value)]] as CardFields['pronouns'])}
      />,
    ),
  }
  return (
    <div className="cp-body">
      {GROUPS.map((group) => {
        const solo = group.fields.length === 1
        const yours = solo && groupYours(edited, group)
        return (
          <section key={group.key} className="cp-group" aria-label={group.label} data-group={group.key}>
            <div className="cp-ghead">
              <h3>{group.label}</h3>
              {HINTS[group.key] !== undefined && <span className="cp-hint">{HINTS[group.key]}</span>}
              {yours && <span className="cp-yours">yours</span>}
              {yours && (
                <button type="button" className="cp-back" onClick={() => onBack(group.fields[0])}>
                  Back to the card
                </button>
              )}
            </div>
            {body[group.key]}
          </section>
        )
      })}
      <section className="cp-group cp-says" aria-label="What the card says">
        <h3>What the card says</h3>
        <p>{card.notes === '' ? 'No notes.' : card.notes}</p>
        {card.sources.length > 0 && (
          <>
            <h4>Sources</h4>
            <ul>
              {card.sources.map((source) => (
                <li key={source}>{source}</li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  )
}

/** The card's sets: choices best first, each one set worn whole or two worn two and two, and a form to add one. */
function SetList({ sets, name, options, onChange }: { sets: CardFields['sets']; name: (key: string) => string; options: CardExtra['options']['sets']; onChange: (next: CardFields['sets']) => void }) {
  const [first, setFirst] = useState('')
  const [second, setSecond] = useState('')
  const line = (choice: CardFields['sets'][number]) => `${choice.pieces === '4' ? '4 pieces' : '2 and 2'}: ${choice.sets.map(name).join(', ')}`
  const lines = sets.map(line)
  return (
    <div className="cp-list">
      {sets.length === 0 && <p className="cp-none">No sets chosen.</p>}
      {sets.map((choice, index) => (
        <div key={choice.sets.join('+')} className="cp-item">
          <span className="cp-n">{index + 1}</span>
          <span className="cp-label">{lines[index]}</span>
          <button type="button" className="cp-mini" aria-label={`Move ${lines[index]} earlier`} disabled={index === 0} onClick={() => onChange(moveItem(sets, index, -1))}>
            <span className="up">
              <Sign name="chevron" />
            </span>
          </button>
          <button type="button" className="cp-mini" aria-label={`Move ${lines[index]} later`} disabled={index === sets.length - 1} onClick={() => onChange(moveItem(sets, index, 1))}>
            <Sign name="chevron" />
          </button>
          <button type="button" className="cp-mini" aria-label={`Take ${lines[index]} out`} onClick={() => onChange(sets.filter((one) => one !== choice))}>
            <Sign name="cross" />
          </button>
        </div>
      ))}
      <div className="cp-add">
        <select aria-label="Add a set" value={first} onChange={(event) => setFirst(event.target.value)}>
          <option value="">Add a set…</option>
          {options.map((option) => (
            <option key={option.key} value={option.key}>
              {option.name}
            </option>
          ))}
        </select>
        <select aria-label="And a second set, for 2 and 2" value={second} onChange={(event) => setSecond(event.target.value)}>
          <option value="">No second set</option>
          {options
            .filter((option) => option.key !== first)
            .map((option) => (
              <option key={option.key} value={option.key}>
                {option.name}
              </option>
            ))}
        </select>
        <button
          type="button"
          className="gb-btn quiet"
          disabled={first === ''}
          onClick={() => {
            const choice = setChoice(second === '' ? [first] : [first, second])
            if (!sets.some((one) => one.sets.join('+') === choice.sets.join('+'))) onChange([...sets, choice])
            setFirst('')
            setSecond('')
          }}
        >
          Add
        </button>
      </div>
    </div>
  )
}

/** The end of the panel: "Back to the card" for everything, while the player has edited anything (the design's section 6.7). */
export function CardFoot({ edited, onBackAll }: { edited: readonly string[]; onBackAll: () => void }) {
  if (edited.length === 0) return null
  return (
    <footer className="cp-foot">
      <button type="button" className="gb-btn quiet" onClick={onBackAll}>
        Back to the card
      </button>
    </footer>
  )
}

/**
 * The Card panel: a parchment window over the page, opened from a character's profile or planner. Each change is sent at
 * once, as the one field it changed, and the core's answer (the new profile) is what the panel then shows. Escape and a
 * click on the dim close it; the focus stays inside while it is open and goes back to where it was.
 */
export function CardPanel({ live, characterKey, onClose }: { live: Live; characterKey: string; onClose: () => void }) {
  const [bump, setBump] = useState(0)
  const { data, error } = useModel<Profile>(`/api/characters/${characterKey}`, live.version + bump)
  const [fresh, setFresh] = useState<{ base: Profile; profile: Profile } | null>(null)
  const profile = data === null ? null : fresh !== null && fresh.base === data ? fresh.profile : data
  const [problem, setProblem] = useState<string | null>(null)
  const dialog = useRef<HTMLElement>(null)
  const close = useRef<HTMLButtonElement>(null)
  const latest = useRef(onClose)
  latest.current = onClose
  const title = useId()

  useEffect(() => {
    const before = document.activeElement
    close.current?.focus({ preventScroll: true })
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.isComposing) {
        event.preventDefault()
        event.stopPropagation()
        latest.current()
      } else if (event.key === 'Tab' && dialog.current !== null) {
        const focusable = [...dialog.current.querySelectorAll<HTMLElement>('button:not(:disabled), select, input')]
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (!dialog.current.contains(document.activeElement)) {
          event.preventDefault()
          first?.focus()
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last?.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first?.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (before instanceof HTMLElement && before.isConnected) before.focus({ preventScroll: true })
    }
  }, [])

  const send = async (request: () => Promise<Profile>) => {
    try {
      const answer = await request()
      if (data !== null) setFresh({ base: data, profile: answer })
      setProblem(null)
    } catch (failure) {
      setProblem(messageOf(failure))
      setBump((count) => count + 1)
    }
  }
  const edit = (body: Record<string, unknown>) => void send(() => api.put<Profile>(cardPath(characterKey), body))
  const back = (field: CardFieldName) => edit(backBody(field))
  const backAll = () => void send(() => api.delete<Profile>(cardPath(characterKey)))

  const edited = profile === null ? [] : profile.card.edited
  return (
    <div className="cp-layer">
      <div className="cp-dim" data-testid="card-dim" onClick={onClose} />
      <div className="cp-wrap">
        <section ref={dialog} className="cp-panel" role="dialog" aria-modal="true" aria-labelledby={title} data-testid="card-panel">
          <header className="cp-head">
            <div>
              <h2 id={title}>{profile === null ? 'Card' : `${cap(profile.pronouns.hers)} card`}</h2>
              <p className="cp-sub">
                {profile === null ? '' : `${profile.name}. `}
                {profile === null ? '' : checkedLine(profile.card.checked, profile.card.confidence, profile.card.early)}
              </p>
            </div>
            <div className="cp-actions">
              <button ref={close} type="button" className="gb-btn" onClick={onClose}>
                Close
              </button>
            </div>
          </header>
          {problem !== null && (
            <p className="cp-problem" role="status">
              {problem}
            </p>
          )}
          {profile === null ? (
            <p className="cp-wait">{error ?? 'Reading the card…'}</p>
          ) : (
            <CardBody profile={profile} card={profile.card} onEdit={edit} onBack={back} />
          )}
          <CardFoot edited={edited} onBackAll={backAll} />
        </section>
      </div>
    </div>
  )
}
