import { type RefObject, useEffect, useRef, useState } from 'react'
import { localDay, plural } from '../format.ts'
import type { AchievementGroup, AchievementStage, AchievementStatus } from '../types.ts'
import { useGlint } from '../ui/motion.tsx'
import { Picture } from '../ui/Picture.tsx'
import { RowPanel } from '../ui/RowPanel.tsx'
import { Sign } from '../ui/Sign.tsx'
import { CounterRow, NoteEditor, type Send, type Shown, WikiLink } from './AchievementGroup.tsx'
import { numeral, panelSummary, reachedLine, sharedWiki } from './achievementsview.ts'

/**
 * One stage in an achievement's panel (look pass spec 11.4): its tick box, its numeral when the achievement has several
 * stages, its own name where it has one, its text, the line that offers the tick, its checklist's parts with the day
 * each was done, and its note or the note's editor; then the day it was ticked, its reward, In progress, Note, and its
 * own Look it up where the stages' addresses differ, and its version where theirs differ. Pin is the card's, for the
 * whole achievement, so a stage's row has none. A tick stamps the row's box once, and `ticked` glints the card, as a
 * tick on the card does (look pass spec 11.5).
 */
function StageRow({
  group,
  stage,
  index,
  shown,
  send,
  ownWiki,
  ownVersion,
  ticked,
  escaped,
}: {
  group: AchievementGroup
  stage: AchievementStage
  index: number
  shown: Shown
  send: Send
  ownWiki: boolean
  ownVersion: boolean
  ticked: () => void
  /** Set when Escape closed the panel: a note being typed goes unsaved (NoteEditor). */
  escaped: RefObject<boolean>
}) {
  const several = group.stages.length > 1
  const [editing, setEditing] = useState(false)
  const [stamps, setStamps] = useState(0) // the player's ticks with this row's box
  const stamp = useGlint(stamps)
  const noteButton = useRef<HTMLButtonElement>(null)
  const editor = useRef<HTMLDivElement>(null)
  const path = `/api/achievements/stage/${stage.id}`
  const status = shown(`status:${stage.id}`, stage.status)
  const note = shown(`note:${stage.id}`, stage.note)
  const setStatus = (next: AchievementStatus) => {
    if (next === 'done') {
      setStamps((count) => count + 1)
      ticked()
    }
    void send(`status:${stage.id}`, next, path, { status: next })
  }
  const saveNote = async (text: string) => {
    const next = text.trim() // as the core keeps it
    if (next !== note && !(await send(`note:${stage.id}`, next, path, { note: text }))) return
    // The editor closes, and the focus it holds would fall back to the start of the page: it goes to the Note button.
    const focused = document.activeElement
    if (focused === null || focused === document.body || editor.current?.contains(focused)) noteButton.current?.focus()
    setEditing(false)
  }
  // Escape in the editor: it closes without saving, and the focus it holds goes back to Note.
  const closeNote = () => {
    noteButton.current?.focus()
    setEditing(false)
  }
  // A changed note the editor leaves behind, as the panel closes, is saved as Save note saves it.
  const keepNote = (text: string) => void send(`note:${stage.id}`, text.trim(), path, { note: text })
  // From the model, not the clicks: the line follows what the core has.
  const reached = reachedLine(stage, group.counter, index)
  return (
    <li className={status === 'done' ? 'ach-row done' : 'ach-row'}>
      <span className={['ach-box', reached !== null && 'reached', stamp !== '' && 'stamp'].filter(Boolean).join(' ')}>
        <input
          type="checkbox"
          aria-label={several ? `Done: ${numeral(index)}, ${stage.description}` : `Done: ${stage.description}`}
          data-focus="done"
          checked={status === 'done'}
          onChange={(event) => setStatus(event.target.checked ? 'done' : 'not_started')}
        />
        <Sign name="tick" />
      </span>
      {several && <span className="ach-numeral">{numeral(index)}</span>}
      <div className="ach-row-body">
        {stage.name !== group.name && <h4 className="ach-own">{stage.name}</h4>}
        <p className="ach-desc">{stage.description}</p>
        {reached !== null && <p className="ach-reached">{reached}</p>}
        {stage.parts.length > 0 && (
          <ul className="ach-parts">
            {stage.parts.map((part, number) => {
              const key = `part:${stage.id}:${number}`
              return (
                <li key={number}>
                  <label className="ach-check">
                    <input
                      type="checkbox"
                      data-focus="part"
                      checked={shown(key, part.done_at !== null)}
                      onChange={(event) => {
                        const done = event.target.checked
                        void send(key, done, path, { part: { index: number, done } })
                      }}
                    />
                    {part.label}
                  </label>
                  {part.done_at !== null && <span className="ach-day">{localDay(part.done_at)}</span>}
                </li>
              )
            })}
          </ul>
        )}
        {editing ? (
          <NoteEditor
            ref={editor}
            name={stage.name}
            note={note}
            save={(text) => void saveNote(text)}
            close={closeNote}
            keep={keepNote}
            escaped={escaped}
          />
        ) : (
          note !== '' && <p className="ach-note">{note}</p>
        )}
      </div>
      <span className="ach-when">{status === 'done' && stage.done_at !== null ? `Done ${localDay(stage.done_at)}` : ''}</span>
      <div className="ach-row-acts">
        <span className="ach-reward">
          <Picture src="/api/icon/static.primogem" sign="gem" className="ach-gem" />
          {plural(stage.reward, 'primogem')}
        </span>
        {ownVersion && <span className="ach-ver">Added in {stage.version}</span>}
        {/* A done stage is unticked first, and a press does nothing. aria-disabled, not disabled, which would drop the
            focus to the page when a tick from elsewhere arrives while the button has it. */}
        <button
          type="button"
          className="ach-toggle"
          aria-pressed={status === 'in_progress'}
          data-focus="progress"
          aria-disabled={status === 'done'}
          onClick={() => {
            if (status !== 'done') setStatus(status === 'in_progress' ? 'not_started' : 'in_progress')
          }}
        >
          In progress
        </button>
        <button
          ref={noteButton}
          type="button"
          className="ach-toggle"
          aria-expanded={editing}
          data-focus="note"
          onClick={() => setEditing(!editing)}
        >
          Note
        </button>
        {ownWiki && <WikiLink href={stage.wiki} />}
      </div>
    </li>
  )
}

/** The address of an achievement's panel, which its card's button names (aria-controls). */
export function panelId(group: number): string {
  return `ach-panel-${group}`
}

/**
 * An achievement in full, in the panel its card opens across the row right under the card's row (look pass spec 11.4,
 * ui/RowPanel.tsx): its name, its stages and what they are worth, the count with −, the typed number and +, and every
 * stage with its own controls (StageRow); then its version and Look it up, where its stages share them. It shares its
 * card's clicks (`shown` and `send`), so that a change shows at once in both, and its data-group is its card's, for the
 * page to keep the keyboard's place. The region is named by the achievement; Escape inside it closes it (`close`), and
 * the note's editor keeps its own Escape. A tick in it glints the card (`ticked`).
 */
export function AchievementPanel({
  group,
  shown,
  send,
  card,
  closing,
  close,
  ticked,
}: {
  group: AchievementGroup
  shown: Shown
  send: Send
  card: RefObject<HTMLElement | null>
  closing: boolean
  close: () => void
  ticked: () => void
}) {
  const wiki = sharedWiki(group) // one Look it up, here and on the card, when every stage shares the address
  const version = group.stages.every((stage) => stage.version === group.stages[0].version) ? group.stages[0].version : null
  const id = panelId(group.id)
  // Escape closed the panel: a note being typed in it goes unsaved, as Escape in its editor drops it. Opened again
  // before it has shrunk away, the panel keeps what is typed as before.
  const escaped = useRef(false)
  useEffect(() => {
    if (!closing) escaped.current = false
  }, [closing])
  const escape = () => {
    escaped.current = true
    close()
  }
  return (
    <RowPanel
      id={id}
      labelledBy={`${id}-name`}
      card={card}
      closing={closing}
      close={escape}
      holder={{ 'data-group': group.id }}
      testId="ach-panel"
    >
      <div className="ach-panel-head">
        <h3 id={`${id}-name`} className="ach-panel-name">
          {group.name}
        </h3>
        <span className="ach-panel-sum">{panelSummary(group)}</span>
        {group.counter !== null && (
          <CounterRow group={group.id} counter={group.counter} stages={group.stages} shown={shown} send={send} />
        )}
      </div>
      <ol className={group.stages.length > 1 ? 'ach-stages' : 'ach-stages single'}>
        {group.stages.map((stage, index) => (
          <StageRow
            key={stage.id}
            group={group}
            stage={stage}
            index={index}
            shown={shown}
            send={send}
            ownWiki={wiki === null}
            ownVersion={version === null}
            ticked={ticked}
            escaped={escaped}
          />
        ))}
      </ol>
      {(version !== null || wiki !== null) && (
        <p className="ach-panel-foot">
          {version !== null && <span>Added in {version}</span>}
          {wiki !== null && <WikiLink href={wiki} />}
        </p>
      )}
    </RowPanel>
  )
}
