/**
 * The site's browser demo: the real interface with no core behind it. Its answers are files recorded from the demo core by
 * tools/record-site-demo.py (one JSON file for each route the pages read, named by `recordingKey`), served beside the page. What the
 * page sends (POST, PUT, DELETE) is sent nowhere: it is refused with a sentence. The pictures of the art cache are read by the
 * visitor's browser from HoYoverse's own addresses, which the demo's list (pictures.json) holds; where a host refuses, the page
 * shows its drawn sign, as for any picture that is missing.
 *
 * This file is imported only when the build is the site's (`VITE_SITE_DEMO=1`, main.tsx): the installed app's bundle has none of
 * it, nor any recorded data, nor an address of HoYoverse's, and its interface still loads nothing from the internet.
 */
import { ApiError, setTransport, type Transport } from './api.ts'
import { mapArtAddresses } from './ui/artsize.ts'
import pictures from '../../src/guildboard/characters/demo/pictures.json'

export const RECORDING_REFUSAL = 'This is a recording, so nothing here changes. Install Guild Board to use it.'
export const GONE_FROM_RECORDING = 'This part of Guild Board is not in the recording. Install Guild Board to use it.'

/** The demo's pictures: the key of each, as `/api/art/<key>` has it, and the official address it was read from. */
export const PICTURES: Record<string, { url: string }> = pictures

/**
 * The name of the file a route is recorded in: its words, and a 32-bit FNV-1a hash of the whole route, so that two routes never
 * share a file. tools/record-site-demo.py makes the same name (`recording_key`); both tests hold the same examples.
 */
export function recordingKey(route: string): string {
  let hash = 0x811c9dc5
  for (const byte of new TextEncoder().encode(route)) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0
  const words = route
    .replace(/^\/api\//, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return `${words}-${hash.toString(16).padStart(8, '0')}`
}

/** The pictures of the icon cache: the key of each (`/api/icon/<key>`), and the official address it was read from (icons.json). */
type Icons = Record<string, { url: string }>

/** Those of the recording, read when the demo starts. */
let icons: Icons = {}

/**
 * The official address of a picture of the art cache or of the icon cache (the primogem, a banner's art, a timer's picture), or
 * the address itself where the list holds no such picture. The art cache's list is `pictures.json`; the icon cache's is the
 * recording's `icons.json`, which the demo core's labels made (tools/record-site-demo.py).
 */
export function officialArt(address: string, known: Icons = icons): string {
  const art = /^\/api\/art\/([^/?#]+)/.exec(address)
  if (art !== null) return Object.prototype.hasOwnProperty.call(PICTURES, art[1]) ? PICTURES[art[1]].url : address
  const icon = /^\/api\/icon\/([^?#]+)/.exec(address)
  if (icon === null) return address
  return Object.prototype.hasOwnProperty.call(known, icon[1]) ? known[icon[1]].url : address
}

/** Reads one recorded file by its name, or null where there is none. */
async function readNamed(name: string): Promise<unknown> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}recording/${name}.json`)
    return response.ok ? await response.json() : null
  } catch {
    return null
  }
}

/** Reads one recorded file, or null where there is none. */
function readFile(key: string): Promise<unknown> {
  return readNamed(key)
}

/**
 * The transport of the recording. `read` gives a file by its key (null: none), and `clock` the time here in milliseconds; both are
 * the page's own in the site and a test's in a test. The status says the time of the recording carried forward by the time since the
 * page opened, so the clock on screen runs on from the recorded moment instead of going back to it at each read.
 */
export function recordedTransport(
  read: (key: string) => Promise<unknown> = readFile,
  clock: () => number = () => performance.now(),
): Transport {
  const opened = clock()
  const files = new Map<string, Promise<unknown>>()
  return async (method, path) => {
    if (method !== 'GET') throw new ApiError(409, RECORDING_REFUSAL)
    const key = recordingKey(path)
    let file = files.get(key)
    if (file === undefined) {
      file = read(key)
      files.set(key, file)
    }
    const answer = await file
    if (answer === null || answer === undefined) throw new ApiError(404, GONE_FROM_RECORDING)
    if (path === '/api/status' && typeof answer === 'object' && 'now' in answer && typeof answer.now === 'string') {
      return { ...answer, now: new Date(Date.parse(answer.now) + (clock() - opened)).toISOString() }
    }
    return answer
  }
}

/** The thin bar at the top of the demo: what the page is, and the way back to the site. */
export const BAR_SENTENCE = 'This is a recording on a made-up account.'
export const BAR_LINK = 'Back to the site'
export const SITE_ADDRESS = '/guild-board/'

/** The bar's look. It is drawn in the page, outside the interface, so that nothing of the interface's styles reaches it; the frame
 *  is made that much shorter, so that the page is not taller than the screen by the bar. */
const BAR_STYLE = `
#site-bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 2px 14px; box-sizing: border-box;
  padding: 6px 16px; background: #2a2f3d; color: #ece5d8; font: 500 13px/1.3 'Alegreya Sans', 'Segoe UI', system-ui, sans-serif;
  text-align: center; }
#site-bar a { color: #d3bc8e; font-weight: 700; text-decoration: underline; padding: 2px 4px; }
.gb { min-height: calc(100vh - var(--site-bar, 0px)); }
.gb-rail { height: calc(100vh - var(--site-bar, 0px)); }
`

/**
 * Puts the bar above the interface. On a phone the page is 1,280 wide and shown zoomed out, so the bar's letters are made as large
 * as they are to be read at the screen's own size (the zoom of the visitor's view is read from visualViewport); where the page is
 * shown at its own size they stay at 13 pixels.
 */
export function showBar(into: Document = document): void {
  const style = into.createElement('style')
  style.textContent = BAR_STYLE
  into.head.append(style)
  const bar = into.createElement('div')
  bar.id = 'site-bar'
  bar.setAttribute('role', 'note')
  const sentence = into.createElement('span')
  sentence.textContent = BAR_SENTENCE
  const link = into.createElement('a')
  link.href = SITE_ADDRESS
  link.textContent = BAR_LINK
  bar.append(sentence, link)
  into.body.prepend(bar)
  const view = into.defaultView?.visualViewport ?? null
  const fit = () => {
    const zoom = view === null || !(view.scale > 0) ? 1 : view.scale
    bar.style.fontSize = `${Math.max(13, Math.min(60, 13 / zoom))}px`
    into.documentElement.style.setProperty('--site-bar', `${bar.offsetHeight}px`)
  }
  fit()
  view?.addEventListener('resize', fit)
}

/**
 * Takes over the page's calls and its pictures; main.tsx waits for it before anything is drawn, so that the icons are known by the
 * first picture. Without an icons file the demo still starts and its icons show their signs.
 */
export async function startSiteDemo(): Promise<void> {
  setTransport(recordedTransport())
  icons = {}
  mapArtAddresses((address) => officialArt(address))
  if (typeof document !== 'undefined') showBar()
  const read = await readNamed('icons')
  if (read !== null && typeof read === 'object') icons = read as Icons
}
