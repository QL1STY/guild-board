import { useEffect, useRef, useState } from 'react'
import { num } from '../../format.ts'
import type { Ledger } from '../../ledgertypes.ts'
import type { Live } from '../../live.ts'
import { countValue, reducedMotion } from '../../ui/motion.tsx'
import { CURRENCY_NAMES, money, priceParts, spentSub } from '../ledgerview.ts'

/** How long the total counts up to its value when the cover comes off (the design, section 5). */
const COUNT_MS = 900

const EYE = 'M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z'
const SLASH = 'M3 12s3.5-6 9-6c2 0 3.7.8 5.1 1.8M21 12s-3.5 6-9 6c-2 0-3.7-.8-5.1-1.8 M4 20L20 4'

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {off ? (
        <path d={SLASH} />
      ) : (
        <>
          <path d={EYE} />
          <circle cx="12" cy="12" r="2.6" />
        </>
      )}
    </svg>
  )
}

/** The total, "about 1,240 zł", with the figure counting when `figure` is not the whole of it. */
function Total({ spent, figure }: { spent: Ledger['spent']; figure: number }) {
  const price = priceParts(figure, spent.currency)
  return (
    <div className="ld-total num" data-testid="ledger-spent-total">
      {spent.total === 0 ? '' : 'about '}
      {price.before}
      {price.figure}
      {price.after !== '' && <small> {price.after}</small>}
    </div>
  )
}

/**
 * Spent on Genshin (the Ledger revamp design, section 5): the money the player spent, which can be hidden. Hidden, a cover
 * lies over the figures, which are blurred under it; Show peels the cover away left to right behind a gold edge and the
 * total counts up, Hide lays it back. With reduced motion it changes at once. The choice is the core's setting
 * `ledger_spent_hidden`, kept on this PC and not synced; the first time the figures are shown.
 */
export function SpentCard({ spent, live }: { spent: Ledger['spent']; live: Live }) {
  const saved = live.settings?.ledger_spent_hidden ?? false
  const [hidden, setHidden] = useState(saved)
  const [turn, setTurn] = useState<{ n: number; way: 'peel' | 'cover' } | null>(null)
  const [count, setCount] = useState<number | null>(null)
  const frame = useRef(0)
  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  const total = Math.round(spent.total)
  const countUp = () => {
    cancelAnimationFrame(frame.current)
    const begin = performance.now()
    const step = (now: number) => {
      const t = (now - begin) / COUNT_MS
      if (t >= 1) {
        setCount(null)
        return
      }
      setCount(countValue(0, total, t))
      frame.current = requestAnimationFrame(step)
    }
    setCount(0)
    frame.current = requestAnimationFrame(step)
  }

  const choose = (next: boolean) => {
    const calm = reducedMotion()
    cancelAnimationFrame(frame.current)
    setCount(null)
    setHidden(next)
    if (!calm) setTurn((was) => ({ n: (was?.n ?? 0) + 1, way: next ? 'cover' : 'peel' }))
    if (!next && !calm) countUp()
    live.saveSettings({ ledger_spent_hidden: next }).catch(() => setHidden(!next))
  }

  const sub = spentSub(spent)
  return (
    <section className="gb-panel ld-card" data-testid="ledger-spent">
      <div className="ld-headrow">
        <h2 className="gb-section-h ld-h">Spent on Genshin</h2>
        <button type="button" className="ld-eye" aria-pressed={hidden} onClick={() => choose(!hidden)}>
          <EyeIcon off={!hidden} />
          {hidden ? 'Show' : 'Hide'}
        </button>
      </div>
      <div className={hidden ? 'ld-money hidden' : 'ld-money'}>
        <div className="ld-figures" data-testid="ledger-spent-figures" aria-hidden={hidden} inert={hidden}>
          <Total spent={spent} figure={count ?? spent.total} />
          <div className="ld-spend-sub">{sub}</div>
          {spent.rows.length === 0 ? (
            <p className="ld-empty">No purchases in the history the game keeps.</p>
          ) : (
            <ul className="ld-packs">
              {spent.rows.map((row) => (
                <li key={row.id}>
                  <span>{row.label}</span>
                  <span className="ld-x num">×{num(row.count)}</span>
                  <b className="num">{money(row.total, spent.currency)}</b>
                </li>
              ))}
            </ul>
          )}
          <p className="ld-note">
            Prices are an estimate in {CURRENCY_NAMES[spent.currency]}, from the official price list.{' '}
            <a href="#/settings">Change currency or prices</a>
          </p>
        </div>
        <div
          className="ld-cover"
          data-testid="ledger-spent-cover"
          role="button"
          tabIndex={-1}
          aria-label="Show what you spent"
          aria-hidden={!hidden}
          onClick={() => choose(false)}
        >
          <EyeIcon off />
          <b>Hidden</b>
          <span>Click to show</span>
        </div>
        {turn !== null && <div key={turn.n} className={`ld-edge ${turn.way}`} aria-hidden="true" />}
      </div>
    </section>
  )
}
