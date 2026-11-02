import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import './planner.css'
import { api, messageOf } from '../../api.ts'
import { Frame } from '../../frame/Frame.tsx'
import { type Live, useModel } from '../../live.ts'
import { hashOf } from '../../route.ts'
import type { MaterialRow, PlanBody, Planner as PlannerModel, Roster, Slot } from '../../types.ts'
import { clipReveal, CountUp, drawLine, reducedMotion, rise, SPRING_EASE } from '../../ui/motion.tsx'
import { Picture } from '../../ui/Picture.tsx'
import { Sign } from '../../ui/Sign.tsx'
import { Avatar } from './Avatar.tsx'
import { elementClass } from './elements.ts'
import {
  changeClass, curveArea, curveMarks, curvePath, curveTicks, curveX, curveY, DAYS_BOX, dayWords, type Draft, draftBody,
  draftFromTyped, findOdds, floorsOf, mainChips, mainOptions, nextWeight, resinParts, setDraftSlot, setsShown, setKeyOf, signed, SLOTS, stepLevel,
  stepTarget, subOptionsFor, weaponsCardFirst, withLevelPiece, withMain, withSet, withTalent, withWeapon, withWeight,
} from './plannerview.ts'
import { weekShown } from './hidden.ts'
import { CardPanel } from './CardPanel.tsx'
import { agree, matWords, objectPronoun } from './profileview.ts'
import { scaleStyle, useCharactersScale } from './scale.ts'
import { toggleFocus } from './rosterview.ts'
import { CalculatorNote, SyncLine } from './SyncLine.tsx'
import { Tip, useTip } from './Tip.tsx'

const SLOT_LABEL: Record<Slot, string> = { flower: 'Flower', plume: 'Plume', sands: 'Sands', goblet: 'Goblet', circlet: 'Circlet' }
const cap = (word: string) => word.charAt(0).toUpperCase() + word.slice(1)

/** A talent's own name without the line of its group: "Self-Evident Proposition" for "Formule Phenomenale: Self-Evident Proposition". */
const shortName = (name: string) => (name.includes(': ') ? name.slice(name.indexOf(': ') + 2) : name)

/** Text in which the labels of a set's bonuses ("2 pieces:", "2 and 2:") are bold. */
function withBoldLabels(text: string): ReactNode {
  return text.split(/(\d pieces:|2 and 2:)/).map((part, index) => (index % 2 === 1 ? <b key={index}>{part}</b> : part))
}

/** The sentence of the days curve with its half-a-chance date in bold. */
function emphasised(summary: string): ReactNode {
  return summary.split(/(half a chance by [^,]+|She is ready [a-z]+)/i).map((part, index) => (index % 2 === 1 ? <b key={index}>{part}</b> : part))
}

/**
 * A target stepper: lower, "now → target", raise. `next` gives the target one step on in a direction; a button rests when
 * that is where it already is, so the ends of the range and the build she has now are the same thing to it.
 */
function Stepper({ label, now, target, next, onStep }: { label: string; now: number | null; target: number; next: (delta: 1 | -1) => number; onStep: (delta: 1 | -1) => void }) {
  return (
    <div className="pp-step">
      <button type="button" aria-label={`Lower the ${label}`} disabled={next(-1) === target} onClick={() => onStep(-1)}>
        −
      </button>
      <span className="pp-lvl">
        {now !== null && <>{now} → </>}
        <b className={now !== null && target > now ? 'up' : undefined}>{target}</b>
      </span>
      <button type="button" aria-label={`Raise the ${label}`} disabled={next(1) === target} onClick={() => onStep(1)}>
        +
      </button>
    </div>
  )
}

function Editor({ model, plan, onPlan, onReset, error }: {
  model: PlannerModel
  plan: PlanBody
  onPlan: (next: PlanBody) => void
  onReset: () => void
  error: string | null
}) {
  const [listOpen, setListOpen] = useState(false)
  const [moreSets, setMoreSets] = useState(false)
  const weapons = weaponsCardFirst(model.weapons)
  const chosen = weapons.find((option) => option.key === plan.weapon) ?? weapons[0]
  const her = model.pronouns.hers
  const floors = floorsOf(model.now_build)
  const typedSlot = plan.typed !== null && plan.typed.use ? plan.typed.slot : null
  const spring = (event: { currentTarget: HTMLElement }) => {
    if (!reducedMotion()) event.currentTarget.animate([{ scale: 0.9 }, { scale: 1 }], { duration: 400, easing: SPRING_EASE })
  }
  return (
    <section className="pp-col" aria-label={`${cap(her)} plan`}>
      <h2>
        {cap(her)} plan <small>Click to change</small>
      </h2>
      {error !== null && (
        <p className="pp-error" role="alert">
          {error}
        </p>
      )}
      <div className="pp-blk">
        <h3>Talents</h3>
        {model.talents.map((talent) => (
          <div key={talent.kind} className="pp-trow">
            <Picture src={talent.icon} sign="crown" className="pp-tic" />
            <div>
              <span className="k">
                {talent.label}
                {talent.bonus > 0 ? `, ${talent.bonus} more from constellations` : ''}
              </span>
              <span className="n">{shortName(talent.name)}</span>
            </div>
            {talent.now < talent.max ? (
              <Stepper
                label={`${talent.label} target`}
                now={talent.now}
                target={plan.talents[talent.kind]}
                next={(delta) => stepTarget(plan.talents[talent.kind], delta, talent.now, talent.max)}
                onStep={(delta) => onPlan(withTalent(plan, talent.kind, stepTarget(plan.talents[talent.kind], delta, talent.now, talent.max)))}
              />
            ) : (
              <span className="pp-max">
                <b>{talent.max}</b>the most
              </span>
            )}
          </div>
        ))}
        <div className="pp-trow">
          <Avatar src={model.icon} element={model.element} size="40px" dark />
          <div>
            <span className="k">Character</span>
            <span className="n">Level to reach</span>
          </div>
          <Stepper
            label="level target"
            now={model.now_build === null ? null : floors.level}
            target={plan.level}
            next={(delta) => stepLevel(plan.level, delta, floors.level)}
            onStep={(delta) => onPlan({ ...plan, level: stepLevel(plan.level, delta, floors.level) })}
          />
        </div>
      </div>

      <div className="pp-blk">
        <h3>Weapon</h3>
        <button type="button" className="pp-pick" aria-expanded={listOpen} aria-controls="pp-wlist" onClick={() => setListOpen((open) => !open)}>
          <Picture src={chosen?.icon ?? null} sign="star" className="pp-pic" />
          <div>
            <b>{chosen?.name ?? 'No weapon'}</b>
            <span>{chosen?.text.split('. ')[0]}</span>
          </div>
          <Sign name="chevron" />
        </button>
        <div className={listOpen ? 'pp-list open' : 'pp-list'} id="pp-wlist" inert={!listOpen}>
          <div className="pp-list-in" role="listbox" aria-label="Weapons">
            {weapons.map((option) => (
              <button
                key={option.key}
                type="button"
                role="option"
                className="pp-opt"
                aria-selected={option.key === plan.weapon}
                onClick={() => {
                  onPlan(withWeapon(plan, option.key))
                  setListOpen(false)
                }}
              >
                <Picture src={option.icon} sign="star" className="pp-pic" />
                <div>
                  <b>{option.name}</b>
                  <span>{option.text}</span>
                </div>
                {option.tag !== null ? <em>{option.tag}</em> : <span />}
              </button>
            ))}
          </div>
        </div>
        <div className="pp-trow" style={{ gridTemplateColumns: '1fr auto', marginTop: 6 }}>
          <div>
            <span className="k">Refinement, one more copy each</span>
            <span className="n">{model.refinement_note}</span>
          </div>
          <Stepper
            label="refinement"
            now={model.now_build === null || model.now_build.refinement === null ? null : floors.refinement}
            target={plan.refinement}
            next={(delta) => stepTarget(plan.refinement, delta, floors.refinement, 5)}
            onStep={(delta) => onPlan({ ...plan, refinement: stepTarget(plan.refinement, delta, floors.refinement, 5) })}
          />
        </div>
        <div className="pp-trow" style={{ gridTemplateColumns: '1fr auto', marginTop: 6 }}>
          <div>
            <span className="k">Weapon level</span>
            <span className="n">Level to reach</span>
          </div>
          <Stepper
            label="weapon level target"
            now={model.now_build === null || model.now_build.weapon_level === null ? null : floors.weaponLevel}
            target={plan.weapon_level}
            next={(delta) => stepLevel(plan.weapon_level, delta, floors.weaponLevel)}
            onStep={(delta) => onPlan({ ...plan, weapon_level: stepLevel(plan.weapon_level, delta, floors.weaponLevel) })}
          />
        </div>
      </div>

      <div className="pp-blk">
        <h3>Artifact set</h3>
        <div className={moreSets ? 'pp-sets all' : 'pp-sets'} data-testid="planner-sets">
          {setsShown(model.sets, setKeyOf(plan.set), moreSets).map((set) => (
            <button key={set.key} type="button" className="pp-set" aria-pressed={setKeyOf(plan.set) === set.key} onClick={() => onPlan(withSet(plan, set.key))}>
              <Picture src={set.icon} sign="flower" className="pp-pic" />
              <div>
                <b>{set.name}</b>
                <span>{set.text}</span>
              </div>
            </button>
          ))}
        </div>
        {model.sets.length > setsShown(model.sets, setKeyOf(plan.set), false).length && (
          <button type="button" className="pp-more" aria-expanded={moreSets} onClick={() => setMoreSets((open) => !open)}>
            {moreSets ? 'Show fewer sets' : `Show every set, ${model.sets.length} in all`}
          </button>
        )}
        <div className="pp-setfx">{withBoldLabels(model.set_text)}</div>
      </div>

      <div className="pp-blk end">
        <h3>Main stats</h3>
        {model.mains.map((main) => (
          <div key={main.slot} className="pp-mrow">
            <Picture src={main.icon} sign="flower" />
            <span className="sl">{SLOT_LABEL[main.slot]}</span>
            <div className="pp-seg">
              {mainChips(main).map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  className={chip.now ? 'now' : undefined}
                  aria-pressed={typedSlot !== main.slot && plan.mains[main.slot] === chip.key}
                  onClick={(event) => {
                    spring(event)
                    onPlan(withMain(plan, main.slot, chip.key))
                  }}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          </div>
        ))}
        {model.level_pieces.map((piece) => {
          const on = plan.level_pieces.includes(piece.slot)
          return (
            <button key={piece.slot} type="button" role="switch" aria-checked={on} className="pp-toggle" onClick={() => onPlan(withLevelPiece(plan, piece.slot, !on))}>
              <span>
                {piece.note.split(':')[0]}
                <small>{piece.note.includes(':') ? piece.note.slice(piece.note.indexOf(':') + 2) : ''}</small>
              </span>
              <span className="pp-sw" />
            </button>
          )
        })}
        <button type="button" className="pp-reset" style={{ marginTop: 12 }} onClick={onReset}>
          Back to {her} card's plan
        </button>
      </div>
    </section>
  )
}

/** What the plan does: the damage against now, or the goals met; her stats now and with the plan; and a piece to try. */
function Result({ model, plan, piece, onPlan, onPiece, tipOf }: {
  model: PlannerModel
  plan: PlanBody
  piece: Draft
  onPlan: (next: PlanBody) => void
  onPiece: (next: Draft, use: boolean) => void
  tipOf: ReturnType<typeof useTip>['tipOf']
}) {
  const her = model.pronouns.hers
  const use = plan.typed?.use ?? false
  const change = model.with_plan.change
  const top = Math.max(100, model.with_plan.damage, model.now.damage) * 1.1
  const trying = model.try
  const spring = (event: { currentTarget: HTMLElement }) => {
    if (!reducedMotion()) event.currentTarget.animate([{ scale: 0.9 }, { scale: 1 }], { duration: 400, easing: SPRING_EASE })
  }
  return (
    <section className="pp-col" aria-label={`${cap(her)} stats with the plan`}>
      <h2>
        With the plan <small>Hover a row for its sources</small>
      </h2>
      {model.damage_role ? (
        <div className="pp-meter">
          <div>
            <div className="big">{change === null ? '—' : <CountUp value={change} format={signed} />}</div>
            <div className="lab">damage against now</div>
          </div>
          <div className="pp-vs">
            <div>
              <span>Now</span>
              <span className="bar">
                <i style={{ width: `${(model.now.damage / top) * 100}%` }} />
              </span>
              <b>{Math.round(model.now.damage)}</b>
            </div>
            <div>
              <span>Plan</span>
              <span className="bar">
                <i className="plan" style={{ width: `${(model.with_plan.damage / top) * 100}%` }} />
              </span>
              <b>{Math.round(model.with_plan.damage)}</b>
            </div>
          </div>
        </div>
      ) : (
        model.goals_met !== null && (
          <div className="pp-goals">
            <h3>Goals met</h3>
            {model.goals_met.map((goal) => (
              <div key={goal.label} className={goal.met ? 'met' : undefined}>
                <span>{goal.label}</span>
                <b>{goal.text}</b>
                <em>{goal.met ? 'Met' : 'Not yet'}</em>
              </div>
            ))}
          </div>
        )
      )}
      {model.warning !== null && (
        <div className="pp-warn" role="status">
          {model.warning}
        </div>
      )}
      <div className="pp-skey">
        <span>
          <i style={{ width: 2, height: 12, background: 'rgba(241, 234, 219, .75)' }} />
          Now
        </span>
        <span>
          <i style={{ width: 14, height: 6, borderRadius: 3, background: 'var(--el)' }} />
          With the plan
        </span>
        <span>
          <i style={{ width: 2, height: 12, background: 'var(--c-gold)' }} />
          {cap(her)} goal
        </span>
      </div>
      <div>
        {model.stats.map((stat) => (
          <div
            key={stat.key}
            className="pp-srow"
            {...tipOf(
              <>
                <b>{stat.label}</b>
                {stat.how}
              </>,
            )}
          >
            <span className="lab">{stat.label}</span>
            <span className="now">{stat.now_text}</span>
            <span className="pp-trk">
              <i className="p" style={{ width: `${Math.min(100, (stat.plan / stat.scale) * 100)}%` }} />
              <i className="n" style={{ left: `${Math.min(100, (stat.now / stat.scale) * 100)}%` }} />
              {stat.goal !== null && <i className="g" style={{ left: `${Math.min(100, (stat.goal / stat.scale) * 100)}%` }} />}
            </span>
            <span className="pl">{stat.plan_text}</span>
            <span className={`dl ${changeClass(stat.change_text)}`}>{stat.change_text}</span>
          </div>
        ))}
      </div>
      <div className="pp-blk">
        <h3>Substats {agree(model.pronouns, 'wants', 'want')}</h3>
        <div className="pp-wants">
          {model.weights.map((weight) => {
            const now = plan.weights[weight.key] ?? weight.weight
            return (
              <button
                key={weight.key}
                type="button"
                data-w={now}
                aria-label={`${weight.label}: ${{ wants: 'wanted', some: 'of some use', none: 'of no use' }[now]}. Press to change.`}
                onClick={(event) => {
                  spring(event)
                  onPlan(withWeight(plan, weight.key, nextWeight(now)))
                }}
              >
                <i />
                {weight.label}
              </button>
            )
          })}
        </div>
        <p className="pp-note">Click to cycle: wants, some use, no use. It decides how pieces are scored, here and on {her} profile.</p>
      </div>
      <div className={use ? 'pp-try used' : 'pp-try'}>
        <h3>Try a piece you got</h3>
        <p className="pp-note">Type in its stats to see what it would do for {objectPronoun(model.pronouns)}.</p>
        <div className="pp-tp-grid">
          <label>
            Slot
            <select value={piece.slot} onChange={(event) => onPiece(setDraftSlot(piece, event.target.value as Slot, model.element), use)}>
              {SLOTS.map((slot) => (
                <option key={slot.key} value={slot.key}>
                  {slot.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Main stat
            <select
              value={piece.main}
              onChange={(event) =>
                onPiece(
                  {
                    ...piece,
                    main: event.target.value,
                    subs: piece.subs.map(([key, value]) => (key === event.target.value ? ['', ''] : [key, value])) as [string, string][],
                  },
                  use,
                )
              }
            >
              {mainOptions(piece.slot, model.element).map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {piece.subs.map(([key, value], index) => (
            <label key={index}>
              Substat {index + 1}
              <span className="pp-sub2">
                <select
                  aria-label={`Substat ${index + 1}`}
                  value={key}
                  onChange={(event) => onPiece({ ...piece, subs: piece.subs.map((sub, i) => (i === index ? [event.target.value, sub[1]] : sub)) as [string, string][] }, use)}
                >
                  <option value="">None</option>
                  {subOptionsFor(piece.main).map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  aria-label={`Value of substat ${index + 1}`}
                  value={value}
                  onChange={(event) => onPiece({ ...piece, subs: piece.subs.map((sub, i) => (i === index ? [sub[0], event.target.value] : sub)) as [string, string][] }, use)}
                />
              </span>
            </label>
          ))}
        </div>
        <div className="pp-tp-out">
          <div>
            <b>{trying === null ? '—' : trying.crit_value}</b>
            <span>crit value</span>
          </div>
          <div>
            <b>{trying === null ? '—' : `${trying.rolls_wanted} of ${trying.rolls_all}`}</b>
            <span>rolls {agree(model.pronouns, 'wants', 'want')}</span>
          </div>
          <div>
            <b>{trying === null || trying.change === null ? '—' : signed(trying.change)}</b>
            <span>{trying === null ? 'damage' : trying.against}</span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={use}
            className="pp-use"
            disabled={draftBody(piece, true) === null}
            onClick={() => onPiece(piece, !use)}
          >
            <span className="pp-sw" />
            Use it in {her} plan
          </button>
        </div>
      </div>
    </section>
  )
}

/** One material: its icon, what is held and needed, where it comes from, and a chip. The amount held can be typed where it is not known. */
function Material({ material, calculatorOff, onHeld }: { material: MaterialRow; calculatorOff: boolean; onHeld: (key: string, amount: number | null) => void }) {
  const words = matWords(material)
  const typeable = calculatorOff || material.state === 'unknown' || material.typed
  const [text, setText] = useState(material.held === null ? '' : String(material.held))
  useEffect(() => setText(material.held === null ? '' : String(material.held)), [material.held])
  const commit = () => {
    const amount = text.trim() === '' ? null : Number(text)
    if (amount === material.held || (amount !== null && !Number.isFinite(amount))) return
    onHeld(material.key, amount)
  }
  return (
    <div className="pp-mat">
      <Picture src={material.icon} sign="chest" />
      <div>
        <div className="nm">{material.name}</div>
        <div className="src">
          {words.held}. {material.source}
        </div>
        {typeable && (
          <label className="pp-held">
            I hold
            <input
              type="number"
              min={0}
              max={9999999}
              step={1}
              value={text}
              aria-label={`Amount of ${material.name} you hold`}
              onChange={(event) => setText(event.target.value)}
              onBlur={commit}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commit()
              }}
            />
            {material.typed && <small>typed by you</small>}
          </label>
        )}
        <div className="mb" aria-hidden="true">
          <i style={{ width: `${material.held === null ? 0 : Math.min(100, (material.held / Math.max(1, material.needed)) * 100)}%` }} />
        </div>
      </div>
      <em className={words.ready ? 'ok' : 'go'}>{words.chip}</em>
    </div>
  )
}

/** What the plan takes: today's note, the materials, today's resin and the pieces to find with their odds. */
function Takes({ model, plan, onHeld }: { model: PlannerModel; plan: PlanBody; onHeld: (key: string, amount: number | null) => void }) {
  const { takes } = model
  const first = takes.today_note.search(/\.\s/)
  const parts = resinParts(takes)
  return (
    <section className="pp-col" aria-label="What the plan takes">
      <h2>
        What it takes <small>Today</small>
      </h2>
      <div className="pp-today">
        {first < 0 ? (
          takes.today_note
        ) : (
          <>
            <b>{takes.today_note.slice(0, first + 1)}</b>
            {takes.today_note.slice(first + 1)}
          </>
        )}
      </div>
      <div className="pp-blk">
        <h3>Materials</h3>
        <div className="pp-mats">
          {takes.materials.length === 0 ? (
            <p className="pp-note" style={{ margin: 0 }}>
              Nothing to farm.
            </p>
          ) : (
            takes.materials.map((material) => <Material key={material.key} material={material} calculatorOff={model.sync.calculator === 'off'} onHeld={onHeld} />)
          )}
        </div>
        <CalculatorNote sync={model.sync} />
      </div>
      <div className="pp-blk pp-resin">
        <h3>Resin today</h3>
        <div className="pp-rb" role="img" aria-label={parts.map((part) => `${part.label}: ${part.resin}`).join(', ')}>
          {parts.map((part) => (
            <i key={part.label} className={`pp-tone-${part.tone}`} style={{ width: `${part.share}%` }} />
          ))}
        </div>
        <div className="pp-rk">
          {parts.map((part) => (
            <span key={part.label}>
              <i className={`pp-tone-${part.tone}`} />
              {part.label}: {part.resin}
            </span>
          ))}
        </div>
      </div>
      <div className="pp-blk end">
        <h3>Pieces to find</h3>
        {takes.find.length === 0 ? (
          <div className="pp-find done">
            <div className="fh">
              <Picture src={null} sign="flower" />
              <div>
                <b>Nothing to find</b>
                <div className="pp-note" style={{ margin: 0 }}>
                  {plan.typed?.use === true ? 'The piece you typed is in the plan: equip it in the game.' : `${cap(model.pronouns.hers)} main stats already match the plan.`}
                </div>
              </div>
            </div>
          </div>
        ) : (
          takes.find.map((find) => (
            <div key={find.label} className="pp-find">
              <div className="fh">
                <Picture src={find.icon} sign="flower" />
                <div>
                  <b>{find.label}</b>
                  <div className="odds">{findOdds(find)}</div>
                </div>
              </div>
              <p>{find.note}</p>
              <div className="pp-paths">
                {find.paths.map((path) => (
                  <div key={path.label} className={path.best ? 'best' : undefined}>
                    <span>{path.label}</span>
                    <b>{path.odds}</b>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  )
}

/** Days to ready: the chance, day by day, that the pieces that depend on luck have come, with its 50% and 90% marks. */
function Days({ model }: { model: PlannerModel }) {
  const { days } = model
  const { tip, show, hide } = useTip()
  const [cross, setCross] = useState<number | null>(null)
  const line = useRef<SVGPathElement>(null)
  const last = days.points.length - 1
  const marks = curveMarks(days)
  const ready = model.takes.find.length === 0
  useLayoutEffect(() => {
    if (line.current !== null) drawLine(line.current, { duration: 0.9 })
  }, [model.key])
  const box = DAYS_BOX
  return (
    <section className="pp-days" aria-label="Days until ready">
      <div className="pp-days-head">
        <h2>Days to ready</h2>
        <p>{emphasised(days.summary)}</p>
      </div>
      <div className="pp-chart">
        {last >= 0 && (
          <svg viewBox={`0 0 ${box.width} ${box.height}`} role="img" aria-label="Chance that the pieces have come, by day">
            <defs>
              <linearGradient id="pp-area" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="var(--el)" stopOpacity=".45" />
                <stop offset="1" stopColor="var(--el)" stopOpacity=".02" />
              </linearGradient>
            </defs>
            <g className="grid">
              {[0, 0.25, 0.5, 0.75, 1].map((chance) => (
                <line key={chance} x1={box.left} x2={box.width - box.right} y1={curveY(chance)} y2={curveY(chance)} />
              ))}
            </g>
            <g className="axis">
              {[0, 0.5, 1].map((chance) => (
                <text key={chance} x={box.left - 8} y={curveY(chance) + 4} textAnchor="end">
                  {chance * 100}%
                </text>
              ))}
              {curveTicks(last).map((tick) => (
                <text key={tick.day} x={curveX(tick.day, last)} y={box.height - 6} textAnchor={tick.day === 0 ? 'start' : tick.day === last ? 'end' : 'middle'}>
                  {tick.label}
                </text>
              ))}
            </g>
            <path className="area" d={curveArea(days.points)} />
            <path className="line" ref={line} d={curvePath(days.points)} />
            {marks.map((mark) => {
              const x = curveX(mark.day, last)
              const late = mark.day > last * 0.8
              return (
                <g key={mark.label} className="mark">
                  <line x1={x} x2={x} y1={box.top} y2={box.height - box.bottom} />
                  <text x={late ? x - 6 : x + 6} y={box.top + 12} textAnchor={late ? 'end' : 'start'}>
                    {mark.label}
                  </text>
                </g>
              )
            })}
            {ready && (
              <g className="mark">
                <text x={curveX(0, last) + 10} y={curveY(1) + 16}>
                  Ready today
                </text>
              </g>
            )}
            <circle className="todayDot" cx={curveX(0, last)} cy={curveY(days.points[0])} r={5} />
            {cross !== null && (
              <>
                <line className="cross" x1={curveX(cross, last)} x2={curveX(cross, last)} y1={box.top} y2={box.height - box.bottom} />
                <circle cx={curveX(cross, last)} cy={curveY(days.points[cross])} r={5} fill="var(--el)" />
              </>
            )}
            <rect
              x={box.left}
              y={box.top}
              width={box.width - box.left - box.right}
              height={box.height - box.top - box.bottom}
              fill="transparent"
              onMouseMove={(event) => {
                const svg = event.currentTarget.ownerSVGElement
                if (svg === null) return
                const rect = svg.getBoundingClientRect()
                const x = ((event.clientX - rect.left) / rect.width) * box.width
                const day = Math.max(0, Math.min(last, Math.round(((x - box.left) / (box.width - box.left - box.right)) * last)))
                setCross(day)
                const chance = Math.round(days.points[day] * 100)
                show(
                  event.clientX,
                  event.clientY,
                  <>
                    <b>{dayWords(day)}</b>
                    {ready ? 'Ready.' : `${chance}% chance ${agree(model.pronouns, 'has', 'have')} ${model.takes.find.length === 1 ? 'the piece' : 'every piece'}.`}
                  </>,
                )
              }}
              onMouseLeave={() => {
                setCross(null)
                hide()
              }}
            />
          </svg>
        )}
      </div>
      <Tip tip={tip} />
    </section>
  )
}

/** The planner as the model has it (the design's section 6.3). */
export function PlannerView({ model, plan, piece, focus, error, onPlan, onPiece, onFocus, onReset, onHeld, onCard, takesShown = true }: {
  model: PlannerModel
  /** The plan as the controls show it, which a change moves at once; the model is the answer to the last one sent. */
  plan: PlanBody
  piece: Draft
  focus: readonly string[] | null
  error: string | null
  onPlan: (next: PlanBody) => void
  onPiece: (next: Draft, use: boolean) => void
  onFocus: () => void
  onReset: () => void
  onHeld: (key: string, amount: number | null) => void
  /** Opens the Card panel; the header's button for it is there while a page gives this. */
  onCard?: () => void
  /** What it takes, today's resin and the focus go with Your week (hidden.ts): while that is hidden the planner has two columns. */
  takesShown?: boolean
}) {
  const page = useRef<HTMLDivElement>(null)
  const scale = useCharactersScale()
  const { tip, tipOf } = useTip()
  const her = model.pronouns.hers
  const inFocus = focus === null ? model.in_focus !== null : focus.includes(model.key)
  const count = focus === null ? 0 : focus.length
  const resin = model.takes.resin_today.reduce((sum, part) => sum + part.resin, 0)

  useLayoutEffect(() => {
    const root = page.current
    if (root === null || reducedMotion()) return
    rise(root.querySelectorAll<HTMLElement>('.pp-col'), { step: 0.1, start: 0.1, duration: 0.6, lift: 18 })
    const giant = root.querySelector<HTMLElement>('.pp-giant')
    if (giant !== null) clipReveal(giant, { from: 'right', duration: 1.3 })
  }, [model.key])

  const readiness =
    model.now.readiness === model.with_plan.readiness ? `${model.now.readiness}%` : `${model.now.readiness}% → ${model.with_plan.readiness}%`
  return (
    <div className="gb-page pp-page" ref={page} style={scaleStyle(scale)}>
      <article className={`pp-card ${elementClass(model.element)}`}>
        <div className="pp-giant" aria-hidden="true">
          {model.name}
        </div>
        <header className="pp-top">
          <div className="pp-who">
            <Avatar src={model.icon} element={model.element} size="76px" dark />
            <div>
              <h2 className="pp-name">{model.name}</h2>
              <div className="pp-sub">{cap(her)} plan, starting from {her} build on HoYoLAB</div>
              {onCard !== undefined && (
                <button type="button" className="pp-cardbtn" onClick={onCard}>
                  {cap(her)} card
                </button>
              )}
            </div>
          </div>
          <div className="pp-sum">
            {model.damage_role && (
              <div className="pp-chip hero">
                <b>{model.with_plan.change === null ? '—' : <CountUp value={model.with_plan.change} format={signed} />}</b>
                <span>damage against now</span>
              </div>
            )}
            <div className="pp-chip">
              <b>{readiness}</b>
              <span>of {her} full potential</span>
            </div>
            {takesShown && (
              <div className="pp-chip">
                <b>
                  <CountUp value={resin} format={(n) => `${n} resin`} />
                </b>
                <span>of {model.takes.resin_cap} today</span>
              </div>
            )}
            {takesShown && (
              <button type="button" className="pp-focus" aria-pressed={inFocus} disabled={focus === null} onClick={onFocus}>
                <b>{inFocus ? 'In your focus' : 'Add to your focus'}</b>
                <span>{count} of 4 characters</span>
              </button>
            )}
          </div>
        </header>
        <div className={takesShown ? 'pp-cols' : 'pp-cols two'}>
          <Editor model={model} plan={plan} onPlan={onPlan} onReset={onReset} error={error} />
          <Result model={model} plan={plan} piece={piece} onPlan={onPlan} onPiece={onPiece} tipOf={tipOf} />
          {takesShown && <Takes model={model} plan={plan} onHeld={onHeld} />}
        </div>
        <Days model={model} />
      </article>
      <Tip tip={tip} />
    </div>
  )
}

/**
 * A character's planner page: it keeps the plan the controls show, sends each change 150 ms after the last, and shows the
 * answer. A change still waiting when the page is left, hidden or closed goes at once, with a request that outlives the
 * page, as the Notes widget's text does (audit L26).
 */
export function Planner({ live, characterKey }: { live: Live; characterKey: string }) {
  const [bump, setBump] = useState(0)
  const { data, error: readError } = useModel<PlannerModel>(`/api/characters/${characterKey}/plan`, live.version + bump)
  const roster = useModel<Roster>('/api/characters', live.version + bump)
  const [model, setModel] = useState<PlannerModel | null>(null)
  const [plan, setPlan] = useState<PlanBody | null>(null)
  const [piece, setPiece] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cardOpen, setCardOpen] = useState(false)
  const timer = useRef(0)
  const sent = useRef(0)
  const pending = useRef(false)
  const waiting = useRef<{ body: PlanBody; mine: number } | null>(null) // the change whose 150 ms have not passed

  // What the core says takes the place of what the page shows, unless a change of the player's is still on its way.
  useEffect(() => {
    if (data === null || pending.current) return
    setModel(data)
    setPlan(data.plan)
    setPiece((now) => now ?? draftFromTyped(data.plan.typed, data.element))
  }, [data])

  /** Sends change number `mine`, and shows the answer unless a newer change came meanwhile. */
  const put = useCallback(
    async (body: PlanBody, mine: number, keepalive: boolean) => {
      try {
        const answer = await api.put<PlannerModel>(`/api/characters/${characterKey}/plan`, body, { keepalive })
        if (mine !== sent.current) return
        pending.current = false
        setModel(answer)
        setPlan(answer.plan)
      } catch (failure) {
        if (mine !== sent.current) return
        pending.current = false
        setError(messageOf(failure))
        setBump((count) => count + 1) // read the plan the core has, in place of the one it refused
      }
    },
    [characterKey],
  )
  // The page is left, hidden or closed: the change that waits goes now. Closing the window hides the page a moment before
  // it goes (dashboard.py), and leaving the planner would otherwise take the timer with it.
  const leave = useCallback(() => {
    const change = waiting.current
    if (change === null) return
    window.clearTimeout(timer.current)
    waiting.current = null
    void put(change.body, change.mine, true)
  }, [put])
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') leave()
    }
    window.addEventListener('pagehide', leave)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', leave)
      document.removeEventListener('visibilitychange', onVisibility)
      leave()
    }
  }, [leave])

  const send = (next: PlanBody) => {
    setPlan(next)
    setError(null)
    pending.current = true
    window.clearTimeout(timer.current)
    const mine = (sent.current += 1)
    waiting.current = { body: next, mine }
    timer.current = window.setTimeout(() => {
      waiting.current = null
      void put(next, mine, false)
    }, 150)
  }

  const reset = async () => {
    window.clearTimeout(timer.current)
    waiting.current = null
    sent.current += 1
    pending.current = false
    try {
      const answer = await api.delete<PlannerModel>(`/api/characters/${characterKey}/plan`)
      setModel(answer)
      setPlan(answer.plan)
      setPiece(draftFromTyped(answer.plan.typed, answer.element))
      setError(null)
    } catch (failure) {
      setError(messageOf(failure))
    }
  }

  const held = async (key: string, amount: number | null) => {
    try {
      await api.put('/api/characters/held', { amounts: { [key]: amount } })
      setError(null)
    } catch (failure) {
      setError(messageOf(failure))
    }
    setBump((count) => count + 1)
  }

  const toggle = async () => {
    if (roster.data === null) return
    const next = toggleFocus(roster.data.focus, characterKey)
    if ('refused' in next) {
      setError(next.refused)
      return
    }
    try {
      await api.put('/api/focus', { characters: next.focus })
      setError(null)
    } catch (failure) {
      setError(messageOf(failure))
    }
    setBump((count) => count + 1)
  }

  const onPiece = (next: Draft, use: boolean) => {
    setPiece(next)
    if (plan !== null) send({ ...plan, typed: draftBody(next, use) })
  }

  return (
    <Frame
      page="characters"
      live={live}
      controls={
        <>
          <a className="gb-btn quiet" href={hashOf({ page: 'characters', view: 'roster' })}>
            All characters
          </a>
          <a className="gb-btn quiet" href={hashOf({ page: 'characters', view: 'profile', key: characterKey })}>
            {model === null ? 'Profile' : `${cap(model.pronouns.hers)} profile`}
          </a>
          {model !== null && <SyncLine live={live} sync={model.sync} />}
        </>
      }
    >
      {model === null || plan === null || piece === null ? (
        <div className="gb-panel gb-empty">
          {readError ?? 'Reading the planner…'}
          {readError !== null && (
            <>
              {' '}
              <a href={hashOf({ page: 'characters', view: 'roster' })}>Back to the characters</a>
            </>
          )}
        </div>
      ) : (
        <PlannerView
          key={model.key}
          model={model}
          plan={plan}
          piece={piece}
          focus={roster.data === null ? null : roster.data.focus}
          error={error}
          onPlan={send}
          onPiece={onPiece}
          onFocus={() => void toggle()}
          onReset={() => void reset()}
          onHeld={(key, amount) => void held(key, amount)}
          onCard={() => setCardOpen(true)}
          takesShown={weekShown(live.status)}
        />
      )}
      {cardOpen && <CardPanel live={live} characterKey={characterKey} onClose={() => setCardOpen(false)} />}
    </Frame>
  )
}
