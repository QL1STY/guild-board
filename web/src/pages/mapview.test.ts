import { expect, test } from 'vitest'
import type { MapModel } from '../types.ts'
import { areaOf, chipOf, keyAction, placeholder } from './mapview.ts'

const MODEL: MapModel = {
  tabs: [
    { id: 1, name: 'Fishing', custom: true, failed: false },
    { id: 2, name: 'Teyvat', custom: false, failed: false },
  ],
  active: 1,
  can_reopen: false,
  signed_in: true,
  has_shell: true,
}

test('the area is the rectangle to a tenth of a pixel, with whether something covers it', () => {
  expect(areaOf({ left: 10.04, top: 20.26, width: 800.33, height: 600 }, false)).toEqual({
    x: 10, y: 20.3, w: 800.3, h: 600, hidden: false,
  })
  expect(areaOf({ left: 0, top: 0, width: 1, height: 1 }, true).hidden).toBe(true)
})

test('the toolbar speaks of the account only when the map does not know the player, and offers the login only where it can help', () => {
  expect(chipOf(MODEL, false)).toBeNull()
  expect(chipOf({ ...MODEL, signed_in: false }, false)).toEqual({ text: 'Not logged in to HoYoLAB', canLogIn: true })
  expect(chipOf({ ...MODEL, signed_in: false }, true)?.canLogIn).toBe(false) // the demo has no login
})

test('the page speaks in the map\'s place only when the map cannot show', () => {
  expect(placeholder(MODEL)).toBeNull()
  expect(placeholder({ ...MODEL, has_shell: false })?.canReload).toBe(false)
  const failed = { ...MODEL, tabs: [{ ...MODEL.tabs[0], failed: true }, MODEL.tabs[1]] }
  expect(placeholder(failed)).toMatchObject({ title: 'The map did not load', canReload: true })
  // another tab failing says nothing about the one shown
  expect(placeholder({ ...failed, active: 2 })).toBeNull()
})

test('Ctrl+T, Ctrl+Shift+T and Ctrl+W work as in a browser', () => {
  expect(keyAction({ ctrlKey: true, shiftKey: false, key: 't' })).toBe('new')
  expect(keyAction({ ctrlKey: true, shiftKey: true, key: 'T' })).toBe('reopen')
  expect(keyAction({ ctrlKey: true, shiftKey: false, key: 'w' })).toBe('close')
  expect(keyAction({ ctrlKey: false, shiftKey: false, key: 't' })).toBeNull()
  expect(keyAction({ ctrlKey: true, shiftKey: false, key: 'r' })).toBeNull()
})
