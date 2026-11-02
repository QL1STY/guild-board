import type { ReactElement } from 'react'

/**
 * The drawn signs (spec 7.2 of the look pass): the widget types, the fallbacks for the game's pictures, the tools and
 * the rail's pages. Each one stands in for a picture of the game's where there is none, so a name says what it shows.
 */
export type SignName =
  | 'hourglass'
  | 'pin'
  | 'star'
  | 'cup'
  | 'moon'
  | 'compass'
  | 'book'
  | 'cycle'
  | 'play'
  | 'bolt'
  | 'stopwatch'
  | 'clock'
  | 'quill'
  | 'banner'
  | 'ring'
  | 'wish'
  | 'cards'
  | 'dice'
  | 'gem'
  | 'teapot'
  | 'transformer'
  | 'boss'
  | 'fish'
  | 'mask'
  | 'person'
  | 'map'
  | 'chest'
  | 'oculus'
  | 'waypoint'
  | 'scroll'
  | 'cells'
  | 'bars'
  | 'gear'
  | 'cross'
  | 'tick'
  | 'chevron'
  | 'grip'
  | 'sync'
  | 'warn'
  | 'bust'
  | 'sword'
  | 'claymore'
  | 'polearm'
  | 'bow'
  | 'catalyst'
  | 'flower'
  | 'stars'
  | 'crown'
  | 'people'

/**
 * What each sign draws, on a 20 by 20 square with its lines about 2 units inside the edge. The drawings have no colour,
 * no width and no fill of their own: Sign gives them its lines. The look pass mockup's symbols are the reference for
 * those it has; the others are drawn in their style.
 */
const DRAWINGS: Record<SignName, ReactElement> = {
  // Timers, One timer, a timer of the player's own.
  hourglass: (
    <path d="M5.5 2.5h9M5.5 17.5h9M6.5 2.5c0 3.6 7 4.2 7 7.5s-7 3.9-7 7.5M13.5 2.5c0 3.6-7 4.2-7 7.5s7 3.9 7 7.5" />
  ),
  // Pinned achievements.
  pin: <path d="M7.5 2.8h5M8.6 2.8v4.8L6 10.4h8l-2.6-2.8V2.8M10 10.4v6.8" />,
  // Commissions to look for and the commission itself (the game's mark is the four-point star), Pulls.
  star: <path d="M10 2.2c.7 4.1 3.7 7.1 7.8 7.8-4.1.7-7.1 3.7-7.8 7.8-.7-4.1-3.7-7.1-7.8-7.8 4.1-.7 7.1-3.7 7.8-7.8z" />,
  // Achievement progress, Achievements.
  cup: (
    <path d="M6.3 3h7.4v4.3a3.7 3.7 0 0 1-7.4 0zM6.3 4.6H4.2a2.4 2.4 0 0 0 2.4 3.4M13.7 4.6h2.1a2.4 2.4 0 0 1-2.4 3.4M10 11v2.6M7.4 17h5.2M8.2 13.6h3.6V17H8.2z" />
  ),
  // Resin: a crescent.
  moon: (
    <>
      <path d="M12.6 2.8a7.4 7.4 0 1 0 4.6 10 6 6 0 0 1-4.6-10z" />
      <path d="M14.5 4.8l1.6-1.6" />
    </>
  ),
  // Expeditions, a region.
  compass: (
    <>
      <circle cx="10" cy="10" r="7.5" />
      <path d="M12.9 7.1l-1.8 4-4 1.8 1.8-4z" />
    </>
  ),
  // Daily notes.
  book: (
    <>
      <path d="M4 3.5h9a1.8 1.8 0 0 1 1.8 1.8v11.2H5.9A1.9 1.9 0 0 1 4 14.6z" />
      <path d="M4 14.6a1.9 1.9 0 0 1 1.9-1.9h8.9M7.5 6.5h4M7.5 9h2.8" />
    </>
  ),
  // Resets: two arrows in a circle.
  cycle: (
    <path d="M3.8 7.7A6.6 6.6 0 0 1 16 7.2M16.7 4.5 16 7.2l-2.6-1.2M16.2 12.3A6.6 6.6 0 0 1 4 12.8M3.3 15.5 4 12.8l2.6 1.2" />
  ),
  // Playtime: a play mark in a circle.
  play: (
    <>
      <circle cx="10" cy="10" r="7.5" />
      <path d="M8.4 6.9 13.6 10 8.4 13.1z" />
    </>
  ),
  // Quick timer.
  bolt: <path d="M11.4 2.2 5.2 11.2h4.4l-1 6.6 6.2-9h-4.4z" />,
  // Stopwatch.
  stopwatch: (
    <>
      <circle cx="10" cy="11" r="6.3" />
      <path d="M8 2.6h4M10 2.6v2.1M15.1 5.9l1.1-1.1M10 11l2.4-2.4" />
    </>
  ),
  // Clock.
  clock: (
    <>
      <circle cx="10" cy="10" r="7.5" />
      <path d="M10 5.6V10l3 1.9" />
    </>
  ),
  // Notes.
  quill: <path d="M16.8 3.2C10.9 3.7 7.3 7.4 6.2 13l-1.6 3.8M6.2 13c3.6-.4 6.6-2.9 7.6-6.4M9.6 10.3H6.9" />,
  // Wishing now, and a banner's art where there is none: a banner hung from its rod, with a diamond on it.
  banner: (
    <>
      <path d="M3.6 3.2h12.8M5.6 3.2v13.6l4.4-2.9 4.4 2.9V3.2" />
      <path d="M10 6.4l2 2.1-2 2.1-2-2.1z" />
    </>
  ),
  // Pity: a ring two thirds filled, with the mark of soft pity ahead of it.
  ring: <path d="M10 3a7 7 0 1 1-6.06 10.5M5.3 7.3 2.6 5.7" />,
  // Wishlist: a wishing star, falling.
  wish: (
    <path d="M12.6 2.7c.4 2.5 2.2 4.3 4.7 4.7-2.5.4-4.3 2.2-4.7 4.7-.4-2.5-2.2-4.3-4.7-4.7 2.5-.4 4.3-2.2 4.7-4.7zM8.8 11.2 3.4 16.6M6.4 9.6 3.6 12.4M11.2 13.6 8.4 16.4" />
  ),
  // Last pulls: two cards, one before the other.
  cards: (
    <>
      <path d="M8.4 5.4h6.6a1.4 1.4 0 0 1 1.4 1.4v9.2a1.4 1.4 0 0 1-1.4 1.4H8.4A1.4 1.4 0 0 1 7 16V6.8a1.4 1.4 0 0 1 1.4-1.4z" />
      <path d="M5.2 14.6h-.4a1.4 1.4 0 0 1-1.4-1.4V4a1.4 1.4 0 0 1 1.4-1.4h7.4A1.4 1.4 0 0 1 13.6 4v.6" />
    </>
  ),
  // Luck: a die showing five.
  dice: (
    <>
      <path d="M5.6 3.2h8.8a2.4 2.4 0 0 1 2.4 2.4v8.8a2.4 2.4 0 0 1-2.4 2.4H5.6a2.4 2.4 0 0 1-2.4-2.4V5.6a2.4 2.4 0 0 1 2.4-2.4z" />
      <path d="M7 6.9v.1M13 6.9v.1M10 9.9v.1M7 12.9v.1M13 12.9v.1" />
    </>
  ),
  // Primogem: a four-point gem.
  gem: (
    <path d="M10 2.2c.8 4.3 3.4 6.9 7.8 7.8-4.4.9-7 3.5-7.8 7.8-.8-4.3-3.4-6.9-7.8-7.8 4.4-.9 7-3.5 7.8-7.8zM10 6v8M6 10h8" />
  ),
  // Realm currency, a teapot field.
  teapot: (
    <path d="M4.5 9h9.5v2.6a4.8 4.8 0 0 1-9.5 0zM14 10.2h1.4a1.8 1.8 0 0 1 0 3.6H13.5M4.5 10.2 2.5 8M7.3 9a2.5 2.5 0 0 1 4 0M9.3 6.2v.4" />
  ),
  // Parametric Transformer: a ring with a diamond.
  transformer: (
    <>
      <circle cx="10" cy="10" r="7.2" />
      <circle cx="10" cy="10" r="3.8" />
      <path d="M10 8.2l1.8 1.8-1.8 1.8-1.8-1.8z" />
    </>
  ),
  // Weekly boss: a diamond in a diamond.
  boss: (
    <>
      <path d="M10 2.2L17.8 10 10 17.8 2.2 10z" />
      <path d="M10 7.2L12.8 10 10 12.8 7.2 10z" />
    </>
  ),
  // A fishing spot.
  fish: <path d="M2.8 10c2.6-3.6 7.6-4.6 11.2 0-3.6 4.6-8.6 3.6-11.2 0zM14 10l3.4-2.6v5.2zM6.6 9.3v.1" />,
  // The Unusual Hilichurl.
  mask: <path d="M4 5.5h12v4.2a6 6 0 0 1-12 0zM7 9.6h1.6M11.4 9.6H13M8.2 13h3.6" />,
  // An expedition's character: head and shoulders.
  person: (
    <>
      <circle cx="10" cy="7.3" r="3.3" />
      <path d="M4 17c.8-3.4 3.2-5 6-5s5.2 1.6 6 5" />
    </>
  ),
  // Backlog: a folded map.
  map: <path d="M3 5.4l4.5-1.8 5 1.8 4.5-1.8v11l-4.5 1.8-5-1.8L3 16.4zM7.5 3.6v11M12.5 5.4v11" />,
  // Chests, in the Backlog and on Stats: an arched lid, the box and its latch.
  chest: (
    <>
      <path d="M3.2 9.3V8.2A4.6 4.6 0 0 1 7.8 3.6h4.4a4.6 4.6 0 0 1 4.6 4.6v1.1" />
      <path d="M3.2 9.3h13.6v6.3a1.6 1.6 0 0 1-1.6 1.6H4.8a1.6 1.6 0 0 1-1.6-1.6z" />
      <path d="M8.5 9.3v2.1a1.5 1.5 0 0 0 3 0V9.3" />
    </>
  ),
  // Oculi: an eye.
  oculus: (
    <>
      <path d="M2.4 10c1.9-3.5 4.4-5.3 7.6-5.3s5.7 1.8 7.6 5.3c-1.9 3.5-4.4 5.3-7.6 5.3S4.3 13.5 2.4 10z" />
      <circle cx="10" cy="10" r="2.5" />
    </>
  ),
  // Waypoints: a marker with a diamond in it.
  waypoint: (
    <>
      <path d="M10 17.7c-3.3-3.5-5.4-6.3-5.4-8.8a5.4 5.4 0 0 1 10.8 0c0 2.5-2.1 5.3-5.4 8.8z" />
      <path d="M10 6.5l2.2 2.4-2.2 2.4-2.2-2.4z" />
    </>
  ),
  // Archon Quests: a scroll rolled at both ends, with two lines of writing.
  scroll: (
    <>
      <path d="M5.4 3h9.2a1.3 1.3 0 0 1 0 2.6H5.4a1.3 1.3 0 0 1 0-2.6z" />
      <path d="M6.2 5.6v8.8M13.8 5.6v8.8" />
      <path d="M5.4 14.4h9.2a1.3 1.3 0 0 1 0 2.6H5.4a1.3 1.3 0 0 1 0-2.6z" />
      <path d="M8.4 8.4h3.2M8.4 11h3.2" />
    </>
  ),
  // Board: four cells.
  cells: (
    <path d="M4.4 3.2h3.2a1.2 1.2 0 0 1 1.2 1.2v3.2a1.2 1.2 0 0 1-1.2 1.2H4.4a1.2 1.2 0 0 1-1.2-1.2V4.4a1.2 1.2 0 0 1 1.2-1.2zM12.4 3.2h3.2a1.2 1.2 0 0 1 1.2 1.2v3.2a1.2 1.2 0 0 1-1.2 1.2h-3.2a1.2 1.2 0 0 1-1.2-1.2V4.4a1.2 1.2 0 0 1 1.2-1.2zM4.4 11.2h3.2a1.2 1.2 0 0 1 1.2 1.2v3.2a1.2 1.2 0 0 1-1.2 1.2H4.4a1.2 1.2 0 0 1-1.2-1.2v-3.2a1.2 1.2 0 0 1 1.2-1.2zM12.4 11.2h3.2a1.2 1.2 0 0 1 1.2 1.2v3.2a1.2 1.2 0 0 1-1.2 1.2h-3.2a1.2 1.2 0 0 1-1.2-1.2v-3.2a1.2 1.2 0 0 1 1.2-1.2z" />
  ),
  // Stats: three bars, each with a rounded data end.
  bars: (
    <path d="M3.2 16.8v-5.4a.9.9 0 0 1 .9-.9h1.8a.9.9 0 0 1 .9.9v5.4zM8.2 16.8V7.4a.9.9 0 0 1 .9-.9h1.8a.9.9 0 0 1 .9.9v9.4zM13.2 16.8V4.1a.9.9 0 0 1 .9-.9h1.8a.9.9 0 0 1 .9.9v12.7z" />
  ),
  // Settings.
  gear: (
    <>
      <path d="M8.6 2.5h2.8l.4 2.1 1.6.9 2-.8 1.4 2.4-1.6 1.4v1.8l1.6 1.4-1.4 2.4-2-.8-1.6.9-.4 2.1H8.6l-.4-2.1-1.6-.9-2 .8-1.4-2.4 1.6-1.4V9.1L3.2 7.7l1.4-2.4 2 .8 1.6-.9z" />
      <circle cx="10" cy="10" r="2.4" />
    </>
  ),
  // Remove.
  cross: <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" />,
  // A tick.
  tick: <path d="M4.6 10.4l3.6 3.6 7.2-7.8" />,
  // A chevron, pointing down.
  chevron: <path d="M5.5 8l4.5 4.5L14.5 8" />,
  // The resize grip: three stripes across the bottom-right corner.
  grip: <path d="M17 6.2 6.2 17M17 10.4 10.4 17M17 14.6 14.6 17" />,
  // The Sync button: two arrows chasing each other round a circle.
  sync: <path d="M15.6 8A6 6 0 0 0 4.7 6.6M4.4 12a6 6 0 0 0 10.9 1.4M15.8 3.6V8h-4.3M4.2 16.4V12h4.3" />,
  // A warning: a triangle with a stroke and a point in it, for the note of a refusal and the plate's amber states.
  warn: <path d="M10 3.5l7 12.5H3zM10 8.5v3.5M10 14.4v.1" />,
  // The Characters plan, Task U1. These are the profile mockup's sidebar signs (a bust with a spark, the claymore, the five
  // petals, the stars joined by a line, the crown), drawn on 20 by 20 where the mockup drew on 32, and the other four
  // weapons in the claymore's style: a faint fill (`f`, signs.css) for the body and a solid dot (`fs`) for a point.
  // Characters, in the rail: a bust with a spark.
  bust: (
    <>
      <circle className="f" cx="9.38" cy="6.88" r="3.25" />
      <path className="f" d="M3.44 17.19c.75-3.5 3.13-5.5 5.94-5.5s5.19 2 5.94 5.5z" />
      <path className="fs" d="M15.94 2.19Q15.94 4.38 18.13 4.38Q15.94 4.38 15.94 6.56Q15.94 4.38 13.75 4.38Q15.94 4.38 15.94 2.19z" />
    </>
  ),
  // A sword: a slim blade, a guard, a handle and a pommel.
  sword: (
    <>
      <path className="f" d="M6.6 12.6 14.6 4.6 16.8 3.2 15.4 5.8 8 13.8z" />
      <path d="M3.9 11.4 8.6 16.1M6.3 13.7 4.2 15.8" />
      <circle className="fs" cx="3.5" cy="16.5" r=".75" />
    </>
  ),
  // A claymore: a broad blade with its fuller, a guard, a handle and a pommel.
  claymore: (
    <>
      <path className="f" d="M5.81 12.06 13.94 4.31 16.75 3.25 15.69 6.06 7.94 14.19z" />
      <path strokeWidth=".9" d="M7.44 12.56 14.63 5.38" />
      <path d="M3.81 11.31 8.69 16.19M6.25 13.75 4.13 15.88" />
      <circle className="fs" cx="3.5" cy="11" r=".69" />
      <circle className="fs" cx="9" cy="16.5" r=".69" />
      <circle className="fs" cx="3.44" cy="16.56" r="1" />
    </>
  ),
  // A polearm: a long shaft with a spearhead.
  polearm: (
    <>
      <path d="M3.6 16.4 13.6 6.4" />
      <path className="f" d="M12.2 4.8 17.4 2.6 15.2 7.8z" />
      <path d="M10.8 9.2 12 10.4" />
      <circle className="fs" cx="3.3" cy="16.7" r=".85" />
    </>
  ),
  // A bow: its limb, its string and an arrow laid across it.
  bow: (
    <>
      <path className="f" d="M14.4 2.8C6.6 5.2 6.6 14.8 14.4 17.2z" />
      <path d="M14.4 2.8v14.4M4.2 10h13M15.2 7.9l2.2 2.1-2.2 2.1" />
    </>
  ),
  // A catalyst: an orb with a four-point spark in it, on its stand.
  catalyst: (
    <>
      <circle className="f" cx="10" cy="8.6" r="5.6" />
      <path className="fs" d="M10 5.4 10.8 7.8 13.2 8.6 10.8 9.4 10 11.8 9.2 9.4 6.8 8.6 9.2 7.8z" />
      <path d="M6.6 17h6.8M8.2 14.6 7.4 17M11.8 14.6l.8 2.4" />
    </>
  ),
  // Artifacts, in the profile: a flower of five petals.
  flower: (
    <>
      <g className="f">
        <path d="M10 10C7.88 7.88 8.13 4.75 10 2.88 11.88 4.75 12.13 7.88 10 10z" />
        <path d="M10 10C7.88 7.88 8.13 4.75 10 2.88 11.88 4.75 12.13 7.88 10 10z" transform="rotate(72 10 10)" />
        <path d="M10 10C7.88 7.88 8.13 4.75 10 2.88 11.88 4.75 12.13 7.88 10 10z" transform="rotate(144 10 10)" />
        <path d="M10 10C7.88 7.88 8.13 4.75 10 2.88 11.88 4.75 12.13 7.88 10 10z" transform="rotate(216 10 10)" />
        <path d="M10 10C7.88 7.88 8.13 4.75 10 2.88 11.88 4.75 12.13 7.88 10 10z" transform="rotate(288 10 10)" />
      </g>
      <circle className="fs" cx="10" cy="10" r="1.5" />
    </>
  ),
  // Constellation, in the profile: four stars joined by a line.
  stars: (
    <>
      <path strokeOpacity=".75" strokeWidth=".9" d="M4.06 15 7.81 8.44 13.13 10.31 15.94 4.06" />
      <path className="fs" d="M4.06 12.81Q4.06 15 6.25 15Q4.06 15 4.06 17.19Q4.06 15 1.88 15Q4.06 15 4.06 12.81z" />
      <path className="fs" d="M7.81 5.31Q7.81 8.44 10.94 8.44Q7.81 8.44 7.81 11.56Q7.81 8.44 4.69 8.44Q7.81 8.44 7.81 5.31z" />
      <path className="fs" d="M13.13 8.44Q13.13 10.31 15 10.31Q13.13 10.31 13.13 12.19Q13.13 10.31 11.25 10.31Q13.13 10.31 13.13 8.44z" />
      <path className="fs" d="M15.94 1.56Q15.94 4.06 18.44 4.06Q15.94 4.06 15.94 6.56Q15.94 4.06 13.44 4.06Q15.94 4.06 15.94 1.56z" />
    </>
  ),
  // Talents, in the profile: a crown with a gem.
  crown: (
    <>
      <path className="f" d="M3.13 14.69 4.13 6.56 7.63 10.13 10 4.69 12.38 10.13 15.88 6.56 16.88 14.69z" />
      <path d="M3.13 16.88h13.75" />
      <circle className="fs" cx="10" cy="3.5" r=".88" />
      <circle className="fs" cx="4" cy="5.38" r=".75" />
      <circle className="fs" cx="16" cy="5.38" r=".75" />
      <path className="fs" d="M10 10.63 11.13 12.25 10 13.88 8.88 12.25z" />
    </>
  ),
  // Friends, in the rail and on its page (the online plan, Task B6): two people, the mockup's sign drawn on 20 by 20.
  people: (
    <>
      <circle cx="7.5" cy="6.7" r="2.7" />
      <path d="M2.9 15.8c.5-2.7 2.3-4.2 4.6-4.2s4.1 1.5 4.6 4.2" />
      <circle cx="13.8" cy="7.5" r="2.2" />
      <path d="M12.9 11.8c2-.3 3.6 1.1 4.2 3.6" />
    </>
  ),
}

/** The name of every sign, in the order of the table above. */
export const SIGN_NAMES: readonly SignName[] = Object.keys(DRAWINGS) as SignName[]

/**
 * A drawn sign: a line drawing on a 20 pixel square, 1.5 pixels thick with round ends, in the colour of the text around
 * it (`currentColor`). The place that uses it sets the colour, and the size where 20 pixels is not right, with a rule
 * for its `className`; the lines scale with the size, and a place that wants them thicker sets `stroke-width`. Screen
 * readers skip it: they are given the words beside it.
 */
export function Sign({ name, className }: { name: SignName; className?: string }) {
  return (
    <svg
      className={className === undefined ? 'sign' : `sign ${className}`}
      viewBox="0 0 20 20"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {DRAWINGS[name]}
    </svg>
  )
}
