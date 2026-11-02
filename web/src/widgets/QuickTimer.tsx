import { useId, useState } from 'react'
import { api, messageOf } from '../api.ts'
import { useModel, useTick } from '../live.ts'
import type { QuickTimer, QuickTimersModel, Widget } from '../types.ts'
import { Dial, Seal } from '../ui/marks.tsx'
import { singleClick, useOnePress } from './onepress.ts'
import type { WidgetContext, WidgetType } from './widget.ts'
import { nearTime, QUICK_PRESETS, quickCountdown, quickProgress } from './widgetview.ts'

/** A number field as the form counts it: an empty field is 0. */
function amount(text: string): number {
  return text.trim() === '' ? 0 : Number(text)
}

/**
 * A quick timer that runs, or is ready, over the whole widget (as the player asked after the look pass's check): a large
 * dial of the time passed with the time left in large figures inside it, or the Ready seal and a green ring, the clock
 * time it is ready at, and Cancel, or Dismiss once it is ready. Behind it, as many more as wait their turn.
 */
function Countdown({ quick, more, now, dismiss }: { quick: QuickTimer; more: number; now: Date; dismiss: () => void }) {
  const left = (Date.parse(quick.ready_at) - now.getTime()) / 1000
  const ready = quick.state === 'ready' || left <= 0
  return (
    <div className="qt-run" data-centre>
      <Dial progress={quickProgress(quick, now)} ready={ready}>
        <span className="qt-in">
          {ready ? <Seal>Ready</Seal> : <b className="qt-big">{quickCountdown(left)}</b>}
          <span className="qt-of">{quick.name.replace(/^Quick timer · /, '')}</span>
        </span>
      </Dial>
      <div className="qt-side">
        <p className="qt-at">{ready ? `Since ${nearTime(quick.ready_at, now)}` : `Ready at ${nearTime(quick.ready_at, now)}`}</p>
        <button
          type="button"
          className={ready ? 'gb-btn' : 'gb-btn quiet'}
          aria-label={`${ready ? 'Dismiss' : 'Cancel'} ${quick.name}`}
          onClick={dismiss}
        >
          {ready ? 'Dismiss' : 'Cancel'}
        </button>
        {more > 0 && <p className="qt-more">{more === 1 ? 'One more after it' : `${more} more after it`}</p>}
      </div>
    </div>
  )
}

/**
 * Quick timers (spec 9.5 and 13.3), as the look pass draws them (spec 9.11): the presets start one in one click, as one
 * row of buttons of one size. The time of the player's own has three fields: behind "Your own time" below three cells
 * across and three tall, where the button opens them in place, and always there from that size (widgets.css chooses, so
 * the markup is one). Once one is started it fills the widget, one at a time (Countdown); the presets are back once it is
 * cancelled or dismissed. They remind like timers. They are no change to undo, so they go to the core straight away; the
 * core says why it refuses one. A double-click starts one timer, and a second click as quick as a double-click's does not
 * dismiss the next one, which takes the place of the first.
 */
function QuickTimerView({ ctx }: { widget: Widget; ctx: WidgetContext }) {
  const { data } = useModel<QuickTimersModel>('/api/quick-timers', ctx.version)
  useTick(1000)
  const [own, setOwn] = useState({ hours: '', minutes: '', seconds: '' })
  const [open, setOpen] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const { press } = useOnePress()
  const form = useId()
  const send = async (request: () => Promise<unknown>) => {
    try {
      await request()
      setRefusal(null)
    } catch (error) {
      setRefusal(messageOf(error))
    }
  }
  const start = (seconds: number) => void send(() => api.post('/api/quick-timers', { seconds }))
  const now = ctx.live.now()
  // The one ready first; the rest wait their turn.
  const timers = data === null ? [] : [...data.quick_timers].sort((a, b) => Date.parse(a.ready_at) - Date.parse(b.ready_at))
  if (timers.length > 0) {
    const [first] = timers
    return (
      <>
        <Countdown
          quick={first}
          more={timers.length - 1}
          now={now}
          dismiss={() => press(() => send(() => api.delete(`/api/quick-timers/${first.id}`)))}
        />
        <p className="wid-problem" role="alert">
          {refusal}
        </p>
      </>
    )
  }
  return (
    <div className="qt">
      <div className="qt-presets" data-centre>
        {QUICK_PRESETS.map((preset) => (
          <button
            key={preset.seconds}
            type="button"
            className="gb-btn quiet"
            onClick={singleClick(() => start(preset.seconds))}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="gb-btn quiet qt-own-toggle"
        aria-expanded={open}
        aria-controls={form}
        onClick={() => setOpen(!open)}
      >
        Your own time
      </button>
      <form
        id={form}
        className={open ? 'qt-own open' : 'qt-own'}
        aria-label="Quick timer of your own"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          start(amount(own.hours) * 3600 + amount(own.minutes) * 60 + amount(own.seconds))
        }}
      >
        {(['hours', 'minutes', 'seconds'] as const).map((part) => (
          <label key={part} className="qt-part">
            <input
              type="number"
              className="qt-num"
              aria-label={part[0].toUpperCase() + part.slice(1)}
              min={0}
              step={1}
              value={own[part]}
              onChange={(event) => setOwn({ ...own, [part]: event.target.value })}
            />
            {part === 'hours' ? 'h' : part === 'minutes' ? 'min' : 's'}
          </label>
        ))}
        <button
          type="submit"
          className="gb-btn"
          onClick={(event) => {
            if (event.detail > 1) event.preventDefault() // a double-click's second click sends nothing
          }}
        >
          Start
        </button>
      </form>
      <p className="wid-problem" role="alert">
        {refusal}
      </p>
    </div>
  )
}

export const QUICK_TIMER: WidgetType = {
  id: 'quick-timer',
  name: 'Quick timer',
  about: 'Short timers that remind you, in one click.',
  sign: 'bolt',
  min: { w: 2, h: 2 },
  max: { w: 4, h: 4 },
  start: { w: 3, h: 2 },
  settings: {},
  View: QuickTimerView,
}
