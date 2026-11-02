import { useEffect, useState } from 'react'
import { api, messageOf } from '../api.ts'
import { num } from '../format.ts'
import { useModel, useTick } from '../live.ts'
import { timeLeft } from '../pages/timersview.ts'
import type { CheckInModel, Widget } from '../types.ts'
import { Picture } from '../ui/Picture.tsx'
import { Sign } from '../ui/Sign.tsx'
import { iconOf, shownIndex, tileState } from './checkinview.ts'
import { useOnePress } from './onepress.ts'
import { useHead, type WidgetContext, type WidgetType } from './widget.ts'

const MINUTE_MS = 60_000
const SPARKS = 12

/** The sparks that fly out of the reward once, when it is claimed here. */
function Sparks() {
  return (
    <span className="checkin-sparks" aria-hidden="true">
      {Array.from({ length: SPARKS }, (_, index) => (
        <i key={index} style={{ '--turn': `${index / SPARKS}turn`, '--far': `${index % 2 === 0 ? 84 : 66}px` } as React.CSSProperties} />
      ))}
    </span>
  )
}

/**
 * The daily check-in (the daily check-in design): today's reward large with one button, and from a width of about three
 * cells the month's rewards beside it. Claim is the only thing that sends the claim: nothing here presses it. The claimed
 * reward lands once, with its stamp and sparks, and only when the press was made here. The check-in's day turns over at
 * midnight in UTC+8, so the widget reads again at the time the core gave, not at the game's own reset.
 */
function CheckInView({ ctx }: { widget: Widget; ctx: WidgetContext }) {
  useTick(MINUTE_MS)
  const now = ctx.live.now()
  const [round, setRound] = useState(0)
  const { data, error } = useModel<CheckInModel>('/api/checkin', ctx.version + round)
  const due = data !== null && now.getTime() >= Date.parse(data.next_reset)
  useEffect(() => {
    if (due) setRound((value) => value + 1)
  }, [due])
  const { resting, press } = useOnePress()
  const [won, setWon] = useState<number | null>(null)
  const [refused, setRefused] = useState<string | null>(null)
  useHead({ meta: data !== null && data.read ? `${num(data.claimed_days)} of ${num(data.rewards.length)}` : null })

  if (data === null) return <p className="wid-line">{error ?? 'Reading the check-in…'}</p>
  if (!data.ready) return <p className="wid-line" data-centre>Log in to HoYoLAB to claim your daily reward.</p>
  const index = shownIndex(data)
  if (!data.read || index === null) {
    return (
      <p className="wid-line" data-centre>
        {data.read
          ? "This month's rewards are all claimed."
          : data.read_failed ? 'HoYoLAB could not be read. Guild Board will try again.' : 'Reading the check-in…'}
      </p>
    )
  }

  const reward = data.rewards[index]
  const claim = () =>
    press(async () => {
      setRefused(null)
      try {
        const answer = await api.post<CheckInModel>('/api/checkin/claim')
        if (answer.result === 'claimed') setWon(answer.claimed_days - 1)
      } catch (failure) {
        setRefused(messageOf(failure))
      }
    })
  const fresh = data.claimed_today && won === index
  const line = refused ?? (data.result === 'claimed' ? null : data.text)
  const busy = resting || data.claiming
  return (
    <div className="checkin" data-claimed={data.claimed_today || undefined} data-fresh={fresh || undefined}>
      <div className="checkin-today">
        <div className="checkin-prize">
          <Picture src={iconOf(reward.icon)} sign="gem" className="checkin-picture" />
          {fresh && <Sparks />}
          {data.claimed_today && (
            <span className="checkin-stamp">
              <Sign name="tick" />
            </span>
          )}
          {fresh && <span className="checkin-gain" aria-hidden="true">+{num(reward.amount)}</span>}
        </div>
        <div className="checkin-words">
          <p className="checkin-name" title={reward.name}>
            {reward.name} <b>×{num(reward.amount)}</b>
          </p>
          {data.claimed_today ? (
            <p className="wid-line">Next reward {timeLeft((Date.parse(data.next_reset) - now.getTime()) / 1000)}</p>
          ) : (
            <button type="button" className="gb-btn checkin-claim" aria-disabled={busy} onClick={claim}>
              {busy ? 'Claiming…' : 'Claim'}
            </button>
          )}
          {data.result === 'verify' && !data.claimed_today && (
            <a className="gb-link" href={data.website} target="_blank" rel="noopener noreferrer">
              Open HoYoLAB's check-in page
            </a>
          )}
          <p className="wid-problem" role="status">{line}</p>
        </div>
      </div>
      <ol className="checkin-month" aria-label="This month's rewards">
        {data.rewards.map((item, day) => {
          const state = tileState(day, data)
          return (
            <li key={day} className="checkin-day" data-state={state} data-fresh={(fresh && day === index) || undefined} title={`${item.name} ×${num(item.amount)}`}>
              <span className="checkin-number">{day + 1}</span>
              <Picture src={iconOf(item.icon)} sign="gem" className="checkin-tile" lazy />
              <span className="checkin-amount">×{num(item.amount)}</span>
              {state === 'claimed' && (
                <span className="checkin-tick">
                  <Sign name="tick" />
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

export const CHECK_IN: WidgetType = {
  id: 'checkin',
  name: 'Daily check-in',
  about: "Claim HoYoLAB's daily reward with one press.",
  sign: 'chest',
  min: { w: 2, h: 2 },
  max: { w: 6, h: 5 },
  start: { w: 5, h: 3 },
  settings: {},
  View: CheckInView,
}
