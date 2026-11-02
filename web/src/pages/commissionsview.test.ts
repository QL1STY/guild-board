import { describe, expect, it } from 'vitest'
import {
  appearedLine, chainLine, hoyolabLine, lookingFor, partDone, placeCards, regionLine,
} from './commissionsview.ts'
import type { Commission, CommissionsModel } from '../types.ts'

const commission = (over: Partial<Commission>): Commission => ({
  id: 84510, name: 'Love Is All Around', description: 'Help Zhihua find 5 signs.', reward: 5, quests: ['Good Sign'],
  parts: [], order: false, next_part: null, how: null, first: null, status: 'not_started', pinned: false,
  appeared_today: false, last_appeared: null, ...over,
})

/** An instant given in this PC's own time, as the page shows times: month 9 is October. */
const local = (month: number, date: number, hours: number, minutes: number): Date =>
  new Date(2026, month, date, hours, minutes)

describe("HoYoLAB's count", () => {
  it("reads as today's finished commissions, with the time it was read in this PC's time", () => {
    const at = (hours: number, minutes: number) => local(9, 20, hours, minutes).toISOString()
    expect(hoyolabLine({ done: 2, of: 4, at: at(11, 30) })).toBe('HoYoLAB: 2 of 4 done, at 11:30')
    expect(hoyolabLine({ done: 0, of: 4, at: at(9, 5) })).toBe('HoYoLAB: 0 of 4 done, at 09:05')
  })

  it('shows nothing without a count read in this game day', () => {
    expect(hoyolabLine(null)).toBeNull()
  })
})

describe('the line that says where a chain is', () => {
  const done = local(9, 15, 18, 0).toISOString()
  const signs = (...doneAt: (string | null)[]): Commission['parts'] =>
    ['Seeing that Granny Shan has good business', 'Leaving the pigeons alone', 'Leaving the dogs alone'].map(
      (name, index) => ({ index, name, done_at: doneAt[index] ?? null }),
    )

  it('names the part the chain is at, from the parts done, while it is under way', () => {
    const chain = commission({ order: true, parts: signs(done), next_part: 1 })
    expect(chainLine(chain)).toBe('At part 2 of 3: Leaving the pigeons alone')
    // A later part done before its turn: the chain still waits for the second.
    expect(chainLine({ ...chain, parts: signs(done, null, done) })).toBe('At part 2 of 3: Leaving the pigeons alone')
  })

  it('counts a chain marked in progress as under way from its first part', () => {
    const marked = commission({ order: true, parts: signs(), next_part: 0, status: 'in_progress' })
    expect(chainLine(marked)).toBe('At part 1 of 3: Seeing that Granny Shan has good business')
  })

  it('says nothing before the chain begins, once every part is done, for a done achievement, or without a chain', () => {
    expect(chainLine(commission({ order: true, parts: signs(), next_part: 0 }))).toBeNull()
    expect(chainLine(commission({ order: true, parts: signs(done, done, done), next_part: null }))).toBeNull()
    expect(chainLine(commission({ order: true, parts: signs(done), next_part: 1, status: 'done' }))).toBeNull()
    // Parts done in any order have no next one.
    expect(chainLine(commission({ order: false, parts: signs(done), next_part: null }))).toBeNull()
  })
})

describe('when the commission last appeared', () => {
  it('says Appeared today., the game day it last appeared, or that it was not seen yet', () => {
    expect(appearedLine(commission({ appeared_today: true, last_appeared: '2026-10-15' }))).toBe('Appeared today.')
    expect(appearedLine(commission({ last_appeared: '2026-10-15' }))).toBe('Last appeared 15 Oct.')
    expect(appearedLine(commission({ last_appeared: '2026-09-03' }))).toBe('Last appeared 3 Sep.')
    expect(appearedLine(commission({}))).toBe('Not seen yet.')
  })
})

describe('when a part was done', () => {
  it("is the day in this PC's time", () => {
    expect(partDone(local(9, 15, 18, 0).toISOString())).toBe('done 15 Oct')
    expect(partDone(local(9, 15, 0, 5).toISOString())).toBe('done 15 Oct')
    expect(partDone(local(10, 2, 23, 55).toISOString())).toBe('done 2 Nov')
  })
})

describe('where the cards show', () => {
  const [one, two, three, four] = [1, 2, 3, 4].map((id) => commission({ id, name: `Card ${id}` }))
  const ticked = (card: Commission): Commission => ({ ...card, status: 'done' })
  const ids = ({ above, fold }: { above: Commission[]; fold: Commission[] }) => ({
    above: above.map((card) => card.id),
    fold: fold.map((card) => card.id),
  })

  it('puts every card where the model has it while nothing is kept', () => {
    const model = { cards: [one, three], done: [ticked(two), ticked(four)] }
    expect(ids(placeCards(model, { above: [1, 2, 3], fold: [4] }, []))).toEqual({ above: [1, 3], fold: [2, 4] })
    expect(ids(placeCards(model, { above: [], fold: [] }, [2]))).toEqual({ above: [1, 3], fold: [2, 4] }) // never shown
  })

  it('keeps a card ticked since the player moved on in its place, with the fresh data, and out of the fold', () => {
    const model = { cards: [one, three], done: [ticked(two), ticked(four)] }
    const shown = placeCards(model, { above: [1, 2, 3], fold: [4] }, [2])
    expect(ids(shown)).toEqual({ above: [1, 2, 3], fold: [4] })
    expect(shown.above[1].status).toBe('done')
  })

  it('keeps a card unticked in the fold in its place there', () => {
    const shown = placeCards({ cards: [one, two, four], done: [ticked(three)] }, { above: [1, 2], fold: [3, 4] }, [4])
    expect(ids(shown)).toEqual({ above: [1, 2], fold: [3, 4] })
  })

  it('keeps several in their order, the first card first', () => {
    const model = { cards: [three], done: [ticked(one), ticked(two), ticked(four)] }
    expect(ids(placeCards(model, { above: [1, 2, 3], fold: [4] }, [2, 1]))).toEqual({ above: [1, 2, 3], fold: [4] })
  })

  it('lets go of a kept card the model no longer has, and shows a card changed elsewhere where the model has it', () => {
    // Card 2 is gone from the list, and card 4 was unticked elsewhere.
    const model = { cards: [one, four], done: [ticked(three)] }
    expect(ids(placeCards(model, { above: [1, 2, 3], fold: [4] }, [2, 3]))).toEqual({ above: [1, 3, 4], fold: [] })
  })
})

describe('the commissions to look for', () => {
  const card = (id: number, quests: string[], status: Commission['status'] = 'not_started'): Commission =>
    commission({ id, name: `Card ${id}`, quests, status })

  it("are the model's while every card shows where the model has it", () => {
    const above = [card(1, ['Good Sign']), card(2, ['The Lost Relic', 'A Little Raid'], 'in_progress')]
    const model = { looking_for: ['A Little Raid', 'Good Sign', 'The Lost Relic'] }
    expect(lookingFor(model, above)).toEqual(['A Little Raid', 'Good Sign', 'The Lost Relic'])
  })

  it('leave out those of a card unticked in the fold, which stays there until the player moves on', () => {
    // Card 3, unticked, still shows in the fold: Cliffhanger waits for it to show above the fold.
    const above = [card(1, ['Good Sign']), card(2, ['A Little Raid'])]
    expect(lookingFor({ looking_for: ['A Little Raid', 'Cliffhanger', 'Good Sign'] }, above))
      .toEqual(['A Little Raid', 'Good Sign'])
  })

  it('leave out those of a card ticked above the fold, unless a card there still to do names them', () => {
    // Card 1, ticked, still shows above the fold; Good Sign is the model's for card 4, unticked in the fold.
    const above = [card(1, ['Good Sign'], 'done'), card(2, ['Cliffhanger']), card(3, ['A Little Raid'], 'done')]
    expect(lookingFor({ looking_for: ['Cliffhanger', 'Good Sign'] }, above)).toEqual(['Cliffhanger'])
    const named = [...above, card(5, ['Good Sign'])]
    expect(lookingFor({ looking_for: ['Cliffhanger', 'Good Sign'] }, named)).toEqual(['Cliffhanger', 'Good Sign'])
  })

  it("are the model's when no card still to do above the fold names one, so that none means there is none", () => {
    expect(lookingFor({ looking_for: ['How to Make Friends'] }, [])).toEqual(['How to Make Friends'])
    const ticked = [card(1, ['Prophets of Pop'], 'done')]
    expect(lookingFor({ looking_for: ['How to Make Friends'] }, ticked)).toEqual(['How to Make Friends'])
    expect(lookingFor({ looking_for: [] }, ticked)).toEqual([])
  })
})

describe("the line for a region whose cards are all done or that has none", () => {
  const regions: CommissionsModel['regions'] = [
    { key: 'fontaine', name: 'Fontaine', left: 0 },
    { key: 'natlan', name: 'Natlan', left: 0 },
    { key: 'liyue', name: 'Liyue', left: 1 },
  ]
  const done = commission({ status: 'done' })

  it('says that Guild Board knows none there yet, or that every one is done', () => {
    expect(regionLine({ region: 'fontaine', regions, cards: [], done: [] }))
      .toBe('Guild Board knows no commission achievements in Fontaine yet.')
    expect(regionLine({ region: 'natlan', regions, cards: [], done: [done] }))
      .toBe('Every commission achievement in Natlan is done.')
  })

  it('says nothing while one is left', () => {
    expect(regionLine({ region: 'liyue', regions, cards: [commission({})], done: [done] })).toBeNull()
  })
})
