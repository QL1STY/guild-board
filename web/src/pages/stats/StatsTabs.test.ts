import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import { StatsTabs } from './StatsTabs.tsx'

test('the Stats tabs link Overview, Months and Year, and mark the one shown', () => {
  const markup = renderToStaticMarkup(createElement(StatsTabs, { view: 'months' }))
  expect(markup).toContain('href="#/stats"')
  expect(markup).toContain('href="#/stats/months"')
  expect(markup).toContain('href="#/stats/year"')
  expect(markup.match(/aria-current="page"/g)).toHaveLength(1)
  expect(markup).toMatch(/class="on" href="#\/stats\/months" aria-current="page">Months/)
})
