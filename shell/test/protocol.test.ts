import { expect, test } from 'vitest'
import { encode, LineReader } from '../src/protocol.js'

test('lines are framed across chunks', () => {
  const lines: string[] = []
  const reader = new LineReader((l) => lines.push(l))
  reader.push('{"event":"rea')
  reader.push('dy"}\r\n\n{"a":1}')
  reader.end()
  expect(lines).toEqual(['{"event":"ready"}', '{"a":1}'])
  expect(encode({ id: 1 })).toBe('{"id":1}\n')
})

test('a line is held back until its newline arrives, and end gives up the rest once', () => {
  const lines: string[] = []
  const reader = new LineReader((l) => lines.push(l))
  reader.push('one\ntw')
  expect(lines).toEqual(['one'])
  reader.end()
  reader.end()
  expect(lines).toEqual(['one', 'tw'])
})

test('a message with non-ASCII text stays one line', () => {
  expect(encode({ text: 'a\nb ü' })).toBe('{"text":"a\\nb ü"}\n')
})
