import { useState } from 'react'
import { cropStyle } from '../charts/endgamecard.ts'
import type { ResetMode } from '../types.ts'
import { sizedArt } from '../ui/artsize.ts'
import { Picture } from '../ui/Picture.tsx'
import { Sign, type SignName } from '../ui/Sign.tsx'
import type { Result } from './endgameview.ts'

/*
 * The small parts the Endgame resets widget's four drawings share: the mode's sign, the star, the Stygian's shield, the
 * medallion's ring, the Theater's act bar and medal, and the mode's picture. Every colour is a widget role, and a mode's is
 * --c, set from `data-mode` by the stylesheet.
 */

/** The sign that stands for each mode, as the Stats card's header has it where the wiki's icon is not there. */
export const MODE_SIGN: Record<ResetMode['mode'], SignName> = { abyss: 'moon', theater: 'cards', stygian: 'boss' }

/**
 * A mode's mark: its Tutorial entry's icon as the Stats card draws it (the art cache's, `icon`), with the drawn sign under it,
 * which shows where the icon cannot load; the sign alone where the core has no icon yet (nothing is kept, or the demo).
 */
export function ModeSign({ mode, icon }: { mode: ResetMode['mode']; icon: string | null }) {
  return icon === null ? <Sign name={MODE_SIGN[mode]} /> : <Picture src={icon} sign={MODE_SIGN[mode]} className="egx-mi" />
}

/** The pictures are asked for at this size of the art cache's: a tile is small, but the Stygian's crop enlarges its picture to twice the place. */
const PICTURE_SIZE = 1024
const MEDAL_SIZE = 128

export function Star() {
  return (
    <span className="egx-star" aria-hidden="true">
      ★
    </span>
  )
}

/** The Stygian's difficulty on a shield. */
export function Shield({ level, size, font }: { level: number; size: number; font: number }) {
  return (
    <span className="egx-shield" style={{ width: size, height: Math.round(size * 1.12) }} aria-hidden="true">
      <svg viewBox="0 0 20 22">
        <path d="M10 1.2l7.6 2.6v6.4c0 5-3.4 8.6-7.6 10.4C5.8 18.8 2.4 15.2 2.4 10.2V3.8z" />
      </svg>
      <b style={{ fontSize: font }}>{level}</b>
    </span>
  )
}

/**
 * The Stygian's difficulty as HoYoLAB draws it, its official medal (the Stats card's picture, through the art cache), at the size of
 * the shield it replaces; the shield with the number where the core gives no medal, and where the medal does not load.
 */
export function Difficulty({ level, medal, size, font }: { level: number; medal: string | null; size: number; font: number }) {
  const [failed, setFailed] = useState<string | null>(null)
  if (medal === null || failed === medal) return <Shield level={level} size={size} font={font} />
  const side = Math.round(size * 1.12)
  return (
    <span className="egx-mk egx-dm" style={{ width: side, height: side }} aria-hidden="true">
      <img src={sizedArt(medal, MEDAL_SIZE) ?? medal} alt="" draggable={false} onError={() => setFailed(medal)} />
    </span>
  )
}

/** A ring that holds the share of the cycle still to come, round the mode's sign. A null share draws the track alone. */
export function Medallion({ mode, icon, share, size }: { mode: ResetMode['mode']; icon: string | null; share: number | null; size: number }) {
  return (
    <span className="egx-med" style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 40 40">
        <circle className="egx-tr" cx="20" cy="20" r="18" />
        {share !== null && (
          <circle
            className="egx-arc"
            cx="20"
            cy="20"
            r="18"
            pathLength="100"
            strokeDasharray={`${Math.max(share * 100, 1.5).toFixed(1)} 100`}
            transform="rotate(-90 20 20)"
          />
        )}
        <circle className="egx-in" cx="20" cy="20" r="13.5" />
      </svg>
      <span className="egx-sign" data-icon={icon === null ? undefined : ''}>
        <ModeSign mode={mode} icon={icon} />
      </span>
    </span>
  )
}

/** One small cell for each act of the season, those reached lit. */
export function ActBar({ act, of, width }: { act: number; of: number; width: number }) {
  return (
    <span className="egx-acts" style={{ width }} aria-hidden="true">
      {Array.from({ length: of }, (_, at) => (
        <u key={at} className={at < act ? 'on' : undefined} />
      ))}
    </span>
  )
}

/** HoYoLAB's medal of the Theater, once the art cache keeps it; until then, or if it fails to load, a gold disc. */
export function MedalMark({ src, size }: { src: string | null; size: number }) {
  const [failed, setFailed] = useState<string | null>(null)
  const shown = src !== null && failed !== src
  return (
    <span className={shown ? 'egx-mk' : 'egx-mk fb'} style={{ width: size, height: size }} aria-hidden="true">
      {shown && <img src={sizedArt(src, MEDAL_SIZE) ?? src} alt="" draggable={false} onError={() => setFailed(src)} />}
    </span>
  )
}

/**
 * The mode's picture, cropped as the Stats card crops it, over the mode's colour gradient. The picture is a background: where
 * the art cache has none yet, or it fails to load, the gradient is all that shows, never a broken image.
 */
export function ModePicture({ header }: { header: ResetMode['header'] }) {
  const address = sizedArt(header.picture, PICTURE_SIZE)
  return (
    <span className="egx-pic" aria-hidden="true">
      {address !== null && <span className="egx-img" style={{ ...cropStyle(header.crop), backgroundImage: `url("${address}")` }} />}
    </span>
  )
}

/** The result as the shorter drawings write it: "33★ / 36", "Act 8", the shield of the difficulty, and nothing where there is none. */
export function ShortResult({ result, shield = 14, font = 9 }: { result: Result; shield?: number; font?: number }) {
  if (result.kind === 'stars') {
    return (
      <>
        {result.stars}
        <Star />
        <small>/ {result.of}</small>
      </>
    )
  }
  if (result.kind === 'act') return <>Act {result.act}</>
  if (result.kind === 'difficulty') {
    return (
      <>
        <Difficulty level={result.level} medal={result.medal} size={shield} font={font} />
        <small>diff.</small>
      </>
    )
  }
  return <>—</>
}

/** The result in a line for the widest drawings: "33 ★ of 36 stars", "Act 8 of 10", "Difficulty 5", or the note. */
export function LongResult({ result }: { result: Result }) {
  if (result.kind === 'stars') {
    return (
      <>
        {result.stars}
        <Star />
        <small>of {result.of} stars</small>
      </>
    )
  }
  if (result.kind === 'act') {
    return (
      <>
        Act {result.act}
        {result.of !== null && <small>of {result.of}</small>}
      </>
    )
  }
  if (result.kind === 'difficulty') {
    return (
      <>
        <Difficulty level={result.level} medal={result.medal} size={16} font={10} />
        Difficulty {result.level}
      </>
    )
  }
  return <small>{result.note}</small>
}
