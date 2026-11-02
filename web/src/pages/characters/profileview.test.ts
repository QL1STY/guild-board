import { expect, test } from 'vitest'
import fixture from '../../fixtures/characters/profile.json'
import type { Profile, StatRow } from '../../types.ts'
import {
  agree, cardLine, CHART_STAGE, chartBox, chartPlaces, goalMark, litLines, matWords, objectPronoun, ownLabel, PANES, paneSign, pieceBar, piecesByCrit, pityBar, pityPill, pityStory,
  possessive, rollsHeading, stepKey, rollsSummary, rollUnits, setsView, statShares, statTip, talentText, tally, unfoldSegments, usesCrit, verdictChip,
  verdictLabel, weaponVerdict,
  edgeOf,
  pictureLight,
} from './profileview.ts'

const profile = fixture as unknown as Profile
const row = (key: string): StatRow => profile.stats.find((stat) => stat.key === key) as StatRow

test("the six sidebar pages come in the design's order, each with its drawn sign", () => {
  expect(PANES.map((pane) => pane.key)).toEqual(['attr', 'weapon', 'arts', 'cons', 'talents', 'story'])
  expect(PANES.map((pane) => pane.label)).toEqual(['Attributes', 'Weapon', 'Artifacts', 'Constellation', 'Talents', 'Story'])
  expect(PANES.map((pane) => paneSign(pane.key, 'Claymore'))).toEqual(['bust', 'claymore', 'flower', 'stars', 'crown', 'book'])
  // The Weapon page's sign follows the weapon's type.
  expect(paneSign('weapon', 'Bow')).toBe('bow')
  expect(paneSign('weapon', 'Catalyst')).toBe('catalyst')
})

test("a stat bar is cut into her own, her weapon's and her artifacts' shares of its scale", () => {
  expect(statShares(row('atk'))).toEqual([
    { key: 'her', width: 8.55 },
    { key: 'weapon', width: 23.95 },
    { key: 'artifacts', width: 41.6 },
  ])
  // A share of nothing has no part.
  expect(statShares(row('hp')).map((share) => share.key)).toEqual(['her', 'artifacts'])
  expect(statShares(row('em'))).toEqual([{ key: 'artifacts', width: 11.8 }])
})

test('the shares never run past the end of the bar', () => {
  const over: StatRow = { ...row('atk'), her: 3000, weapon: 3000, artifacts: 3000, scale: 4000 }
  const total = statShares(over).reduce((sum, share) => sum + share.width, 0)
  expect(total).toBeLessThanOrEqual(100)
  expect(total).toBeGreaterThan(99.9)
})

test("the goal's gold mark stands at its share of the scale, and a stat with no goal has none", () => {
  expect(goalMark(row('atk'))).toBe(65)
  expect(goalMark(row('cr'))).toBe(75)
  expect(goalMark(row('cd'))).toBeCloseTo(66.67, 2)
  expect(goalMark(row('hp'))).toBeNull()
  expect(goalMark({ ...row('atk'), goal: 99999 })).toBe(100)
})

test("a stat's tip says where it comes from and how far her goal is", () => {
  expect(statTip(row('atk'))).toEqual({
    title: 'ATK 2,964',
    how: "Her own 342, weapon 958 (674 base, 284 from its passive), artifacts 1,664 with the set's 18%.",
    goal: 'Goal 2,600: reached.',
  })
  expect(statTip(row('cd')).goal).toBe('Goal 200%: 23.5% to go.')
  expect(statTip(row('dmg')).goal).toBe('Goal 46.6%: 46.6% to go.')
  expect(statTip(row('hp')).goal).toBeNull()
})

test('the roll chart has one square per roll, coloured by its weight', () => {
  expect(rollUnits({ rolls: 3, weight: 'wants' })).toEqual(['h', 'h', 'h'])
  expect(rollUnits({ rolls: 2, weight: 'some' })).toEqual(['s', 's'])
  expect(rollUnits({ rolls: 4, weight: 'none' })).toEqual(['n', 'n', 'n', 'n'])
  expect(rollUnits({ rolls: 0, weight: 'wants' })).toEqual([])
  const units = profile.rolls.map((roll) => rollUnits(roll).length)
  expect(units.reduce((sum, count) => sum + count, 0)).toBe(41)
})

test("the roll chart's heading and line count her rolls in her own pronoun", () => {
  expect(rollsHeading(profile)).toBe('Where her 41 substat rolls went')
  expect(rollsSummary(profile)).toBe('28 help her, 5 are of some use, 8 are wasted.')
  const they = { ...profile, pronouns: THEY }
  expect(rollsHeading(they)).toBe('Where their 41 substat rolls went')
  expect(rollsSummary(they)).toBe('28 help them, 5 are of some use, 8 are wasted.')
})

// The contract's pronouns (types.ts): `she` the subject, `her` the object and `hers` the possessive.
const HE = { she: 'he', her: 'him', hers: 'his' }
const THEY = { she: 'they', her: 'them', hers: 'their' }

test("his and their words take the card's object and possessive, and a verb agrees with they", () => {
  const him = { ...profile, pronouns: HE }
  expect(rollsHeading(him)).toBe('Where his 41 substat rolls went')
  expect(rollsSummary(him)).toBe('28 help him, 5 are of some use, 8 are wasted.')
  expect(ownLabel(HE)).toBe('His own')
  expect(ownLabel(THEY)).toBe('Their own')
  expect(possessive(HE)).toBe('his')
  expect(objectPronoun(THEY)).toBe('them')
  expect(agree(HE, 'wants', 'want')).toBe('he wants')
  expect(agree(THEY, 'wants', 'want')).toBe('they want')
  expect(pityStory(him).map((entry) => entry.what)).toEqual([
    'won the 50/50: he joins you',
    'guaranteed: his first constellation',
    'won the 50/50: his second constellation',
  ])
  expect(pityStory({ ...profile, pronouns: THEY })[0].what).toBe('won the 50/50: they join you')
  expect(tally(him)?.text).toBe('wishes for his three copies, plus the ones that ended in Qiqi')
  expect(cardLine({ edited: ['goals'], confidence: 'high', early: false }, HE)).toBe('You have edited one field of his card.')
})

test('only a card whose confidence is none is the fallback card', () => {
  const fallback = 'No researched card yet; these are defaults.'
  expect(cardLine({ edited: [], confidence: 'none', early: false }, HE)).toBe(fallback)
  expect(cardLine({ edited: [], confidence: 'defaults', early: false }, HE)).not.toBe(fallback)
})

test('an unfolded substat shows six segments, the rolls it had coloured and the rest empty', () => {
  const [flower, plume] = profile.pieces
  expect(unfoldSegments(flower.subs[0])).toEqual(['h', 'h', 'h', 'e', 'e', 'e'])
  expect(unfoldSegments(plume.subs[3])).toEqual(['n', 'n', 'e', 'e', 'e', 'e'])
  expect(unfoldSegments(profile.pieces[2].subs[2])).toEqual(['s', 'e', 'e', 'e', 'e', 'e'])
  expect(unfoldSegments({ ...flower.subs[0], rolls: 9 })).toHaveLength(6)
})

test("the pity pill lists each copy's pity, and is hidden when the history holds none of her", () => {
  expect(pityPill(profile.pity)).toEqual({ label: 'Came at pity', numbers: [71, 44, 62] })
  expect(pityPill([])).toBeNull()
  expect(pityPill([{ ...profile.pity[0], pity: null }])).toBeNull()
  expect(pityPill([{ ...profile.pity[0], pity: null }, profile.pity[1]])).toEqual({ label: 'Came at pity', numbers: [44] })
})

test('a pity bar fills to its pity out of 90, with its mark at soft pity, 74', () => {
  expect(pityBar(71)).toEqual({ fill: 78.9, soft: 82.2, tip: '71 of 90; the line is soft pity, 74' })
  expect(pityBar(44).fill).toBe(48.9)
  expect(pityBar(120).fill).toBe(100)
})

test('the story tells each copy as the mockup does, in her own pronouns', () => {
  const story = pityStory(profile)
  expect(story.map((entry) => entry.when)).toEqual([
    '2 July 2026, character banner',
    '9 July 2026, after losing a 50/50 to Qiqi',
    '14 July 2026, character banner',
  ])
  expect(story.map((entry) => entry.what)).toEqual([
    'won the 50/50: she joins you',
    'guaranteed: her first constellation',
    'won the 50/50: her second constellation',
  ])
  expect(story.map((entry) => entry.pity)).toEqual([71, 44, 62])
})

test('the tally counts the wishes for her copies, and names the ones that ended in someone else', () => {
  expect(tally(profile)).toEqual({ total: 177, text: 'wishes for her three copies, plus the ones that ended in Qiqi' })
  expect(tally({ ...profile, pity: [profile.pity[0]] })).toEqual({ total: 71, text: 'wishes for her copy' })
  expect(tally({ ...profile, pity: [] })).toBeNull()
})

test('the Artifacts page lists the pieces by crit value, and by the rolls she wants where she uses no crit', () => {
  expect(piecesByCrit(profile).map((piece) => piece.slot)).toEqual(['flower', 'sands', 'plume', 'circlet', 'goblet'])
  expect(usesCrit(profile)).toBe(true)
  const support = {
    ...profile,
    rolls: profile.rolls.map((roll) => ({ ...roll, weight: roll.key === 'er' ? ('wants' as const) : ('none' as const) })),
  }
  expect(usesCrit(support)).toBe(false)
  expect(piecesByCrit(support).map((piece) => piece.slot)).toEqual(['flower', 'circlet', 'plume', 'sands', 'goblet'])
  expect(pieceBar(profile.pieces[0], true)).toBeCloseTo(85.6, 5)
  expect(pieceBar(profile.pieces[0], false)).toBe(100)
  expect(pieceBar(profile.pieces[3], true)).toBe(0)
})

test('a verdict has its word and its chip colour', () => {
  expect(['keep', 'level', 'replace'].map((verdict) => verdictLabel(verdict as 'keep'))).toEqual(['Keep', 'Level up', 'Replace'])
  expect(['keep', 'level', 'replace'].map((verdict) => verdictChip(verdict as 'keep'))).toEqual(['keep', 'lvl-up', 'swap'])
})

test('a set she wears whole, and two she wears in pairs, are told as their pieces are', () => {
  expect(setsView(profile.sets, profile.pronouns)).toEqual([
    {
      name: 'Disenchantment in Deep Shadow',
      sub: 'All five pieces from one set',
      bonuses: [
        { label: '2 pieces', text: 'ATK +18%.' },
        { label: '4 pieces', text: 'Superconduct DMG +80%, and +16% Crit Rate against opponents affected by Superconduct.' },
      ],
    },
  ])
  const pair = setsView([
    { name: 'A', pieces: 2, two: 'ATK +18%.', four: '' },
    { name: 'B', pieces: 3, two: 'Cryo DMG +15%.', four: '' },
  ], profile.pronouns)
  expect(pair.map((set) => set.sub)).toEqual(['2 of her pieces', '3 of her pieces'])
  expect(pair.map((set) => set.bonuses.length)).toEqual([1, 1])
  const his = setsView([{ name: 'A', pieces: 2, two: 'ATK +18%.', four: '' }], { she: 'he', her: 'him', hers: 'his' })
  expect(his.map((set) => set.sub)).toEqual(['2 of his pieces'])
})

test("the chart's line joins the stars she has, in order, and a star she lacks has none", () => {
  const stars = profile.stars as [number, number][]
  expect(litLines(stars, 2)).toEqual([{ from: [288, 250], to: [450, 197] }])
  expect(litLines(stars, 0)).toEqual([])
  expect(litLines(stars, 1)).toEqual([])
  expect(litLines(stars, 6)).toHaveLength(5)
})

test("a star falls on the chart's own star, whatever the chart's shape and the size it is shown at", () => {
  // Where a browser draws a chart's pixel in a square box of `box` pixels with `object-fit: contain`, centred: the image's proportions
  // alone decide it, so a copy of the chart at any picture quality lands in the same place.
  const drawn = ([x, y]: [number, number], [width, height]: [number, number], box: number) => {
    const scale = Math.min(box / width, box / height)
    return [(box - width * scale) / 2 + x * scale, (box - height * scale) / 2 + y * scale]
  }
  const charts: [string, [number, number]][] = [
    ['square', [900, 900]], ['large square', [1350, 1350]], ['small square', [563, 563]],
    ['tall', [548, 720]], ['slightly tall', [1085, 1108]], ['wide', [933, 809]], ['slightly wide', [876, 843]],
  ]
  for (const [, size] of charts) {
    const points: [number, number][] = [[0, 0], [size[0], size[1]], [Math.round(size[0] / 3), Math.round(size[1] * 0.8)]]
    const places = chartPlaces(points, size)
    for (const box of [560, 813, 1093]) {
      points.forEach((point, index) => {
        const [x, y] = drawn(point, size, box)
        expect(places[index][0] * (box / CHART_STAGE)).toBeCloseTo(x, 6)
        expect(places[index][1] * (box / CHART_STAGE)).toBeCloseTo(y, 6)
      })
    }
  }
  expect(chartPlaces([[288, 250]], [900, 900])).toEqual([[288, 250]]) // the mockup's chart, drawn as it is
  const [large] = chartPlaces([[1000, 400]], [1350, 1350])
  expect(large[0]).toBeCloseTo((1000 * 2) / 3, 6)
  expect(large[1]).toBeCloseTo((400 * 2) / 3, 6)
  const [tall] = chartPlaces([[0, 360]], [548, 720]) // a tall chart stands in the middle
  expect(tall[0]).toBeCloseTo((900 - 548 * 1.25) / 2, 6)
  expect(tall[1]).toBeCloseTo(450, 6)
})

test("the chart's box has the chart's own proportions, as long as the stage on its longer side", () => {
  expect(chartBox([900, 900])).toEqual({ width: '100%', height: '100%' })
  expect(chartBox([1350, 1350])).toEqual({ width: '100%', height: '100%' })
  expect(parseFloat(chartBox([548, 720])!.width)).toBeCloseTo(76.11, 1)
  expect(chartBox([548, 720])!.height).toBe('100%')
  expect(chartBox([933, 809])!.width).toBe('100%')
  expect(parseFloat(chartBox([933, 809])!.height)).toBeCloseTo(86.71, 1)
  expect(chartBox(null)).toBeUndefined()
})

test('with no stars the six stand on a ring around the middle of the chart, evenly, from the top', () => {
  const places = chartPlaces(null, null)
  expect(places).toHaveLength(6)
  expect(places[0][0]).toBeCloseTo(CHART_STAGE / 2, 6)
  expect(places[0][1]).toBeLessThan(CHART_STAGE / 2)
  const radii = places.map(([x, y]) => Math.hypot(x - CHART_STAGE / 2, y - CHART_STAGE / 2))
  for (const radius of radii) {
    expect(radius).toBeCloseTo(radii[0], 6)
    expect(radius).toBeLessThan(CHART_STAGE / 2 - 46) // a star's ring stays inside
  }
  const steps = places.map(([x, y], index) => Math.hypot(x - places[(index + 1) % 6][0], y - places[(index + 1) % 6][1]))
  for (const step of steps) expect(step).toBeCloseTo(steps[0], 6)
})

test('a talent that a constellation raises shows apart, as "10 + 3"', () => {
  expect(talentText({ level: 10, bonus: 3 })).toBe('10 + 3')
  expect(talentText({ level: 9, bonus: 0 })).toBe('9')
  expect(talentText({ level: null, bonus: 0 })).toBe('')
})

test('a material is ready, or says how many are left to get, or that the amount is not known', () => {
  const [vagrancy, shaft, , , mora] = profile.next_level?.materials ?? []
  expect(matWords(vagrancy)).toEqual({ held: '9 held, 16 needed', chip: '7 to get', ready: false })
  expect(matWords(shaft)).toEqual({ held: '12 held, 12 needed', chip: 'Ready', ready: true })
  expect(matWords(mora)).toEqual({ held: '2,410,000 held, 700,000 needed', chip: 'Ready', ready: true })
  expect(matWords({ ...vagrancy, held: null, state: 'unknown' })).toEqual({ held: 'Held amount not known, 16 needed', chip: 'Not known', ready: false })
})

test("the card's verdict on her weapon opens with a word, which becomes the chip", () => {
  expect(weaponVerdict(profile.weapon?.verdict ?? '')).toEqual({
    label: 'Keep',
    chip: 'keep',
    text: 'Its bonuses match her kit: Charged Attack hits and Stellar reactions.',
  })
  expect(weaponVerdict('Replace it: a weapon with Crit Rate would serve her better.')).toMatchObject({ label: 'Replace', chip: 'swap' })
  expect(weaponVerdict('No verdict yet.')).toEqual({ label: null, chip: null, text: 'No verdict yet.' })
})

const press = (key: string, extra: Partial<Parameters<typeof stepKey>[0]> = {}, target: Parameters<typeof stepKey>[1] = { tagName: 'BODY' }) =>
  stepKey({ key, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, defaultPrevented: false, isComposing: false, ...extra }, target)

test('the left and right arrows step to the previous and the next character, and nothing else does', () => {
  expect(press('ArrowLeft')).toBe(-1)
  expect(press('ArrowRight')).toBe(1)
  expect(press('ArrowUp')).toBeNull()
  expect(press('a')).toBeNull()
  expect(press('Tab')).toBeNull()
})

test('the arrows do not step while the player types, holds a modifier, or a control has used the key already', () => {
  expect(press('ArrowLeft', {}, { tagName: 'INPUT' })).toBeNull()
  expect(press('ArrowRight', {}, { tagName: 'TEXTAREA' })).toBeNull()
  expect(press('ArrowRight', {}, { tagName: 'SELECT' })).toBeNull()
  expect(press('ArrowRight', {}, { tagName: 'DIV', isContentEditable: true })).toBeNull()
  expect(press('ArrowLeft', { altKey: true })).toBeNull() // Alt+Left is the window's Back
  expect(press('ArrowLeft', { ctrlKey: true })).toBeNull()
  expect(press('ArrowLeft', { metaKey: true })).toBeNull()
  expect(press('ArrowLeft', { shiftKey: true })).toBeNull()
  expect(press('ArrowLeft', { defaultPrevented: true })).toBeNull()
  expect(press('ArrowLeft', { isComposing: true })).toBeNull()
  expect(press('ArrowLeft', {}, { tagName: 'BUTTON' })).toBe(-1)
  expect(press('ArrowLeft', {}, null)).toBe(-1)
})

test('the light of a picture is its mean brightness, and what is see-through counts as the dark card behind it', () => {
  expect(pictureLight(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]))).toBeCloseTo(0.5)
  expect(pictureLight(new Uint8ClampedArray([255, 255, 255, 0]))).toBe(0)
  expect(pictureLight(new Uint8ClampedArray(0))).toBe(0)
})

test('the edges darken only on a bright picture, by how bright it is, and never past a half', () => {
  expect(edgeOf(0.33)).toBe(0) // Neuvillette
  expect(edgeOf(0.42)).toBe(0)
  expect(edgeOf(0.585)).toBeCloseTo(0.495) // Columbina
  expect(edgeOf(0.9)).toBe(0.5)
})
