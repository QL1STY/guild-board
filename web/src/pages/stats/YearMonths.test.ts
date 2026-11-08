import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import css from '../../styles/year.css?raw'
import { YearMonths } from './YearMonths.tsx'

const plain = css.replace(/\/\*[\s\S]*?\*\//g, '')

/** The declarations of a rule of year.css with exactly this selector. */
function ruleOf(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\>]/g, '\\$&')
  return new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(plain)?.[1] ?? ''
}

test('the biggest month tells a real zero, a month not tracked and a month to come apart', () => {
  // January is before the history, March had no wish, and November and December are after the core's today.
  const markup = renderToStaticMarkup(
    createElement(YearMonths, { numbers: { month: 8, through: 10, months: [null, 4, 0, 12, 40, 30, 50, 90, 20, 10, null, null] } }),
  )
  const label = /aria-label="([^"]*)"/.exec(markup)?.[1] ?? ''
  expect(label.split(', ')).toEqual([
    'Jan not tracked', 'Feb 4', 'Mar 0', 'Apr 12', 'May 40', 'Jun 30', 'Jul 50', 'Aug 90', 'Sep 20', 'Oct 10', 'Nov not yet', 'Dec not yet',
  ])
  const bars = [...markup.matchAll(/<i([^>]*)>/g)].map((bar) => bar[1])
  expect(bars).toHaveLength(12)
  // Not tracked: a ghost the whole height of the chart. A real zero: its baseline. Not yet: nothing.
  expect(bars[0]).toContain('class="ghost"')
  expect(bars[0]).toContain('height:100%')
  expect(bars[2]).not.toContain('class=')
  expect(bars[2]).toContain('height:2%')
  expect(bars[7]).toContain('class="peak"')
  expect(bars[10]).toContain('class="later"')
  expect(bars[10]).toContain('height:0%')
  // The ghost is drawn as an outline, dashed and faint, never filled as a month of wishes; a month to come draws nothing.
  expect(ruleOf('.yr-bars i.ghost')).toMatch(/dashed/)
  expect(ruleOf('.yr-bars i.ghost')).toMatch(/background:\s*none/)
  expect(ruleOf('.yr-bars i.later')).toMatch(/visibility:\s*hidden/)
})
