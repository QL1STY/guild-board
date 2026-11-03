import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from 'react'
import './profile.css'
import { api, messageOf } from '../../api.ts'
import { Frame } from '../../frame/Frame.tsx'
import { type Live, useModel } from '../../live.ts'
import { hashOf } from '../../route.ts'
import type { Profile as ProfileModel } from '../../types.ts'
import { clipReveal, reducedMotion, rise, SPRING_EASE } from '../../ui/motion.tsx'
import { sizedArt } from '../../ui/artsize.ts'
import { Picture } from '../../ui/Picture.tsx'
import { Sign } from '../../ui/Sign.tsx'
import { BuildStrip, type OpenKey } from './BuildStrip.tsx'
import { elementClass } from './elements.ts'
import { ElementChip } from './ElementChip.tsx'
import { Pane } from './ProfilePanes.tsx'
import { CardPanel } from './CardPanel.tsx'
import { scaleStyle, useCharactersScale } from './scale.ts'
import { agree, cardLine, CHART_STAGE, chartBox, chartPlaces, edgeOf, litLines, PANES, type PaneKey, paneSign, pictureLight, pityPill, stepKey } from './profileview.ts'
import { rosterOrderFor, useRoster, useRosterMemory } from './memory.ts'
import { ReadinessRing } from './ReadinessRing.tsx'
import { weekShown } from './hidden.ts'
import { neighbours, toggleFocus } from './rosterview.ts'
import { SyncLine } from './SyncLine.tsx'
import { PageSwitch, Trail } from './Trail.tsx'
import { Tip, useTip } from './Tip.tsx'

/**
 * A constellation's picture on its star, clipped to the star's circle. Like `Picture`, it goes when it cannot be loaded,
 * as the demo's cannot, so that the star keeps its number and never shows the browser's broken-image mark.
 */
function StarPicture({ src, owned, clip }: { src: string; owned: boolean; clip: string }) {
  // The address that failed, so that a new address is tried afresh.
  const [failed, setFailed] = useState<string | null>(null)
  if (failed === src) return null
  return <image href={sizedArt(src, 128) ?? undefined} x={-36} y={-36} width={72} height={72} opacity={owned ? 1 : 0.35} clipPath={`url(#${clip})`} onError={() => setFailed(src)} />
}

/** Her chart of six stars on her own picture of them, which light as she owns them (the design's section 6.2). */
function Chart({ profile, hot, setHot, tipOf }: {
  profile: ProfileModel
  hot: number | null
  setHot: (index: number | null) => void
  tipOf: ReturnType<typeof useTip>['tipOf']
}) {
  const stars = chartPlaces(profile.stars, profile.chart_size)
  const owned = profile.constellations.filter((c) => c.owned).length
  return (
    <div className="pf-cwrap">
      <Picture src={profile.chart} sign="stars" className="pf-chart" style={chartBox(profile.chart_size)} />
      <svg viewBox={`0 0 ${CHART_STAGE} ${CHART_STAGE}`} role="group" aria-label={`${profile.name}'s constellation`}>
        {litLines(stars, owned).map((line, i) => (
          <line key={i} className="pf-cline" pathLength={1} x1={line.from[0]} y1={line.from[1]} x2={line.to[0]} y2={line.to[1]} />
        ))}
        {stars.map(([x, y], i) => {
          const c = profile.constellations[i]
          if (c === undefined) return null
          const tip = tipOf(
            <>
              <b>
                C{c.n}. {c.name}
              </b>
              {c.text}
            </>,
          )
          return (
            <g key={c.n} transform={`translate(${x} ${y})`}>
              <g
                className={`pf-cstar pf-pop${c.owned ? ' lit' : ''}${hot === i ? ' hot' : ''}`}
                style={{ '--i': i } as CSSProperties}
                {...tip}
                aria-label={`C${c.n}. ${c.name}, ${c.owned ? 'yours' : 'not yet'}`}
                onMouseEnter={() => setHot(i)}
                onMouseLeave={() => {
                  setHot(null)
                  tip.onMouseLeave()
                }}
                onFocus={(event) => {
                  setHot(i)
                  tip.onFocus(event)
                }}
                onBlur={() => {
                  setHot(null)
                  tip.onBlur()
                }}
              >
                <circle className="pf-ring" r={46} />
                <clipPath id={`pf-cc-${profile.key}-${i}`}>
                  <circle r={38} />
                </clipPath>
                <text>C{c.n}</text>
                {c.icon !== null && <StarPicture src={c.icon} owned={c.owned} clip={`pf-cc-${profile.key}-${i}`} />}
              </g>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/** Her readiness, below the card, on parchment: a ring and its parts, and what to do next. */
function Sheet({ profile, onCard }: { profile: ProfileModel; onCard?: () => void }) {
  const her = profile.pronouns.hers
  return (
    <section className={profile.owned ? 'pf-sheet' : 'pf-sheet solo'} aria-label={`How ready ${agree(profile.pronouns, 'is', 'are')}`} data-testid="readiness">
      {profile.owned && (
        <div className="pf-ready">
          <ReadinessRing value={profile.readiness.total} size="150px" caption={`of ${her} full potential`} count />
          <div className="pf-parts">
            {profile.readiness.parts.map((part) => (
              <div key={part.key} className="pf-part">
                <span>{part.label}</span>
                <span className="pf-pb" aria-hidden="true">
                  <i style={{ width: `${Math.round(part.value * 100)}%` }} />
                </span>
                <b>{part.text}</b>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="pf-steps">
        <div className="pf-steps-head">
          <h3>What to do next</h3>
          {onCard !== undefined && (
            <button type="button" className="gb-btn quiet" onClick={onCard}>
              {her.charAt(0).toUpperCase() + her.slice(1)} card
            </button>
          )}
        </div>
        {profile.next_steps.length > 0 ? (
          <ol>
            {profile.next_steps.map((step) => (
              <li key={step.text}>
                <span>{step.text}</span>
                <span className="pf-gain">{step.gain}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="pf-cardline">Nothing to do next.</p>
        )}
        <p className="pf-cardline">{cardLine(profile.card, profile.pronouns)}</p>
      </div>
    </section>
  )
}

/** How long the chart stays after the Constellation page is left: the time its fade takes (profile.css) and a little over. */
const CHART_LINGERS_MS = 500

/** The brightness of each art picture measured in this window, by address. */
const artLights = new Map<string, number>()

/** How dark the edges around this art are: its smallest copy is read once into a few pixels, and let go. */
function useArtEdge(src: string | null): number {
  const [edge, setEdge] = useState(0)
  useEffect(() => {
    if (src === null || src === '') {
      setEdge(0)
      return
    }
    const known = artLights.get(src)
    if (known !== undefined) {
      setEdge(edgeOf(known))
      return
    }
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = 32
      canvas.height = 16
      const drawn = canvas.getContext('2d', { willReadFrequently: true })
      if (drawn === null) return
      drawn.drawImage(image, 0, 0, 32, 16)
      let light: number
      try {
        light = pictureLight(drawn.getImageData(0, 0, 32, 16).data)
      } catch {
        return // a picture from another site (the browser demo's) cannot be read back: its edge stays as it is
      }
      artLights.set(src, light)
      setEdge(edgeOf(light))
    }
    image.src = sizedArt(src, 128) ?? src
    return () => {
      image.onload = null
      image.src = ''
    }
  }, [src])
  return edge
}

/** The profile as the model has it (the design's section 6.2): the dark card with its six pages, her build, and her readiness. */
export function ProfileView({
  profile,
  focus,
  onFocus,
  refusal,
  onCard,
  focusShown = true,
}: {
  profile: ProfileModel
  /** The characters in the player's focus, or null until they are read. */
  focus: readonly string[] | null
  onFocus: (key: string) => void
  refusal: string | null
  /** Opens the Card panel; the readiness sheet's button for it is there while a page gives this. */
  onCard?: () => void
  /** The focus goes with Your week (hidden.ts): while that is hidden the card has no button for it. */
  focusShown?: boolean
}) {
  const scale = useCharactersScale()
  const [pane, setPane] = useState<PaneKey>('attr')
  const [openKey, setOpenKey] = useState<OpenKey | null>(null)
  const [hot, setHot] = useState<number | null>(null)
  const { tip, tipOf, hide } = useTip()
  const page = useRef<HTMLDivElement>(null)
  const firstPane = useRef(true)
  const edge = useArtEdge(profile.art)
  const pity = pityPill(profile.pity)
  const inFocus = focus?.includes(profile.key) ?? false

  // The profile comes in once: her art slides in with a spring, her name is uncovered from the left, what she is rises
  // line by line, and then her build. When the card moves on to the character beside her (the arrows), the page stays, and
  // only her art and her figures change, with a short cross-fade.
  const shown = useRef<string | null>(null)
  useLayoutEffect(() => {
    const root = page.current
    const moved = shown.current !== null && shown.current !== profile.key
    shown.current = profile.key
    hide() // a tip of the character before
    setOpenKey(null)
    setHot(null)
    if (root === null || reducedMotion()) return
    if (moved) {
      const parts = root.querySelectorAll<HTMLElement>('.pf-art, .pf-giant, .pf-who, .pf-panel, .pf-strip, .pf-sheet')
      for (const part of parts) part.animate([{ opacity: 0 }], { duration: 220, easing: 'ease-out' }) // up to the part's own opacity (the dimmed art)
      return
    }
    root.querySelector('.pf-art')?.animate(
      [
        { opacity: 0, translate: '50px 0' },
        { opacity: 1, translate: '0 0' },
      ],
      { duration: 1100, easing: SPRING_EASE, fill: 'backwards' },
    )
    const giant = root.querySelector<HTMLElement>('.pf-giant')
    if (giant !== null) clipReveal(giant, { delay: 0.2, duration: 1.4 })
    rise(root.querySelectorAll<HTMLElement>('.pf-who > *, .pf-actions'), { step: 0.08, start: 0.25, duration: 0.5, lift: 16 })
    rise(root.querySelectorAll<HTMLElement>('.pf-strip > *'), { step: 0.06, start: 0.6, duration: 0.5, lift: 16 })
  }, [profile.key])

  // A page of the sidebar comes in with its blocks one after another.
  useLayoutEffect(() => {
    if (firstPane.current) {
      firstPane.current = false
      return
    }
    const element = page.current?.querySelector<HTMLElement>('.pf-pane')
    if (element === null || element === undefined) return
    rise(element.children as HTMLCollectionOf<HTMLElement>, { step: 0.04, duration: 0.35, lift: 10 })
    const moving = element.getAnimations({ subtree: true })
    if (moving.length === 0) return
    element.classList.add('settling')
    void Promise.allSettled(moving.map((one) => one.finished)).then(() => element.classList.remove('settling'))
  }, [pane])

  // Her chart and its six pictures are there while the Constellation page is open, and a moment after, for it to fade out.
  const [chartOn, setChartOn] = useState(pane === 'cons')
  useEffect(() => {
    if (pane === 'cons') {
      setChartOn(true)
      return undefined
    }
    const later = window.setTimeout(() => setChartOn(false), CHART_LINGERS_MS)
    return () => window.clearTimeout(later)
  }, [pane])

  const open = (key: OpenKey) => setOpenKey((now) => (now === key ? null : key))
  const openFromList = (key: string) => {
    setOpenKey(key as OpenKey)
    document.getElementById('pf-unfold')?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'nearest' })
  }
  const hasBuild = profile.weapon !== null || profile.pieces.length > 0

  return (
    <div className="gb-page pf-page" ref={page} style={scaleStyle(scale)}>
      <article className={`pf-card ${elementClass(profile.element)}${pane === 'cons' ? ' cons-mode' : ''}`} data-pane={pane}>
        <div className="pf-hero">
          <div className="pf-giant" aria-hidden="true">
            {profile.name}
          </div>
          <nav className="pf-nav" aria-label={`${profile.name}'s pages`}>
            {PANES.map((one) => (
              <button key={one.key} type="button" aria-current={one.key === pane ? 'page' : undefined} onClick={() => setPane(one.key)}>
                <Sign name={paneSign(one.key, profile.weapon_type)} />
                {one.label}
              </button>
            ))}
          </nav>
          <div className="pf-stage" style={{ '--edge': edge } as CSSProperties}>
            <Picture src={profile.art} sign="bust" className="pf-art" />
            {(profile.stars !== null || profile.constellations.length > 0) && chartOn && (
              <div className="pf-cstage" aria-hidden={pane !== 'cons'}>
                <Chart profile={profile} hot={hot} setHot={setHot} tipOf={tipOf} />
              </div>
            )}
            <div className="pf-who">
              <h2 className="pf-name">{profile.name}</h2>
              <div className="pf-title">{profile.title}</div>
              <div className="pf-facts">
                <ElementChip element={profile.element} dark />
                <span>{profile.weapon_type}</span>
                {profile.owned && profile.level !== null && (
                  <span>
                    Level <b>{profile.level}</b>
                  </span>
                )}
                {profile.owned && (
                  <span>
                    <b>C{profile.constellation ?? 0}</b>
                  </span>
                )}
              </div>
              {!profile.owned && <span className="pf-notyours">Not yours yet</span>}
              {pity !== null && (
                <button type="button" className="pf-pity" onClick={() => setPane('story')}>
                  <span>{pity.label}</span>
                  {pity.numbers.map((n, i) => (
                    <b key={i}>{n}</b>
                  ))}
                </button>
              )}
            </div>
            <div className="pf-actions">
              {refusal !== null && (
                <p className="pf-refusal" role="status">
                  {refusal}
                </p>
              )}
              {focusShown && (
                <button type="button" className="pf-btn" aria-pressed={inFocus} disabled={focus === null} onClick={() => onFocus(profile.key)}>
                  {profile.owned ? (inFocus ? 'In focus' : 'Add to focus') : inFocus ? 'Pre-farming' : 'Pre-farm'}
                </button>
              )}
            </div>
          </div>
          <aside className="pf-panel" aria-label={`${profile.name}, ${PANES.find((one) => one.key === pane)?.label ?? ''}`}>
            <Pane key={pane} pane={pane} profile={profile} tipOf={tipOf} hot={hot} setHot={setHot} onOpenPiece={openFromList} />
          </aside>
        </div>
        {hasBuild && <BuildStrip profile={profile} openKey={openKey} onOpen={open} />}
      </article>
      <Sheet profile={profile} onCard={onCard} />
      <Tip tip={tip} />
    </div>
  )
}

/** A character's profile page: the model, and the focus it can change. */
export function Profile({ live, characterKey }: { live: Live; characterKey: string }) {
  const [changed, setChanged] = useState(0)
  const { data, error } = useModel<ProfileModel>(`/api/characters/${characterKey}`, live.version + changed)
  const roster = useRoster(live.version + changed, live.status)
  const memory = useRosterMemory()
  const [refusal, setRefusal] = useState<string | null>(null)
  const [cardOpen, setCardOpen] = useState(false)

  // The character beside her in the roster as the player left it: its search, its filters and its sort. The ← and → keys stop at
  // the ends. The card (and its page of the sidebar) stays when they move on; only the character changes.
  const { previous, next } = neighbours(rosterOrderFor(memory, characterKey), characterKey)
  // Her face and element for the trail, from the roster as the player left it, while her own model is on its way.
  const known = memory.data?.entries.find((entry) => entry.key === (data?.key ?? characterKey)) ?? null
  const target = useRef({ previous, next, cardOpen })
  target.current = { previous, next, cardOpen }
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const step = stepKey(event, event.target instanceof Element ? (event.target as HTMLElement) : null)
      if (step === null || target.current.cardOpen) return
      const key = step < 0 ? target.current.previous : target.current.next
      event.preventDefault()
      if (key !== null) window.location.hash = hashOf({ page: 'characters', view: 'profile', key })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => setRefusal(null), [characterKey])

  const toggle = async (key: string) => {
    if (roster.data === null) return
    const next = toggleFocus(roster.data.focus, key)
    if ('refused' in next) {
      setRefusal(next.refused)
      return
    }
    setRefusal(null)
    try {
      await api.put('/api/focus', { characters: next.focus })
    } catch (failure) {
      setRefusal(messageOf(failure))
    }
    setChanged((count) => count + 1)
  }

  // The trail names the character on the page: her model, else the roster as the player left it while hers is on its way.
  const name = data?.name ?? known?.name ?? 'Character'
  const shown = data !== null ? { key: data.key, icon: known?.icon ?? null, element: data.element } : known
  // The model of the character before stays on the page until the one asked for has come.
  const unknown = error !== null && (data === null || data.key !== characterKey)
  return (
    <Frame
      page="characters"
      live={live}
      heading={<Trail here={name} character={shown} />}
      beside={shown !== null && <PageSwitch here={name} characterKey={shown.key} view="profile" />}
      controls={data !== null && <SyncLine live={live} sync={data.sync} />}
    >
      {data === null || unknown ? (
        <div className="gb-panel gb-empty">
          {error ?? 'Reading the character…'}
          {error !== null && (
            <>
              {' '}
              <a href={hashOf({ page: 'characters', view: 'roster' })}>Back to the characters</a>
            </>
          )}
        </div>
      ) : (
        <ProfileView
          profile={data}
          focus={roster.data === null ? null : roster.data.focus}
          onFocus={(key) => void toggle(key)}
          refusal={refusal}
          onCard={() => setCardOpen(true)}
          focusShown={weekShown(live.status)}
        />
      )}
      {cardOpen && <CardPanel live={live} characterKey={characterKey} onClose={() => setCardOpen(false)} />}
    </Frame>
  )
}
