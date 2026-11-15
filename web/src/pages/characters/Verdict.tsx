import { useState } from 'react'
import type { Planner as PlannerModel, PlannerHits, PlannerSim } from '../../types.ts'
import { Picture } from '../../ui/Picture.tsx'
import type { Choice, Reaction, TalentKey, Verdict } from './damage.ts'
import { changeText, type CountedLine, ENEMY_NOTE, headline, kindShown, REACTION_WORD, recordedOf, teamLine } from './verdictview.ts'

/** The verdict as the mockup's box: the headline in its colour, and the one sentence that says why. */
export function VerdictBox({ verdict }: { verdict: Verdict }) {
  const head = headline(verdict)
  return (
    <div className="pp-verdict" title={ENEMY_NOTE}>
      <div className={`v ${head.cls}`}>{head.text}</div>
      <div className="why">{verdict.why}</div>
    </div>
  )
}

/** The reactions a talent's ordinary hits can trigger: one reaction is an On and Off button, several are a compact choice with None. */
function Reactions({ label, options, chosen, onChoose }: { label: string; options: Reaction[]; chosen: Reaction; onChoose: (next: Reaction) => void }) {
  if (options.length === 2) {
    const reaction = options[1]
    const on = chosen === reaction
    return (
      <span className="pp-react">
        {REACTION_WORD[reaction]}
        <button type="button" aria-label={`${REACTION_WORD[reaction]} for the ${label}`} aria-pressed={on} onClick={() => onChoose(on ? 'none' : reaction)}>
          {on ? 'On' : 'Off'}
        </button>
      </span>
    )
  }
  return (
    <select className="pp-react pp-reactsel" aria-label={`Reaction of the ${label}`} value={chosen} onChange={(event) => onChoose(event.target.value as Reaction)}>
      {options.map((reaction) => (
        <option key={reaction} value={reaction}>
          {REACTION_WORD[reaction]}
        </option>
      ))}
    </select>
  )
}

/** A row per main talent: its picture, its change, the reaction its ordinary hits can trigger and the Lunar or Stellar kinds it deals. */
export function TalentRows({ model, hits, tables, verdict, choice, onChoice }: {
  model: PlannerModel
  hits: PlannerHits
  tables: PlannerSim['tables']
  verdict: Verdict
  choice: Choice
  onChoice: (next: Choice) => void
}) {
  return (
    <div className="pp-tals">
      {verdict.talents.map((one) => {
        const talent = model.talents.find((have) => have.kind === one.key)
        const label = talent?.label ?? one.key
        const shown = kindShown(hits, one.key, choice)
        const change = changeText(one.change)
        const recorded = recordedOf(hits, one.key as TalentKey, choice, tables)
        const most = tables.stellar_conduct.length - 1
        const record = (next: number) => onChoice({ ...choice, recorded: { ...choice.recorded, [one.key]: next } })
        const kinds = shown.labels.join(' · ')
        // With a reaction to choose the kinds go under the row, beside Recorded hits; alone they sit in the row.
        const under = shown.reactions !== null && kinds !== ''
        return (
          <div key={one.key} className="pp-tal" data-talent={one.key}>
            <Picture src={talent?.icon ?? null} sign="crown" className="pp-tal-ic" />
            <span className="nm">{label}</span>
            {shown.reactions !== null ? (
              <Reactions
                label={label}
                options={shown.reactions}
                chosen={choice.reaction[one.key] ?? 'none'}
                onChoose={(next) => onChoice({ ...choice, reaction: { ...choice.reaction, [one.key]: next } })}
              />
            ) : (
              <span className="pp-kind" title={`${label} deals ${kinds} damage`}>
                {kinds}
              </span>
            )}
            <span className={`d ${change.cls}`}>{change.text}</span>
            {(under || recorded !== null) && (
              <div className="pp-line2">
                {under && (
                  <span className="pp-kind" title={`${label} deals ${kinds} damage`}>
                    {kinds}
                  </span>
                )}
                {recorded !== null && (
                  <span className="pp-rec">
                    Recorded hits
                    <button type="button" aria-label={`Lower the recorded hits of the ${label}`} disabled={recorded <= 0} onClick={() => record(recorded - 1)}>
                      −
                    </button>
                    <b className="n" aria-live="polite">
                      {recorded}
                    </b>
                    <button type="button" aria-label={`Raise the recorded hits of the ${label}`} disabled={recorded >= most} onClick={() => record(recorded + 1)}>
                      +
                    </button>
                  </span>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** How many effects the Not counted list shows at once before it folds into one line. */
const FOLD_AFTER = 3

/**
 * What the verdict counts (the Plan design, 14.4): the toggles that are counted, each a switch that leaves it out, and under them the ones
 * that are not counted but would change a counted row, each a switch that counts it (with the toggles an effect needs beside it).
 */
export function Counted({ line, choice, onChoice, hers = 'her' }: { line: CountedLine; choice: Choice; onChoice: (next: Choice) => void; hers?: string }) {
  const [unfolded, setUnfolded] = useState(false)
  if (line.fixed.length + line.on.length + line.off.length === 0) return null
  // A long Not counted list (a character with many gear effects) would make this column far taller than its neighbours, so it folds into one line.
  const folded = line.off.length > FOLD_AFTER && !unfolded
  // Pressing any switch here keeps the list open, so a switch that was just left out is still there to press again.
  const set = (names: string[], on: boolean) => {
    setUnfolded(true)
    onChoice({ ...choice, toggles: { ...choice.toggles, ...Object.fromEntries(names.map((name) => [name, on])) } })
  }
  return (
    <div className="pp-counted">
      <div>
        <span className="lbl">Counted:</span>
        {line.fixed.map((label) => (
          <span key={label} className="pp-chipsw fixed" title={`Counted while ${hers} hits include Stellar-Conduct`}>
            {label}
          </span>
        ))}
        {line.on.map((toggle) => (
          <button key={toggle.name} type="button" className="pp-chipsw" aria-pressed="true" title="Counted. Press to leave it out." onClick={() => set([toggle.name], false)}>
            {toggle.label}
          </button>
        ))}
        {line.fixed.length + line.on.length === 0 && <span className="none">nothing</span>}
      </div>
      {line.off.length > 0 && (
        <div>
          <span className="lbl">Not counted:</span>
          {folded ? (
            <button type="button" className="pp-chipsw more" aria-expanded="false" onClick={() => setUnfolded(true)}>
              {line.off.length} effects. Show them
            </button>
          ) : (
            line.off.map((toggle) => (
              <button key={toggle.name} type="button" className="pp-chipsw" aria-pressed="false" title="Not counted. Press to count it." onClick={() => set(toggle.with, true)}>
                {toggle.label}
              </button>
            ))
          )}
        </div>
      )}
      {line.off.length > 0 && !folded && <small className="pp-counted-note">Press one to count it.</small>}
    </div>
  )
}

/**
 * The team the verdict is read for, for a character whose damage depends on it (the Plan design, 14): a choice of team shapes in the
 * look of the reaction choice, and under it, in small text, which team is usual. Nothing for a character no team decides.
 */
export function Team({ hits, choice, onChoice }: { hits: PlannerHits; choice: Choice; onChoice: (next: Choice) => void }) {
  const line = teamLine(hits, choice)
  if (line === null) return null
  return (
    <div className="pp-team">
      <div>
        <span className="lbl">Team:</span>
        <select
          className="pp-react pp-reactsel pp-teamsel"
          aria-label="Team"
          title={line.reason}
          value={line.chosen}
          onChange={(event) => onChoice({ ...choice, party: event.target.value })}
        >
          {line.options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <small className="pp-team-note" title={line.reason}>
        {line.note}
      </small>
    </div>
  )
}

/** The notes of the verdict, in a box under the rows (the mockup's note). */
export function Notes({ notes }: { notes: string[] }) {
  if (notes.length === 0) return null
  return (
    <div className="pp-notes">
      {notes.map((note) => (
        <p key={note}>{note}</p>
      ))}
    </div>
  )
}
