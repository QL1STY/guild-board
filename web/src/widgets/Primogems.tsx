import type { ReactNode } from 'react'
import '../styles/widget-primogems.css'
import { dayMonth, num, plural, weekday } from '../format.ts'
import { useModel, useTick } from '../live.ts'
import type { Pulls, PrimogemsModel, Widget } from '../types.ts'
import { Picture } from '../ui/Picture.tsx'
import { Switch } from '../ui/Switch.tsx'
import {
  barHeights, lockedPart, metaOf, PART_NAMES, partsOf, segmentWidths, sourceName, titleOf, wantsLedger, wantsPulls,
  type Part, type Parts,
} from './primogemsview.ts'
import { useHead, type WidgetContext, type WidgetType } from './widget.ts'
import { savingsSet } from './widgetview.ts'

/*
 * Primogems (the Savings widget, `savings`; the widgets and Friends design, 2.2; mockup 2): up to four parts, each with a
 * switch in its Settings. Savings and Pulls are Pulls' own balance and forecast; Earned and By source are the Ledger's days,
 * read from `/api/primogems` only while one of them is on. A widget saved before the parts has no settings and so the first
 * two, and says "Savings" in its heading as it did.
 */

const MINUTE_MS = 60_000
const PRIMOGEM = '/api/icon/static.primogem'
const NO_HISTORY = 'No wish history yet.'
const NOT_IMPORTED = 'Import the Ledger to see what you earned.'

/** What each part is called in the Settings, with its line under the name. */
const PART_WORDS: Record<Part, { name: string; about: string }> = {
  savings: { name: 'Savings', about: 'Primogems and fates, as you set them' },
  pulls: { name: 'Pulls', about: 'Now and by the end of the next version' },
  earned: { name: 'Earned', about: 'Today, this week and the last seven days' },
  sources: { name: 'By source', about: 'This month, from the Ledger' },
}

/** A model that is read only while `on`: the children get it, or null while it reads and while it is not wanted. */
function Maybe<T>({
  on, path, ctx, children,
}: { on: boolean; path: string; ctx: WidgetContext; children: (data: T | null) => ReactNode }) {
  return on ? <Read<T> path={path} ctx={ctx}>{children}</Read> : <>{children(null)}</>
}

function Read<T>({ path, ctx, children }: { path: string; ctx: WidgetContext; children: (data: T | null) => ReactNode }) {
  const { data } = useModel<T>(path, ctx.version)
  return <>{children(data)}</>
}

/** The balance and the forecast, from Pulls' model: Savings' big number and Pulls' two cells. */
function BalanceParts({ pulls, parts }: { pulls: Pulls | null; parts: Parts }) {
  if (pulls === null) return <p className="wid-line">Reading the pulls…</p>
  if (pulls.uid === null) return <p className="wid-line">{NO_HISTORY}</p>
  const { savings } = pulls
  if (savings.set === null || savings.pulls === null || savings.estimated === null) {
    return <p className="wid-line">Set the balance on the Pulls page.</p>
  }
  const by = savings.next.number === null ? `by ${dayMonth(savings.next.ends_on)}` : `by the end of ${savings.next.number}`
  return (
    <>
      {parts.savings && (
        <div className="pm-top">
          <Picture src={PRIMOGEM} sign="gem" className="pm-gem" />
          <div>
            <p className="pm-big">{num(savings.estimated.primogems)}</p>
            <p className="pm-sub">primogems and {plural(savings.estimated.fates, 'fate')}</p>
          </div>
        </div>
      )}
      {parts.pulls && (
        <div className="pm-two">
          <p className="pm-cell">
            <b>{plural(savings.pulls, 'pull')}</b>
            <span>now</span>
          </p>
          {savings.by_next_end !== null && (
            <p className="pm-cell">
              <b>{plural(savings.by_next_end, 'pull')}</b>
              <span>{by}</span>
            </p>
          )}
        </div>
      )}
    </>
  )
}

/** Today, this week and a bar for each of the last seven game days, today's marked. */
function EarnedPart({
  days, today, week,
}: { days: NonNullable<PrimogemsModel['days']>; today: number | null; week: number | null }) {
  const heights = barHeights(days)
  return (
    <section className="pm-part">
      <h4 className="pm-h">Earned</h4>
      <div className="pm-earn">
        {today !== null && (
          <p className="pm-v">
            <b>+{num(today)}</b>
            <span>today</span>
          </p>
        )}
        {week !== null && (
          <p className="pm-v">
            <b>+{num(week)}</b>
            <span>this week</span>
          </p>
        )}
        <div className="pm-days" role="img" aria-label="Primogems earned on each of the last seven days">
          {days.map((day, index) => (
            <i
              key={day.day}
              style={{ height: `${heights[index]}%` }}
              data-now={index === days.length - 1 || undefined}
              data-known={day.known || undefined}
              title={`${weekday(day.day)} ${dayMonth(day.day)}: ${day.known ? `+${num(day.earned)}` : 'not in the Ledger'}`}
            />
          ))}
        </div>
      </div>
    </section>
  )
}

/** This month's primogems as one segmented bar and its legend; each segment names its source for the stylesheet. */
function SourcesPart({ month }: { month: PrimogemsModel['month'] }) {
  if (month === null) return <p className="wid-line">This month is not in the Ledger yet.</p>
  const widths = segmentWidths(month.sources, month.total)
  return (
    <section className="pm-part">
      <h4 className="pm-h">
        {month.name} by source · <span>{num(month.total)}</span>
      </h4>
      <div className="pm-seg" aria-hidden="true">
        {month.sources.map((source, index) => (
          <i key={source.group} data-source={source.group} style={{ width: `${widths[index]}%` }} />
        ))}
      </div>
      <ul className="pm-leg">
        {month.sources.map((source) => (
          <li key={source.group} title={source.label}>
            <i data-source={source.group} aria-hidden="true" />
            {sourceName(source.group)} <b>{num(source.amount)}</b>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Body({
  ctx, parts, pulls, ledger,
}: { ctx: WidgetContext; parts: Parts; pulls: Pulls | null; ledger: PrimogemsModel | null }) {
  useTick(MINUTE_MS)
  const set = pulls === null || pulls.uid === null ? null : pulls.savings.set
  const balance = set === null ? null : savingsSet(set, ctx.live.now())
  useHead({ title: titleOf(parts), meta: metaOf(parts, balance, ledger, ctx.live.now()) })
  const count = PART_NAMES.filter((part) => parts[part]).length
  const days = ledger !== null && ledger.imported ? ledger.days : null
  return (
    <div className="pmw" data-centre data-parts={count}>
      {wantsPulls(parts) && <BalanceParts pulls={pulls} parts={parts} />}
      {wantsLedger(parts) && ledger !== null && days === null && <p className="wid-line">{NOT_IMPORTED}</p>}
      {parts.earned && ledger !== null && days !== null && <EarnedPart days={days} today={ledger.today} week={ledger.week} />}
      {parts.sources && ledger !== null && days !== null && <SourcesPart month={ledger.month} />}
    </div>
  )
}

function PrimogemsView({ widget, ctx }: { widget: Widget; ctx: WidgetContext }) {
  const parts = partsOf(widget.settings)
  return (
    <Maybe<Pulls> on={wantsPulls(parts)} path="/api/pulls" ctx={ctx}>
      {(pulls) => (
        <Maybe<PrimogemsModel> on={wantsLedger(parts)} path="/api/primogems" ctx={ctx}>
          {(ledger) => <Body ctx={ctx} parts={parts} pulls={pulls} ledger={ledger} />}
        </Maybe>
      )}
    </Maybe>
  )
}

/** Four switches, one for each part; the last one that is on stays on, and its title says why. */
function PrimogemsSettings({
  widget, change,
}: { widget: Widget; ctx: WidgetContext; change: (settings: Record<string, unknown>) => void }) {
  const parts = partsOf(widget.settings)
  const locked = lockedPart(parts)
  return (
    <fieldset className="pm-set">
      <legend>Primogems shows</legend>
      {PART_NAMES.map((part) => (
        <div key={part} className="pm-set-row">
          <span>
            {PART_WORDS[part].name}
            <small>{PART_WORDS[part].about}</small>
          </span>
          <Switch
            on={parts[part]}
            label={PART_WORDS[part].name}
            className="pm-switch"
            locked={locked === part}
            title={locked === part ? 'At least one part stays on.' : undefined}
            onPress={() => {
              if (locked !== part) change({ ...widget.settings, ...parts, [part]: !parts[part] })
            }}
          />
        </div>
      ))}
    </fieldset>
  )
}

export const SAVINGS: WidgetType = {
  id: 'savings',
  name: 'Primogems',
  about: 'Your primogems and pulls, and what you earned, from the Ledger.',
  sign: 'gem',
  min: { w: 2, h: 2 },
  max: { w: 4, h: 3 },
  start: { w: 2, h: 2 },
  settings: { savings: true, pulls: true, earned: false, sources: false },
  View: PrimogemsView,
  Settings: PrimogemsSettings,
}
