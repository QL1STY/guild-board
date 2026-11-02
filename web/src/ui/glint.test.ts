import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import { Glint } from './Glint.tsx'

/** An element of Glint as the page draws it first. */
const drawn = (props: Parameters<typeof Glint>[0]) => renderToStaticMarkup(createElement(Glint, props))

test('a number shows no glint as it is first drawn, and keeps the class it has of its own', () => {
  expect(drawn({ className: 'fig', value: 77, children: '77' })).toBe('<span class="fig">77</span>')
  expect(drawn({ as: 'p', className: 'fig', value: 77, children: '77' })).toBe('<p class="fig">77</p>')
})

test('a number with no class of its own has none at all until it glints', () => {
  expect(drawn({ as: 'b', value: 3, children: '3' })).toBe('<b>3</b>')
})

test('a number that glints for its reads shows no glint as it is first drawn either', () => {
  expect(drawn({ className: 'fig', value: 77, read: '2026-10-13T08:00:00+00:00', children: '77' })).toBe(
    '<span class="fig">77</span>',
  )
  expect(drawn({ as: 'b', value: 'Back', read: null, children: 'Back' })).toBe('<b>Back</b>')
})
