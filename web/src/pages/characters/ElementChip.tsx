import type { Element } from '../../types.ts'
import { elementClass } from './elements.ts'

/** An element as a dot in her colour and her name: the name says it too, so the colour is never alone. */
export function ElementChip({ element, dark = false }: { element: Element; dark?: boolean }) {
  return (
    <span className={`cx-chip ${elementClass(element)}${dark ? ' on-card' : ''}`}>
      <i aria-hidden="true" />
      {element}
    </span>
  )
}
