import { Tip, currentTip, useTip } from '../pages/characters/Tip.tsx'

/**
 * The date range beside a page's title, of the freshness ring's family (freshness design, section 2): a small calendar
 * sign and the range in a few words, quiet, with the tip on hover and on focus. It is for reading only: nothing in it
 * presses.
 */
export function CalendarChip({ label, tip, testId }: { label: string; tip: string; testId: string }) {
  const { tip: shown, tipOf } = useTip()
  return (
    <span className="gb-fresh gb-chip">
      <span className="gb-chip-box" role="img" aria-label={tip} {...tipOf(tip)}>
        <svg className="sign" viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4.6 4.4h10.8a1.4 1.4 0 0 1 1.4 1.4v9.6a1.4 1.4 0 0 1-1.4 1.4H4.6a1.4 1.4 0 0 1-1.4-1.4V5.8a1.4 1.4 0 0 1 1.4-1.4zM3.2 8.4h13.6M6.8 2.8v3M13.2 2.8v3" />
        </svg>
      </span>
      <span className="gb-fresh-label" data-testid={testId}>
        {label}
      </span>
      <Tip tip={currentTip(shown, tip)} light />
    </span>
  )
}
