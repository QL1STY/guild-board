import { expect, test } from 'vitest'
import type { UpdateStatus } from '../types.ts'
import { noticeOf } from './updatenote.ts'

const none: UpdateStatus = { state: 'none', version: null, progress: null, message: null, notes: [], released: null }
const notes = [{ kind: 'new', title: 'Remove a code from the history', text: 'The × takes it off.' }] as const

test('the notice says nothing until a newer version is found', () => {
  expect(noticeOf(none)).toBeNull()
  expect(noticeOf({ ...none, state: 'available', version: null })).toBeNull()
})

test('an available version is named, with its first change under it', () => {
  expect(noticeOf({ ...none, state: 'available', version: '0.4.1', notes: [...notes] })).toEqual({
    heading: 'A new Guild Board is ready: 0.4.1',
    sub: 'Remove a code from the history',
    progress: null,
    canInstall: true,
    hasNotes: true,
  })
})

test('a release with no notes says what Update now does and offers no list', () => {
  const notice = noticeOf({ ...none, state: 'available', version: '0.4.1' })
  expect(notice?.hasNotes).toBe(false)
  expect(notice?.sub).toBe('Update now installs it and opens Guild Board again.')
})

test('the download shows its part, and the install says it restarts; neither can be pressed again', () => {
  const download = noticeOf({ ...none, state: 'downloading', version: '0.4.1', progress: 0.456 })
  expect(download).toMatchObject({ sub: 'Downloading… 46 %', progress: 0.456, canInstall: false })
  expect(noticeOf({ ...none, state: 'downloading', version: '0.4.1', progress: null })?.sub).toBe('Downloading… 0 %')
  expect(noticeOf({ ...none, state: 'installing', version: '0.4.1' })).toMatchObject({
    sub: 'Restarting…', progress: null, canInstall: false,
  })
})

test('a failure keeps the core\'s words and can be tried again', () => {
  expect(noticeOf({ ...none, state: 'failed', version: '0.4.1', message: 'Offline.' })).toMatchObject({
    sub: 'Offline.', canInstall: true,
  })
})

test('a press the core refused takes the place of the second line', () => {
  expect(noticeOf({ ...none, state: 'available', version: '0.4.1', notes: [...notes] }, 'There is no update.')?.sub).toBe(
    'There is no update.',
  )
})
