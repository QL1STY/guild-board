import type { CSSProperties, ReactNode } from 'react'
import type { ResetMode } from '../types.ts'
import { ActBar, Difficulty, LongResult, Medallion, ShortResult, Star } from './endgameparts.tsx'
import { cycleDates, linePlaces, modeIcon, resultOf, shareLeft, timeWords, type Result } from './endgameview.ts'

/*
 * The Endgame resets widget's three drawings of the modes' resets that are not the pictures' (the polish pass, mockup 2 A, B and
 * C): Medallions, Season bars and In order. Each draws the same three modes from the same read, one way at one cell tall and one
 * way from two. A mode's colour is the role --w-mode-*, chosen by the stylesheet from `data-mode` and held in --c, a mark and
 * never the text's colour.
 */

type Props = { modes: readonly ResetMode[]; now: Date }

/** What the time says in a drawing: "18 h" and "to reset", or nothing where the read gives none. */
function Time({ mode, now, className }: { mode: ResetMode; now: Date; className: string }) {
  const time = timeWords(mode, now)
  return (
    <span className={className}>
      {time !== null && (
        <>
          <b>{time.time}</b> {time.tail}
        </>
      )}
    </span>
  )
}

// ------------------------------------------------------------------------------------------------ Medallions

/** The result of a medallion at one cell tall: a few figures beside a ring, so only the figures, with the Theater's acts as small bars. */
function MedallionValue({ result }: { result: Result }) {
  if (result.kind === 'act' && result.of !== null) {
    return (
      <span className="egm-v egm-stack num">
        Act {result.act}
        <ActBar act={result.act} of={result.of} width={52} />
      </span>
    )
  }
  return (
    <span className="egm-v num">
      <ShortResult result={result} shield={17} font={11} />
    </span>
  )
}

/** The result under a plate's time: the figure with what it is out of, as lines of their own. */
function PlateResult({ result }: { result: Result }) {
  if (result.kind === 'stars') {
    return (
      <>
        <span className="egm-fig num">
          {result.stars}
          <Star />
        </span>
        <span className="egm-cap num">of {result.of}</span>
      </>
    )
  }
  if (result.kind === 'act') {
    return (
      <>
        {result.of !== null && <ActBar act={result.act} of={result.of} width={84} />}
        <span className="egm-cap num">
          Act <b>{result.act}</b>
          {result.of !== null && ` of ${result.of}`}
        </span>
      </>
    )
  }
  if (result.kind === 'difficulty') {
    return (
      <>
        <Difficulty level={result.level} medal={result.medal} size={26} font={15} />
        <span className="egm-cap num">
          Difficulty <b>{result.level}</b>
        </span>
      </>
    )
  }
  return <span className="egm-cap egm-note">{result.note}</span>
}

export function Medallions({ modes, now, short }: Props & { short: boolean }) {
  if (short) {
    return (
      <div className="egm3" data-centre>
        {modes.map((mode) => (
          <div key={mode.mode} className="egm-c" data-mode={mode.mode}>
            <Medallion mode={mode.mode} icon={modeIcon(mode)} share={shareLeft(mode, now)} size={38} />
            <div className="egm-x">
              <div className="egm-k">{mode.short}</div>
              <MedallionValue result={resultOf(mode)} />
              <Time mode={mode} now={now} className="egm-in num" />
            </div>
          </div>
        ))}
      </div>
    )
  }
  return (
    <div className="egm-plates" data-centre>
      {modes.map((mode) => {
        const time = timeWords(mode, now)
        return (
          <div key={mode.mode} className="egm-p" data-mode={mode.mode}>
            <Medallion mode={mode.mode} icon={modeIcon(mode)} share={shareLeft(mode, now)} size={40} />
            <span className="egm-name">{mode.short}</span>
            <span className="egm-time num">
              {time !== null && (
                <>
                  {time.time}
                  <small>{time.tail}</small>
                </>
              )}
            </span>
            <span className="egm-sep" />
            <div className="egm-res">
              <PlateResult result={resultOf(mode)} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ Season bars

/** A bar that fills as the cycle goes, with a mark at now. Null share: the track alone. */
function Bar({ share }: { share: number | null }) {
  const done = share === null ? null : (1 - share) * 100
  return (
    <span className="egb-bar" aria-hidden="true">
      {done !== null && (
        <>
          <u style={{ width: `${done}%` }} />
          <i style={{ left: `${done}%` }} />
        </>
      )}
    </span>
  )
}

/** The result in as few words as a bar's name has room for: "33★", "Act 8", "Diff. 5", and nothing where there is none. */
function BarResult({ result }: { result: Result }): ReactNode {
  if (result.kind === 'stars') {
    return (
      <>
        {result.stars}
        <Star />
      </>
    )
  }
  if (result.kind === 'act') return <>Act {result.act}</>
  if (result.kind === 'difficulty') return <>Diff. {result.level}</>
  return null
}

/** The result on the flag that rides the bar's mark. */
function FlagResult({ result }: { result: Result }): ReactNode {
  if (result.kind === 'stars') {
    return (
      <>
        {result.stars}
        <Star />
      </>
    )
  }
  if (result.kind === 'act') return <>Act {result.act}</>
  if (result.kind === 'difficulty') return <>Difficulty {result.level}</>
  return <>{result.note}</>
}

export function SeasonBars({ modes, now, short }: Props & { short: boolean }) {
  if (short) {
    return (
      <div className="egb" data-centre>
        {modes.map((mode) => {
          const time = timeWords(mode, now)
          return (
            <div key={mode.mode} className="egb-r" data-mode={mode.mode}>
              <span className="egb-k">
                {mode.short}
                <span className="egb-v num">
                  <BarResult result={resultOf(mode)} />
                </span>
              </span>
              <Bar share={shareLeft(mode, now)} />
              <span className="egb-t num">{time?.time ?? ''}</span>
            </div>
          )
        })}
      </div>
    )
  }
  return (
    <div className="egb2" data-centre>
      {modes.map((mode) => {
        const time = timeWords(mode, now, true)
        const share = shareLeft(mode, now)
        const done = share === null ? 0 : (1 - share) * 100
        const dates = cycleDates(mode)
        const flag: CSSProperties = done > 70 ? { right: `${100 - done + 2}%` } : { left: `${share === null ? 0 : done + 2}%` }
        return (
          <div key={mode.mode} className="egb2-r" data-mode={mode.mode}>
            <div className="egb2-h">
              <span className="egb2-k">{mode.label}</span>
              {time !== null && (
                <span className="egb2-v num">
                  {time.lead} <b>{time.time}</b>
                </span>
              )}
            </div>
            <span className="egb-bar" aria-hidden="true">
              {share !== null && (
                <>
                  <u style={{ width: `${done}%` }} />
                  <i style={{ left: `${done}%` }} />
                </>
              )}
              <span className="egb-flag num" style={flag}>
                <FlagResult result={resultOf(mode)} />
              </span>
            </span>
            <div className="egb2-f num">
              <span>{dates?.from ?? ''}</span>
              <span>
                <b>{dates?.to ?? ''}</b>
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ In order

export function InOrder({ modes, now, short }: Props & { short: boolean }) {
  const places = linePlaces(modes, now)
  if (short) {
    return (
      <div className="egl" data-centre>
        <span className="egl-axis" />
        {places.map(({ mode, side, at }) => {
          const place: CSSProperties = side === 'l' ? { left: `${at}%` } : side === 'r' ? { right: 0 } : { left: `${at}%`, translate: '-50% 0' }
          const result = resultOf(mode)
          const time = timeWords(mode, now)
          return (
            <div key={mode.mode} className={`egl-m ${side}`} data-mode={mode.mode} style={place}>
              <span className="egl-up">
                {mode.short}{' '}
                <span className="num">
                  <BarResult result={result} />
                </span>
              </span>
              <span className="egl-d" />
              <span className="egl-dn num">
                {time !== null && (
                  <>
                    in <b>{time.time}</b>
                  </>
                )}
              </span>
            </div>
          )
        })}
      </div>
    )
  }
  return (
    <div className="egv" data-centre>
      <div className="egv-now">
        <span>Now</span>
        <span />
      </div>
      {places.map(({ mode }) => {
        const time = timeWords(mode, now)
        return (
          <div key={mode.mode} className="egv-r" data-mode={mode.mode}>
            <span className="egv-t num">{time?.time ?? ''}</span>
            <div className="egv-n">
              <b>{mode.label}</b>
              <span className="num">
                <LongResult result={resultOf(mode)} />
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

