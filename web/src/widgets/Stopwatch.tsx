import { useTick } from '../live.ts'
import type { Widget } from '../types.ts'
import { Bar, Seal } from '../ui/marks.tsx'
import { singleClick } from './onepress.ts'
import type { WidgetContext, WidgetType } from './widget.ts'
import { useWidgetData } from './widgetdata.ts'
import { lapRows, stopwatchText } from './widgetview.ts'

const MAX_LAPS = 50

/** The stopwatch as the core keeps it, on the core's clock: when it last started, the time before, and its laps. */
type Watch = { running_since: string | null; elapsed_ms: number; laps: number[] }

function watchOf(data: unknown): Watch {
  const kept = (data ?? {}) as Partial<Record<keyof Watch, unknown>>
  return {
    running_since: typeof kept.running_since === 'string' ? kept.running_since : null,
    elapsed_ms: typeof kept.elapsed_ms === 'number' && kept.elapsed_ms >= 0 ? kept.elapsed_ms : 0,
    laps: Array.isArray(kept.laps) ? kept.laps.filter((lap): lap is number => typeof lap === 'number') : [],
  }
}

/**
 * Start, stop and laps (spec 13.3), as the look pass draws them (spec 9.12). The visual centre is the time in strong
 * tabular figures under a Running or Stopped seal, with the buttons beside it, all of one size. From two cells tall the
 * laps are rows under them, the newest first, each with a bar of its own length (the time since the lap before) against
 * the longest and that length as text, and the fastest lap says so. It keeps its time in the core, so a restart keeps
 * it. It ticks once a second, and shows tenths when stopped and in its laps. A press takes the core's time as it
 * happens, not the time of the last tick. A double-click is one press, as its second click lands on the button that took
 * the first one's place: Stop where Start was.
 */
function StopwatchView({ widget, ctx }: { widget: Widget; ctx: WidgetContext }) {
  const { data, problem, save } = useWidgetData(widget.id, watchOf, ctx.version)
  useTick(1000)
  if (data === null) return <p className="wid-line">{problem ?? 'Reading the stopwatch…'}</p>
  const since = data.running_since === null ? null : Date.parse(data.running_since)
  const running = since !== null
  /** The stopwatch's time at a moment of the core's clock. */
  const elapsedAt = (now: number) => data.elapsed_ms + (since === null ? 0 : Math.max(0, now - since))
  const press = (next: (now: number) => Watch) => singleClick(() => void save(next(ctx.live.now().getTime())))
  const elapsed = elapsedAt(ctx.live.now().getTime())
  const laps = lapRows(data.laps).reverse() // the newest lap first
  return (
    <div className="watch">
      <div className="watch-top">
        <div className="watch-now" data-centre>
          <p>
            <Seal quiet={!running}>{running ? 'Running' : 'Stopped'}</Seal>
          </p>
          <p className="fig">{stopwatchText(elapsed, !running)}</p>
        </div>
        <div className="watch-buttons">
          <button
            type="button"
            className="gb-btn"
            onClick={press((now) =>
              running
                ? { ...data, running_since: null, elapsed_ms: elapsedAt(now) }
                : { ...data, running_since: new Date(now).toISOString() },
            )}
          >
            {running ? 'Stop' : 'Start'}
          </button>
          {running && data.laps.length < MAX_LAPS && (
            <button type="button" className="gb-btn quiet" onClick={press((now) => ({ ...data, laps: [...data.laps, elapsedAt(now)] }))}>
              Lap
            </button>
          )}
          {!running && elapsed > 0 && (
            <button
              type="button"
              className="gb-btn quiet"
              onClick={press(() => ({ running_since: null, elapsed_ms: 0, laps: [] }))}
            >
              Reset
            </button>
          )}
        </div>
      </div>
      {laps.length > 0 && (
        <ol className="watch-laps w-scroll" aria-label="Laps">
          {laps.map((lap) => (
            <li key={lap.number} className="lap">
              <span className="lap-n">Lap {lap.number}</span>
              <Bar value={lap.share} max={1} />
              <span className="lap-t">{stopwatchText(lap.split, true)}</span>
              <span className="lap-tag">{lap.fastest ? 'fastest' : null}</span>
              <span className="lap-at">{stopwatchText(lap.total, true)}</span>
            </li>
          ))}
        </ol>
      )}
      {problem !== null && (
        <p className="wid-problem" role="alert">
          {problem}
        </p>
      )}
    </div>
  )
}

export const STOPWATCH: WidgetType = {
  id: 'stopwatch',
  name: 'Stopwatch',
  about: 'Start, stop and laps.',
  sign: 'stopwatch',
  min: { w: 2, h: 1 },
  max: { w: 3, h: 3 },
  start: { w: 2, h: 2 },
  settings: {},
  View: StopwatchView,
}
