const STEPS = [1, 2, 5]

/**
 * The top of a count axis and its ticks: 2 to 4 equal steps of 1, 2 or 5 times a power of ten, with
 * the smallest top that still holds `max`. Of two ways to reach the same top, the finer one wins.
 * 14 gives 0, 5, 10, 15.
 */
export function axis(max: number): { top: number; ticks: number[] } {
  const need = Math.max(1, max)
  let best = { top: Infinity, step: 1, count: 2 }
  for (let power = 1; power <= need * 10; power *= 10) {
    for (const base of STEPS) {
      for (let count = 2; count <= 4; count += 1) {
        const step = base * power
        const top = step * count
        if (top < need) continue
        if (top < best.top || (top === best.top && count > best.count)) best = { top, step, count }
      }
    }
  }
  return { top: best.top, ticks: Array.from({ length: best.count + 1 }, (_, index) => index * best.step) }
}

/** Every how many columns the x-axis carries a label: all of a few, every seventh day, about seven in all for weeks. */
export function labelEvery(count: number, unit: 'day' | 'week'): number {
  if (unit === 'week') return count <= 8 ? 1 : Math.ceil(count / 7)
  return count <= 10 ? 1 : 7
}
