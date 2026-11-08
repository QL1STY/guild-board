import type { CSSProperties } from 'react'
import { num } from '../../format.ts'
import { type MonthBar, monthBars } from './yearview.ts'

/** What a month's bar says to a screen reader: its wishes, "not tracked" or "not yet". */
function said(bar: MonthBar): string {
  if (bar.state === 'untracked') return `${bar.name} not tracked`
  if (bar.state === 'later') return `${bar.name} not yet`
  return `${bar.name} ${num(bar.wishes)}`
}

/**
 * The twelve bars of the biggest-month card (`monthBars`): a month of wishes is a bar, a real zero its baseline, a month gone
 * by that the history does not reach a faint dashed ghost the whole height, and a month after the core's today nothing.
 */
export function YearMonths({ numbers }: { numbers: Record<string, unknown> }) {
  const bars = monthBars(numbers)
  if (bars.length === 0) return null
  return (
    <div className="yr-months" role="img" aria-label={bars.map(said).join(', ')}>
      <div className="yr-bars">
        {bars.map((bar, at) => (
          <i
            key={bar.name}
            className={bar.state === 'untracked' ? 'ghost' : bar.state === 'later' ? 'later' : bar.peak ? 'peak' : undefined}
            style={{ height: `${bar.height}%`, '--yr-delay': `${0.3 + at * 0.05}s` } as CSSProperties}
          />
        ))}
      </div>
      <div className="yr-mlabels" aria-hidden="true">
        {bars.map((bar) => (
          <span key={bar.name}>{bar.label}</span>
        ))}
      </div>
    </div>
  )
}
