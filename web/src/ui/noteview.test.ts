import { describe, expect, it } from 'vitest'
import {
  changedNote, type KeyLike, nothingNote, NOTE_MS, refusedNote, undoKeyApplies, undoneNote,
} from './noteview.ts'

describe('the note', () => {
  it('stays eight seconds', () => {
    expect(NOTE_MS).toBe(8000)
  })

  it('a saved change says its sentence and offers Undo', () => {
    expect(changedNote(3, 'Ticked Overlooking View')).toEqual({
      id: 3, tone: 'done', text: 'Ticked Overlooking View', undo: 'Undo',
    })
  })

  it('an undo says what it undid, and offers Undo again only while the core keeps earlier changes', () => {
    expect(undoneNote(4, 'Ticked Overlooking View', true)).toEqual({
      id: 4, tone: 'done', text: 'Undone: Ticked Overlooking View', undo: 'Undo again',
    })
    expect(undoneNote(5, 'Ticked Overlooking View', false)).toEqual({
      id: 5, tone: 'done', text: 'Undone: Ticked Overlooking View', undo: null,
    })
  })

  it('nothing to undo says so without a button', () => {
    expect(nothingNote(6, 'There is nothing to undo.')).toEqual({
      id: 6, tone: 'done', text: 'There is nothing to undo.', undo: null,
    })
  })

  it('a refused change is brown, with no button', () => {
    expect(refusedNote(7, 'The core is busy.')).toEqual({
      id: 7, tone: 'refused', text: 'The core is busy.', undo: null,
    })
  })
})

describe('Ctrl+Z', () => {
  const press = (over: Partial<KeyLike> = {}): KeyLike => ({
    key: 'z', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, target: { tagName: 'DIV' }, ...over,
  })

  it('undoes on the page and on a button', () => {
    expect(undoKeyApplies(press(), false)).toBe(true)
    expect(undoKeyApplies(press({ target: { tagName: 'BUTTON' } }), false)).toBe(true)
    expect(undoKeyApplies(press({ target: null }), false)).toBe(true)
  })

  it('counts Cmd as Ctrl and a capital Z as z', () => {
    expect(undoKeyApplies(press({ ctrlKey: false, metaKey: true }), false)).toBe(true)
    expect(undoKeyApplies(press({ key: 'Z' }), false)).toBe(true)
  })

  it('is no undo with Shift or Alt, without Ctrl, or for another key', () => {
    expect(undoKeyApplies(press({ shiftKey: true }), false)).toBe(false)
    expect(undoKeyApplies(press({ altKey: true }), false)).toBe(false)
    expect(undoKeyApplies(press({ ctrlKey: false }), false)).toBe(false)
    expect(undoKeyApplies(press({ key: 'y' }), false)).toBe(false)
  })

  it('leaves a text field, a text area and an editable element their own undo', () => {
    expect(undoKeyApplies(press({ target: { tagName: 'INPUT', type: 'text' } }), false)).toBe(false)
    expect(undoKeyApplies(press({ target: { tagName: 'INPUT', type: 'search' } }), false)).toBe(false)
    expect(undoKeyApplies(press({ target: { tagName: 'INPUT', type: 'number' } }), false)).toBe(false)
    expect(undoKeyApplies(press({ target: { tagName: 'TEXTAREA' } }), false)).toBe(false)
    expect(undoKeyApplies(press({ target: { tagName: 'DIV', isContentEditable: true } }), false)).toBe(false)
  })

  it('still undoes from a checkbox', () => {
    expect(undoKeyApplies(press({ target: { tagName: 'INPUT', type: 'checkbox' } }), false)).toBe(true)
  })

  it('does nothing while Edit is open', () => {
    expect(undoKeyApplies(press(), true)).toBe(false)
  })
})
