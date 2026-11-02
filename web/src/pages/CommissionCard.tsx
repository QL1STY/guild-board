import { memo, useRef } from 'react'
import { num, plural } from '../format.ts'
import type { AchievementStatus, Commission } from '../types.ts'
import { Bar } from '../ui/marks.tsx'
import { Picture } from '../ui/Picture.tsx'
import { RowPanel, usePanelPresence } from '../ui/RowPanel.tsx'
import { Sign } from '../ui/Sign.tsx'
import { type Change, type Send, type Shown, useClicked } from './AchievementGroup.tsx'
import { CHIPS_AT_MOST, reachedLine } from './achievementsview.ts'
import { appearedLine, chainLine, partDone } from './commissionsview.ts'

/** The address of a commission's panel, which its card's Details names (aria-controls). */
function panelId(card: number): string {
  return `com-panel-${card}`
}

/**
 * The card's third row (look pass spec 11.7): the parts as chips that tick, with Next on the next part of a chain and
 * the later ones dimmed, from the model, as the panel has them, or a bar and "2 of 6 parts" for more than four; or,
 * without parts, when the commission last appeared. Each chip is named by its part, and its name, cut short on the card
 * where it is long, is whole in its tip and in the panel.
 */
function Progress({
  card,
  shown,
  send,
  appeared,
}: {
  card: Commission
  shown: Shown
  send: Send
  appeared: boolean
}) {
  const { parts } = card
  if (parts.length === 0) return <p className="com-prog">{appearedLine({ ...card, appeared_today: appeared })}</p>
  // From the model, not the clicks, as the lines are: a done achievement marks no part.
  const next = card.status === 'done' ? null : card.next_part
  const path = `/api/achievements/stage/${card.id}`
  if (parts.length > CHIPS_AT_MOST) {
    const done = parts.filter((part) => shown(`part:${part.index}`, part.done_at !== null)).length
    return (
      <div className="com-prog">
        <Bar value={done} max={parts.length} />
        <span className="com-of-parts">
          {num(done)} of {plural(parts.length, 'part')}
        </span>
      </div>
    )
  }
  return (
    <ul className="com-prog com-chips">
      {parts.map((part) => {
        const key = `part:${part.index}`
        return (
          <li key={part.index} className={next !== null && part.index > next ? 'later' : undefined}>
            <label className="ach-chip" title={part.name}>
              <input
                type="checkbox"
                data-focus={key}
                checked={shown(key, part.done_at !== null)}
                onChange={(event) => {
                  const done = event.target.checked
                  void send(key, done, path, { part: { index: part.index, done } })
                }}
              />
              <span className="ach-chip-face">
                <Sign name="tick" />
                <span className="ach-chip-name">{part.name}</span>
              </span>
            </label>
            {part.index === next && <span className="com-next">Next</span>}
          </li>
        )
      })}
    </ul>
  )
}

/**
 * One commission achievement as an even card (look pass spec 11.7), one height for every card, in four rows: its Done
 * box, name and primogems; the commission names to look for, and where its chain is when it is under way; its parts as
 * chips that tick, or when it last appeared (Progress); and In progress, Pin, Appeared today and Details, one size. A
 * commission whose parts are all done gets a gold outline on its box, and Guild Board still never ticks it.
 *
 * Details opens its panel under the card's row (RowPanel), with the description, what to do first and how, every part
 * with the day it was done, when it last appeared, and the line that offers the tick. `open` says whether it is open,
 * and `onToggle` asks the category to open or close it: one at a time. Its controls go into the page's undo history,
 * and follow the click at once, in the card and in the panel alike (AchievementGroup.tsx, useClicked). The card's and the
 * panel's data-card and each control's data-focus let the page keep the keyboard's place when the card moves into the
 * fold or out of it (Commissions.tsx), its panel with it. Memoised: the page's own changes, such as its note, leave
 * the cards as they are.
 */
export const CommissionCard = memo(function CommissionCard({
  card,
  read,
  change,
  open,
  onToggle,
}: {
  card: Commission
  /** The number of the model read that `card` came from (live.ts, useModel). */
  read: number
  change: Change
  open: boolean
  onToggle: (card: number) => void
}) {
  const { shown, send } = useClicked(card.id, read, change)
  const path = `/api/achievements/stage/${card.id}`
  const status = shown('status', card.status)
  const pinned = shown('pinned', card.pinned)
  const appeared = shown('appeared', card.appeared_today)
  const setStatus = (next: AchievementStatus) => void send('status', next, path, { status: next })
  // From the model, not the clicks, as the lines are: a done achievement marks no part.
  const next = card.status === 'done' ? null : card.next_part
  const chain = chainLine(card)
  const reached = reachedLine(card, null, 0)
  const heading = `com-${card.id}`
  const article = useRef<HTMLElement>(null)
  const details = useRef<HTMLButtonElement>(null)
  // The panel stays in the page while it shrinks away after it is closed.
  const present = usePanelPresence(open)
  // Escape in the panel: it closes, and the focus it holds goes back to Details.
  const closePanel = () => {
    details.current?.focus()
    onToggle(card.id)
  }
  const classes = ['gb-panel', 'com-card', status === 'done' && 'done', open && 'open'].filter(Boolean)
  return (
    <>
      <article
        ref={article}
        className={classes.join(' ')}
        aria-labelledby={heading}
        data-testid="commission"
        data-card={card.id}
      >
        <span className={reached === null ? 'ach-box' : 'ach-box reached'}>
          <input
            type="checkbox"
            aria-label={`Done: ${card.name}`}
            data-focus="done"
            checked={status === 'done'}
            onChange={(event) => setStatus(event.target.checked ? 'done' : 'not_started')}
          />
          <Sign name="tick" />
        </span>
        <h3 id={heading} className="com-name">
          {card.name}
        </h3>
        {/* The number beside the primogem's picture, as the game shows a reward; the word is for screen readers. */}
        <span className="com-reward">
          <Picture src="/api/icon/static.primogem" sign="gem" className="ach-gem" />
          {num(card.reward)}
          <span className="sr-only">{card.reward === 1 ? ' primogem' : ' primogems'}</span>
        </span>
        <div className="com-look-line">
          {/* As the game's commission list shows them. */}
          <p className="com-quests">{card.quests.length > 0 && `Look for: ${card.quests.join(' · ')}`}</p>
          {chain !== null && <p className="com-chain">{chain}</p>}
        </div>
        <Progress card={card} shown={shown} send={send} appeared={appeared} />
        <div className="com-acts">
          {/* A done achievement is unticked first, and a press does nothing. aria-disabled, not disabled, which would
              drop the focus to the page. */}
          <button
            type="button"
            className="ach-toggle"
            data-focus="progress"
            aria-pressed={status === 'in_progress'}
            aria-disabled={status === 'done'}
            onClick={() => {
              if (status !== 'done') setStatus(status === 'in_progress' ? 'not_started' : 'in_progress')
            }}
          >
            In progress
          </button>
          <button
            type="button"
            className="ach-toggle"
            data-focus="pin"
            aria-pressed={pinned}
            onClick={() => void send('pinned', !pinned, path, { pinned: !pinned })}
          >
            Pin
          </button>
          {/* Once a game day: from the press until the next game day, a press sends nothing. Undo takes it back. */}
          <button
            type="button"
            className="ach-toggle"
            data-focus="appeared"
            aria-disabled={appeared}
            onClick={() => {
              if (!appeared) void send('appeared', true, `/api/commissions/${card.id}/appeared`, undefined)
            }}
          >
            Appeared today
          </button>
          <button
            ref={details}
            type="button"
            className="ach-toggle ach-panel-btn"
            data-focus="details"
            aria-expanded={open}
            aria-controls={present ? panelId(card.id) : undefined}
            onClick={() => onToggle(card.id)}
          >
            Details
            <Sign name="chevron" />
          </button>
        </div>
      </article>
      {present && (
        <RowPanel
          id={panelId(card.id)}
          labelledBy={heading}
          card={article}
          closing={!open}
          close={closePanel}
          holder={{ 'data-card': card.id }}
          className="com-panel"
          testId="commission-panel"
        >
          <p className="com-desc">{card.description}</p>
          {card.first !== null && <p className="com-note">First: {card.first}</p>}
          {card.how !== null && <p className="com-note">{card.how}</p>}
          {card.parts.length > 0 && (
            <ul className="com-parts">
              {card.parts.map((part) => {
                const key = `part:${part.index}`
                return (
                  <li key={part.index} className={next !== null && part.index > next ? 'later' : undefined}>
                    <label className="ach-check">
                      <input
                        type="checkbox"
                        data-focus={`panel-${key}`}
                        checked={shown(key, part.done_at !== null)}
                        onChange={(event) => {
                          const done = event.target.checked
                          void send(key, done, path, { part: { index: part.index, done } })
                        }}
                      />
                      {part.name}
                    </label>
                    {part.index === next && <span className="com-next">Next</span>}
                    {part.done_at !== null && <span className="com-when">{partDone(part.done_at)}</span>}
                  </li>
                )
              })}
            </ul>
          )}
          <p className="com-appeared">{appearedLine({ ...card, appeared_today: appeared })}</p>
          {reached !== null && <p className="ach-reached">{reached}</p>}
        </RowPanel>
      )}
    </>
  )
})
