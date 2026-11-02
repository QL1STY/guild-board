import { type CSSProperties, useLayoutEffect, useRef, useState } from 'react'
import { artSize, askedSize, knownAspect, learnAspect, sizedArt } from './artsize.ts'
import { usePictureQuality } from './pictureQuality.ts'
import { Sign, type SignName } from './Sign.tsx'

/**
 * One of the game's pictures over its drawn sign, in one box. `src` is the picture's address in the core's icon cache
 * (`/api/icon/...`), or null or empty where there is none. The image hides itself when it cannot be loaded, as the
 * demo's cannot (the demo downloads nothing), and then the sign shows in its place: a hidden image draws nothing, never
 * the browser's broken-image mark. An empty address is none: React leaves an empty `src` out, so no load fails, and the
 * sign must show all the same. The image cannot be dragged, since a draggable image takes the pointer events of a drag
 * that starts on it (the Board's, in Edit). `className` names the box, which has no size of its own: the place gives
 * its class one (signs.css says how the image and the sign are laid out in it).
 *
 * A picture of the art cache (`/api/art/...`) is asked for at the size its box has on the screen (artsize.ts): the image has no
 * address until the box is measured, just before the first paint. One shown as cover (`object-fit: cover`) runs past its box,
 * so it is asked for at the size that covers the box, which takes its proportions: those are learned from the picture when it
 * first loads (a picture of a size that fell short is asked for again, larger) and remembered for the run (artsize.ts). A large
 * one is then asked for as the picture quality in Settings says: the original, or a copy of at most 1,536 or 1,024 pixels. The image is decoded off the page's main work, and with
 * `lazy` it is not loaded or decoded until it nears the screen: a roster of a hundred faces holds those in view.
 */
export function Picture({
  src,
  sign,
  className,
  style,
  lazy = false,
}: {
  src: string | null
  sign: SignName
  className?: string
  style?: CSSProperties
  /** Not loaded or decoded until it is near the screen. */
  lazy?: boolean
}) {
  // The address that failed, so that a new address is tried afresh.
  const [failed, setFailed] = useState<string | null>(null)
  const box = useRef<HTMLSpanElement>(null)
  const art = src !== null && src.startsWith('/api/art/')
  const [size, setSize] = useState<number | null>(null)
  const [, learned] = useState(0)
  const aspect = art ? knownAspect(src) : null
  useLayoutEffect(() => {
    const place = box.current
    if (!art || place === null) return
    const image = place.querySelector('img')
    const cover = image !== null && getComputedStyle(image).objectFit === 'cover'
    setSize(artSize(place.getBoundingClientRect(), window.devicePixelRatio || 1, cover ? aspect : null))
  }, [art, aspect])
  // A picture that goes with its page lets go of its image: the window then has nothing to keep decoded for it.
  useLayoutEffect(() => {
    const place = box.current
    return () => place?.querySelector('img')?.removeAttribute('src')
  }, [])
  const quality = usePictureQuality()
  const address = art && size === null ? null : sizedArt(src, art ? askedSize(size ?? 0, quality) : 0)
  return (
    <span ref={box} className={className === undefined ? 'pic' : `pic ${className}`} style={style}>
      <img
        src={address || undefined}
        alt=""
        draggable={false}
        decoding="async"
        loading={lazy ? 'lazy' : undefined}
        hidden={!src || failed === src}
        onError={() => setFailed(src)}
        onLoad={(event) => {
          if (art && learnAspect(src, event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)) learned((count) => count + 1)
        }}
      />
      <Sign name={sign} />
    </span>
  )
}
