import type { ReactNode } from 'react'
import '../styles/switch.css'

/**
 * A switch: a button that is pressed while its setting is on (`aria-pressed`), drawn as a pill with a knob. The Pulls
 * page's Savings ledger shows a picture and a name in it; Settings shows the knob alone, named by `label`, beside the
 * row's name.
 */
export function Switch({
  on,
  onPress,
  label,
  picture,
  children,
  className,
  testId,
}: {
  on: boolean
  onPress: () => void
  /** The switch's name when it shows no words of its own. */
  label?: string
  /** A `Picture` after the knob, muted while the switch is off. */
  picture?: ReactNode
  children?: ReactNode
  className?: string
  testId?: string
}) {
  return (
    <button
      type="button"
      className={className === undefined ? 'pl-switch' : `pl-switch ${className}`}
      aria-pressed={on}
      aria-label={label}
      data-testid={testId}
      onClick={onPress}
    >
      <span className="pl-knob" aria-hidden="true" />
      {picture}
      {children}
    </button>
  )
}
