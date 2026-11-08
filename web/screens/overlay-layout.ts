import type { Api } from '../e2e/fixtures.ts'

/**
 * The overlay laid out tidily for a promotion picture (the README's and the site's), 1,640 × 680: nine columns of 168 pixels and six
 * rows of 96, with no gap wider than the grid's own and none of the widgets cut off. It is saved through the same layout route as the
 * overlay's Edit mode saves with (`PUT /api/layouts/overlay`, over the revision it read), on the test's own demo core: the player's
 * layout is never touched, since every screens test runs on a fresh core of its own.
 *
 * Each widget has the size its content fills (the Quick timer runs, so its dial fills its card); row 0 keeps the middle three columns
 * free, where the overlay's bar stands. The Timers are five rows tall, enough for every row the demo has, ready and running.
 */
const WIDGETS = [
  { id: 'pic-clock', type: 'clock', w: 3, h: 1, x: 0, y: 0 },
  { id: 'pic-resin', type: 'resin', w: 3, h: 1, x: 6, y: 0 },
  { id: 'pic-timers', type: 'timers', w: 4, h: 5, x: 0, y: 1, pinned: true },
  { id: 'pic-commissions', type: 'commissions', w: 3, h: 2, x: 4, y: 1 },
  { id: 'pic-expeditions', type: 'expeditions', w: 3, h: 2, x: 4, y: 3 },
  { id: 'pic-resets', type: 'resets', w: 3, h: 1, x: 4, y: 5 },
  { id: 'pic-notes', type: 'daily-notes', w: 2, h: 2, x: 7, y: 1 },
  { id: 'pic-quick', type: 'quick-timer', w: 2, h: 2, x: 7, y: 3 },
  { id: 'pic-progress', type: 'progress', w: 2, h: 1, x: 7, y: 5 },
] as const

export async function tidyOverlay(api: Api): Promise<void> {
  const { revision } = await api.get<{ revision: number }>('/api/layouts/overlay')
  await api.put('/api/layouts/overlay', { revision, widgets: WIDGETS.map((widget) => ({ ...widget, settings: {} })) })
  // A quick timer runs, started nine minutes ago on the demo's clock, so that its card shows its dial a third of the way round
  // (its presets alone leave the card mostly empty). It is this test core's own, as the layout is.
  await api.post('/api/quick-timers', { seconds: 25 * 60 })
  await api.advance(9 * 60)
}
