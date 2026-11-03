import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import type { Live } from '../../live.ts'
import type { CharSync } from '../../types.ts'
import { Avatar } from './Avatar.tsx'
import { ElementChip } from './ElementChip.tsx'
import { ReadinessRing } from './ReadinessRing.tsx'
import { CalculatorNote, SyncLine } from './SyncLine.tsx'

const live = { now: () => new Date('2026-10-25T07:20:00+00:00') } as unknown as Live
const sync: CharSync = {
  can_refresh: true, wait_minutes: null, reading: false, blocked: null, read_at: '2026-10-25T07:00:00+00:00', calculator: 'on', message: null, every_minutes: 360,
}

test('a face sits on a ring of her element, with her drawn bust where there is no picture', () => {
  const markup = renderToStaticMarkup(createElement(Avatar, { src: null, element: 'Cryo', size: '56px' }))
  expect(markup).toContain('el-cryo')
  expect(markup).toContain('cx-ava')
  expect(markup).toContain('--size:56px')
  expect(markup).toContain('hidden=""') // no picture: the sign shows
  expect(renderToStaticMarkup(createElement(Avatar, { src: '/api/art/sandrone', element: 'Pyro', size: '40px', dark: true }))).toContain('on-card')
})

test('an element chip says her element in words as well as in her colour', () => {
  const markup = renderToStaticMarkup(createElement(ElementChip, { element: 'Dendro' }))
  expect(markup).toContain('el-dendro')
  expect(markup).toMatch(/Dendro<\/span>$/)
})

test('the readiness ring gives its figure as text and as its name', () => {
  const markup = renderToStaticMarkup(createElement(ReadinessRing, { value: 88.6, size: '46px' }))
  expect(markup).toContain('aria-label="89% ready"')
  expect(markup).toContain('89<small>%</small>')
  expect(renderToStaticMarkup(createElement(ReadinessRing, { value: 140, size: '46px', caption: 'of her full potential' }))).toContain('100<small>%</small>')
})

test('the ring beside the characters offers a press and rests it while a read must wait', () => {
  const ready = renderToStaticMarkup(createElement(SyncLine, { live, sync }))
  expect(ready).toContain('<button')
  expect(ready).not.toContain('>Refresh<')
  expect(ready).not.toContain('aria-disabled')
  expect(ready).toContain('data-testid="characters-sync"')
  expect(ready).toContain('>20 min ago</span>')
  expect(ready).toContain('Reads again by itself every 6 hours.')
  // The ring is a button in every state, so that the keyboard's focus stays on it when a read starts or must wait.
  const waiting = renderToStaticMarkup(createElement(SyncLine, { live, sync: { ...sync, can_refresh: false, wait_minutes: 3 } }))
  expect(waiting).toContain('<button')
  expect(waiting).toContain('aria-disabled="true"')
  expect(waiting).toContain('Try again in 3 minutes.')
  const reading = renderToStaticMarkup(createElement(SyncLine, { live, sync: { ...sync, can_refresh: false, reading: true } }))
  expect(reading).toContain('<button')
  expect(reading).toContain('aria-disabled="true"')
  expect(reading).toContain('Reading your characters from HoYoLAB')
})

test('the calculator sentence is said in full by its note, and in the ring only as a tip', () => {
  const off: CharSync = { ...sync, calculator: 'off' }
  const ring = renderToStaticMarkup(createElement(SyncLine, { live, sync: off }))
  expect(ring).toContain('>Calculator off</span>') // the label is short; the long sentence is the ring's tip
  expect(renderToStaticMarkup(createElement(CalculatorNote, { sync: off }))).toContain('Calculator sync is off in HoYoLAB, so Guild Board can&#x27;t see what you hold.')
  expect(renderToStaticMarkup(createElement(CalculatorNote, { sync }))).toBe('')
})
