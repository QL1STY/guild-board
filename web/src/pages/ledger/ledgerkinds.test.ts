import { describe, expect, test } from 'vitest'

import type { ArtifactDay, CrystalDay, Ledger, ResinDay } from '../../ledgertypes.ts'
import { LEDGER_FIXTURE } from '../../ledgertypes.ts'
import { headline } from './ledgerchart.ts'
import {
  CRYSTAL_WORDS, crystalBalanceDays, crystalsHeld, artifactBars, artifactBecame, artifactCost, artifactHead, artifactLuck, artifactTop, artifactWhere, crystalBars, crystalCompare,
  crystalHead, crystalWhere, lastMonthSameDays, monthOf, packsNote, resinAgainst, resinBars, resinHead, resinBosses, resinMost,
  resinWhere, runsWords, welkinCard,
} from './ledgerkinds.ts'

const TODAY = '2026-10-31'
const text = (line: { text: string }[]) => line.map((seg) => seg.text).join('')

const crystal = (day: string, bought = 0, spent: [number, number] = [0, 0], welkin = 0, known = true): CrystalDay => ({
  day, known, bought, welkin, spent: spent[0] + spent[1], by_use: { ...(spent[0] ? { exchange: spent[0] } : {}), ...(spent[1] ? { shop: spent[1] } : {}) }, held: null,
})
const resin = (day: string, by_use: ResinDay['by_use'], runs: ResinDay['runs'] = {}, known = true): ResinDay => ({
  day, known, spent: Object.values(by_use).reduce((a, b) => a + b, 0), by_use, runs,
})
const artifact = (day: string, five_domain = 0, five_other = 0, fed = 0, salvaged = 0, names: string[] = [], known = true): ArtifactDay => ({
  day, known, five_domain, five_other, fed, salvaged, names,
})

describe('the months of the days', () => {
  const days = LEDGER_FIXTURE.crystal_days
  test('this month is the 1st to today; the month before the same days of it', () => {
    expect(monthOf(days, '2026-10-22').map((day) => day.day)).toHaveLength(22)
    expect(monthOf(days, '2026-10-22')[0].day).toBe('2026-10-01')
    const before = lastMonthSameDays(days, '2026-10-22')
    expect(before).toHaveLength(22)
    expect(before[0].day).toBe('2026-09-01')
    // The 31st against a month of 30 days: all of it.
    expect(lastMonthSameDays(days, '2026-10-31')).toHaveLength(30)
  })
})

describe('Crystals with a balance', () => {
  test('none is kept today: no day has a held, and the view draws bars', () => {
    expect(crystalsHeld(LEDGER_FIXTURE.crystal_days)).toBe(false)
  })

  test('a day with a held switches the view to the balance, in the primogems’ chart words', () => {
    const days = [crystal('2026-10-01', 300, [300, 0]), crystal('2026-10-02', 0, [0, 60])].map((day, index) => ({ ...day, held: 1000 - index * 60 }))
    expect(crystalsHeld(days)).toBe(true)
    const balance = crystalBalanceDays(days)
    expect(balance[1]).toEqual({ day: '2026-10-02', earned: 0, spent: 60, held: 940, known: true, moments: [] })
    expect(headline(balance, null, 'month', 'October', CRYSTAL_WORDS)).toEqual({
      label: 'Genesis Crystals held', amount: '940', wishes: 'crystals', line: '+300 bought and −360 spent in October',
    })
    expect(headline(balance, 0, 'month', 'October', CRYSTAL_WORDS).line).toBe('+300 bought and −300 spent that day')
  })
})

describe('Crystals', () => {
  const days = [crystal('2026-10-01', 300, [300, 0], 300), crystal('2026-10-09', 1090, [1090, 0]), crystal('2026-10-12', 0, [0, 60]), crystal('2026-10-13')]

  test('the bars: bought up in gold, exchanged and the shop down', () => {
    const bars = crystalBars(days)
    expect(bars[1].up).toEqual([{ value: 1090, color: 'var(--fill)' }])
    expect(bars[2].down.map((part) => part.value)).toEqual([0, 60])
  })

  test('the big number is what was bought, with what went and the note that no balance is kept', () => {
    const head = crystalHead(days, null, 'month', 'October')
    expect(head).toMatchObject({ label: 'Genesis Crystals bought', amount: '1,390', unit: 'crystals' })
    expect(text(head.line)).toBe('+1,390 bought and −1,450 spent in October')
    expect(head.note).toContain('No crystal balance is kept')
    expect(head.line.map((seg) => seg.tone)).toEqual(['in', undefined, 'out', undefined])
  })

  test('with the pointer on a day it says that day', () => {
    expect(text(crystalHead(days, 1, 'month', 'October').line)).toBe('+1,090 bought · −1,090 exchanged for primogems')
    expect(crystalHead(days, 1, 'month', 'October')).toMatchObject({ label: 'Friday, 9 October', amount: '1,090', unit: 'bought' })
    expect(text(crystalHead(days, 2, 'month', 'October').line)).toBe('Nothing bought · −60 in the shop')
    expect(text(crystalHead(days, 3, 'month', 'October').line)).toBe('No crystals came or went that day.')
    expect(text(crystalHead([crystal('2026-10-05', 0, [0, 0], 0, false)], 0, 'month', 'October').line)).toBe('No record of this day')
  })

  test('nothing bought or spent says so, and no days say nothing', () => {
    expect(text(crystalHead([crystal('2026-10-13')], null, 'week', 'October').line)).toBe('Nothing bought or spent in the last 7 days')
    expect(text(crystalHead([], null, 'month', 'October').line)).toBe('No record of these days')
  })

  test('a day or a range the log does not cover reads — and says so, never 0', () => {
    const unknown = [crystal('2026-10-05', 0, [0, 0], 0, false)]
    expect(crystalHead(unknown, 0, 'month', 'October')).toMatchObject({ amount: '—', unit: '', label: 'Monday, 5 October' })
    expect(crystalHead(unknown, null, 'month', 'October')).toMatchObject({ amount: '—', unit: '' })
    expect(text(crystalHead(unknown, null, 'month', 'October').line)).toBe('No record of these days')
  })

  test('where they went: the month’s exchanged and shop, the largest first, and what was bought', () => {
    const card = crystalWhere(days, TODAY)
    expect(card.items.map((item) => [item.key, item.value])).toEqual([['exchange', 1390], ['shop', 60]])
    expect(card.total).toBe(1450)
    expect(card.sub).toBe('Spent in October')
    expect(card.note).toBe('The 1,390 crystals became 1,390 primogems, 8 wishes’ worth.')
    expect(card.foot).toEqual({ ring: 'gold', label: 'Bought in October', value: '+1,390' })
    expect(crystalWhere([crystal('2026-10-01', 300, [160, 0])], TODAY).note).toContain('1 wish’s worth')
    expect(crystalWhere([crystal('2026-10-01')], TODAY).items).toEqual([])
  })

  test('compared with last month’s same days', () => {
    const both = [crystal('2026-09-01', 300, [300, 0], 300), crystal('2026-09-10', 1090, [1090, 0]), crystal('2026-09-30', 300, [0, 0], 300), ...days]
    const card = crystalCompare(both, '2026-10-12', [{ day: '2026-10-09', label: '980 + 110 Genesis Crystals' }])
    expect(card.title).toBe('Compared with September')
    expect(card.note).toBe('One 980 + 110 pack, on 9 October.')
    expect(card.bars.map((bar) => [bar.name, bar.value])).toEqual([['September', 1390], ['October', 1390]])
    expect(card.line).toBe('You bought as many crystals as last month.')
    expect(card.rows).toEqual([
      { label: 'Welkin Moon', change: 'same', way: 'same' },
      { label: 'Packs', change: 'same', way: 'same' },
    ])
    const fewer = crystalCompare([crystal('2026-09-01', 1000), crystal('2026-10-01', 300, [0, 0], 300)], '2026-10-12', [])
    expect(fewer.line).toBe('You bought 700 fewer crystals.')
    expect(fewer.rows).toEqual([
      { label: 'Welkin Moon', change: '▲ +300', way: 'up' },
      { label: 'Packs', change: '▼ −1,000', way: 'down' },
    ])
    expect(crystalCompare([crystal('2026-09-01'), crystal('2026-10-01')], '2026-10-12', []).line).toBe('Nothing bought this month or last.')
  })

  test('the packs of the month in words', () => {
    expect(packsNote([])).toBe('No packs this month.')
    expect(packsNote([{ day: '2026-10-09', label: '980 + 110 Genesis Crystals' }])).toBe('One 980 + 110 pack, on 9 October.')
    expect(
      packsNote([{ day: '2026-10-09', label: '980 + 110 Genesis Crystals' }, { day: '2026-10-20', label: '3280 + 600 Genesis Crystals' }]),
    ).toBe('Two packs: 980 + 110 on 9 October and 3280 + 600 on 20 October.')
  })

  test('the Welkin Moon: which of its 30 days today is', () => {
    const single = { start: '2026-10-01', end: '2026-10-30', days: 30 }
    const card = welkinCard(single, '2026-10-22')
    expect(card.head).toBe('Day 22 of 30.')
    expect(card.cells?.filter((cell) => cell.state === 'passed')).toHaveLength(21)
    expect(card.cells?.[21].state).toBe('today')
    expect(card.cells?.filter((cell) => cell.state === 'to-come')).toHaveLength(8)
    expect(card.note).toBe('Bought on 1 October: 300 crystals then, and 90 primogems every day until 30 October.')
    expect(welkinCard(single, '2026-10-30').head).toBe('Day 30 of 30.')
    expect(welkinCard(single, '2026-10-31').cells).toBeNull()
    expect(welkinCard(null, '2026-10-31').head).toBe('No Welkin Moon running.')
    expect(welkinCard(single, '2026-09-30').head).toBe('No Welkin Moon running.')
  })

  test('a Welkin bought while one runs follows it: the card counts the 30 that today is in and says another follows', () => {
    // Bought on 1 October and again on the 25th: 60 days, to 29 November.
    const stacked = { start: '2026-10-01', end: '2026-11-29', days: 60 }
    const first = welkinCard(stacked, '2026-10-26')
    expect(first.head).toBe('Day 26 of 30.')
    expect(first.note).toBe('Bought on 1 October: 300 crystals then, and 90 primogems every day until 30 October. Another follows it: 90 primogems a day until 29 November.')
    const second = welkinCard(stacked, '2026-11-02')
    expect(second.head).toBe('Day 3 of 30.')
    expect(second.cells?.[2].state).toBe('today')
    expect(second.note).toBe('Running since 1 October: 90 primogems every day until 29 November.')
    expect(welkinCard(stacked, '2026-11-29').head).toBe('Day 30 of 30.')
    expect(welkinCard(stacked, '2026-11-30').cells).toBeNull()
  })

  test('a Welkin bought after the last ran out is a block of its own', () => {
    const own = { start: '2026-10-05', end: '2026-11-03', days: 30 }
    expect(welkinCard(own, '2026-10-05').head).toBe('Day 1 of 30.')
    expect(welkinCard(own, '2026-10-13').note).toBe('Bought on 5 October: 300 crystals then, and 90 primogems every day until 3 November.')
  })
})

describe('Resin', () => {
  const days = [
    resin('2026-10-01', { domain: 80, ley: 20 }, { domain: 4, ley: 1 }),
    resin('2026-10-02', { domain: 120, boss: 40, condensed: 40 }, { domain: 6, boss: 1, condensed: 1 }),
    resin('2026-10-03', {}),
    resin('2026-10-04', {}, {}, false),
  ]

  test('the bars are the resin spent, in gold', () => {
    expect(resinBars(days).map((bar) => bar.up[0].value)).toEqual([100, 200, 0, 0])
  })

  test('the big number is the resin spent over the days known, and the average', () => {
    const head = resinHead(days, null, 'month', 'October')
    expect(head).toMatchObject({ label: 'Resin spent', amount: '300', unit: 'resin' })
    expect(text(head.line)).toBe('−300 over 3 days of October, about 100 a day')
    expect(text(resinHead(days, null, 'week', 'October').line)).toBe('−300 over the last 7 days, about 100 a day')
    expect(head.note).toContain('No resin balance is kept')
  })

  test('the pointer names the runs', () => {
    expect(text(resinHead(days, 1, 'month', 'October').line)).toBe('−200 spent that day · 6 domain runs, 1 boss, 1 condensed craft')
    expect(text(resinHead(days, 2, 'month', 'October').line)).toBe('No resin spent that day.')
    expect(text(resinHead(days, 3, 'month', 'October').line)).toBe('No record of this day')
    expect(resinHead(days, 3, 'month', 'October')).toMatchObject({ amount: '—', unit: '' })
    const none = [resin('2026-10-04', {}, {}, false)]
    expect(resinHead(none, null, 'month', 'October')).toMatchObject({ amount: '—', unit: '' })
    expect(text(resinHead(none, null, 'month', 'October').line)).toBe('No record of these days')
    expect(resinHead([], null, 'week', 'October').amount).toBe('—')
    expect(runsWords(days[0])).toBe('4 domain runs, 1 ley line')
  })

  test('where it went: by use, the largest first, with the days it covers', () => {
    const card = resinWhere(days, TODAY)
    expect(card.items.map((item) => [item.name, item.value])).toEqual([['Domains', 200], ['Bosses', 40], ['Condensed Resin', 40], ['Ley Lines', 20]]) // a tie keeps the order of the uses
    expect(card.total).toBe(300)
    expect(card.foot).toEqual({ ring: 'plain', label: '3 days of October', value: '−300' })
  })

  test('against the 180 a day', () => {
    const card = resinAgainst(days, TODAY)
    expect(card).toMatchObject({ head: 'You spent 56% of what regrew.', spent: 300, regrown: 540, days: 3 })
    expect(card.rows).toEqual([
      { label: 'Busiest day', value: '200 · 2 Oct' },
      { label: 'Days at 140 or more', value: '1 of 3' },
      { label: 'Days under 100', value: '1 of 3' },
    ])
    expect(resinAgainst([], TODAY).head).toBe('Nothing recorded this month yet.')
  })

  test('the domain run most', () => {
    const card = resinMost(LEDGER_FIXTURE.resin_month)
    expect(card.head).toBe('Valley of Remembrance, 32 runs.')
    expect(card.rows).toHaveLength(4)
    expect(card.rows[0].width).toBe(100)
    expect(card.note).toBe('83 domain runs in all, 1,660 resin. 71 of them were artifact domains.')
    expect(resinMost({ domains: [], domain_runs: 0, artifact_runs: 0, weekly: { cheap: 0, full: 0, other: 0 } }).head).toBe('No domain run this month.')
  })

  test('the bosses: the normal ones and the weekly ones, each with its runs, its resin and its share of the month', () => {
    const month = [
      resin('2026-10-01', { domain: 80, boss: 40 }, { domain: 4, boss: 1 }),
      resin('2026-10-02', { weekly: 30, boss: 40, ley: 10 }, { weekly: 1, boss: 1, ley: 1 }),
      resin('2026-10-03', { weekly: 60 }, { weekly: 1 }),
      resin('2026-10-04', { domain: 40 }, { domain: 2 }, false), // not known: left out
    ]
    const card = resinBosses(month, { cheap: 1, full: 1, other: 0 }, TODAY)
    expect(card.head).toBe('4 boss runs, 170 resin.')
    expect(card.rows).toEqual([
      { label: 'Bosses, 40 resin each', value: '2 runs · 80 resin · 31%' },
      { label: 'Weekly bosses, 30 or 60', value: '2 runs · 90 resin · 35%' },
    ])
    expect(card.note).toBe('1 of the weekly runs cost 30 instead of 60, 30 resin less than the full price.')
    expect(resinBosses(LEDGER_FIXTURE.resin_days, LEDGER_FIXTURE.resin_month.weekly, TODAY).rows[0].value).toMatch(/^6 runs · 240 resin/)
  })

  test('with no boss this month the sentence leads under the heading and the rows say 0, so the card is never an empty panel', () => {
    const card = resinBosses([resin('2026-10-01', { domain: 80 }, { domain: 4 })], { cheap: 0, full: 0, other: 0 }, TODAY)
    expect(card.head).toBe('No boss run this month yet.')
    expect(card.rows.map((row) => row.value)).toEqual(['0 runs · 0 resin · 0%', '0 runs · 0 resin · 0%'])
    expect(card.note).toBe('')
    expect(resinBosses([], { cheap: 0, full: 0, other: 0 }, TODAY).rows).toHaveLength(2)
  })
})

describe('Artifacts', () => {
  const month: Ledger['artifact_month'] = {
    domains: [{ name: 'Valley of Remembrance', five: 3, runs: 6 }, { name: 'Momiji-Dyed Court', five: 1, runs: 4 }, { name: 'Slumbering Court', five: 0, runs: 2 }],
    runs: 12, five_domain: 4, per_run: 0.33, typical: 1.07,
  }
  const days = [
    artifact('2026-10-01', 2, 0, 0, 0, ['Flower', 'Plume']),
    artifact('2026-10-02', 1, 1, 1, 0, ['Sands', 'Goblet']),
    artifact('2026-10-03', 1, 0, 1, 2, ['Circlet', 'x', 'y'].slice(0, 1)),
    artifact('2026-10-04', 0, 0, 0, 0, [], false),
  ]

  test('the bars: from domains in gold, from elsewhere in taupe', () => {
    expect(artifactBars(days)[1].up).toEqual([{ value: 1, color: 'var(--fill)' }, { value: 1, color: 'var(--src-other)' }])
  })

  test('the big number counts the five-stars that came in, with the luck line', () => {
    const head = artifactHead(days, null, 'month', 'October', month)
    expect(head).toMatchObject({ label: 'Five-star artifacts', amount: '5', unit: 'five-stars' })
    expect(text(head.line)).toBe('+4 from domains, +1 from elsewhere and −4 fed or salvaged in October')
    expect(text(head.luck ?? [])).toBe('0.33 five-stars per domain run this month · a typical run gives about 1.07')
    expect(artifactHead(days, null, 'month', 'October', { ...month, per_run: null }).luck).toBeNull()
  })

  test('nothing used up reads 0, never −0', () => {
    const none = [artifact('2026-10-01', 1)]
    expect(text(artifactHead(none, null, 'month', 'October', month).line)).toBe('+1 from domains, 0 from elsewhere and 0 fed or salvaged in October')
    expect(artifactWhere(none, month, TODAY).foot.value).toBe('0')
    expect(resinWhere([resin('2026-10-01', {})], TODAY).foot.value).toBe('0')
  })

  test('the pointer names the day’s artifacts', () => {
    expect(text(artifactHead(days, 1, 'month', 'October', month).line)).toBe('+1 from domains and +1 from elsewhere · Sands, Goblet')
    const many = [artifact('2026-10-01', 3, 0, 0, 0, ['A', 'B', 'C'])]
    expect(text(artifactHead(many, 0, 'month', 'October', month).line)).toBe('+3 from domains · A, B and 1 more')
    expect(text(artifactHead([artifact('2026-10-05')], 0, 'month', 'October', month).line)).toBe('No five-star artifacts that day.')
    expect(text(artifactHead(days, 3, 'month', 'October', month).line)).toBe('No record of this day')
    expect(artifactHead(days, 3, 'month', 'October', month)).toMatchObject({ amount: '—', unit: '' })
    const none = [artifact('2026-10-04', 0, 0, 0, 0, [], false)]
    expect(artifactHead(none, null, 'month', 'October', month)).toMatchObject({ amount: '—', unit: '' })
    expect(text(artifactHead(none, null, 'month', 'October', month).line)).toBe('No record of these days')
  })

  test('where they came from: the domains that gave five-stars, then elsewhere, with those used up at the foot', () => {
    const card = artifactWhere(days, month, TODAY)
    expect(card.items.map((item) => [item.name, item.value])).toEqual([['Valley of Remembrance', 3], ['Momiji-Dyed Court', 1], ['Elsewhere', 1]])
    expect(card.total).toBe(5)
    expect(card.foot).toEqual({ ring: 'bad', label: 'Fed or salvaged', value: '−4' })
  })

  test('what became of them: kept is what came less what was used, never below nothing', () => {
    const card = artifactBecame(days, TODAY)
    expect(card).toMatchObject({ got: 5, used: 4, kept: 1, sub: 'The 5 five-stars of October' })
    expect(card.items.map((item) => [item.key, item.value])).toEqual([['kept', 1], ['fed', 2], ['salvaged', 2]])
    expect(card.items.map((item) => item.share)).toEqual([20, 40, 40])
    const over = artifactBecame([artifact('2026-10-01', 1, 0, 3, 0)], TODAY)
    expect(over.kept).toBe(0)
    expect(over.note).toContain('More were used up than came in')
  })

  test('the domain that gave the most, and the luck against a typical run', () => {
    const top = artifactTop(month)
    expect(top.head).toBe('Valley of Remembrance, 3 five-stars.')
    expect(top.rows.map((row) => row.name)).toEqual(['Valley of Remembrance', 'Momiji-Dyed Court'])
    expect(top.note).toBe('6 runs, 0.50 five-stars a run.')
    const luck = artifactLuck(days, month, TODAY)
    expect(luck.head).toBe('0.33 five-stars per run.')
    expect(luck.bars.map((bar) => bar.value)).toEqual(['0.33', '1.07'])
    expect(luck.rows).toEqual([
      { label: 'Runs of artifact domains', value: '12' },
      { label: 'Five-stars from them', value: '4' },
      { label: 'Five-stars from elsewhere', value: '1' },
    ])
    expect(luck.note).toBe('12 typical runs give about 13.')
    expect(artifactLuck(days, { ...month, per_run: null }, TODAY).head).toBe('No artifact domain run this month.')
  })

  test('the resin for each five-star counts 20 a run', () => {
    const cost = artifactCost(month, [resin('2026-10-01', { domain: 240 }), resin('2026-10-02', { domain: 120, ley: 20 })], TODAY)
    expect(cost.head).toBe('About 60 resin for each.')
    expect(cost.rows).toEqual([
      { label: 'Artifact domain runs', value: '12' },
      { label: 'Resin they cost', value: '240' },
      { label: 'Five-stars from them', value: '4' },
    ])
    expect(cost.note).toBe('Counted in Resin too, among the 360 resin spent on domains.')
    expect(artifactCost({ ...month, five_domain: 0 }, [], TODAY).head).toBe('No five-star from a domain yet.')
  })
})
