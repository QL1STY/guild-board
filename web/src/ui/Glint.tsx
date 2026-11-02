import type { ReactNode } from 'react'
import { useGlint, useReadGlint } from './motion.tsx'

/**
 * An element that shows a number a sync can change (look pass spec 14.2): it has the class `glint` for the length of
 * `--t-glint` after `value` changes, and never on its first render, so a number drawn as its page opens does not glint.
 * `value` is what the core gave, such as a field of a model read after a sync, and not the figure on the screen when that
 * is counted on from it with the clock: the clock's ticks do not glint.
 *
 * A figure that the clock moves on, such as resin counted on from the last read or a time of return that has come, takes
 * `read` as well, which names the read the figure came from: it glints only when a new read changes it (useReadGlint),
 * and then `value` is the figure as that same answer of the core gives it, so that two answers arriving apart cannot
 * split one change into two. `className` is the element's own.
 */
export function Glint({
  as: Tag = 'span',
  value,
  read,
  className,
  children,
}: {
  as?: 'span' | 'b' | 'p'
  value: unknown
  read?: unknown
  className?: string
  children: ReactNode
}) {
  // Both hooks run, as hooks must; the one not chosen is given a figure that never changes.
  const byValue = useGlint(read === undefined ? value : null)
  const byRead = useReadGlint(value, read)
  const glint = read === undefined ? byValue : byRead
  const classes = [className, glint].filter((name) => name !== undefined && name !== '').join(' ')
  return <Tag className={classes === '' ? undefined : classes}>{children}</Tag>
}
