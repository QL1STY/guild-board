import { useEffect, useRef } from 'react'
import '../styles/update.css'
import type { ChangeItem } from '../types.ts'
import { type ListMode, buttonsOf, kindLabel, releasedText } from './whatsnew.ts'

/**
 * The list of changes (the update notice design): a window in the middle of the page area, over a dim that leaves the
 * rail alone. Before an update it opens from the notice and offers Later and Update now; after one it opens by itself,
 * once, and offers Got it. Escape and a click on the dim do what the button that only closes it does. The focus goes to
 * that button, stays inside while the window is open, and returns to where it was.
 */
export function ChangesModal({
  mode,
  version,
  released,
  items,
  onClose,
  onInstall,
}: {
  mode: ListMode
  version: string
  released: string | null
  items: ChangeItem[]
  onClose: () => void
  onInstall: () => void
}) {
  const buttons = buttonsOf(mode)
  const dialog = useRef<HTMLElement>(null)
  const close = useRef<HTMLButtonElement>(null)
  const latest = useRef(onClose)
  latest.current = onClose
  useEffect(() => {
    const before = document.activeElement
    close.current?.focus({ preventScroll: true })
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.isComposing) {
        event.preventDefault()
        event.stopPropagation() // the window answers it alone, not a panel open beneath it
        latest.current()
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
  const day = releasedText(released)
  return (
    <div className="chg-layer">
      <div className="chg-dim" data-testid="changes-dim" onClick={onClose} />
      <div className="chg-wrap">
        <section
          ref={dialog}
          className="chg-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="chg-title"
          data-testid="changes-modal"
          data-mode={mode}
        >
          <header className="chg-head">
            <div className="chg-kick">What's new</div>
            <h2 id="chg-title">
              Guild Board <span>{version}</span>
            </h2>
            {day !== null && <small>{day}</small>}
          </header>
          <ul className="chg-body">
            {items.map((item, index) => {
              const tag = kindLabel(item.kind)
              return (
                <li key={index}className="chg-item" style={{ '--i': index } as React.CSSProperties}>
                  {tag !== null && <span className={`chg-tag ${item.kind}`}>{tag}</span>}
                  <div>
                    <b>{item.title}</b>
                    {item.text !== '' && <span>{item.text}</span>}
                  </div>
                </li>
              )
            })}
          </ul>
          <footer className="chg-foot">
            <button ref={close} type="button" className={buttons.install === null ? 'gb-btn up-btn' : 'gb-btn quiet up-btn'} onClick={onClose}>
              {buttons.close}
            </button>
            {buttons.install !== null && (
              <button type="button" className="gb-btn up-btn" onClick={onInstall}>
                {buttons.install}
              </button>
            )}
          </footer>
        </section>
      </div>
    </div>
  )
}
