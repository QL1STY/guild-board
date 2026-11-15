import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import css from '../styles/endgame-card.css?raw'
import { contrast, tokenValues } from '../styles/contrast.ts'
import motion from '../styles/motion.css?raw'
import tokens from '../styles/tokens.css?raw'
import type { EndgameAbyss, EndgameMode, EndgameStygian, EndgameTheater } from '../types.ts'
import { EndgameCard } from './EndgameCard.tsx'
import {
  actCells,
  bestText,
  bossTime,
  cropStyle,
  durationText,
  foeRows,
  medalsText,
  starCells,
} from './endgamecard.ts'

test('actCells', () => {
  const states = (cells: { state: string }[]) => cells.map((cell) => cell.state)
  expect(states(actCells([true, false, true], 2, 0))).toEqual(['medal', 'done', 'off'])
  expect(states(actCells([false, false], 0, 0))).toEqual(['off', 'off'])
  expect(actCells([], 5, 0)).toEqual([])
  expect(actCells([true, false], 2, null).map((cell) => cell.label)).toEqual(['1', '2'])
})

test("actCells keeps an Arcana Challenge's two Arcana fights apart from its ten acts", () => {
  const medals = [true, false, true, true, false, true, true, false, false, true, false, true]
  const cells = actCells(medals, 10, 2)
  expect(cells.map((cell) => cell.label)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'A1', 'A2'])
  // Both Arcana fights are cleared: the first without its medal, the second with it. Neither is "not reached".
  expect(cells.slice(10).map((cell) => cell.state)).toEqual(['done', 'medal'])
  expect(actCells([...medals.slice(0, 10), false, false], 7, 1).slice(10).map((cell) => cell.state)).toEqual(['done', 'off'])
  // A detail that does not know the Arcana fights cleared shows a won medal, and nothing else, as cleared.
  expect(actCells(medals, 10, null).slice(10).map((cell) => cell.state)).toEqual(['off', 'medal'])
})

test('the Theater says the Arcana fights cleared, and counts the acts without them', () => {
  const { abyss, theater, stygian } = columns()
  const medals = [true, false, true, true, false, true, true, false, false, true, false, true]
  const card = drawn([abyss, { ...theater, medals, arcana: 2 }, stygian])
  expect(card.theater).toMatch(/<b>Act 10<\/b><span>reached · Arcana 2 · 6 medals<\/span>/)
  expect(card.theater).toContain('aria-label="Act 10 of 10 reached, Arcana 2 of 2, 6 medals"')
  expect(card.theater).toMatch(/class="ec-act arcana medal"[^>]*>A2</)
  expect(card.theater).not.toContain('>11<')
})

test('starCells fills floors 9 to 12', () => {
  const cells = starCells([{ name: '12-3', stars: 2 }])
  expect(cells.map((cell) => cell.floor)).toEqual([9, 10, 11, 12])
  expect(cells.at(-1)).toEqual({ floor: 12, stars: [0, 0, 0, 0, 0, 0, 1, 1, 0] })
  expect(cells[0].stars).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0])
})

test('starCells keeps each chamber in its own three', () => {
  const cells = starCells([
    { name: '9-1', stars: 3 },
    { name: '9-2', stars: 1 },
    { name: '10-3', stars: 3 },
  ])
  expect(cells[0].stars).toEqual([1, 1, 1, 1, 0, 0, 0, 0, 0])
  expect(cells[1].stars).toEqual([0, 0, 0, 0, 0, 0, 1, 1, 1])
})

test('durationText', () => {
  expect(durationText(280)).toBe('4 min 40 s')
  expect(durationText(1002)).toBe('16 min 42 s')
  expect(durationText(42)).toBe('42 s')
  expect(durationText(120)).toBe('2 min')
})

test("a boss's time reads as minutes and seconds", () => {
  expect(bossTime(119)).toBe('1:59')
  expect(bossTime(42)).toBe('0:42')
  expect(bossTime(null)).toBe('–')
})

test('foeRows puts a chamber on one row, its two halves side by side', () => {
  const rows = foeRows([
    { chamber: '12-1', half: 1, foes: [{ name: 'A', level: 95, icon: null }] },
    { chamber: '12-1', half: 2, foes: [{ name: 'B', level: 95, icon: null }] },
    { chamber: '12-2', half: 2, foes: [{ name: 'C', level: 98, icon: null }] },
  ])
  expect(rows.map((row) => row.chamber)).toEqual(['12-1', '12-2'])
  expect(rows[0].halves.map((half) => half.map((foe) => foe.name))).toEqual([['A'], ['B']])
  expect(rows[1].halves.map((half) => half.map((foe) => foe.name))).toEqual([[], ['C']])
})

test('bestText drops the word Difficulty and says the medals', () => {
  expect(bestText('36 stars')).toBe('36 stars')
  expect(bestText('Difficulty 5')).toBe('5')
  expect(medalsText(6)).toBe('6 medals')
  expect(medalsText(1)).toBe('1 medal')
  expect(medalsText(0)).toBe('no medals')
})

test('a crop shows only its part of the picture', () => {
  expect(cropStyle(null)).toMatchObject({ backgroundSize: 'cover' })
  const style = cropStyle([0, 0, 0.48, 0.84])
  expect(style.backgroundSize).toBe(`${100 / 0.48}% auto`)
  expect(style.backgroundPosition).toBe('0% 42%')
  expect(cropStyle([0.5, 0, 0.5, 1]).backgroundPosition).toBe('100% 50%')
})

test("the modes' colours reach 3:1 on the card, and the white of their marks 4.5:1", () => {
  const t = tokenValues(tokens)
  for (const name of ['--mode-abyss', '--mode-theater', '--mode-stygian']) {
    expect(t[name], name).toBeDefined()
    expect(contrast(t[name], t['--surface']), name).toBeGreaterThanOrEqual(3)
    expect(contrast('#FFFFFF', t[name]), name).toBeGreaterThanOrEqual(4.5)
  }
  expect([t['--mode-abyss'], t['--mode-theater'], t['--mode-stygian']]).toEqual(['#3E5A9E', '#9C3B52', '#2D6E6A'])
})

test('a lit star, the number of an act and the card read on parchment', () => {
  const t = tokenValues(tokens)
  expect(contrast(t['--fill'], t['--surface'])).toBeGreaterThanOrEqual(3)
  expect(contrast(t['--ink'], t['--track'])).toBeGreaterThanOrEqual(4.5) // the number in a circle not reached
  expect(contrast(t['--medal-ink'], t['--medal'])).toBeGreaterThanOrEqual(4.5) // the number on a medal's gold
})

// ---------- The card as drawn

const header = { icon: null, picture: null, crop: null }
const rank = (kind: string, label: string, value: number) => ({ kind, label, value, face: null, name: 'Nefer', element: null })

/** The three columns as this version reads them, every field there. */
function columns(): { abyss: EndgameAbyss; theater: EndgameTheater; stygian: EndgameStygian } {
  return {
    abyss: {
      mode: 'abyss', label: 'Spiral Abyss', header, period: '16 Oct to 15 Nov', result: '33 of 36 stars', best: '36 stars',
      played: true, line: '16 Oct to 15 Nov · 6 battles, 6 won', stars: 33, battles: 6, wins: 6,
      chambers: [{ name: '12-1', stars: 3 }], floor_shown: 12, foes: [],
      ranks: [rank('strike', 'Strongest single strike', 1352944), rank('defeats', 'Most defeats', 22)],
    },
    theater: {
      mode: 'theater', label: 'Imaginarium Theater', header, period: '1 Nov to 30 Nov', result: 'Act 10 reached', best: 'Act 10',
      played: true, line: 'November · Arcana Challenge', month: 'November', difficulty: 'Arcana Challenge', ended: false, act: 10,
      medals: [true, false, true], medal_count: 6, arcana: 0, heraldry: 5,
      marks: { medal: null, cleared: null, flower: null, heraldry: null }, ranks: [rank('damage', 'Most damage', 943229)], flowers: 1285, seconds: 1002,
    },
    stygian: {
      mode: 'stygian', label: 'Stygian Onslaught', header, period: 'Luminous Battlefront', result: 'Difficulty 5 cleared',
      best: 'Difficulty 5', played: true, line: 'Luminous Battlefront', season: 'Luminous Battlefront', ended: false,
      difficulty: 5, medal: null, seconds: 280, bosses: [], next: null, next_started: false, dimmed: false,
    },
  }
}

/** The card's markup, cut into its three columns by mode. */
function drawn(modes: EndgameMode[]): Record<string, string> {
  const markup = renderToStaticMarkup(createElement(EndgameCard, { model: { modes } }))
  const starts = modes.map((mode) => markup.indexOf(`data-testid="ec-${mode.mode}"`))
  return Object.fromEntries(modes.map((mode, at) => [mode.mode, markup.slice(starts[at], starts[at + 1])]))
}

test('a detail kept by 1.0.1 shows its stars with no grey grid, and no medals, flowers or time it does not know', () => {
  const { abyss, theater, stygian } = columns()
  const card = drawn([
    { ...abyss, line: '16 Oct to 15 Nov', battles: null, wins: null, chambers: null, ranks: null },
    { ...theater, medals: null, medal_count: null, ranks: null, flowers: null, seconds: null, arcana: null },
    stygian,
  ])
  // The Abyss keeps "33 of 36 stars", with no star grid and no highlight.
  expect(card.abyss).toMatch(/<b>33<\/b><span>of 36 stars<\/span>/)
  expect(card.abyss).not.toContain('ec-floors')
  expect(card.abyss).not.toContain('ec-star')
  expect(card.abyss).not.toContain('Strongest single strike')
  // The Theater says the act reached, and nothing of the medals, the flowers or the time.
  expect(card.theater).toMatch(/<b>Act 10<\/b><span>reached<\/span>/)
  expect(card.theater).not.toContain('medal')
  expect(card.theater).not.toContain('ec-acts')
  expect(card.theater).not.toContain('Fantasia Flowers used')
  expect(card.theater).not.toContain('Time in battle')
})

test("the Theater shows HoYoLAB's own marks once they are kept, with the number under each", () => {
  const { abyss, theater, stygian } = columns()
  const medals = [true, false, true, true, false, true, true, false, false, true, false, true]
  const marks = { medal: '/api/art/m', cleared: '/api/art/c', flower: '/api/art/f', heraldry: '/api/art/h' }
  const card = drawn([abyss, { ...theater, medals, act: 9, arcana: 1, marks }, stygian])
  expect(card.theater).toContain('class="ec-heraldry" src="/api/art/h"')
  expect(card.theater).toMatch(/class="ec-mark medal"[^>]*><span class="ec-disc"><img src="\/api\/art\/m"[^>]*><\/span>1</)
  expect(card.theater).toMatch(/class="ec-mark done"[^>]*><span class="ec-disc"><img src="\/api\/art\/c"[^>]*><\/span>2</)
  // Act 10 was not reached: an empty disc. A1 is cleared without its medal; A2 has its medal.
  expect(card.theater).toMatch(/class="ec-mark off"[^>]*><span class="ec-disc"><\/span>10</)
  expect(card.theater).toMatch(/class="ec-split"/)
  expect(card.theater).toMatch(/class="ec-mark arcana done"[^>]*><span class="ec-disc"><img src="\/api\/art\/c"[^>]*><\/span>A1</)
  expect(card.theater).toMatch(/class="ec-mark arcana medal"[^>]*><span class="ec-disc"><img src="\/api\/art\/m"[^>]*><\/span>A2</)
  expect(card.theater).not.toContain('class="ec-act')
  expect(card.theater).toMatch(/<img class="ec-legend-mark" src="\/api\/art\/m"/)
  expect(card.theater).toMatch(/<img class="ec-glyph-pic" src="\/api\/art\/f"/)
})

test("without HoYoLAB's medal pictures the Theater keeps its own circles and no heraldry", () => {
  const { abyss, theater, stygian } = columns()
  const marks = { medal: null, cleared: '/api/art/c', flower: null, heraldry: null }
  const card = drawn([abyss, { ...theater, marks }, stygian])
  expect(card.theater).toContain('class="ec-act medal"')
  expect(card.theater).not.toContain('ec-mark')
  expect(card.theater).not.toContain('ec-heraldry')
})

test('a real 0 still shows: no medals, no flowers and no time are numbers read', () => {
  const { abyss, theater, stygian } = columns()
  const card = drawn([abyss, { ...theater, act: 1, medals: [false, false], medal_count: 0, flowers: 0, seconds: 0 }, stygian])
  expect(card.theater).toMatch(/<b>Act 1<\/b><span>reached · no medals<\/span>/)
  expect(card.theater).toMatch(/Fantasia Flowers used<\/span><span class="ec-v">0</)
  expect(card.theater).toMatch(/Time in battle<\/span><span class="ec-v">0 s</)
  expect(card.abyss).toContain('ec-floors') // the Abyss's grid, which this version read
  expect(card.abyss).toContain('Strongest single strike')
})

test('a new cycle with no tries yet keeps the best; only a mode never played says it was not played', () => {
  const { abyss, theater, stygian } = columns()
  const card = drawn([{ ...abyss, played: false }, { ...theater, played: false, best: '' }, stygian])
  expect(card.abyss).toContain('No tries this cycle yet')
  expect(card.abyss).toMatch(/Best <b>36 stars<\/b>/)
  expect(card.abyss).not.toContain('Not played yet')
  expect(card.theater).toContain('Not played yet')
  expect(card.theater).not.toContain('Best')
  expect(card.theater).not.toContain('No tries')
})

test('the card moves with the tokens and rests under reduced motion', () => {
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, '')
  expect(plain).not.toMatch(/animation[^;]*\b\d+(\.\d+)?m?s\b/) // a duration is a token, never a number
  expect(plain).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation:\s*none/)
  expect(plain).not.toMatch(/#[0-9a-fA-F]{3,8}\b/) // a colour is a token of tokens.css, never a value of its own
  expect(motion).toContain('prefers-reduced-motion')
})
