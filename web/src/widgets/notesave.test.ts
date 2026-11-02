import { expect, test } from 'vitest'
import { noteSave } from './notesave.ts'

test('a failed save leaves its text pending, to go again', () => {
  const note = noteSave()
  expect(note.take()).toBeNull() // nothing typed, nothing to send
  note.typed('Buy Sweet Flowers')
  expect(note.pending()).toBe('Buy Sweet Flowers')
  const send = note.take()!
  expect(send.text).toBe('Buy Sweet Flowers')
  expect(note.pending()).toBeNull() // on its way
  note.failed(send)
  expect(note.pending()).toBe('Buy Sweet Flowers')
  expect(note.take()?.text).toBe('Buy Sweet Flowers')
})

test('a failed save does not put its text over what was typed after it', () => {
  const note = noteSave()
  note.typed('Mint')
  const send = note.take()!
  note.typed('Mint for Kirara')
  note.failed(send)
  expect(note.pending()).toBe('Mint for Kirara')
})

test('a failed save does not come back over a newer one that was sent after it', () => {
  const note = noteSave()
  note.typed('Mint')
  const older = note.take()!
  note.typed('Mint for Kirara')
  const newer = note.take()!
  note.failed(older)
  expect(note.pending()).toBeNull() // the newer text is on its way, and it holds the older
  note.failed(newer)
  expect(note.pending()).toBe('Mint for Kirara')
})
