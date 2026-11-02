import type { ReactNode } from 'react'
import '../styles/achievements.css'
import { useModel, useTick } from '../live.ts'
import { useClicked } from '../pages/AchievementGroup.tsx'
import { countText } from '../pages/achievementsview.ts'
import { progressOf, stateLine } from '../pages/timersview.ts'
import type { AchievementStage, Timer, TimersModel, Widget } from '../types.ts'
import { Dial, Seal } from '../ui/marks.tsx'
import { Picture } from '../ui/Picture.tsx'
import { Segmented } from '../ui/Segmented.tsx'
import { CountSteps } from './CountSteps.tsx'
import { useOnePress } from './onepress.ts'
import { settingsOf, useHead, useOneCell, type WidgetContext, type WidgetType } from './widget.ts'
import { readySince, timeLead, timerSign, type TimersSettings, timersMeta, timersShown } from './widgetview.ts'

const SHOW = [
  { value: 'all', label: 'All' },
  { value: 'ready', label: 'Ready' },
  { value: 'chosen', label: 'Chosen' },
] as const

/** The Timers widget's settings, as a later version or a hand might have left them. */
function timersSettings(widget: Widget): TimersSettings {
  const { show, chosen } = widget.settings
  return {
    show: show === 'ready' || show === 'chosen' ? show : 'all',
    chosen: Array.isArray(chosen) ? chosen.filter((id): id is number => typeof id === 'number') : [],
  }
}

/**
 * Cleared, as the Timers category sends it, through the undo note. One at a time, and not again for half a
 * second after the core answers, as a second click of a double-click could land on a row that moved up.
 */
function useCleared(ctx: WidgetContext): { resting: boolean; cleared: (timer: Timer) => void } {
  const { resting, press } = useOnePress()
  return { resting, cleared: (timer) => press(() => ctx.change(`/api/timers/${timer.id}/cleared`, {})) }
}

/** A timer's picture in the dial, the ring of its time passed: green and ticked when it is ready (look pass spec 9.1). */
function TimerDial({ timer, now }: { timer: Timer; now: Date }) {
  return (
    <Dial progress={progressOf(timer, now)} ready={timer.state === 'ready'}>
      <Picture src={timer.icon} sign={timerSign(timer)} />
    </Dial>
  )
}

/**
 * Cleared, solid only where the timer is ready and quiet while it runs (spec 9.1), one size either way. Named by its
 * timer ("Cleared Teapot · Jade Field"), since every button of a list says the same word.
 */
function ClearedButton({ timer, resting, cleared }: { timer: Timer; resting: boolean; cleared: (timer: Timer) => void }) {
  return (
    <button
      type="button"
      className={timer.state === 'ready' ? 'gb-btn' : 'gb-btn quiet'}
      aria-label={`Cleared ${timer.name}`}
      aria-disabled={resting}
      onClick={() => cleared(timer)}
    >
      Cleared
    </button>
  )
}

/**
 * One row of the Timers list: the dial, the name, and under it the state. A running timer's state is the time left first
 * ("in 9 h 59 min · Thu 23:16"), a ready one's the Ready seal and since when, and a timer of the player's own that has
 * done all its visits says so, "All 3 visits done". Cleared stands at the end.
 */
function TimerRow({ timer, now, resting, cleared }: { timer: Timer; now: Date; resting: boolean; cleared: (timer: Timer) => void }) {
  const lead = timeLead(timer, now)
  const since = readySince(timer, now)
  return (
    <li className={timer.state === 'ready' ? 'tm-row ready' : 'tm-row'}>
      <TimerDial timer={timer} now={now} />
      <span className="tm-name">{timer.name}</span>
      <span className="tm-state">
        {timer.state === 'ready' ? (
          <>
            <Seal>Ready</Seal>
            {since !== null && ` ${since}`}
          </>
        ) : lead !== null ? (
          <>
            <b>{lead.lead}</b> · {lead.at}
          </>
        ) : (
          stateLine(timer, now)
        )}
      </span>
      <ClearedButton timer={timer} resting={resting} cleared={cleared} />
    </li>
  )
}

/**
 * The timers, all of them, the ready ones or the ones chosen (spec 13.3), as the look pass draws them (spec 9.1): two
 * groups, Ready and then Running, each headed by a small diamond and a gold hairline, and in them a row for each timer,
 * soonest first. The list is the visual centre. When it is taller than the body it scrolls inside it, and as its rows
 * hold the buttons it is not a stop of the keyboard itself. It is one list with the headings among the rows, not a list
 * under each heading, and its rows are keyed by their timers: a row that turns ready, or is cleared, then moves from
 * one group to the other as the element it is, which React moves in the list and which keeps the keyboard's focus, where
 * a row drawn anew in another list would lose it. The heading has the count of the ready ones and the running ones.
 */
function TimersView({ widget, ctx }: { widget: Widget; ctx: WidgetContext }) {
  const settings = timersSettings(widget)
  const { data } = useModel<TimersModel>('/api/timers', ctx.version)
  const { resting, cleared } = useCleared(ctx)
  useTick(1000)
  const shown = data === null ? [] : timersShown(data.timers, settings)
  useHead({ meta: timersMeta(shown) })
  if (data === null) return <p className="wid-line">Reading the timers…</p>
  if (shown.length === 0) {
    const none = { all: 'No timer.', ready: 'No timer is ready.', chosen: 'No timer chosen.' }
    return <p className="wid-line">{none[settings.show]}</p>
  }
  const now = ctx.live.now()
  const items: ReactNode[] = []
  for (const [group, timers] of [
    ['Ready', shown.filter((timer) => timer.state === 'ready')],
    ['Running', shown.filter((timer) => timer.state !== 'ready')],
  ] as const) {
    if (timers.length === 0) continue
    items.push(
      <li key={group} className="tm-group" role="presentation">
        <h4>{group}</h4>
      </li>,
    )
    for (const timer of timers) {
      items.push(<TimerRow key={timer.id} timer={timer} now={now} resting={resting} cleared={cleared} />)
    }
  }
  return (
    <div className="tms">
      <ul className="tm-list w-scroll" data-centre>
        {items}
      </ul>
    </div>
  )
}

function TimersSettingsForm({
  widget,
  ctx,
  change,
}: {
  widget: Widget
  ctx: WidgetContext
  change: (settings: Record<string, unknown>) => void
}) {
  const settings = timersSettings(widget)
  const { data } = useModel<TimersModel>('/api/timers', ctx.version)
  return (
    <>
      <Segmented label="Show" options={SHOW} value={settings.show} onChange={(show) => change({ ...widget.settings, show })} />
      {settings.show === 'chosen' && (
        <div className="wid-choices">
          {data?.timers.map((timer) => (
            <label key={timer.id} className="wid-check">
              <input
                type="checkbox"
                checked={settings.chosen.includes(timer.id)}
                onChange={(event) =>
                  change({
                    ...widget.settings,
                    show: 'chosen',
                    chosen: event.target.checked
                      ? [...settings.chosen, timer.id]
                      : settings.chosen.filter((id) => id !== timer.id),
                  })
                }
              />
              {timer.name}
            </label>
          ))}
        </div>
      )}
    </>
  )
}

/** The timer a One timer widget shows, by its number, or null until one is chosen. */
function chosenTimer(widget: Widget): number | null {
  const { timer } = settingsOf(widget, { timer: null as unknown })
  return typeof timer === 'number' ? timer : null
}

/**
 * The count of the achievement a timer serves where Cleared adds nothing to it, as for the items a teapot field gives
 * and the fish caught: the count between the − and the + that change it (CountSteps), which send what the Timers
 * category's card sends, through the undo note. A press shows its count at once and the core's takes over when
 * it is read again (useClicked).
 */
function TimerCount({
  group,
  counter,
  stages,
  read,
  ctx,
}: {
  group: number
  counter: NonNullable<NonNullable<Timer['achievement']>['counter']>
  stages: readonly Pick<AchievementStage, 'status'>[]
  /** The number of the read of the timers that `counter` came from (live.ts, useModel). */
  read: number
  ctx: WidgetContext
}) {
  const { shown, send } = useClicked(group, read, (_group, path, body) => ctx.change(path, body))
  const value = shown('count', counter.value)
  return (
    <CountSteps
      className="one-steps"
      value={value}
      text={countText({ ...counter, value }, stages)}
      set={(next) => void send('count', next, `/api/achievements/counter/${group}`, { value: next })}
    />
  )
}

/**
 * A single timer, large (look pass spec 9.2; Pin to Board on a timer card adds one): its picture in a large dial, the
 * ring of its time passed, and beside it the time left, and Cleared. The heading names the timer, not the type. One cell
 * tall there is room for the time left in large figures and Cleared, and the heading has the clock time it comes back at;
 * from two cells tall the body says "Back in", the time left, the clock time and the achievement the timer counts toward
 * with its count, and Cleared is under the text. The count is text where Cleared adds to it (the hilichurl's kill) and
 * has its own − and + where it does not (a teapot field's items, the fish caught): a number beside an action moves with
 * it or is changed there, as on the Timers category's card. A ready timer has the Ready seal and since when instead of
 * the time left, a full green ring with its tick, and a solid Cleared. The dial is the visual centre.
 */
function OneTimerView({ widget, ctx }: { widget: Widget; ctx: WidgetContext }) {
  const id = chosenTimer(widget)
  const { data, read } = useModel<TimersModel>('/api/timers', ctx.version)
  const { resting, cleared } = useCleared(ctx)
  const { ref, short } = useOneCell()
  useTick(1000)
  const now = ctx.live.now()
  const timer = id === null || data === null ? undefined : data.timers.find((one) => one.id === id)
  const lead = timer === undefined ? null : timeLead(timer, now)
  // The type's name stays in the heading until there is a timer to name, and the clock time goes there only where the
  // body has no room for it.
  useHead({ title: timer?.name, meta: short && lead !== null ? lead.at : null })
  if (id === null) return <p className="wid-line">Choose a timer in Edit.</p>
  if (data === null) return <p className="wid-line">Reading the timers…</p>
  if (timer === undefined) return <p className="wid-line">This timer was removed.</p>
  const since = readySince(timer, now)
  const { achievement } = timer
  // A time that has come reads "now" until the core says the timer is ready.
  const soon = lead?.lead === 'now'
  return (
    <div ref={ref} className="one">
      <div className="one-dial" data-centre>
        <TimerDial timer={timer} now={now} />
      </div>
      <div className="one-tx">
        {timer.state === 'ready' ? (
          <>
            <p className="one-lead">
              <Seal>Ready</Seal>
            </p>
            {since !== null && <p className="one-when">{since}</p>}
          </>
        ) : lead !== null ? (
          <>
            <p className="one-lead one-label">{soon ? 'Back' : 'Back in'}</p>
            <p className="one-big">{soon ? 'now' : lead.lead.replace(/^in /, '')}</p>
            <p className="one-when one-at">{lead.at}</p>
          </>
        ) : (
          <p className="one-when">{stateLine(timer, now)}</p>
        )}
        {achievement !== null && (
          <div className="one-ach">
            <p>{achievement.name}</p>
            {achievement.counter !== null &&
              (achievement.counter.cleared_adds ? (
                <p>
                  <b>{countText(achievement.counter, achievement.stages)}</b>
                </p>
              ) : (
                <TimerCount group={achievement.id} counter={achievement.counter} stages={achievement.stages} read={read} ctx={ctx} />
              ))}
          </div>
        )}
      </div>
      <ClearedButton timer={timer} resting={resting} cleared={cleared} />
    </div>
  )
}

function OneTimerSettingsForm({
  widget,
  ctx,
  change,
}: {
  widget: Widget
  ctx: WidgetContext
  change: (settings: Record<string, unknown>) => void
}) {
  const id = chosenTimer(widget)
  const { data } = useModel<TimersModel>('/api/timers', ctx.version)
  // The timers as one list of choices, each a click: no list that drops down, which the window's engine may not open.
  return (
    <fieldset className="wid-choose">
      <legend>Timer</legend>
      {data === null ? (
        <p className="wid-line">Reading the timers…</p>
      ) : data.timers.length === 0 ? (
        <p className="wid-line">There are no timers yet.</p>
      ) : (
        data.timers.map((timer) => (
          <label key={timer.id} className="wid-choice">
            <input
              type="radio"
              name={`timer-of-${widget.id}`}
              checked={timer.id === id}
              onChange={() => change({ ...widget.settings, timer: timer.id })}
            />
            {timer.name}
          </label>
        ))
      )}
    </fieldset>
  )
}

export const TIMERS: WidgetType = {
  id: 'timers',
  name: 'Timers',
  about: 'Your timers, each with Cleared.',
  sign: 'hourglass',
  min: { w: 3, h: 2 },
  max: { w: 6, h: 5 },
  start: { w: 4, h: 3 },
  settings: { show: 'all', chosen: [] },
  View: TimersView,
  Settings: TimersSettingsForm,
}

export const ONE_TIMER: WidgetType = {
  id: 'one-timer',
  name: 'One timer',
  about: 'A single timer, large.',
  sign: 'hourglass',
  min: { w: 2, h: 1 },
  max: { w: 3, h: 3 },
  start: { w: 2, h: 2 },
  settings: { timer: null },
  View: OneTimerView,
  Settings: OneTimerSettingsForm,
}
