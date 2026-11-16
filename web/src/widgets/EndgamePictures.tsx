import type { ReactNode } from 'react'
import type { ResetMode } from '../types.ts'
import { Sign } from '../ui/Sign.tsx'
import { Difficulty, LongResult, MedalMark, ModePicture, ModeSign, Star } from './endgameparts.tsx'
import { cycleDates, modeIcon, resultOf, timeWords, type Result } from './endgameview.ts'

/*
 * The Endgame resets widget's With pictures drawing (the polish pass, mockup 2 D): the Stats card's headers in small. A picture
 * tile for each mode at one cell tall, a band for each at two cells wide and two tall, a column for each at three cells wide and
 * two tall. The pictures are the card's, through the art cache (endgameparts.tsx, ModePicture), over the mode's colour; the words
 * stand on a scrim made from the widget's own background. A mode not played this cycle has its picture greyed and dimmed.
 */

export type PictureLayout = 'tiles' | 'bands' | 'columns'

type Props = { modes: readonly ResetMode[]; now: Date; layout: PictureLayout }

/** The Theater's medals beside its act: HoYoLAB's mark and the count, where the read carries the count. */
function Medals({ mode, size }: { mode: ResetMode; size: number }) {
  if (mode.medals === null) return null
  return (
    <>
      <MedalMark src={mode.medal} size={size} />
      <small>{mode.medals}</small>
    </>
  )
}

/** The value of a tile: short, since a tile is a third of two cells. */
function TileValue({ mode, result }: { mode: ResetMode; result: Result }): ReactNode {
  if (result.kind === 'none') return <span className="egp-v not">{result.note}</span>
  if (result.kind === 'stars') {
    return (
      <span className="egp-v num">
        {result.stars}
        <Star />
        <small>/ {result.of}</small>
      </span>
    )
  }
  if (result.kind === 'act') {
    return (
      <span className="egp-v num">
        Act {result.act}
        <Medals mode={mode} size={15} />
      </span>
    )
  }
  return (
    <span className="egp-v num">
      <Difficulty level={result.level} medal={result.medal} size={16} font={10} />
      <small>difficulty</small>
    </span>
  )
}

/** The line under a band's name. */
function BandLine({ mode, result }: { mode: ResetMode; result: Result }): ReactNode {
  if (result.kind === 'none') return <span className="not">{result.note}</span>
  return (
    <span className="num">
      <LongResult result={result} />
      {result.kind === 'act' && <Medals mode={mode} size={16} />}
    </span>
  )
}

/** The big result of a column, and the small line under it. */
function columnResult({ mode, result }: { mode: ResetMode; result: Result }): { big: ReactNode; caption: string } {
  if (result.kind === 'none') {
    const dates = cycleDates(mode)
    return { big: <span className="egp-big not">{result.note}</span>, caption: !result.stale && dates !== null ? `This cycle began ${dates.from}` : '' }
  }
  if (result.kind === 'stars') {
    return {
      big: (
        <span className="egp-big num">
          {result.stars}
          <Star />
        </span>
      ),
      caption: `of ${result.of} stars`,
    }
  }
  if (result.kind === 'act') {
    const parts = [result.of === null ? '' : `of ${result.of}`, mode.medals === null ? '' : `${mode.medals} ${mode.medals === 1 ? 'medal' : 'medals'}`]
    return {
      big: (
        <>
          {mode.medals !== null && <MedalMark src={mode.medal} size={24} />}
          <span className="egp-big num">Act {result.act}</span>
        </>
      ),
      caption: parts.filter((part) => part !== '').join(' · '),
    }
  }
  return {
    big: (
      <>
        <Difficulty level={result.level} medal={result.medal} size={23} font={13} />
        <span className="egp-big num">Difficulty {result.level}</span>
      </>
    ),
    caption: 'this season',
  }
}

export function WithPictures({ modes, now, layout }: Props) {
  if (layout === 'tiles') {
    return (
      <div className="egp3" data-centre>
        {modes.map((mode) => {
          const time = timeWords(mode, now)
          return (
            <div key={mode.mode} className={mode.played ? 'egp-t' : 'egp-t off'} data-mode={mode.mode}>
              <ModePicture header={mode.header} />
              {time !== null && (
                <span className="egp-pill num">
                  <Sign name="cycle" />
                  {time.time}
                </span>
              )}
              <span className="egp-k">{mode.short}</span>
              <TileValue mode={mode} result={resultOf(mode)} />
            </div>
          )
        })}
      </div>
    )
  }
  if (layout === 'bands') {
    return (
      <div className="egp-bands" data-centre>
        {modes.map((mode) => {
          const time = timeWords(mode, now, true)
          return (
            <div key={mode.mode} className={mode.played ? 'egp-b' : 'egp-b off'} data-mode={mode.mode}>
              <ModePicture header={mode.header} />
              <span className="egp-ic" data-icon={modeIcon(mode) === null ? undefined : ''}>
                <ModeSign mode={mode.mode} icon={modeIcon(mode)} />
              </span>
              <div className="egp-n">
                <b>{mode.label}</b>
                <BandLine mode={mode} result={resultOf(mode)} />
              </div>
              {time !== null && (
                <span className="egp-pill num">
                  <small>{time.lead}</small>
                  {time.time}
                </span>
              )}
            </div>
          )
        })}
      </div>
    )
  }
  return (
    <div className="egp-cols" data-centre>
      {modes.map((mode) => {
        const time = timeWords(mode, now, true)
        const { big, caption } = columnResult({ mode, result: resultOf(mode) })
        return (
          <div key={mode.mode} className={mode.played ? 'egp-c' : 'egp-c off'} data-mode={mode.mode}>
            <div className="egp-h">
              <ModePicture header={mode.header} />
              <span className="egp-ic" data-icon={modeIcon(mode) === null ? undefined : ''}>
                <ModeSign mode={mode.mode} icon={modeIcon(mode)} />
              </span>
              <b>{mode.label}</b>
            </div>
            <div className="egp-body">
              <div className="egp-r">{big}</div>
              <span className="egp-cap">{caption}</span>
              <span className="egp-foot num">
                {time !== null && (
                  <>
                    <b>{time.time}</b> {time.tail}
                  </>
                )}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
