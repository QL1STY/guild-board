import { type CSSProperties, useEffect, useRef, useState } from 'react'
import '../../styles/stats.css'
import '../../styles/year.css'
import { messageOf } from '../../api.ts'
import { num } from '../../format.ts'
import { Frame } from '../../frame/Frame.tsx'
import { type Live, useModel } from '../../live.ts'
import { hashOf } from '../../route.ts'
import type { YearAnswer, YearCard, YearCounter, YearModel } from '../../types.ts'
import { Picture } from '../../ui/Picture.tsx'
import { reducedMotion } from '../../ui/motion.tsx'
import { startDust } from './dust.ts'
import { type PosterSize, savePoster } from './poster.ts'
import { StatsTabs } from './StatsTabs.tsx'
import { YearMonths } from './YearMonths.tsx'
import { countUp, faceList, packCards, resinShare, yearOptions } from './yearview.ts'

/** The specks of dust over the night. The window draws at 60 frames a second, so the count stays modest. */
const DUST = 140
/** How long a counter takes to count up, in milliseconds. */
const COUNT_MS = 1600

/** The Year tab: the year as a poster that moves, the Wrapped (the Months and Wrapped design, section 6). */
export function Year({ live, year }: { live: Live; year: number | null }) {
  const { data, error } = useModel<YearAnswer>(year === null ? '/api/stats/year' : `/api/stats/year?year=${year}`, live.version)
  return (
    <Frame page="stats" live={live} beside={<StatsTabs view="year" />}>
      {data === null ? (
        <div className="gb-panel gb-empty">{error ?? 'Reading the year…'}</div>
      ) : data.year === null ? (
        <div className="gb-panel gb-empty">Nothing to show yet. The year fills in as Guild Board keeps data.</div>
      ) : (
        <Wrapped key={data.year.year} model={data.year} years={data.years} current={data.current_year} />
      )}
    </Frame>
  )
}

/** Whether an element has come into view. It is true at once where the browser cannot tell, or with reduced motion. */
function useEntered(): [(element: HTMLElement | null) => void, boolean] {
  const [element, setElement] = useState<HTMLElement | null>(null)
  const [entered, setEntered] = useState(() => reducedMotion() || typeof IntersectionObserver !== 'function')
  useEffect(() => {
    if (element === null || entered) return
    const watch = new IntersectionObserver(
      (seen) => {
        if (seen.some((one) => one.isIntersecting)) {
          setEntered(true)
          watch.disconnect()
        }
      },
      { threshold: 0.12 },
    )
    watch.observe(element)
    return () => watch.disconnect()
  }, [element, entered])
  return [setElement, entered]
}

function Wrapped({ model, years, current }: { model: YearModel; years: number[]; current: number }) {
  const dust = useRef<HTMLCanvasElement>(null)
  const [paused, setPaused] = useState(() => document.hidden || document.visibilityState === 'hidden')
  // The dust, and the stylesheet's animations, stop while the document is hidden and go on when it shows.
  useEffect(() => {
    const canvas = dust.current
    const stop = canvas === null ? () => {} : startDust(canvas, { count: DUST, reduced: reducedMotion() })
    const watch = (): void => setPaused(document.hidden || document.visibilityState === 'hidden')
    document.addEventListener('visibilitychange', watch)
    return () => {
      document.removeEventListener('visibilitychange', watch)
      stop()
    }
  }, [])
  const options = yearOptions(years, model.year, current)
  const cards = packCards(model.cards)
  return (
    <div className="yr-stage" data-testid="year-stage" data-paused={paused ? '' : undefined}>
      <canvas className="yr-dust" ref={dust} aria-hidden="true" data-testid="year-dust" />
      <div className="yr-sky" aria-hidden="true">
        <div className="yr-aurora" />
      </div>
      <div className="yr-col">
        {options.length > 0 && (
          <nav className="yr-switch" aria-label="Year" data-testid="year-switch">
            {options.map((one) => (
              <a
                key={one.year}
                href={hashOf({ page: 'stats', view: 'year', year: one.year })}
                className={one.on ? 'on' : undefined}
                aria-current={one.on ? 'page' : undefined}
              >
                {one.label}
              </a>
            ))}
          </nav>
        )}
        <Hero model={model} soFar={model.year === current} />
        <div className="yr-cards" data-testid="year-cards">
          {cards.map((card, at) => (
            <Card key={card.kind} card={card} span={card.span} index={at} />
          ))}
        </div>
        <SaveButtons model={model} />
      </div>
    </div>
  )
}

/** What the page says once the window has its Save dialog open; the window says where it saved, or why it could not. */
const CHOOSE_PLACE = 'Choose where to save the picture in the Guild Board window.'

/**
 * The two Save buttons (spec 6.4): each draws the poster at its full size and hands the PNG to the window's Save dialog, or, with
 * no window, to the browser as a download. One picture at a time.
 */
function SaveButtons({ model }: { model: YearModel }) {
  const [making, setMaking] = useState<PosterSize | null>(null)
  const [note, setNote] = useState('')
  const save = (size: PosterSize): void => {
    if (making !== null) return
    setMaking(size)
    setNote('')
    savePoster({ ...model.poster, year: model.year }, size)
      .then((saved) => setNote(saved === 'dialog' ? CHOOSE_PLACE : ''))
      .catch((error: unknown) => setNote(messageOf(error)))
      .finally(() => setMaking(null))
  }
  return (
    <div className="yr-save">
      {/* Not `disabled` while a picture is made: a button that is loses the keyboard's focus. */}
      <button
        type="button"
        className="yr-btn"
        aria-disabled={making !== null}
        aria-busy={making === 'story'}
        onClick={() => save('story')}
        data-testid="year-save-story"
      >
        Save as picture · Story
      </button>
      <button
        type="button"
        className="yr-btn ghost"
        aria-disabled={making !== null}
        aria-busy={making === 'wide'}
        onClick={() => save('wide')}
        data-testid="year-save-wide"
      >
        Save as picture · Wide
      </button>
      <p className="yr-note" role="status" data-testid="year-save-note">
        {note}
      </p>
    </div>
  )
}

function Hero({ model, soFar }: { model: YearModel; soFar: boolean }) {
  const { hero } = model
  return (
    <section className="yr-hero" data-testid="year-hero" aria-label={`Your ${model.year} in Teyvat`}>
      <div className="yr-intro">
        <div className="yr-kicker">Your year in Teyvat</div>
        <h2 className="yr-year">
          <span className="yr-digits">{model.year}</span>
          {soFar && <small>so far</small>}
        </h2>
        <p className="yr-lede" data-testid="year-line">
          {hero.line}
        </p>
        <div className="yr-trio">
          {hero.counters.map((counter) => (
            <Counter key={counter.label} counter={counter} />
          ))}
        </div>
      </div>
      <div
        className="yr-art"
        role={hero.character === null ? undefined : 'img'}
        aria-label={hero.character === null ? undefined : `${hero.character.name}, the character of the year`}
        data-testid="year-portrait"
      >
        <div className="yr-halo" />
        <div className="yr-ring" />
        <Picture src={hero.character?.picture ?? null} sign="person" className="yr-portrait" />
      </div>
    </section>
  )
}

/**
 * A number of the hero that counts up when it comes into view, with the stretch of the year it covers under it where that is part.
 * A read that changes its value counts on from the number shown, never from nothing again.
 */
function Counter({ counter }: { counter: YearCounter }) {
  const [place, entered] = useEntered()
  const [shown, setShown] = useState(() => (reducedMotion() ? counter.value : 0))
  const showing = useRef(shown) // the number on screen, where a new count begins
  useEffect(() => {
    if (!entered) return
    const show = (value: number): void => {
      showing.current = value
      setShown(value)
    }
    if (reducedMotion()) {
      show(counter.value)
      return
    }
    let frame = 0
    const from = showing.current
    const begun = performance.now()
    const step = (now: number): void => {
      const t = (now - begun) / COUNT_MS
      show(countUp(counter.value, t, from))
      if (t < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [entered, counter.value])
  return (
    <div ref={place} className="yr-counter" data-testid="year-counter">
      <b aria-hidden="true">{num(shown)}</b>
      <span className="sr-only">{num(counter.value)} </span>
      {counter.label}
      {counter.since !== null && <em>{counter.since}</em>}
    </div>
  )
}

function Card({ card, span, index }: { card: YearCard; span: number; index: number }) {
  const [place, entered] = useEntered()
  const share = card.kind === 'resin' ? resinShare(card.numbers) : null
  const { shown, more } = faceList(card.faces)
  const style = { '--yr-delay': `${Math.min(index, 8) * 0.1}s` } as CSSProperties
  return (
    <article
      ref={place}
      className={`yr-card${entered ? ' in' : ''}`}
      data-kind={card.kind}
      data-span={span}
      style={style}
      data-testid="year-card"
    >
      <div className="yr-why">{card.heading}</div>
      <div className="yr-main">
        <div className="yr-big">{card.big}</div>
        {card.line !== '' && <p className="yr-say">{card.line}</p>}
      </div>
      {card.kind === 'biggest_month' && <YearMonths numbers={card.numbers} />}
      {share !== null && (
        <div className="yr-bar" role="img" aria-label={`${share}% of it went into Condensed Resin`}>
          <i style={{ width: `${share}%` }} />
        </div>
      )}
      {shown.length > 0 && (
        <div className="yr-faces">
          {shown.map((face, at) => (
            <Picture key={`${face}-${at}`} src={face} sign="star" className="yr-face" lazy />
          ))}
          {more > 0 && <span className="yr-more">+{more}</span>}
        </div>
      )}
    </article>
  )
}
