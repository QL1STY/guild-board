import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import '../styles/map.css'
import { api, messageOf } from '../api.ts'
import { Frame } from '../frame/Frame.tsx'
import { type Live, useModel } from '../live.ts'
import type { MapModel } from '../types.ts'
import { Sign } from '../ui/Sign.tsx'
import { areaOf, chipOf, keyAction, placeholder } from './mapview.ts'

type Menu = { id: number; x: number; y: number }

/**
 * The Map page (the Map design): HoYoLAB's own map in tabs. The map is not drawn here. The Guild Board window lays its
 * own browser views over the empty area below the tabs, and this page tells the core where that area is, and when
 * something of the page covers it, because a browser view is always on top.
 */
export function MapPage({ live }: { live: Live }) {
  const { data } = useModel<MapModel>('/api/map', live.version)
  const [model, setModel] = useState<MapModel | null>(null)
  const [menu, setMenu] = useState<Menu | null>(null)
  const [renaming, setRenaming] = useState<number | null>(null)
  const [wide, setWide] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  const area = useRef<HTMLDivElement>(null)
  const sent = useRef('')

  useEffect(() => {
    if (data !== null) setModel(data)
  }, [data])

  const change = useCallback(async (run: () => Promise<MapModel>) => {
    try {
      setModel(await run())
      setSaid(null)
    } catch (error) {
      setSaid(messageOf(error))
    }
  }, [])
  const open = () => void change(() => api.post<MapModel>('/api/map/tabs', {}))
  const close = (id: number) => void change(() => api.delete<MapModel>(`/api/map/tabs/${id}`))
  const reopen = () => void change(() => api.post<MapModel>('/api/map/reopen'))
  const activate = (id: number) => void change(() => api.put<MapModel>('/api/map/active', { id }))
  const duplicate = (id: number) => void change(() => api.post<MapModel>(`/api/map/tabs/${id}/duplicate`))
  const reload = (id: number) => void change(() => api.post<MapModel>(`/api/map/tabs/${id}/reload`))
  const rename = (id: number, name: string) => {
    setRenaming(null)
    void change(() => api.put<MapModel>(`/api/map/tabs/${id}`, { name }))
  }

  const addressOf = async (id: number): Promise<string | null> => {
    try {
      return (await api.get<{ url: string }>(`/api/map/tabs/${id}`)).url
    } catch (error) {
      setSaid(messageOf(error))
      return null
    }
  }
  const copyLink = async (id: number) => {
    const url = await addressOf(id)
    if (url === null) return
    try {
      await navigator.clipboard.writeText(url)
      setSaid('Link copied.')
    } catch {
      setSaid('The link could not be copied.')
    }
  }
  const inBrowser = async (id: number) => {
    const url = await addressOf(id)
    if (url !== null) window.open(url, '_blank', 'noopener')
  }

  // The frame's drop-downs (the plate's and the profile card's, Panel.tsx) hang over the page too: while one is open,
  // the map steps aside as it does for the tab menu.
  const [dropped, setDropped] = useState(false)
  useEffect(() => {
    const look = () => setDropped(document.querySelector('.gb-pop') !== null)
    const observer = new MutationObserver(look)
    observer.observe(document.body, { childList: true, subtree: true })
    look()
    return () => observer.disconnect()
  }, [])

  const instead = model === null ? null : placeholder(model)
  const covered = menu !== null || instead !== null || dropped

  // Where the map goes: the area's rectangle, sent whenever it moves or resizes, and again once the page's opening fade is
  // over. Leaving the page sends none, which takes the views off.
  const send = useCallback((next: ReturnType<typeof areaOf> | null) => {
    const key = JSON.stringify(next)
    if (key === sent.current) return
    sent.current = key
    api.put('/api/map/viewport', { area: next }).catch(() => {
      sent.current = ''
    })
  }, [])
  useLayoutEffect(() => {
    const element = area.current
    if (element === null) return undefined
    let frame = 0
    const measure = () => {
      frame = 0
      send(areaOf(element.getBoundingClientRect(), covered))
    }
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(measure)
    }
    const observer = new ResizeObserver(schedule)
    observer.observe(element)
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)
    const settled = window.setTimeout(schedule, 300)
    schedule()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
      window.clearTimeout(settled)
      if (frame !== 0) cancelAnimationFrame(frame)
    }
  }, [covered, wide, model === null, send])
  useEffect(
    () => () => {
      sent.current = ''
      api.put('/api/map/viewport', { area: null }).catch(() => undefined)
    },
    [],
  )

  // Ctrl+T, Ctrl+Shift+T and Ctrl+W, while the focus is on the page (a map view takes its own keys).
  const active = model?.active ?? 0
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const action = keyAction(event)
      if (action === null || model === null) return
      event.preventDefault()
      if (action === 'new') open()
      else if (action === 'reopen' && model.can_reopen) reopen()
      else if (action === 'close') close(active)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [model, active])

  useEffect(() => {
    if (menu === null) return undefined
    const away = () => setMenu(null)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') away()
    }
    window.addEventListener('pointerdown', away)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', away)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  const chip = model === null ? null : chipOf(model, live.status?.mode === 'demo')
  return (
    <Frame page="map" live={live} wide bare={wide}>
      <div className={wide ? 'mp bare' : 'mp'} data-testid="map">
        {model === null ? (
          <p className="gb-hint" role="status">
            Opening the map…
          </p>
        ) : (
          <>
            <div className="mp-tabs" role="tablist" aria-label="Map tabs">
              {model.tabs.map((tab) => (
                <div
                  key={tab.id}
                  className={tab.id === model.active ? 'mp-tab on' : 'mp-tab'}
                  role="tab"
                  aria-selected={tab.id === model.active}
                  tabIndex={0}
                  title={tab.name}
                  data-testid={`map-tab-${tab.id}`}
                  onClick={() => {
                    if (tab.id !== model.active && renaming !== tab.id) activate(tab.id)
                  }}
                  onDoubleClick={() => setRenaming(tab.id)}
                  onAuxClick={(event) => {
                    if (event.button === 1) close(tab.id)
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    setMenu({ id: tab.id, x: event.clientX, y: event.clientY })
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') activate(tab.id)
                    if (event.key === 'F2') setRenaming(tab.id)
                  }}
                >
                  <Sign name="map" className="mp-ic" />
                  {renaming === tab.id ? (
                    <input
                      className="mp-name"
                      defaultValue={tab.name}
                      maxLength={40}
                      aria-label="Tab name"
                      autoFocus
                      onFocus={(event) => event.currentTarget.select()}
                      onClick={(event) => event.stopPropagation()}
                      onBlur={(event) => rename(tab.id, event.currentTarget.value)}
                      onKeyDown={(event) => {
                        event.stopPropagation()
                        if (event.key === 'Enter') rename(tab.id, event.currentTarget.value)
                        if (event.key === 'Escape') setRenaming(null)
                      }}
                    />
                  ) : (
                    <span className="mp-t">{tab.name}</span>
                  )}
                  <button
                    type="button"
                    className="mp-x"
                    aria-label={`Close ${tab.name}`}
                    title="Close (Ctrl+W)"
                    onClick={(event) => {
                      event.stopPropagation()
                      close(tab.id)
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button type="button" className="mp-add" aria-label="New tab" title="New map tab (Ctrl+T)" onClick={open}>
                +
              </button>
              <span className="gb-grow" />
              <button type="button" className="mp-reopen" disabled={!model.can_reopen} onClick={reopen}>
                Reopen closed tab
              </button>
            </div>
            <div className="mp-sheet">
              <div className="mp-bar">
                <button type="button" className="mp-ib" aria-label="Reload this tab" title="Reload this tab" onClick={() => reload(model.active)}>
                  ↻
                </button>
                <button type="button" className="mp-ib" aria-label="Copy this tab's link" title="Copy this tab's link: the map, filters and view" onClick={() => void copyLink(model.active)}>
                  ⧉
                </button>
                <button type="button" className="mp-ib" aria-label="Open this tab in your browser" title="Open this tab in your browser" onClick={() => void inBrowser(model.active)}>
                  ↗
                </button>
                <span className="mp-said" role="status">
                  {said}
                </span>
                <span className="gb-grow" />
                {chip !== null && (
                  <span className="mp-chip" data-testid="map-account">
                    {chip.text}
                  </span>
                )}
                {chip?.canLogIn && (
                  <button type="button" className="gb-btn gb-act" onClick={() => void api.post('/api/auth/login').catch(() => undefined)}>
                    Log in
                  </button>
                )}
                <button
                  type="button"
                  className="mp-ib"
                  aria-label={wide ? 'Show the rail and the title' : 'Wide: hide the rail and the title'}
                  aria-pressed={wide}
                  title={wide ? 'Show the rail and the title' : 'Wide: hide the rail and the title'}
                  onClick={() => setWide(!wide)}
                >
                  ⤢
                </button>
              </div>
              <div className="mp-area" ref={area} data-testid="map-area">
                {instead !== null && (
                  <div className="mp-card" role="status">
                    <h2>{instead.title}</h2>
                    <p>{instead.text}</p>
                    {instead.canReload && (
                      <div className="mp-row">
                        <button type="button" className="gb-btn gb-act" onClick={() => reload(model.active)}>
                          Reload
                        </button>
                        <button type="button" className="gb-btn" onClick={() => void inBrowser(model.active)}>
                          Open in your browser
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
            {menu !== null && (
              <div className="mp-menu" role="menu" style={{ left: menu.x, top: menu.y }} onPointerDown={(event) => event.stopPropagation()}>
                {(
                  [
                    ['Rename', () => setRenaming(menu.id)],
                    ['Duplicate', () => duplicate(menu.id)],
                    ['Reload', () => reload(menu.id)],
                    ['Copy link', () => void copyLink(menu.id)],
                    ['Close', () => close(menu.id)],
                    ['Reopen closed tab', model.can_reopen ? reopen : null],
                  ] as const
                ).map(([label, run]) => (
                  <button
                    key={label}
                    type="button"
                    role="menuitem"
                    disabled={run === null}
                    onClick={() => {
                      setMenu(null)
                      if (run !== null) run()
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </Frame>
  )
}
