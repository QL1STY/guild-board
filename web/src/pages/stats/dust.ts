/** One speck: where it is (0 to 1 across and up the canvas), its size, its speed up, its twinkle phase and its colour. */
type Speck = { x: number; y: number; r: number; speed: number; phase: number; gold: boolean }

/**
 * The least time between two frames drawn, in milliseconds: about 60 a second. The window draws at the monitor's rate, so a fast
 * screen asks for every frame it shows; the dust draws no more often than this. A millisecond
 * under 1000 / 60, so that a 60 Hz screen's frames, which come a little early or late, are each drawn.
 */
export const DUST_FRAME_MS = 1000 / 60 - 1

/**
 * Gold dust drifting up on a canvas, for the Year tab (the Months and Wrapped design, section 6.1). `count` specks twinkle and
 * rise, at about 60 frames a second at most (DUST_FRAME_MS); with `reduced` (reduce motion) they are drawn once and stay. The
 * canvas takes the size of its parent and is kept to it. The dust stops when the document is hidden and goes on when it shows
 * again, and `canvas.dataset.running` says which ("true" or "false"). The returned function stops it for good: it removes the
 * listeners and empties the canvas to no pixels, so that the window lets go of its memory at once (a browser can keep what a page
 * lets go of for a long while), as the poster's canvas is.
 */
export function startDust(canvas: HTMLCanvasElement, opts: { count: number; reduced: boolean }): () => void {
  const context = canvas.getContext('2d')
  const specks: Speck[] = Array.from({ length: Math.max(0, Math.round(opts.count)) }, () => ({
    x: Math.random(),
    y: Math.random(),
    r: Math.random() * 1.8 + 0.3,
    speed: Math.random() * 0.00025 + 0.00005,
    phase: Math.random() * Math.PI * 2,
    gold: Math.random() < 0.45,
  }))
  // The canvas has a pixel for each pixel of the screen, so that the specks are as crisp at the window's zoom as anywhere; what is
  // drawn is measured in CSS pixels (`width` and `height`).
  let ratio = 1
  let width = 1
  let height = 1
  let frame = 0
  let last = 0
  let stopped = false

  const hidden = (): boolean => document.hidden || document.visibilityState === 'hidden'
  const size = (): void => {
    const box = canvas.parentElement
    if (box === null) return
    ratio = Math.min(2, window.devicePixelRatio || 1)
    width = Math.max(1, Math.round(box.clientWidth))
    height = Math.max(1, Math.round(box.clientHeight))
    if (canvas.width !== Math.round(width * ratio)) canvas.width = Math.round(width * ratio)
    if (canvas.height !== Math.round(height * ratio)) canvas.height = Math.round(height * ratio)
  }
  const draw = (): void => {
    if (context === null) return
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.clearRect(0, 0, width, height)
    for (const speck of specks) {
      const alpha = 0.35 + 0.35 * Math.sin(speck.phase)
      context.beginPath()
      context.arc(speck.x * width + Math.sin(speck.phase * 0.5) * 6, speck.y * height, speck.r, 0, Math.PI * 2)
      context.fillStyle = speck.gold ? `rgba(246,226,174,${alpha})` : `rgba(220,210,255,${alpha * 0.8})`
      context.fill()
    }
  }
  const step = (now: number): void => {
    frame = 0
    if (stopped || hidden()) return
    if (last !== 0 && now - last < DUST_FRAME_MS) {
      frame = requestAnimationFrame(step) // too soon after the frame last drawn: nothing moves or is drawn
      return
    }
    // Time, not frames, moves the dust, so that it drifts at one speed whatever the screen's rate; a long pause counts as little.
    const passed = last === 0 ? 1 : Math.min(3, (now - last) / (1000 / 60))
    last = now
    for (const speck of specks) {
      speck.y -= speck.speed * passed
      speck.phase += 0.03 * passed
      if (speck.y < -0.02) {
        speck.y = 1.02
        speck.x = Math.random()
      }
    }
    draw()
    frame = requestAnimationFrame(step)
  }
  const run = (): void => {
    if (stopped || frame !== 0) return
    last = 0
    canvas.dataset.running = 'true'
    frame = requestAnimationFrame(step)
  }
  const halt = (): void => {
    if (frame !== 0) cancelAnimationFrame(frame)
    frame = 0
    canvas.dataset.running = 'false'
  }
  const watch = (): void => {
    if (opts.reduced) return
    if (hidden()) halt()
    else run()
  }
  const resize = (): void => {
    size()
    draw() // a resize clears the canvas: it is drawn again at once, so that a still canvas is not left blank
  }

  size()
  draw()
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null
  if (observer !== null && canvas.parentElement !== null) observer.observe(canvas.parentElement)
  else window.addEventListener('resize', resize)
  document.addEventListener('visibilitychange', watch)
  canvas.dataset.running = 'false'
  if (!opts.reduced && !hidden()) run()

  return () => {
    stopped = true
    halt()
    observer?.disconnect()
    window.removeEventListener('resize', resize)
    document.removeEventListener('visibilitychange', watch)
    canvas.width = 0
    canvas.height = 0
  }
}
