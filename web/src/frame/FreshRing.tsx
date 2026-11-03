import { Tip, currentTip, useTip } from '../pages/characters/Tip.tsx'
import { Sign } from '../ui/Sign.tsx'
import type { FreshView } from './freshview.ts'

/**
 * How fresh a page's data is, beside its title (freshness design, section 1, option E): a ring that empties as the next
 * read by itself comes closer, the sync sign inside it, and a few words beside it. With `onPress` it is a button that
 * reads now; without, only a thing to hover or focus for the tip. While `view.turning` the sign turns, and while `disabled`
 * (a press the page would refuse), the button sends nothing; either way it stays a button, aria-disabled, so that the
 * keyboard's focus is not dropped when a read starts.
 */
export function FreshRing({
  view,
  onPress,
  disabled = false,
  testId,
}: {
  view: FreshView
  onPress?: () => void
  disabled?: boolean
  testId: string
}) {
  const { tip, tipOf } = useTip()
  const inside = (
    <>
      <svg className="gb-fresh-ring" viewBox="0 0 36 36" aria-hidden="true">
        <circle className="gb-fresh-track" cx="18" cy="18" r="15" />
        {view.fill > 0 && (
          <circle
            className="gb-fresh-arc"
            cx="18"
            cy="18"
            r="15"
            pathLength={100}
            strokeDasharray={100}
            strokeDashoffset={100 * (1 - view.fill)}
          />
        )}
      </svg>
      <Sign name="sync" className={view.turning ? 'turning' : undefined} />
    </>
  )
  const className = `gb-fresh-ring-box ${view.tone}`
  return (
    <span className={`gb-fresh ${view.tone}`}>
      {onPress !== undefined ? (
        <button
          type="button"
          className={className}
          aria-label={view.tip}
          aria-disabled={view.turning || disabled || undefined}
          {...tipOf(view.tip)}
          onClick={() => {
            if (!view.turning && !disabled) onPress()
          }}
        >
          {inside}
        </button>
      ) : (
        <span className={className} role="img" aria-label={view.tip} {...tipOf(view.tip)}>
          {inside}
        </span>
      )}
      <span className="gb-fresh-label" role="status" data-testid={testId}>
        {view.label}
      </span>
      <Tip tip={currentTip(tip, view.tip)} light />
    </span>
  )
}
