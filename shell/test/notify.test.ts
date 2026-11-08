import { expect, test } from 'vitest'
import { Notifier, STILL_RUNNING, type TrayLike } from '../src/notify.js'

class FakeTray implements TrayLike {
  balloons: { title: string; content: string }[] = []
  clicks: (() => void)[] = []
  gone = false
  failNext = false
  displayBalloon(options: { title: string; content: string }): void {
    if (this.failNext) throw new Error('no balloon')
    this.balloons.push(options)
  }
  on(_event: 'balloon-click', listener: () => void): void {
    this.clicks.push(listener)
  }
  isDestroyed(): boolean {
    return this.gone
  }
  click(): void {
    for (const listener of this.clicks) listener()
  }
}

function setup() {
  const tray = new FakeTray()
  const opened: (string | null)[] = []
  const notifier = new Notifier(tray, (place) => opened.push(place))
  return { tray, opened, notifier }
}

test('a notification shows as a balloon titled Guild Board with the text', () => {
  const { tray, notifier } = setup()
  expect(notifier.show('reminder', 'Your Parametric Transformer is ready.', 'achievements/timers')).toBe(true)
  expect(tray.balloons).toEqual([{ title: 'Guild Board', content: 'Your Parametric Transformer is ready.' }])
})

test('a click on the balloon opens the place of the last balloon', () => {
  const { tray, opened, notifier } = setup()
  notifier.show('reminder', 'first', 'achievements/timers')
  notifier.show('codes', 'second', 'codes')
  tray.click()
  expect(opened).toEqual(['codes'])
})

test('a balloon without a place opens the window where it is: the place is null', () => {
  const { tray, opened, notifier } = setup()
  notifier.show('backup', 'Saved a.gbbackup.', null)
  tray.click()
  expect(opened).toEqual([null])
})

test('a click with no balloon shown before opens nothing', () => {
  const { tray, opened } = setup()
  tray.click()
  expect(opened).toEqual([])
})

test('the still-running hint has its own title and text, and its click opens the window', () => {
  const { tray, opened, notifier } = setup()
  expect(STILL_RUNNING).toEqual({
    title: 'Guild Board is still running',
    text: 'It keeps syncing from the tray. Right-click the tray icon to quit.',
  })
  expect(notifier.hint()).toBe(true)
  expect(tray.balloons).toEqual([{ title: STILL_RUNNING.title, content: STILL_RUNNING.text }])
  tray.click()
  expect(opened).toEqual([null])
})

test('a balloon is not shown when the tray is gone, or when Windows refuses it, and says so', () => {
  const { tray, opened, notifier } = setup()
  tray.gone = true
  expect(notifier.show('reminder', 'x', 'board')).toBe(false)
  expect(tray.balloons).toEqual([])
  tray.gone = false
  tray.failNext = true
  expect(notifier.show('reminder', 'x', 'board')).toBe(false)
  tray.click()
  expect(opened).toEqual([]) // nothing was shown, so a click is not for it
})
