import type { CSSProperties } from 'react'
import type { EndgameFoe, EndgameFoeGroup } from '../types.ts'

/** The Abyss's floors with stars, and the chambers and stars of each. */
const FLOORS = [9, 10, 11, 12] as const
const CHAMBERS = 3
const STARS = 3

/**
 * The star grid of the Spiral Abyss: floors 9 to 12, each with nine cells (three chambers of three stars) that are 1 where
 * a star was won and 0 where not. A chamber the cycle did not reach has no star. `name` is the chamber as "12-3".
 */
export function starCells(chambers: { name: string; stars: number }[]): { floor: number; stars: (0 | 1)[] }[] {
  const won = new Map<string, number>(chambers.map((chamber) => [chamber.name, chamber.stars]))
  return FLOORS.map((floor) => {
    const stars: (0 | 1)[] = []
    for (let chamber = 1; chamber <= CHAMBERS; chamber += 1) {
      const earned = won.get(`${floor}-${chamber}`) ?? 0
      for (let star = 0; star < STARS; star += 1) stars.push(star < earned ? 1 : 0)
    }
    return { floor, stars }
  })
}

/**
 * The Theater's acts as circles: 'medal' where the act earned one, 'done' where it was cleared without, 'off' where it
 * was not reached. `act` is the act reached, and `medals` the season's list, one entry for each act.
 */
export function actCells(medals: boolean[], act: number): ('medal' | 'done' | 'off')[] {
  return medals.map((medal, at) => (at >= act ? 'off' : medal ? 'medal' : 'done'))
}

/** A time in battle: "4 min 40 s", "16 min 42 s", "42 s", "2 min". */
export function durationText(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  if (minutes === 0) return `${rest} s`
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`
}

/** A boss's clear time as the game shows it, "1:59"; a dash where HoYoLAB gave none. */
export function bossTime(seconds: number | null): string {
  if (seconds === null) return '–'
  const total = Math.max(0, Math.round(seconds))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** The foes of a floor by chamber: one row for each, with its first and its second half. */
export function foeRows(groups: EndgameFoeGroup[]): { chamber: string; halves: [EndgameFoe[], EndgameFoe[]] }[] {
  const rows: { chamber: string; halves: [EndgameFoe[], EndgameFoe[]] }[] = []
  for (const group of groups) {
    let row = rows.find((one) => one.chamber === group.chamber)
    if (row === undefined) {
      row = { chamber: group.chamber, halves: [[], []] }
      rows.push(row)
    }
    row.halves[group.half === 2 ? 1 : 0].push(...group.foes)
  }
  return rows
}

/** The best so far beside the big number: the Stygian's "Difficulty 5" is just "5" there, under a badge that says it. */
export function bestText(best: string): string {
  return best.replace(/^Difficulty /, '')
}

/** "6 medals", "1 medal". */
export function medalsText(count: number): string {
  if (count <= 0) return 'no medals'
  return count === 1 ? '1 medal' : `${count} medals`
}

/**
 * A header's picture shown as the crop (x, y, width, height, fractions of the picture) says: all of it, covering the place,
 * with none. With a crop the picture is scaled so that the crop's width fills the place's width (100 / width per cent, height
 * in proportion), and placed so that the crop's left edge is at the place's left and the crop's middle height is at the
 * place's middle: horizontally x / (1 - width), vertically y + height / 2, as percentages of the picture. It shows the crop's
 * width, and as much of its height as the place has; it does not cut at the crop's top and bottom.
 */
export function cropStyle(crop: [number, number, number, number] | null): CSSProperties {
  if (crop === null) return { backgroundSize: 'cover', backgroundPosition: '50% 40%' }
  const [x, y, width, height] = crop
  const across = width >= 1 ? 50 : (x / (1 - width)) * 100
  const down = (y + height / 2) * 100
  return { backgroundSize: `${100 / width}% auto`, backgroundPosition: `${across}% ${down}%` }
}
