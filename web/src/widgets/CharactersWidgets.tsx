import { usePlanModel } from '../pages/useplan.ts'
import type { Widget } from '../types.ts'
import { Picture } from '../ui/Picture.tsx'
import { useHead, type WidgetContext, type WidgetType } from './widget.ts'
import { todayLayout, todayView } from './widgetview.ts'

/*
 * The Today widget (the Plan design, section 4): the talent books and weapon materials that are open today for the characters in
 * the plan, small, as the Plan page's Today shows them. It reads the Plan page's model (`GET /api/plan`), read again when the day turns at 04:00. It draws with the
 * widget roles alone (widgets.css), on the Board and, with `.on-dark`, on the overlay.
 */

const READING = 'Reading your plan…'

function TodayView({ widget, ctx }: { widget: Widget; ctx: WidgetContext }) {
  const { data } = usePlanModel(ctx.live, ctx.version)
  const view = data === null ? null : todayView(data)
  useHead({ meta: view === null ? null : view.meta })
  if (view === null) return <p className="wid-line">{READING}</p>
  const layout = todayLayout({ w: widget.w, h: widget.h })
  return (
    <div className="td" data-centre>
      {view.line !== null ? (
        <p className="wid-line" data-centre>
          {view.line}
        </p>
      ) : (
        <ul className="td-list w-scroll">
          {view.rows.map((row) => (
            <li key={row.key} className="td-row">
              <Picture src={row.icon} sign={row.kind === 'book' ? 'book' : 'sword'} className="td-mat" />
              <span className="td-text">
                <b>{row.title}</b>
                <span>{row.names}</span>
              </span>
              {layout.faces && (
                <span className="td-faces">
                  {row.who.slice(0, 3).map((one) => (
                    <Picture key={one.key} src={one.icon} sign="bust" className="td-face" />
                  ))}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export const TODAY: WidgetType = {
  id: 'today',
  name: 'Today',
  about: "The talent books and weapon materials open today for the characters in your plan.",
  sign: 'book',
  min: { w: 3, h: 2 },
  max: { w: 6, h: 5 },
  start: { w: 3, h: 3 },
  settings: {},
  View: TodayView,
}
