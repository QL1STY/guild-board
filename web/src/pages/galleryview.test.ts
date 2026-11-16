import { expect, test } from 'vitest'
import {
  bodyOf,
  clock,
  countText,
  type GalleryMonth,
  inOrder,
  photos,
  pictureUrl,
  step,
  stepShown,
  videoCount,
  videosText,
  visibleMonths,
  withFavourite,
} from './galleryview.ts'

function picture(id: string, favourite = false) {
  return { id, taken: '2026-10-12T21:14:03+02:00', time: '12 Oct 21:14', when: '12 October 2026, 21:14', favourite }
}

const MONTHS: GalleryMonth[] = [
  { label: 'October 2026', pictures: [picture('20261012211403.png', true), picture('20261003100000.jpg')] },
  { label: 'September 2026', pictures: [picture('20260930080000.jpg')] },
  { label: 'August 2026', pictures: [picture('Photo (2).jpg', true)] },
]

test('months group newest first', () => {
  expect(visibleMonths(MONTHS, 'all').map((month) => month.label)).toEqual([
    'October 2026',
    'September 2026',
    'August 2026',
  ])
  expect(inOrder(visibleMonths(MONTHS, 'all')).map((p) => p.id)).toEqual([
    '20261012211403.png',
    '20261003100000.jpg',
    '20260930080000.jpg',
    'Photo (2).jpg',
  ])
})

test('favourites filter', () => {
  const shown = visibleMonths(MONTHS, 'favourites')
  // A month left with no favourite is left out; the order stays.
  expect(shown.map((month) => month.label)).toEqual(['October 2026', 'August 2026'])
  expect(inOrder(shown).map((p) => p.id)).toEqual(['20261012211403.png', 'Photo (2).jpg'])
  expect(visibleMonths(withFavourite(MONTHS, 'Photo (2).jpg', false), 'favourites').map((m) => m.label)).toEqual([
    'October 2026',
  ])
})

test('arrow keys move within the list', () => {
  const list = inOrder(MONTHS)
  expect(step(list, '20261003100000.jpg', 'ArrowRight')).toBe('20260930080000.jpg')
  expect(step(list, '20261003100000.jpg', 'ArrowLeft')).toBe('20261012211403.png')
  expect(step(list, '20261012211403.png', 'ArrowLeft')).toBeNull() // the newest: nowhere before it
  expect(step(list, 'Photo (2).jpg', 'ArrowRight')).toBeNull() // the oldest
  expect(step(list, '20261003100000.jpg', 'Enter')).toBeNull()
  expect(step(list, 'gone.png', 'ArrowRight')).toBeNull()
})

test('the open picture un-starred under Favourites still moves to its neighbours shown', () => {
  // Favourites shows the first and the last; the first, open, is un-starred and leaves the list shown.
  const unstarred = withFavourite(MONTHS, '20261012211403.png', false)
  const shown = inOrder(visibleMonths(unstarred, 'favourites'))
  const all = inOrder(unstarred)
  expect(shown.map((p) => p.id)).toEqual(['Photo (2).jpg'])
  expect(stepShown(shown, all, '20261012211403.png', 'ArrowRight')).toBe('Photo (2).jpg')
  expect(stepShown(shown, all, '20261012211403.png', 'ArrowLeft')).toBeNull()
  expect(stepShown(shown, all, 'Photo (2).jpg', 'ArrowLeft')).toBeNull() // shown: as step
  expect(stepShown(shown, all, '20261003100000.jpg', 'ArrowLeft')).toBeNull()
  expect(stepShown(shown, all, '20260930080000.jpg', 'ArrowRight')).toBe('Photo (2).jpg')
  expect(stepShown(shown, all, '20260930080000.jpg', 'Enter')).toBeNull()
})

test('a picture count and a picture address read right', () => {
  expect([photos(0), photos(1), photos(214), photos(1200)]).toEqual(['0 photos', '1 photo', '214 photos', '1,200 photos'])
  expect(pictureUrl('Photo (2).jpg', 'thumb')).toBe('/api/gallery/Photo%20(2).jpg/thumb')
  expect(pictureUrl('..\\x.png', 'full')).toBe('/api/gallery/..%5Cx.png/full')
})

test('an id of an added folder keeps its tilde in the address, and a video counts apart from the photos', () => {
  expect(pictureUrl('ab12cd34~Clip 2026-10-05 20-00-00.webm', 'full')).toBe(
    '/api/gallery/ab12cd34~Clip%202026-10-05%2020-00-00.webm/full',
  )
  expect([countText(24, 0), countText(28, 1), countText(3, 3), countText(1, 1), countText(0, 0)]).toEqual([
    '24 photos',
    '27 photos, 1 video',
    '3 videos',
    '1 video',
    '0 photos',
  ])
  const month = [picture('a.jpg'), { ...picture('ab12cd34~b.webm'), video: true, folder: 'Clips' }]
  expect(videoCount(month)).toBe(1)
  expect(videosText(2)).toBe('2 videos')
})

test('a video length reads as a clock', () => {
  expect([clock(0), clock(2.6), clock(65), clock(600), clock(3723)]).toEqual(['0:00', '0:03', '1:05', '10:00', '1:02:03'])
  expect([clock(NaN), clock(Infinity), clock(-1)]).toEqual(['', '', ''])
})

test('the game folder missing is said only while no added folder is there', () => {
  const base = { enabled: true as const, count: 0, videos: 0, months: [] }
  expect(bodyOf({ enabled: false })).toBe('off')
  expect(bodyOf({ ...base, folder_missing: true, added: 0 })).toBe('missing')
  expect(bodyOf({ ...base, folder_missing: true, added: 1 })).toBe('empty')
  expect(bodyOf({ ...base, folder_missing: false, added: 0 })).toBe('empty')
  expect(bodyOf({ ...base, folder_missing: true, added: 1, count: 3 })).toBe('grid')
})
