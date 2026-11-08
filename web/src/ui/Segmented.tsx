import { useRef } from 'react'
import { nextIndex } from './roving.ts'
import { Sign } from './Sign.tsx'

/**
 * The pill-shaped switch: exactly one of a few options. One tab stop; the arrow keys choose. As in any radio group,
 * `onChange` hears only of an option that is not already chosen: a click on the chosen one changes nothing, unless
 * `onRepeat` is given (a sort that a second press turns round), and then the chosen option shows `way` as a chevron:
 * down for the usual order, up for the order turned round.
 */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  onRepeat,
  way = 'down',
}: {
  label: string
  options: readonly { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
  onRepeat?: () => void
  way?: 'down' | 'up'
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const selected = Math.max(0, options.findIndex((option) => option.value === value))
  const choose = (next: T) => {
    if (next !== value) onChange(next)
    else onRepeat?.()
  }
  return (
    <div className="gb-seg" role="radiogroup" aria-label={label}>
      {options.map((option, index) => (
        <button
          key={option.value}
          ref={(element) => {
            buttons.current[index] = element
          }}
          type="button"
          role="radio"
          aria-checked={index === selected}
          tabIndex={index === selected ? 0 : -1}
          className={index === selected ? 'on' : undefined}
          onClick={() => choose(option.value)}
          onKeyDown={(event) => {
            const next = nextIndex(event.key, index, options.length)
            if (next === null) return
            event.preventDefault()
            if (next === index) return
            choose(options[next].value)
            buttons.current[next]?.focus()
          }}
        >
          {option.label}
          {onRepeat !== undefined && index === selected && (
            <span className={`gb-seg-way ${way}`} aria-hidden="true">
              <Sign name="chevron" />
            </span>
          )}
        </button>
      ))}
    </div>
  )
}
