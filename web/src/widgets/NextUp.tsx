import { useCallback, useEffect, useRef, type ReactElement } from 'react'
import '../styles/widget-nextup.css'
import '../styles/widget-primogems.css' // the switches of Settings are its rows
import { useModel, useTick } from '../live.ts'
import type { NextUpModel, Widget } from '../types.ts'
import { Picture } from '../ui/Picture.tsx'
import { Sign } from '../ui/Sign.tsx'
import { Switch } from '../ui/Switch.tsx'
import {
  NEXT_UP_DEFAULTS, NEXT_UP_STYLES, NEXT_UP_SWITCHES, nextUpGroups, nextUpMeta, nextUpSettings, strandedHeadings,
  type NextUpGroups, type NextUpRow, type NextUpSettings, type NextUpStyle,
} from './nextupview.ts'
import { useHead, type WidgetContext, type WidgetType } from './widget.ts'

/*
 * Next up (the widgets and Friends design, 2.1; the widgets polish, 2026-11-15): one timeline of what is ready and what happens
 * next, put together in the core (`/api/next-up`), grouped here by the local day of the core's clock. It reads again at each core
 * event and counts the time left on each minute, never each second. It is drawn in one of three styles, chosen in its settings:
 * a rail with a sign for each kind, gauges that fill as each thing comes, or cards by day. They share the rows (nextupview.ts).
 */

const MINUTE_MS = 60_000
const EMPTY = 'Nothing is coming up.'
/** The chips of the rail's top: this many, and the rest as "+N". */
const CHIPS = 4

/**
 * Hides the day heading whose first row is cut by the list's bottom edge (`strandedHeadings`), so that a heading is never the
 * last line with its rows under the fold. It is set on the elements, on each scroll, each resize of the list and each draw.
 */
function useNoStrandedHeading(): (list: HTMLUListElement | null) => (() => void) | undefined {
  const list = useRef<HTMLUListElement | null>(null)
  const apply = useCallback(() => {
    const element = list.current
    if (element === null) return
    const base = element.getBoundingClientRect().top - element.scrollTop
    const lines = [...element.children].map((line) => {
      const box = line.getBoundingClientRect()
      return { heading: line.classList.contains('nu-g') && box.height > 0, top: box.top - base, bottom: box.bottom - base }
    })
    const hide = new Set(strandedHeadings(lines, element.scrollTop, element.scrollTop + element.clientHeight))
    ;[...element.children].forEach((line, index) => {
      if (hide.has(index)) line.setAttribute('data-stranded', '')
      else line.removeAttribute('data-stranded')
    })
  }, [])
  useEffect(apply)
  return useCallback(
    (element: HTMLUListElement | null) => {
      list.current = element
      if (element === null) return undefined
      apply()
      element.addEventListener('scroll', apply, { passive: true })
      const observer = new ResizeObserver(apply)
      observer.observe(element)
      return () => {
        element.removeEventListener('scroll', apply)
        observer.disconnect()
      }
    },
    [apply],
  )
}

/** What each row of a style carries for the stylesheet: its kind and, for an endgame row, its mode, which set its colour. */
const marks = (row: NextUpRow) => ({ 'data-kind': row.kind, 'data-mode': row.mode ?? undefined })

/**
 * A row's sign: for an endgame row, its mode's icon as the Stats card draws it (the Tutorial entry's, kept by the art cache),
 * with the mode's drawn sign under it, which shows where the icon cannot load (the cache has not got it, the demo's);
 * for any other row, its drawn sign.
 */
function RowSign({ row }: { row: NextUpRow }) {
  return row.icon === null ? <Sign name={row.sign} /> : <Picture src={row.icon} sign={row.sign} className="nu-mi" />
}

/** The time left with its "in" set small ("in" 1 h 59 min), or what is said in its place ("Ready", "now"). */
function TimeLeft({ row }: { row: NextUpRow }) {
  return row.left.startsWith('in ') ? (
    <>
      <small>in</small> {row.time}
    </>
  ) : (
    <>{row.left}</>
  )
}

/** The rows that are not ready, in their day groups, and the ready ones apart. */
function split(groups: NextUpGroups): { ready: NextUpRow[]; rest: NextUpGroups } {
  const now = groups.find((group) => group.heading === 'Now')
  return { ready: now?.rows ?? [], rest: groups.filter((group) => group.heading !== 'Now') }
}

/** A: what is ready as chips on top, the rest hanging off a rail, each on a round node with its sign, with the days marked. */
function Rail({ groups, listRef }: { groups: NextUpGroups; listRef: (list: HTMLUListElement | null) => (() => void) | undefined }) {
  const { ready, rest } = split(groups)
  const chips = ready.slice(0, CHIPS)
  const more = ready.length - chips.length
  return (
    <div className="nu" data-style="rail">
      {ready.length > 0 && (
        <div className="nu-chips" data-centre={rest.length === 0 || undefined}>
          {chips.map((row) => (
            <span key={row.key} className="nu-chip" {...marks(row)} title={row.name}>
              <span className="nu-chip-i">
                <RowSign row={row} />
              </span>
              <span className="nu-chip-n">{row.name}</span>
            </span>
          ))}
          {more > 0 && <span className="nu-chip nu-chip-more">+{more}</span>}
        </div>
      )}
      {rest.length > 0 && (
        <ul className="nu-list nu-rail w-scroll" data-centre ref={listRef}>
          {rest.flatMap((group) => [
            <li key={group.heading} className="nu-g">
              <span className="nu-dia" />
              {group.heading}
            </li>,
            ...group.rows.map((row) => (
              <li key={row.key} className="nu-r" {...marks(row)}>
                <span className="nu-node">
                  <RowSign row={row} />
                </span>
                <span className="nu-n">
                  <b title={row.name}>{row.name}</b>
                  {row.right !== null && (
                    <small className="nu-sub">
                      {row.right} · {row.kindLabel}
                    </small>
                  )}
                </span>
                <span className="nu-t">
                  <TimeLeft row={row} />
                </span>
              </li>
            )),
          ])}
        </ul>
      )}
    </div>
  )
}

/** One tile's ring: the track and the arc of how far along it is, or for a ready thing a filled disc with a tick. */
function Ring({ row }: { row: NextUpRow }) {
  return (
    <span className="nu-ring">
      <svg viewBox="0 0 40 40" aria-hidden="true">
        {row.ready ? (
          <circle className="nu-full" cx="20" cy="20" r="18.5" />
        ) : (
          <>
            <circle className="nu-track" cx="20" cy="20" r="17" />
            {row.progress !== null && row.progress > 0 && (
              <circle
                className="nu-arc"
                cx="20"
                cy="20"
                r="17"
                pathLength="100"
                strokeDasharray={`${(row.progress * 100).toFixed(1)} 100`}
                transform="rotate(-90 20 20)"
              />
            )}
          </>
        )}
      </svg>
      <span className="nu-ic">
        {row.ready ? <Sign name="tick" /> : <RowSign row={row} />}
      </span>
    </span>
  )
}

/** B: a tile for each thing, with a ring that fills as it comes; a ready thing is a filled green disc with a tick. */
function Gauges({ groups }: { groups: NextUpGroups }) {
  const rows = groups.flatMap((group) => group.rows)
  return (
    <div className="nu" data-style="gauges">
      <ul className="nu-list nu-grid w-scroll" data-centre>
        {rows.map((row) => (
          <li key={row.key} className="nu-tile" {...marks(row)} data-ready={row.ready || undefined} title={row.name}>
            <Ring row={row} />
            <span className="nu-bt">{row.time}</span>
            <span className="nu-bn">{row.name}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** C: everything ready in one green card, then each day's things as small cards with their kind's colour down the left edge. */
function Cards({ groups, listRef }: { groups: NextUpGroups; listRef: (list: HTMLUListElement | null) => (() => void) | undefined }) {
  const { ready, rest } = split(groups)
  return (
    <div className="nu" data-style="cards">
      <ul className="nu-list nu-cards w-scroll" data-centre ref={listRef}>
        {ready.length > 0 && [
          <li key="Now" className="nu-g nu-g-now">
            Now <u>{ready.length}</u>
          </li>,
          <li key="now-box" className="nu-now">
            <ul className="nu-now-lines">
              {ready.map((row) => (
                <li key={row.key} {...marks(row)}>
                  <RowSign row={row} />
                  <b title={row.name}>{row.name}</b>
                  <em>Ready</em>
                </li>
              ))}
            </ul>
            <div className="nu-now-one">
              <span className="nu-ics">
                {ready.map((row) => (
                  <span key={row.key} {...marks(row)}>
                    <RowSign row={row} />
                  </span>
                ))}
              </span>
              <b>{ready.map((row) => row.name).join(' · ')}</b>
              <em>Ready</em>
            </div>
          </li>,
        ]}
        {rest.flatMap((group) => [
          <li key={group.heading} className="nu-g">
            {group.heading} <u>{group.rows.length}</u>
          </li>,
          ...group.rows.map((row) => (
            <li key={row.key} className="nu-card" {...marks(row)}>
              <RowSign row={row} />
              <b title={row.name}>{row.name}</b>
              <span className="nu-at">{row.right}</span>
              <span className="nu-ct">{row.time}</span>
            </li>
          )),
        ])}
      </ul>
    </div>
  )
}

function NextUpView({ widget, ctx }: { widget: Widget; ctx: WidgetContext }) {
  useTick(MINUTE_MS)
  const now = ctx.live.now()
  const settings = nextUpSettings(widget.settings)
  const { data, error } = useModel<NextUpModel>('/api/next-up', ctx.version)
  const listRef = useNoStrandedHeading()
  useHead({ meta: data === null ? null : nextUpMeta(data, settings) })
  if (data === null) return <p className="wid-line" data-centre>{error ?? 'Reading what is next…'}</p>
  const groups = nextUpGroups(data, settings, now)
  if (groups.length === 0) return <p className="wid-line" data-centre>{EMPTY}</p>
  if (settings.style === 'gauges') return <Gauges groups={groups} />
  if (settings.style === 'cards') return <Cards groups={groups} listRef={listRef} />
  return <Rail groups={groups} listRef={listRef} />
}

/** A picture of each style in the picker: the shape of what it draws, in the colour around it. */
const GLYPHS: Record<NextUpStyle, ReactElement> = {
  rail: <path d="M6.5 2.5v15M12 6h6M12 14h6M6.5 5.6a1.8 1.8 0 1 0 .01 0M6.5 13.6a1.8 1.8 0 1 0 .01 0" />,
  gauges: <path d="M6 3a3 3 0 1 0 .01 0M14 3a3 3 0 1 0 .01 0M6 11a3 3 0 1 0 .01 0M14 11a3 3 0 1 0 .01 0" />,
  cards: <path d="M4 3.2h12a1.5 1.5 0 0 1 1.5 1.5v2.1a1.5 1.5 0 0 1-1.5 1.5H4a1.5 1.5 0 0 1-1.5-1.5V4.7A1.5 1.5 0 0 1 4 3.2zM4 11.2h12a1.5 1.5 0 0 1 1.5 1.5v2.1a1.5 1.5 0 0 1-1.5 1.5H4a1.5 1.5 0 0 1-1.5-1.5v-2.1A1.5 1.5 0 0 1 4 11.2z" />,
}

/** The style to draw it in, then one switch for each kind of thing the timeline can list, all on at first. */
function NextUpSettingsForm({
  widget, change,
}: { widget: Widget; ctx: WidgetContext; change: (settings: Record<string, unknown>) => void }) {
  const settings = nextUpSettings(widget.settings)
  return (
    <>
      <fieldset className="pm-set">
        <legend>Style</legend>
        <div className="nu-picks" role="radiogroup" aria-label="Style">
          {NEXT_UP_STYLES.map(({ style, name, about }) => (
            <button
              key={style}
              type="button"
              role="radio"
              aria-checked={settings.style === style}
              className="nu-pick"
              onClick={() => change({ ...widget.settings, ...settings, style })}
            >
              <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {GLYPHS[style]}
              </svg>
              <span>
                {name}
                <small>{about}</small>
              </span>
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="pm-set">
        <legend>Next up lists</legend>
        {NEXT_UP_SWITCHES.map(({ kind, name, about }) => (
          <div key={kind} className="pm-set-row">
            <span>
              {name}
              <small>{about}</small>
            </span>
            <Switch
              on={settings[kind]}
              label={name}
              className="pm-switch"
              onPress={() => change({ ...widget.settings, ...settings, [kind]: !settings[kind] })}
            />
          </div>
        ))}
      </fieldset>
    </>
  )
}

export const NEXT_UP: WidgetType = {
  id: 'next-up',
  name: 'Next up',
  about: 'What is ready, and what happens next, soonest first.',
  sign: 'next',
  min: { w: 2, h: 2 },
  max: { w: 3, h: 6 },
  start: { w: 2, h: 3 },
  settings: { ...NEXT_UP_DEFAULTS } satisfies NextUpSettings,
  View: NextUpView,
  Settings: NextUpSettingsForm,
}
