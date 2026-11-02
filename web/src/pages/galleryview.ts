/** The Gallery page's model (GET /api/gallery, the ledger design, section 7) and what the page works out from it. */

export type GalleryPicture = {
  /** The file name, which is the id the core knows it by. */
  id: string
  /** When it was taken, with its offset. */
  taken: string
  /** "26 Oct 21:14", on its tile. */
  time: string
  /** "26 October 2026, 21:14", in the large view. */
  when: string
  favourite: boolean
}

export type GalleryMonth = { label: string; pictures: GalleryPicture[] }

/** While the gallery is off the core answers `{ enabled: false }` alone, and lists nothing. */
export type GalleryModel =
  | { enabled: false }
  | { enabled: true; folder_missing: boolean; count: number; months: GalleryMonth[] }

export type Show = 'all' | 'favourites'

export const SHOWS: readonly { value: Show; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'favourites', label: 'Favourites' },
]

/** "1 photo", "214 photos". */
export function photos(count: number): string {
  return `${count.toLocaleString('en-GB')} ${count === 1 ? 'photo' : 'photos'}`
}

/** The months to show, newest first as the core gives them: all of them, or only favourites, leaving out a month left
 * with none. */
export function visibleMonths(months: readonly GalleryMonth[], show: Show): GalleryMonth[] {
  if (show === 'all') return months.filter((month) => month.pictures.length > 0)
  return months
    .map((month) => ({ label: month.label, pictures: month.pictures.filter((picture) => picture.favourite) }))
    .filter((month) => month.pictures.length > 0)
}

/** Every picture shown, in the page's order: what the large view's arrows move through. */
export function inOrder(months: readonly GalleryMonth[]): GalleryPicture[] {
  return months.flatMap((month) => month.pictures)
}

/**
 * The picture an arrow key moves to from `id`: ← the one before (newer), → the one after (older). It stops at either
 * end. Null for any other key, or when there is nowhere to go.
 */
export function step(pictures: readonly GalleryPicture[], id: string, key: string): string | null {
  const at = pictures.findIndex((picture) => picture.id === id)
  if (at < 0) return null
  const by = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : 0
  if (by === 0) return null
  return pictures[at + by]?.id ?? null
}

/**
 * As step, for the picture the large view shows, which a filter may have taken out of the list shown (a favourite
 * un-starred under Favourites): it moves from where that picture stands among `all`, to the nearest one shown.
 */
export function stepShown(
  shown: readonly GalleryPicture[],
  all: readonly GalleryPicture[],
  id: string,
  key: string,
): string | null {
  if (shown.some((picture) => picture.id === id)) return step(shown, id, key)
  const by = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : 0
  const at = all.findIndex((picture) => picture.id === id)
  if (by === 0 || at < 0) return null
  const ids = new Set(shown.map((picture) => picture.id))
  for (let index = at + by; index >= 0 && index < all.length; index += by) {
    if (ids.has(all[index].id)) return all[index].id
  }
  return null
}

/** The same months with one picture's star set or cleared, until the core's answer arrives. */
export function withFavourite(months: readonly GalleryMonth[], id: string, on: boolean): GalleryMonth[] {
  return months.map((month) => ({
    label: month.label,
    pictures: month.pictures.map((picture) => (picture.id === id ? { ...picture, favourite: on } : picture)),
  }))
}

/** The address of a picture's thumbnail or the picture itself. */
export function pictureUrl(id: string, kind: 'thumb' | 'full'): string {
  return `/api/gallery/${encodeURIComponent(id)}/${kind}`
}
