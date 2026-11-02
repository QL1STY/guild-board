import { useState } from 'react'
import { api } from '../api.ts'
import { useModel } from '../live.ts'
import type { Week, Widget } from '../types.ts'
import { Picture } from '../ui/Picture.tsx'
import { weekShown } from '../pages/characters/hidden.ts'
import { Sign } from '../ui/Sign.tsx'
import { useHead, type WidgetContext, type WidgetType } from './widget.ts'
import { todayLayout, todayTick, todayView } from './widgetview.ts'

/*
 * The Today widget (the Characters plan, Task U7; the design's section 6.6): today's steps of the week plan, each with its
 * face, its task, its resin and a tick box, and today's resin as a bar. It reads the week model (`GET /api/week`, whose
 * `today` part is its model) and shares its ticks with the week page, which the core keeps. It draws with the widget roles
 * alone (widgets.css), on the Board and, with `.on-dark`, on the overlay.
 */

const READING = 'Reading your week…'

function TodayBody({ widget, ctx }: { widget: Widget; ctx: WidgetContext }) {
  const { data } = useModel<Week>('/api/week', ctx.version)
  // What the core answered to a tick, until a newer read of the week takes over.
  const [answer, setAnswer] = useState<{ base: Week; week: Week } | null>(null)
  const week = data === null ? null : answer !== null && answer.base === data ? answer.week : data
  const view = week === null ? null : todayView(week)
  useHead({ meta: view === null ? null : view.meta })
  if (week === null || view === null) return <p className="wid-line">{READING}</p>
  const layout = todayLayout({ w: widget.w, h: widget.h })
  const names = new Map(week.characters.map((one) => [one.key, one]))
  const tick = async (rowKey: string, done: boolean) => {
    const task = week.today.tasks.find((one) => one.key === rowKey)
    if (task === undefined) return
    try {
      const next = await api.put<Week>('/api/week/ticks', todayTick(week, task, done))
      if (data !== null) setAnswer({ base: data, week: next })
    } catch {
      // The next read of the week shows what the core has.
    }
  }
  return (
    <div className="td" data-centre>
      {layout.bar && view.bar.length > 0 && (
        <div className="td-resin">
          <div className="td-bar" role="img" aria-label={`Today's resin: ${view.resin}`}>
            {view.bar.map((segment) => (
              <i key={segment.key} className={segment.left ? 'left' : segment.done ? 'done' : undefined} style={{ flex: segment.resin }} />
            ))}
          </div>
          <span className="td-resin-text">{view.resin}</span>
        </div>
      )}
      {view.line !== null ? (
        <p className="wid-line" data-centre>
          {view.line}
        </p>
      ) : (
        <ul className="td-list w-scroll">
          {view.rows.map((row) => (
            <li key={row.key} className={row.done ? 'td-row done' : 'td-row'}>
              <span className="pn-tick">
                <input
                  type="checkbox"
                  aria-label={`${row.done ? 'Not done' : 'Done'}: ${row.title}`}
                  checked={row.done}
                  onChange={(event) => void tick(row.key, event.target.checked)}
                />
                <Sign name="tick" />
              </span>
              {layout.faces && (
                <span className="td-faces">
                  {row.who.slice(0, 2).map((key) => (
                    <Picture key={key} src={names.get(key)?.icon ?? null} sign="bust" className="td-face" />
                  ))}
                </span>
              )}
              <span className="td-text">
                <b>{row.title}</b>
                <span>{layout.why ? row.why : row.who.map((key) => names.get(key)?.name ?? key).join(' and ')}</span>
              </span>
              <span className={row.free ? 'td-cost free' : 'td-cost'}>{row.cost}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** While Your week is hidden the widget shows nothing and reads nothing, and it is as it was when the week is back. */
function TodayView({ widget, ctx }: { widget: Widget; ctx: WidgetContext }) {
  return weekShown(ctx.live.status) ? <TodayBody widget={widget} ctx={ctx} /> : null
}

export const TODAY: WidgetType = {
  id: 'today',
  name: 'Today',
  about: "Today's steps in your week plan, and today's resin.",
  sign: 'book',
  min: { w: 3, h: 2 },
  max: { w: 6, h: 5 },
  start: { w: 3, h: 3 },
  needsWeek: true,
  settings: {},
  View: TodayView,
}
