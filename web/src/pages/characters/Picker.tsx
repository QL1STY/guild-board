import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Element } from '../../types.ts'
import { Picture } from '../../ui/Picture.tsx'
import type { SignName } from '../../ui/Sign.tsx'
import { elementClass } from './elements.ts'

/** One thing to choose: a weapon or an artifact set, as a picture tile. A tile that cannot be chosen yet says why in `lines`. */
export type PickTile = { key: string; name: string; icon: string | null; rarity: number | null; lines: ReactNode; disabled?: boolean }

/**
 * A dialog over the page that picks one weapon or set: a search box, chips that filter by rarity with their counts (weapons
 * only) and a grid of picture tiles about 150 pixels wide. It is `position: fixed`, so the page never changes height for it.
 * Escape, Close and a press outside it close it; the focus goes to the search box and, when it closes, back to where it was.
 * Choosing a tile closes it.
 */
export function Picker({ title, sign, tiles, error, current, element, rarities, onPick, onClose }: {
  title: string
  sign: SignName
  /** Null while the list is being read. */
  tiles: PickTile[] | null
  error: string | null
  /** The key of the tile that is chosen now. */
  current: string
  element: Element
  /** Whether to offer chips for the rarities the tiles have. */
  rarities: boolean
  onPick: (key: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [rarity, setRarity] = useState<number | null>(null)
  const dialog = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const latest = useRef(onClose)
  latest.current = onClose
  const heading = useId()

  useEffect(() => {
    const before = document.activeElement
    search.current?.focus({ preventScroll: true })
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.isComposing) {
        event.preventDefault()
        event.stopPropagation()
        latest.current()
      } else if (event.key === 'Tab' && dialog.current !== null) {
        const focusable = [...dialog.current.querySelectorAll<HTMLElement>('button:not(:disabled), input')]
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

  const stars = useMemo(() => (tiles === null ? [] : [...new Set(tiles.flatMap((tile) => (tile.rarity === null ? [] : [tile.rarity])))].sort((a, b) => b - a)), [tiles])
  const shown = (tiles ?? []).filter((tile) => (rarity === null || tile.rarity === rarity) && tile.name.toLowerCase().includes(query.trim().toLowerCase()))
  const count = (stars: number | null) => (tiles ?? []).filter((tile) => stars === null || tile.rarity === stars).length

  return createPortal(
    <div className={`pp-card ${elementClass(element)} pp-scrim`} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div ref={dialog} className="pp-modal" role="dialog" aria-modal="true" aria-labelledby={heading}>
        <div className="pp-mhead">
          <div className="row">
            <h4 id={heading}>{title}</h4>
            <button type="button" className="pp-btn" onClick={onClose}>
              Close
            </button>
          </div>
          <div className="row">
            <input ref={search} type="search" placeholder="Search" aria-label="Search" value={query} onChange={(event) => setQuery(event.target.value)} />
          </div>
          {rarities && stars.length > 1 && (
            <div className="pp-chips">
              <button type="button" aria-pressed={rarity === null} onClick={() => setRarity(null)}>
                All · {count(null)}
              </button>
              {stars.map((one) => (
                <button key={one} type="button" aria-pressed={rarity === one} onClick={() => setRarity(one)}>
                  {one}★ · {count(one)}
                </button>
              ))}
            </div>
          )}
        </div>
        {error !== null ? (
          <p className="pp-modal-note" role="alert">
            {error}
          </p>
        ) : tiles === null ? (
          <p className="pp-modal-note">Reading the list…</p>
        ) : (
          <div className="pp-grid">
            {shown.map((tile) => (
              <button
                key={tile.key}
                type="button"
                className={`pp-tile${tile.rarity === null ? '' : ` r${tile.rarity}`}`}
                aria-pressed={tile.key === current}
                disabled={tile.disabled}
                onClick={() => onPick(tile.key)}
              >
                <Picture src={tile.icon} sign={sign} lazy />
                <b>{tile.name}</b>
                <span>{tile.lines}</span>
              </button>
            ))}
            {shown.length === 0 && <p className="pp-modal-note">Nothing matches.</p>}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
