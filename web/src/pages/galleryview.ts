/** The Gallery page's model (GET /api/gallery, the ledger design, section 7) and what the page works out from it. */

export type GalleryPicture = {
  /** What the core knows it by: the file name in the game's folder, "<folder key>~<file name>" in an added one. */
  id: string
  /** When it was taken, with its offset. */
  taken: string
  /** "26 Oct 21:14", on its tile. */
  time: string
  /** "26 October 2026, 21:14", in the large view. */
  when: string
  favourite: boolean
  /** An MP4 or WebM video of an added folder; a picture has none. */
  video?: boolean
  /** The name of the added folder it is in; the game's pictures have none. */
  folder?: string
}

export type GalleryMonth = { label: string; pictures: GalleryPicture[] }

/** While the gallery is off the core answers `{ enabled: false }` alone, and lists nothing. */
export type GalleryModel =
  | { enabled: false }
  | {
      enabled: true
      /** The game's ScreenShot folder was not found (the added folders may still show). */
      folder_missing: boolean
      /** Pictures and videos together. */
      count: number
      videos: number
      /** How many added folders are listed. */
      added: number
      months: GalleryMonth[]
    }

export type Show = 'all' | 'favourites'

export const SHOWS: readonly { value: Show; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'favourites', label: 'Favourites' },
]

/** "1 photo", "214 photos". */
export function photos(count: number): string {
  return `${count.toLocaleString('en-GB')} ${count === 1 ? 'photo' : 'photos'}`
}

/** "1 video", "3 videos". */
export function videosText(count: number): string {
  return `${count.toLocaleString('en-GB')} ${count === 1 ? 'video' : 'videos'}`
}

/** What the page counts: "214 photos", or "27 photos, 1 video" once videos are among them, or "2 videos" alone. */
export function countText(count: number, videos: number): string {
  if (videos <= 0) return photos(count)
  if (videos >= count) return videosText(videos)
  return `${photos(count - videos)}, ${videosText(videos)}`
}

/** How many of the pictures are videos. */
export function videoCount(pictures: readonly GalleryPicture[]): number {
  return pictures.filter((picture) => picture.video === true).length
}

/** A video's length as a clock reads it: "0:03", "1:05", "1:02:03"; "" while it is not known. */
export function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return ''
  const whole = Math.round(seconds)
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)
  const rest = String(whole % 60).padStart(2, '0')
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`
}

/** What the page shows: a message instead of the grid, or the grid. */
export type GalleryBody = 'off' | 'missing' | 'empty' | 'grid'

/** The game's folder missing is said only while no added folder is there to show something. */
export function bodyOf(model: GalleryModel): GalleryBody {
  if (!model.enabled) return 'off'
  if (model.folder_missing && model.added === 0) return 'missing'
  return model.count === 0 ? 'empty' : 'grid'
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
