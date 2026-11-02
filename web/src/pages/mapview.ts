import type { MapArea, MapModel } from '../types.ts'

/** The area of the page a rectangle takes, in CSS pixels to a tenth, as the shell lays the map views over it. */
export function areaOf(rect: { left: number; top: number; width: number; height: number }, hidden: boolean): MapArea {
  const tenth = (value: number) => Math.round(value * 10) / 10
  return { x: tenth(rect.left), y: tenth(rect.top), w: tenth(rect.width), h: tenth(rect.height), hidden }
}

/** What the toolbar says of the account: nothing while the map is signed in, else why the map does not know the player. */
export function chipOf(model: MapModel, demo: boolean): { text: string; canLogIn: boolean } | null {
  if (model.signed_in) return null
  if (demo) return { text: 'Demo data: the map is not signed in', canLogIn: false }
  return { text: 'Not logged in to HoYoLAB', canLogIn: true }
}

/**
 * What the page says in place of the map, when the map is not showing: because there is no Guild Board window to draw
 * it, or because the tab's map did not load. Null while the map shows.
 */
export function placeholder(model: MapModel): { title: string; text: string; canReload: boolean } | null {
  if (!model.has_shell) {
    return {
      title: 'The map shows in the Guild Board window',
      text: 'This page was opened in a browser, which cannot hold the map. Open Guild Board from its own window or its tray icon.',
      canReload: false,
    }
  }
  const tab = model.tabs.find((candidate) => candidate.id === model.active)
  if (tab?.failed) {
    return {
      title: 'The map did not load',
      text: "HoYoLAB's map page did not answer. Check your internet connection. If other HoYoLAB pages work, the map may be down for a while.",
      canReload: true,
    }
  }
  return null
}

/** The tab to show after the active one is closed with Ctrl+W is the core's to say; this is the key for it. */
export function keyAction(event: { ctrlKey: boolean; shiftKey: boolean; key: string }): 'new' | 'close' | 'reopen' | null {
  if (!event.ctrlKey) return null
  const key = event.key.toLowerCase()
  if (key === 't') return event.shiftKey ? 'reopen' : 'new'
  if (key === 'w' && !event.shiftKey) return 'close'
  return null
}
