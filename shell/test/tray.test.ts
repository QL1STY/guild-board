import { expect, test } from 'vitest'
import type { Settings } from '../src/protocol.js'
import { TrayMenu, type TrayDeps, type TrayItem } from '../src/tray.js'

function settings(changes: Partial<Settings> = {}): Settings {
  return {
    overlay_hotkey: 'Ctrl+Alt+G',
    overlay_display: '',
    overlay_size: 100,
    overlay_full_screen: false,
    overlay_pinned: true,
    start_with_windows: false,
    sync_paused: false,
    notifications: true,
    tray_hint_shown: false,
    ...changes,
  }
}

function setup(demo = false, overrides: Partial<TrayDeps> = {}) {
  const calls: string[] = []
  const menus: TrayItem[][] = []
  const clicks: (() => void)[] = []
  const warnings: string[] = []
  const deps: TrayDeps = {
    demo,
    openWindow: () => calls.push('open'),
    syncNow: () => calls.push('sync'),
    setPaused: (paused) => void calls.push(`paused ${paused}`),
    setPinned: (pinned) => void calls.push(`pinned ${pinned}`),
    toMainDisplay: () => calls.push('main display'),
    quit: () => calls.push('quit'),
    setMenu: (items) => menus.push(items),
    onClick: (cb) => clicks.push(cb),
    warn: (text) => warnings.push(text),
    ...overrides,
  }
  const menu = new TrayMenu(deps)
  return { menu, calls, menus, clicks, warnings, latest: () => menus[menus.length - 1] }
}

const labels = (items: TrayItem[]): string[] => items.map((item) => (item.type === 'separator' ? '-' : item.label ?? '?'))

test('the menu has the Qt tray’s items with their texts', () => {
  const { latest } = setup()
  expect(labels(latest())).toEqual([
    'Open', 'Sync now', 'Pause syncing', '-', 'Show pinned widgets', 'Move the overlay to the main display', '-', 'Quit',
  ])
})

test('the pause item reads Pause syncing, or Resume syncing while paused, and is no check', () => {
  const { menu, latest } = setup()
  const pause = () => latest().find((item) => item.label === 'Pause syncing' || item.label === 'Resume syncing')!
  expect(pause().label).toBe('Pause syncing')
  expect(pause().type).toBeUndefined()
  menu.update(settings({ sync_paused: true }))
  expect(pause().label).toBe('Resume syncing')
  expect(pause().type).toBeUndefined()
  menu.update(settings({ sync_paused: false }))
  expect(pause().label).toBe('Pause syncing')
})

test('the pinned check follows the setting', () => {
  const { menu, latest } = setup()
  const pinned = () => latest().find((item) => item.label === 'Show pinned widgets')!
  expect(pinned().checked).toBe(true) // as the setting is by default, until the settings arrive
  expect(pinned().type).toBe('checkbox')
  menu.update(settings({ overlay_pinned: false }))
  expect(pinned().checked).toBe(false)
})

test('the menu is not rebuilt for settings that change neither the pause text nor the pinned check', () => {
  const { menu, menus } = setup()
  menu.update(settings())
  const before = menus.length
  menu.update(settings({ notifications: false, overlay_size: 150 }))
  expect(menus.length).toBe(before)
  menu.update(settings({ sync_paused: true }))
  expect(menus.length).toBe(before + 1)
})

test('the overlay items are absent in the demo, and no separator is left doubled', () => {
  const { latest } = setup(true)
  expect(labels(latest())).toEqual(['Open', 'Sync now', 'Pause syncing', '-', 'Quit'])
})

test('a click on the pause item sends the opposite of the state the settings gave', () => {
  const { menu, calls, latest } = setup()
  latest().find((item) => item.label === 'Pause syncing')!.click!({ checked: false })
  menu.update(settings({ sync_paused: true }))
  latest().find((item) => item.label === 'Resume syncing')!.click!({ checked: false })
  expect(calls).toEqual(['paused true', 'paused false'])
})

test('each item calls what it is for', () => {
  const { menu, calls, latest } = setup()
  menu.update(settings())
  const click = (label: string, checked = false): void => latest().find((item) => item.label === label)!.click!({ checked })
  click('Open')
  click('Sync now')
  click('Pause syncing')
  click('Show pinned widgets', false)
  click('Move the overlay to the main display')
  click('Quit')
  expect(calls).toEqual(['open', 'sync', 'paused true', 'pinned false', 'main display', 'quit'])
})

test('a click on the icon opens the window', () => {
  const { clicks, calls } = setup()
  expect(clicks).toHaveLength(1)
  clicks[0]()
  expect(calls).toEqual(['open'])
})

test('an item that fails is logged and goes no further', () => {
  const { latest, warnings } = setup(false, {
    syncNow: () => {
      throw new Error('boom')
    },
  })
  expect(() => latest().find((item) => item.label === 'Sync now')!.click!({ checked: false })).not.toThrow()
  expect(warnings).toEqual(['The tray item Sync now failed.'])
})

test('a pinned check that the core did not take goes back to the setting', async () => {
  const { menu, menus, latest, warnings } = setup(false, { setPinned: () => Promise.reject(new Error('no core')) })
  menu.update(settings({ overlay_pinned: true }))
  const before = menus.length
  // The native check flipped with the click; the setting did not.
  latest().find((item) => item.label === 'Show pinned widgets')!.click!({ checked: false })
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(warnings).toEqual(['The tray item Show pinned widgets failed.'])
  expect(menus.length).toBe(before + 1)
  expect(latest().find((item) => item.label === 'Show pinned widgets')?.checked).toBe(true)
})
