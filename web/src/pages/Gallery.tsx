import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import '../styles/gallery.css'
import { api, messageOf } from '../api.ts'
import { Frame } from '../frame/Frame.tsx'
import type { Live } from '../live.ts'
import { hashOf } from '../route.ts'
import { Segmented } from '../ui/Segmented.tsx'
import {
  type GalleryModel,
  type GalleryPicture,
  inOrder,
  photos,
  pictureUrl,
  SHOWS,
  type Show,
  stepShown,
  visibleMonths,
  withFavourite,
} from './galleryview.ts'

/** Whether this browser can put a picture on the clipboard at all; without it the button is not shown. */
const CAN_COPY =
  typeof window !== 'undefined' &&
  typeof window.ClipboardItem === 'function' &&
  typeof navigator.clipboard?.write === 'function'

/** The picture as PNG, the one kind of picture the clipboard takes: the core serves PNG or JPEG. */
async function asPng(url: string): Promise<Blob> {
  const response = await fetch(url)
  if (!response.ok) throw new Error('not read')
  const blob = await response.blob()
  if (blob.type === 'image/png') return blob
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((png) => (png === null ? reject(new Error('not drawn')) : resolve(png)), 'image/png'),
  )
}

function LargeView({
  picture,
  hasPrevious,
  hasNext,
  onMove,
  onClose,
  onFavourite,
}: {
  picture: GalleryPicture
  hasPrevious: boolean
  hasNext: boolean
  onMove: (key: 'ArrowLeft' | 'ArrowRight') => void
  onClose: () => void
  onFavourite: (on: boolean) => void
}) {
  const [size, setSize] = useState<string | null>(null)
  const [said, setSaid] = useState<string | null>(null)
  const close = useRef<HTMLButtonElement>(null)
  const dialog = useRef<HTMLElement>(null)
  const latest = useRef({ onMove, onClose })
  latest.current = { onMove, onClose }
  useEffect(() => {
    setSize(null)
    setSaid(null)
  }, [picture.id])
  useEffect(() => {
    const before = document.activeElement
    close.current?.focus({ preventScroll: true })
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        latest.current.onClose()
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        latest.current.onMove(event.key)
      } else if (event.key === 'Tab' && dialog.current !== null) {
        const focusable = [...dialog.current.querySelectorAll<HTMLElement>('button:not(:disabled)')]
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (!dialog.current.contains(document.activeElement)) {
          event.preventDefault()
          first?.focus()
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last?.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first?.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (before instanceof HTMLElement && before.isConnected) before.focus({ preventScroll: true })
    }
  }, [])
  const full = pictureUrl(picture.id, 'full')
  const copy = async () => {
    setSaid(null)
    try {
      // The picture is made while the click still counts as the player's: the clipboard is written at once.
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': asPng(full) })])
      setSaid('Copied. Paste it where you like.')
    } catch {
      setSaid('The picture could not be copied.')
    }
  }
  const show = async () => {
    setSaid(null)
    try {
      await api.post(`/api/gallery/${encodeURIComponent(picture.id)}/show`)
    } catch (error) {
      setSaid(messageOf(error))
    }
  }
  return (
    <div className="ga-layer">
      <div className="ga-dim" data-testid="gallery-dim" onClick={onClose} />
      <section ref={dialog} className="ga-light" role="dialog" aria-modal="true" aria-label="Photo" data-testid="gallery-view">
        <div className="ga-big">
          <img
            key={picture.id}
            src={full}
            alt={`Photo taken ${picture.when}`}
            data-testid="gallery-full"
            onLoad={(event) => setSize(`${event.currentTarget.naturalWidth} × ${event.currentTarget.naturalHeight}`)}
          />
          <button
            type="button"
            className="ga-nav prev"
            aria-label="Previous photo"
            disabled={!hasPrevious}
            onClick={() => onMove('ArrowLeft')}
          >
            ‹
          </button>
          <button
            type="button"
            className="ga-nav next"
            aria-label="Next photo"
            disabled={!hasNext}
            onClick={() => onMove('ArrowRight')}
          >
            ›
          </button>
        </div>
        <div className="ga-side">
          <button ref={close} type="button" className="ga-close" aria-label="Close" onClick={onClose}>
            ✕
          </button>
          <div>
            <div className="ga-k">Taken</div>
            <b data-testid="gallery-taken">{picture.when}</b>
          </div>
          <div>
            <div className="ga-k">Size</div>
            <span data-testid="gallery-size">{size ?? '…'}</span>
          </div>
          <button
            type="button"
            className={picture.favourite ? 'gb-btn quiet ga-fav on' : 'gb-btn quiet ga-fav'}
            aria-pressed={picture.favourite}
            onClick={() => onFavourite(!picture.favourite)}
          >
            {picture.favourite ? '★' : '☆'} Favourite
          </button>
          {CAN_COPY && (
            <button type="button" className="gb-btn quiet" onClick={() => void copy()}>
              Copy picture
            </button>
          )}
          <button type="button" className="gb-btn quiet" onClick={() => void show()}>
            Show in folder
          </button>
          {said !== null && (
            <p className="ga-said" role="status">
              {said}
            </p>
          )}
        </div>
      </section>
    </div>
  )
}

export function Gallery({ live }: { live: Live }) {
  const [model, setModel] = useState<GalleryModel | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [show, setShow] = useState<Show>('all')
  const [open, setOpen] = useState<string | null>(null)
  const [looking, setLooking] = useState(false)
  const opened = useRef(false)

  /** Asks the core: `fresh` looks at the folder again, as on opening the page and on Look again. */
  const read = useCallback(async (fresh: boolean) => {
    try {
      const next = fresh
        ? await api.post<GalleryModel>('/api/gallery/rescan')
        : await api.get<GalleryModel>('/api/gallery')
      setModel(next)
      setError(null)
    } catch (failure) {
      setError(messageOf(failure))
    }
  }, [])

  // The folder is looked at when the page opens; later events read what that look found.
  useEffect(() => {
    if (!opened.current) {
      opened.current = true
      void read(true)
    } else {
      void read(false)
    }
  }, [read, live.version])

  const lookAgain = async () => {
    setLooking(true)
    await read(true)
    setLooking(false)
  }

  const months = useMemo(
    () => (model !== null && model.enabled ? visibleMonths(model.months, show) : []),
    [model, show],
  )
  const list = useMemo(() => inOrder(months), [months])
  // The large view keeps the picture it shows when a filter would hide it, until it moves.
  const all = useMemo(() => (model !== null && model.enabled ? inOrder(model.months) : []), [model])
  const current = open === null ? null : (list.find((p) => p.id === open) ?? all.find((p) => p.id === open) ?? null)

  const favourite = async (id: string, on: boolean) => {
    setModel((before) => (before !== null && before.enabled ? { ...before, months: withFavourite(before.months, id, on) } : before))
    try {
      await api.put(`/api/gallery/${encodeURIComponent(id)}/favourite`, { on })
    } catch (failure) {
      setError(messageOf(failure))
      await read(false)
    }
  }

  const controls =
    model !== null && model.enabled && !model.folder_missing ? (
      <>
        <span className="gb-status" data-testid="gallery-count">
          {photos(model.count)}
        </span>
        <Segmented label="Show" options={SHOWS} value={show} onChange={setShow} />
        <button type="button" className="gb-btn quiet" disabled={looking} onClick={() => void lookAgain()}>
          Look again
        </button>
      </>
    ) : undefined

  let body
  if (model === null) {
    body = <div className="gb-panel gb-empty">{error ?? 'Looking at your screenshots…'}</div>
  } else if (!model.enabled) {
    body = (
      <div className="gb-panel gb-empty">
        The screenshot gallery is turned off. Turn it on in <a href={hashOf('settings')}>Settings</a>.
      </div>
    )
  } else if (model.folder_missing) {
    body = (
      <div className="gb-panel gb-empty" data-testid="gallery-missing">
        The game's ScreenShot folder was not found. Choose it in <a href={hashOf('settings')}>Settings</a>, then come
        back here.
      </div>
    )
  } else if (model.count === 0) {
    body = (
      <div className="gb-panel gb-empty">
        No photos yet. The pictures you take in the game show here; press Look again after taking some.
      </div>
    )
  } else if (months.length === 0) {
    body = (
      <div className="gb-panel gb-empty">No favourites yet. Open a photo and press Favourite to keep it here.</div>
    )
  } else {
    body = (
      <div className="ga-page">
        {error !== null && (
          <p className="ga-error" role="alert">
            {error}
          </p>
        )}
        {months.map((month) => (
          <section key={month.label} className="ga-month" aria-label={month.label}>
            <h2 className="ga-month-h">
              {month.label} <span>{photos(month.pictures.length)}</span>
            </h2>
            <div className="ga-grid">
              {month.pictures.map((picture) => (
                <button
                  key={picture.id}
                  type="button"
                  className={picture.favourite ? 'ga-tile fav' : 'ga-tile'}
                  aria-label={`Photo taken ${picture.when}${picture.favourite ? ', favourite' : ''}`}
                  data-testid="gallery-tile"
                  data-id={picture.id}
                  onClick={() => setOpen(picture.id)}
                >
                  <img src={pictureUrl(picture.id, 'thumb')} alt="" loading="lazy" decoding="async" />
                  <span className="ga-time">{picture.time}</span>
                  {picture.favourite && (
                    <span className="ga-star" aria-hidden="true">
                      ★
                    </span>
                  )}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    )
  }

  return (
    <Frame page="gallery" live={live} controls={controls}>
      {body}
      {current !== null && (
        <LargeView
          picture={current}
          hasPrevious={stepShown(list, all, current.id, 'ArrowLeft') !== null}
          hasNext={stepShown(list, all, current.id, 'ArrowRight') !== null}
          onMove={(key) => {
            const next = stepShown(list, all, current.id, key)
            if (next !== null) setOpen(next)
          }}
          onClose={() => setOpen(null)}
          onFavourite={(on) => void favourite(current.id, on)}
        />
      )}
    </Frame>
  )
}
