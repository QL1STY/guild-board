import type { CSSProperties } from 'react'
import '../styles/achievements.css'
import { localDay, num, plural } from '../format.ts'
import { useModel, useTick } from '../live.ts'
import { useClicked } from '../pages/AchievementGroup.tsx'
import { countText, currentStage, nextTarget, numeral, pipsOf, reachedLine } from '../pages/achievementsview.ts'
import { REGION_NAMES } from '../pages/timersview.ts'
import type { AchievementGroup, Achievements, AchievementStatus, CommissionsModel, Region, Widget } from '../types.ts'
import { emblemColour } from '../ui/emblem.ts'
import { Glint } from '../ui/Glint.tsx'
import { Bar, Pips, Seal } from '../ui/marks.tsx'
import { CountUp } from '../ui/motion.tsx'
import { Picture } from '../ui/Picture.tsx'
import { Sign } from '../ui/Sign.tsx'
import { CountSteps } from './CountSteps.tsx'
import { useHead, type WidgetContext, type WidgetType } from './widget.ts'
import { commissionsMeta, tickedPercent } from './widgetview.ts'

/** Every achievement with a pinned stage, from every category, as the Pinned category reads them. */
const PINNED = '/api/achievements?view=all&pinned=true'
/** The game day turns at 04:00 server time, and no event says so: the commissions are read again each minute. */
const MINUTE_MS = 60_000

/**
 * One pinned achievement at its current stage (look pass spec 9.3 and the decision of its section 2): the first stage
 * not ticked, or the last once every stage is. The box ticks that stage, and when it is ticked the model moves the row on
 * to the next stage by itself: its numeral, its text, its reward and its count's target are the next stage's, and its
 * box is not ticked. Once every stage is ticked the row says Done and the day, until the player unpins the achievement
 * on the Achievements page. A count is a bar with the number between the − and the + that change it, and checklist parts
 * are chips that tick. A stage that its count or parts reached says so and gets a gold outline on its box, and Guild
 * Board still never ticks it. The controls follow the click at once (useClicked), and the changes go through the
 * undo note. The smallest size shows the name, pips, box and count; the text and the reward come with height
 * (widgets.css).
 */
function PinnedAchievement({ group, read, ctx }: { group: AchievementGroup; read: number; ctx: WidgetContext }) {
  const { shown, send } = useClicked(group.id, read, (_group, path, body) => ctx.change(path, body))
  const { stage, index, allDone } = currentStage(group)
  const pips = pipsOf(group)
  const several = group.stages.length > 1
  const path = `/api/achievements/stage/${stage.id}`
  const status = shown(`status:${stage.id}`, stage.status)
  const tick = (next: AchievementStatus) => void send(`status:${stage.id}`, next, path, { status: next })
  // From the model, not the clicks: the line follows what the core has.
  const reached = reachedLine(stage, group.counter, index)
  const { counter } = group
  const count = counter === null ? 0 : shown('count', counter.value)
  return (
    <li className="pn-row" aria-label={group.name}>
      <div className="pn-left">
        <span className={reached === null ? 'pn-tick' : 'pn-tick reached'}>
          <input
            type="checkbox"
            aria-label={several ? `Done: ${numeral(index)}, ${stage.description}` : `Done: ${stage.description}`}
            checked={status === 'done'}
            onChange={(event) => tick(event.target.checked ? 'done' : 'not_started')}
          />
          <Sign name="tick" />
        </span>
        {several && (
          <span className="pn-numeral" aria-hidden="true">
            {numeral(index)}
          </span>
        )}
      </div>
      <div className="pn-main">
        <div className="pn-top">
          <p className="pn-title">{group.name}</p>
          {several && <Pips total={pips.total} filled={pips.done} label={`${pips.done} of ${pips.total} stages done`} />}
        </div>
        <p className="pn-desc">{stage.description}</p>
        {allDone ? (
          <p className="pn-done">
            <Seal>Done</Seal>
            {stage.done_at !== null && ` ${localDay(stage.done_at)}`}
          </p>
        ) : (
          <>
            {counter !== null && (
              <div className="pn-prog">
                <Bar value={count} max={nextTarget(counter, group.stages)} />
                <CountSteps
                  className="pn-steps"
                  value={count}
                  text={countText({ ...counter, value: count }, group.stages)}
                  set={(next) => void send('count', next, `/api/achievements/counter/${group.id}`, { value: next })}
                />
              </div>
            )}
            {stage.parts.length > 0 && (
              <div className="pn-chips">
                {stage.parts.map((part, number) => {
                  const key = `part:${stage.id}:${number}`
                  return (
                    <label key={number} className="pn-chip">
                      <input
                        type="checkbox"
                        checked={shown(key, part.done_at !== null)}
                        onChange={(event) => {
                          const done = event.target.checked
                          void send(key, done, path, { part: { index: number, done } })
                        }}
                      />
                      <span className="pn-chip-face">
                        <Sign name="tick" />
                        {part.label}
                      </span>
                    </label>
                  )
                })}
              </div>
            )}
          </>
        )}
        {reached !== null && <p className="pn-reached">{reached}</p>}
        <p className="pn-reward">
          <Picture src="/api/icon/static.primogem" sign="gem" className="pn-gem" />
          {plural(stage.reward, 'primogem')}
        </p>
      </div>
    </li>
  )
}

/**
 * Each pinned achievement at its current stage (look pass spec 9.3). The list is the visual centre. When it is taller than
 * the body it scrolls inside it, with no scrollbar and its bottom edge fading out as the body's does, and as its rows hold
 * the controls it is not a stop of the keyboard itself. A row's controls have rings that reach 4 pixels out, which a
 * scroller clips, so the list is padded for them and takes the room back with its margins.
 */
function PinnedView({ ctx }: { widget: Widget; ctx: WidgetContext }) {
  const { data, read } = useModel<Achievements>(PINNED, ctx.version)
  if (data === null) return <p className="wid-line">Reading the pinned achievements…</p>
  if (data.groups.length === 0) return <p className="wid-line">Nothing is pinned yet.</p>
  return (
    <div className="pn" data-centre>
      <ul className="pn-list w-scroll">
        {data.groups.map((group) => (
          <PinnedAchievement key={group.id} group={group} read={read} ctx={ctx} />
        ))}
      </ul>
    </div>
  )
}

/** The region a Commissions to look for widget shows; null follows the region in Settings. */
function chosenRegion(widget: Widget): Region | null {
  const { region } = widget.settings
  return typeof region === 'string' && region in REGION_NAMES ? (region as Region) : null
}

/**
 * The commission names that can still earn an achievement in a region (look pass spec 9.4): the region's emblem in a gold
 * ring beside its name, which the heading counts the names under ("3 to look for"), and the names as a calm list, one
 * to a line, each with the commission's star on a hairline rule. Where the core names no emblem, as the demo does not,
 * the star shows in the ring. A list taller than the body scrolls inside it, below the emblem and the name.
 */
function CommissionsView({ widget, ctx }: { widget: Widget; ctx: WidgetContext }) {
  const region = chosenRegion(widget)
  const minutes = useTick(MINUTE_MS)
  const path = region === null ? '/api/commissions' : `/api/commissions?region=${region}`
  const { data } = useModel<CommissionsModel>(path, ctx.version + minutes)
  useHead({ meta: commissionsMeta(data === null ? 0 : data.looking_for.length) })
  if (data === null) return <p className="wid-line">Reading the daily commissions…</p>
  const name = REGION_NAMES[data.region]
  return (
    <div className="look" data-centre>
      <div className="look-head">
        <Picture
          src={data.region_icon}
          sign="star"
          className="look-emblem"
          style={{ '--emblem': emblemColour(data.region) } as CSSProperties}
        />
        <h4 className="look-region">{name}</h4>
      </div>
      {data.looking_for.length === 0 ? (
        <p className="wid-line">Nothing to look for in {name}.</p>
      ) : (
        <ul className="look-list w-scroll">
          {data.looking_for.map((quest) => (
            <li key={quest}>
              <Sign name="star" />
              <span>{quest}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function CommissionsSettingsForm({
  widget,
  change,
}: {
  widget: Widget
  ctx: WidgetContext
  change: (settings: Record<string, unknown>) => void
}) {
  const region = chosenRegion(widget)
  return (
    <label className="wid-field">
      Region
      <select
        aria-label="Region"
        value={region ?? ''}
        onChange={(event) => change({ ...widget.settings, region: event.target.value === '' ? null : event.target.value })}
      >
        <option value="">As in Settings</option>
        {Object.entries(REGION_NAMES).map(([key, name]) => (
          <option key={key} value={key}>
            {name}
          </option>
        ))}
      </select>
    </label>
  )
}

/**
 * The achievements ticked against all (look pass spec 9.5): the count, a bar with its percentage at its end, and with
 * room the primogems to earn, with the primogem's picture, and how many are left, which the heading says as well.
 * HoYoLAB's count is not shown. The bar is the visual centre. The count glints once when the model gives another one
 * (look pass spec 14.2).
 */
function ProgressView({ ctx }: { widget: Widget; ctx: WidgetContext }) {
  const board = ctx.board
  useHead({ meta: board === null ? null : `${num(board.achievements.left)} left` })
  if (board === null) return <p className="wid-line">Reading the achievements…</p>
  const { done, stages, left, primogems_left: primogems } = board.achievements
  return (
    <div className="prog">
      <p className="prog-top">
        <Glint className="fig" value={done}>
          <CountUp value={done} />
        </Glint>
        <small>of {num(stages)} ticked</small>
      </p>
      <div className="prog-meter" data-centre>
        <Bar value={done} max={stages} />
        <span className="prog-percent">{tickedPercent(done, stages)}%</span>
      </div>
      <p className="prog-info">
        <span className="prog-earn">
          <Picture src="/api/icon/static.primogem" sign="gem" className="prog-gem" />
          {plural(primogems, 'primogem')} to earn
        </span>
        <span>{num(left)} left</span>
      </p>
    </div>
  )
}

export const PINNED_ACHIEVEMENTS: WidgetType = {
  id: 'pinned',
  name: 'Pinned achievements',
  about: 'Your pinned achievements, each at its current stage, with its tick and count.',
  sign: 'pin',
  min: { w: 3, h: 2 },
  max: { w: 6, h: 5 },
  start: { w: 4, h: 3 },
  settings: {},
  View: PinnedView,
}

export const COMMISSIONS: WidgetType = {
  id: 'commissions',
  name: 'Commissions to look for',
  about: 'The commission names that can still earn an achievement.',
  sign: 'star',
  min: { w: 2, h: 2 },
  max: { w: 4, h: 4 },
  start: { w: 2, h: 3 },
  settings: { region: null },
  View: CommissionsView,
  Settings: CommissionsSettingsForm,
}

export const PROGRESS: WidgetType = {
  id: 'progress',
  name: 'Achievement progress',
  about: 'Ticked against all, what is left, and the primogems to earn.',
  sign: 'cup',
  min: { w: 2, h: 1 },
  max: { w: 4, h: 2 },
  start: { w: 3, h: 1 },
  settings: {},
  View: ProgressView,
}
