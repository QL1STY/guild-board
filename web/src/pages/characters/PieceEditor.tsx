import { useState } from 'react'
import type { Element, PlannerSim, Pronouns, SimPiece, Slot } from '../../types.ts'
import { Picture } from '../../ui/Picture.tsx'
import { freshPiece, levelUp, mainAt, reachable, rollBudget, subValue, type TestPiece } from './simulator.ts'
import { changeMain, changeSubStat, clearedSub } from './simstate.ts'
import { boxText, defaultMain, mainChoices, rollsText, SLOT_LABEL, statName, SUB_STATS, typedValue, valueText } from './simview.ts'

type Sub = TestPiece['subs'][number]

const TIER_PERCENT = [70, 80, 90, 100]
const maxRolls = (rarity: number): number => (rarity >= 5 ? 6 : 4)
const topLevel = (rarity: number): number => (rarity >= 5 ? 20 : 16)
const rollsHeld = (piece: TestPiece): number => piece.subs.reduce((sum, sub) => sum + Math.max(1, sub.tiers.length), 0)

/** One substat: its stat, its value (typed, or the sum of its rolls), the rolls as pips, and the buttons that add or take one. */
function SubRow({ sub, piece, tables, element, room, hers, onChange }: {
  sub: Sub
  piece: TestPiece
  tables: PlannerSim['tables']
  element: Element
  room: number
  /** The value HoYoLAB shows for this stat on her own piece, or null. */
  hers: number | null
  onChange: (next: Sub) => void
}) {
  const [text, setText] = useState<string | null>(null)
  // A stat the roll tables do not have (the core gives it no rolls) shows its value and takes no roll buttons.
  const rolls: number[] = tables.rolls[piece.rarity >= 5 ? '5' : '4'][sub.stat] ?? []
  const known = rolls.length > 0
  const shown = text ?? (sub.typed !== null || known ? boxText(sub.stat, subValue(sub, tables, piece.rarity)) : '')
  const problem = text === null ? null : typedValue(sub.stat, text)
  const ways = !known ? [] : sub.typed === null ? [sub.tiers.length] : reachable(sub.stat, sub.typed, tables, piece.rarity)
  const possible = ways.length > 0 || !known
  const bad = !possible || (problem !== null && 'problem' in problem)
  const taken = new Set([piece.main, ...piece.subs.map((one) => one.stat)])
  const name = statName(sub.stat, element)
  const full = !known || room <= 0 || sub.typed !== null || sub.tiers.length >= maxRolls(piece.rarity)
  return (
    <div className="pp-srow">
      <select className="pp-sel" aria-label={`Stat of the ${name} substat`} value={sub.stat} onChange={(event) => onChange(changeSubStat(sub, event.target.value, Math.random))}>
        {[...(SUB_STATS.includes(sub.stat) ? [] : [sub.stat]), ...SUB_STATS.filter((stat) => stat === sub.stat || !taken.has(stat))].map((stat) => (
          <option key={stat} value={stat}>
            {statName(stat, element)}
          </option>
        ))}
      </select>
      <input
        type="text"
        inputMode="decimal"
        className={bad ? 'bad' : undefined}
        aria-label={`Value of ${name}`}
        aria-invalid={bad}
        value={shown}
        onChange={(event) => {
          setText(event.target.value)
          const typed = typedValue(sub.stat, event.target.value)
          if (typed === null) onChange(clearedSub(sub, hers))
          else if ('value' in typed) onChange({ ...sub, typed: typed.value })
        }}
        onBlur={() => setText(null)}
      />
      <div className="pp-pips">
        {sub.typed === null &&
          sub.tiers.map((tier, index) => (
            <span key={index} className={`pp-pip p${tier}`} title={`${TIER_PERCENT[tier]}% roll: ${boxText(sub.stat, rolls[tier])}`} />
          ))}
        <span className={bad ? 'pp-ri bad' : 'pp-ri'}>
          {problem !== null && 'problem' in problem ? problem.problem : !known ? '' : !possible ? 'No roll can make this' : rollsText(ways)}
        </span>
      </div>
      <div className="pp-tiers">
        {rolls.map((value, tier) => (
          <button
            key={tier}
            type="button"
            disabled={full}
            title={`Add a ${TIER_PERCENT[tier]}% roll`}
            onClick={() => onChange({ ...sub, tiers: [...sub.tiers, tier] })}
          >
            +{boxText(sub.stat, value)}
          </button>
        ))}
        <button
          type="button"
          className="pp-undo"
          aria-label={`Take the last ${name} roll off`}
          disabled={sub.tiers.length <= 1 || sub.typed !== null}
          title="Take the last roll off"
          onClick={() => onChange({ ...sub, tiers: sub.tiers.slice(0, -1) })}
        >
          −
        </button>
      </div>
    </div>
  )
}

/**
 * The piece under test: its main stat as a list with each value at its level, its four substats, and the buttons that
 * level it up by the game's rules, give it a fresh start or put hers back. Rolls are random, from `Math.random`.
 */
export function PieceEditor({ sim, slot, piece, hers, icon, element, pronouns, onChange, onBack }: {
  sim: PlannerSim
  slot: Slot
  /** Undefined where she wears nothing in this slot. */
  piece: TestPiece | undefined
  /** The piece she wears in this slot, for the value of a substat that has no rolls. */
  hers: SimPiece | undefined
  icon: string | null
  element: Element
  pronouns: Pronouns
  onChange: (next: TestPiece) => void
  onBack: () => void
}) {
  const [said, setSaid] = useState('')
  const tables = sim.tables
  const fresh = (main: string, rarity: number) => {
    const next = freshPiece(slot, main, rarity, tables, Math.random)
    onChange(next)
    setSaid(`A new +0 piece with ${next.subs.length} substats.`)
  }
  const buttons = (
    <span className="pp-edbtns">
      <button type="button" className="pp-btn" onClick={onBack}>
        Back to {pronouns.hers} piece
      </button>
      <button type="button" className="pp-btn" onClick={() => fresh(piece?.main ?? defaultMain(slot), piece?.rarity ?? 5)}>
        New +0 piece
      </button>
    </span>
  )
  if (piece === undefined) {
    return (
      <div className="pp-editor">
        <div className="pp-edhead top">
          <b>{SLOT_LABEL[slot]}</b>
          <span className="pp-ri">Nothing is worn in this slot.</span>
          {buttons}
        </div>
        <div className="pp-log" aria-live="polite">
          {said}
        </div>
      </div>
    )
  }
  const top = topLevel(piece.rarity)
  const budget = rollBudget(piece)
  const room = budget - rollsHeld(piece)
  const choices = mainChoices(slot, piece.main)
  const level = (next: { piece: TestPiece; said: string }) => {
    onChange(next.piece)
    setSaid(next.said)
  }
  const rollToTop = () => {
    let now = piece
    const lines: string[] = []
    while (now.level < top) {
      const step = levelUp(now, tables, Math.random)
      if (step.piece.level === now.level) {
        if (step.said !== '') lines.push(step.said)
        break
      }
      lines.push(`+${step.piece.level}: ${step.said}`)
      now = step.piece
    }
    onChange(now)
    setSaid(lines.join(' · '))
  }
  return (
    <div className="pp-editor">
      <div className="pp-edhead top">
        <Picture src={icon} sign="flower" className="pp-edpic" />
        <span className="lv">+{piece.level}</span>
        <b>{SLOT_LABEL[slot]}</b>
        <select
          className="pp-sel"
          aria-label="Main stat"
          disabled={choices.length === 1}
          value={piece.main}
          onChange={(event) => {
            const next = changeMain(piece, event.target.value, tables, Math.random)
            onChange(next.piece)
            setSaid(next.said)
          }}
        >
          {choices.map((main) => (
            <option key={main} value={main}>
              {statName(main, element)} · {valueText(main === 'dmg_other' ? 'dmg' : main, mainAt(tables, piece.rarity, main, piece.level))}
            </option>
          ))}
        </select>
        {buttons}
      </div>
      <div className="pp-subs">
        {piece.subs.map((sub, index) => (
          <SubRow
            key={`${index}-${sub.stat}`}
            sub={sub}
            piece={piece}
            tables={tables}
            element={element}
            room={room}
            hers={hers?.subs.find((one) => one.stat === sub.stat)?.value ?? null}
            onChange={(next) => onChange({ ...piece, subs: piece.subs.map((one, at) => (at === index ? next : one)) })}
          />
        ))}
      </div>
      <div className="pp-edhead">
        <button type="button" className="pp-btn main" disabled={piece.level >= top} onClick={() => level(levelUp(piece, tables, Math.random))}>
          Level up +4
        </button>
        <button type="button" className="pp-btn main" disabled={piece.level >= top} onClick={rollToTop}>
          Roll to +{top}
        </button>
        <span className="pp-ri pp-budget">
          {rollsHeld(piece)} of {budget} rolls at +{piece.level}
        </span>
      </div>
      <div className="pp-log" aria-live="polite">
        {said}
      </div>
    </div>
  )
}
