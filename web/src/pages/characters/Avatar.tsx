import type { CSSProperties } from 'react'
import type { Element } from '../../types.ts'
import { Picture } from '../../ui/Picture.tsx'
import { elementClass } from './elements.ts'

/**
 * A character's face on a ring in her element's colour. `src` is her picture in the core's art cache (`/api/art/...`); the
 * drawn bust shows where there is none, as in the demo. The ring is her colour and the name always comes beside it, since
 * colour alone never tells two characters apart. `size` is a CSS length. On the dark card of her own pages the ring is her
 * bright colour with a glow (`dark`); on parchment it is the deepened one.
 */
export function Avatar({
  src,
  element,
  size,
  dark = false,
  className,
  lazy = false,
}: {
  src: string | null
  element: Element
  size: string
  dark?: boolean
  className?: string
  /** Not loaded or decoded until it nears the screen: the roster's faces. */
  lazy?: boolean
}) {
  const classes = ['cx-ava', elementClass(element), dark ? 'on-card' : '', className ?? ''].filter((name) => name !== '').join(' ')
  return <Picture src={src} sign="bust" className={classes} style={{ '--size': size } as CSSProperties} lazy={lazy} />
}
