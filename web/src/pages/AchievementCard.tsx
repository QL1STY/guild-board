import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { localDay, num, plural } from '../format.ts'
import type { AchievementGroup, AchievementStatus } from '../types.ts'
import { Bar, Pips, Seal } from '../ui/marks.tsx'
import { useGlint } from '../ui/motion.tsx'
import { Picture } from '../ui/Picture.tsx'
import { usePanelPresence } from '../ui/RowPanel.tsx'
import { Sign } from '../ui/Sign.tsx'
import { CountSteps } from '../widgets/CountSteps.tsx'
import { type Change, type Send, type Shown, useClicked, WikiLink } from './AchievementGroup.tsx'
import { AchievementPanel, panelId } from './AchievementPanel.tsx'
import {
  chipsFit, countText, currentStage, lastTicked, nextTarget, numeral, pinnedAt, reachedLine,
} from './achievementsview.ts'

/**
 * The card's third row (look pass spec 11.3), for the stage the achievement stands at: a count is a bar against the
 * stage's target with the count between the − and + that change it; a checklist is its parts as chips that tick, when
 * they fit, or else a bar and "2 of 6 parts". A chip's name is cut short where the card is narrow, and whole in its tip
 * and its accessible name. A count or parts that reached the target say so, with the line Guild Board uses today, in
 * place of the bar or the chips, and − and + stay beside the count. Null when there is neither: the stage's text takes
 * the room.
 */
function Progress({
  group,
  stage,
  index,
  shown,
  send,
}: {
  group: AchievementGroup
  stage: AchievementGroup['stages'][number]
  index: number
  shown: Shown
  send: Send
}) {
  const { counter } = group
  // From the model, not the clicks: the line follows what the core has.
  const reached = reachedLine(stage, counter, index)
  const line = reached !== null && <p className="ach-reached" title={reached}>{reached}</p>
  if (counter !== null) {
    const count = shown('count', counter.value)
    return (
      <div className="ach-prog">
        {line || <Bar value={count} max={nextTarget(counter, group.stages)} />}
        <CountSteps
          className="ach-steps"
          value={count}
          text={countText({ ...counter, value: count }, group.stages)}
          set={(next) => void send('count', next, `/api/achievements/counter/${group.id}`, { value: next })}
        />
      </div>
    )
  }
  const { parts } = stage
  if (parts.length === 0) return null
  if (line) return <div className="ach-prog">{line}</div>
  const path = `/api/achievements/stage/${stage.id}`
  const ticked = parts.map((part, number) => shown(`part:${stage.id}:${number}`, part.done_at !== null))
  const done = ticked.filter(Boolean).length
  if (!chipsFit(parts.map((part) => part.label))) {
    return (
      <div className="ach-prog">
        <Bar value={done} max={parts.length} />
        <span className="ach-of-parts">
          {num(done)} of {plural(parts.length, 'part')}
        </span>
      </div>
    )
  }
  return (
    <div className="ach-prog">
      {parts.map((part, number) => {
        const key = `part:${stage.id}:${number}`
        return (
          <label key={number} className="ach-chip" title={part.label}>
            <input
              type="checkbox"
              data-focus="part"
              checked={ticked[number]}
              onChange={(event) => {
                const next = event.target.checked
                void send(key, next, path, { part: { index: number, done: next } })
              }}
            />
            <span className="ach-chip-face">
              <Sign name="tick" />
              <span className="ach-chip-name">{part.label}</span>
            </span>
          </label>
        )
      })}
      <span className="ach-of-parts">
        {num(done)} of {num(parts.length)}
      </span>
    </div>
  )
}

/**
 * One achievement as an even card (look pass spec 11.3 and 11.5), one height for every card of a list, in four rows:
 * its tick box, name, stage pips and Look it up; the text of the stage it stands at (the first not ticked, or the last
 * once every one is), with the stage's numeral when it has several; its progress (Progress); and the stage's reward and
 * version, with In progress, Pin and the button of its panel.
 *
 * The box ticks or unticks that stage with the page's rules (ticking a stage ticks the earlier ones). Once every stage
 * is ticked the box stays ticked, unticking the last stage, and the Done seal says the day. Pin is the whole
 * achievement's (look pass spec 2): on while any stage is pinned, and pressed then it unpins every stage in one change;
 * otherwise it pins the stage the achievement stands at. In progress is that stage's. A tick stamps the box it was made
 * with, here or in the panel, fills a pip and glints the card once. Ticking a checklist's last part swaps the chips for
 * the line that offers the tick, and takes away the chip that had the focus: the focus goes to the box, which the line
 * asks for.
 *
 * "3 stages" or "Details" opens the achievement in its panel (AchievementPanel), which comes right after the card in the
 * page and shares its clicks. `open` says whether it is open, and `onToggle` asks the page to open or close it: one
 * panel at a time. The card's data-group and each control's data-focus let the page keep the keyboard's place when a
 * card leaves the list (Achievements.tsx). Memoised: the page's own changes, such as its note, leave the cards as
 * they are, and so does a read that changed nothing of the card's: the page keeps an unchanged group's object
 * (shareGroups) and gives the read's number only to a card whose clicks wait for a read (`onWaiting`; audit L22).
 */
export const AchievementCard = memo(function AchievementCard({
  group,
  read,
  change,
  showCategory,
  open,
  onToggle,
  onWaiting,
}: {
  group: AchievementGroup
  /** The number of the model read that `group` came from, while a click of the card's waits for a read; else 0. */
  read: number
  change: Change
  /** Set where the page shows achievements of every category, as Pinned and a search do. */
  showCategory: boolean
  open: boolean
  onToggle: (group: number) => void
  /** Hears when a click of the card's begins to wait for a read, and when none waits any more. */
  onWaiting: (group: number, waiting: boolean) => void
}) {
  const { shown, send, waiting } = useClicked(group.id, read, change)
  const told = useRef(false) // what onWaiting last heard: a card with no click to wait for says nothing
  useEffect(() => {
    if (waiting === told.current) return
    told.current = waiting
    onWaiting(group.id, waiting)
  }, [group.id, waiting, onWaiting])
  // A card that leaves the list with a click still waiting takes it with it.
  useEffect(
    () => () => {
      if (told.current) onWaiting(group.id, false)
    },
    [group.id, onWaiting],
  )
  // The player's ticks, on the card or in its panel: each one glints the card once. Those made with the card's box
  // stamp it; the panel's boxes stamp themselves.
  const [ticks, setTicks] = useState(0)
  const [stamps, setStamps] = useState(0)
  const glint = useGlint(ticks)
  const stamp = useGlint(stamps)
  const ticked = useCallback(() => setTicks((count) => count + 1), [])
  const article = useRef<HTMLElement>(null)
  const box = useRef<HTMLInputElement>(null)
  const panelButton = useRef<HTMLButtonElement>(null)
  // The card's control that has the focus, or had it last when the focus went to no element, by its data-focus.
  const focused = useRef<string | null>(null)
  // The panel stays in the page while it shrinks away after it is closed (look pass spec 11.4).
  const present = usePanelPresence(open)
  // Escape in the panel: it closes, and the focus it holds goes back to the button that opened it.
  const closePanel = () => {
    panelButton.current?.focus()
    onToggle(group.id)
  }
  const { stage, index, allDone } = currentStage(group)
  const several = group.stages.length > 1
  const heading = `ach-${group.id}`
  const path = `/api/achievements/stage/${stage.id}`
  const status = shown(`status:${stage.id}`, stage.status)
  const setStatus = (next: AchievementStatus) => {
    if (next === 'done') {
      setTicks((count) => count + 1)
      setStamps((count) => count + 1)
    }
    void send(`status:${stage.id}`, next, path, { status: next })
  }
  const pinned = shown('pin', pinnedAt(group))
  const pin = () => {
    if (pinned) void send('pin', false, `/api/achievements/group/${group.id}/unpin`, undefined)
    else void send('pin', true, path, { pinned: true })
  }
  // The pips follow the clicks at once, as the box does.
  const done = group.stages.filter((each) => shown(`status:${each.id}`, each.status) === 'done').length
  const reached = reachedLine(stage, group.counter, index) !== null
  // The line that offers the tick has taken the place of the chips, and of the chip that had the focus.
  useLayoutEffect(() => {
    if (!reached || focused.current !== 'part') return
    const active = document.activeElement
    if (active !== null && active !== document.body) return // the focus is somewhere still
    focused.current = null
    box.current?.focus()
  }, [reached])
  const finished = allDone ? lastTicked(group) : null
  const noted = group.stages.some((each) => shown(`note:${each.id}`, each.note) !== '')
  const progress = <Progress group={group} stage={stage} index={index} shown={shown} send={send} />
  const bare = group.counter === null && stage.parts.length === 0 // no third row: the text takes its room
  const classes = ['gb-panel', 'ach-card', bare && 'bare', allDone && 'done', open && 'open', glint].filter(Boolean)
  return (
    <>
      <article
        ref={article}
        className={classes.join(' ')}
        aria-labelledby={heading}
        data-testid="ach-group"
        data-group={group.id}
        onFocus={(event) => {
          focused.current = (event.target as HTMLElement).dataset.focus ?? null
        }}
        onBlur={(event) => {
          // A move to something outside the card forgets the control; a move to no element, as when the control goes
          // from the page, keeps it.
          const next = event.relatedTarget
          if (next instanceof Node && !event.currentTarget.contains(next)) focused.current = null
        }}
      >
        <span className={['ach-box', reached && 'reached', stamp && 'stamp'].filter(Boolean).join(' ')}>
          <input
            ref={box}
            type="checkbox"
            aria-label={several ? `Done: ${numeral(index)}, ${stage.description}` : `Done: ${stage.description}`}
            data-focus="done"
            checked={status === 'done'}
            onChange={(event) => setStatus(event.target.checked ? 'done' : 'not_started')}
          />
          <Sign name="tick" />
        </span>
        <div className="ach-head">
          <h3 id={heading} className="ach-name">
            {group.name}
          </h3>
          {several && <Pips total={group.stages.length} filled={done} label={`${done} of ${group.stages.length} stages done`} />}
          {allDone && <Seal>{finished === null ? 'Done' : `Done ${localDay(finished)}`}</Seal>}
          <WikiLink href={stage.wiki} />
        </div>
        <p className="ach-text">
          {several && <span className="ach-numeral">{numeral(index)}</span>}
          {stage.description}
        </p>
        {!bare && progress}
        <div className="ach-foot">
          <p className="ach-info">
            {/* The number beside the primogem's picture, as the game shows a reward; the word is for screen readers. */}
            <span className="ach-reward">
              <Picture src="/api/icon/static.primogem" sign="gem" className="ach-gem" />
              {num(stage.reward)}
              <span className="sr-only">{stage.reward === 1 ? ' primogem' : ' primogems'}</span>
            </span>
            {noted && (
              <span className="ach-quill" title="Has a note">
                <Sign name="quill" />
                <span className="sr-only">Has a note</span>
              </span>
            )}
            {/* Where the page shows every category, the card names its own, which gives way first to the version. */}
            {showCategory && <span className="ach-where">{group.category}</span>}
            <span className="ach-ver">
              {showCategory && '· '}Added in {stage.version}
            </span>
          </p>
          <span className="ach-acts">
            {/* A done stage is unticked first, and a press does nothing. aria-disabled, not disabled, which would drop
                the focus to the page when a tick from elsewhere arrives while the button has it. */}
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
            <button type="button" className="ach-toggle" aria-pressed={pinned} data-focus="pin" onClick={pin}>
              Pin
            </button>
            <button
              ref={panelButton}
              type="button"
              className="ach-toggle ach-panel-btn"
              aria-expanded={open}
              aria-controls={present ? panelId(group.id) : undefined}
              data-focus="details"
              onClick={() => onToggle(group.id)}
            >
              {several ? `${num(group.stages.length)} stages` : 'Details'}
              <Sign name="chevron" />
            </button>
          </span>
        </div>
      </article>
      {present && (
        <AchievementPanel
          group={group}
          shown={shown}
          send={send}
          card={article}
          closing={!open}
          close={closePanel}
          ticked={ticked}
        />
      )}
    </>
  )
})
