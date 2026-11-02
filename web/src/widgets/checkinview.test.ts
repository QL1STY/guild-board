import { describe, expect, it } from 'vitest'
import { iconOf, shownIndex, tileState } from './checkinview.ts'

const rewards = [
  { name: 'Primogem', amount: 20, icon: '' },
  { name: 'Mora', amount: 5000, icon: '' },
  { name: 'Primogem', amount: 20, icon: '' },
]

describe('the month of rewards', () => {
  it('offers the first day not claimed, while today is open', () => {
    const model = { claimed_days: 1, claimed_today: false }
    expect([0, 1, 2].map((index) => tileState(index, model))).toEqual(['claimed', 'today', 'coming'])
  })

  it('offers nothing once today is claimed', () => {
    const model = { claimed_days: 2, claimed_today: true }
    expect([0, 1, 2].map((index) => tileState(index, model))).toEqual(['claimed', 'claimed', 'coming'])
  })
})

describe('the reward shown large', () => {
  it("is the next one before the claim and the claimed one after it", () => {
    expect(shownIndex({ claimed_days: 1, claimed_today: false, rewards })).toBe(1)
    expect(shownIndex({ claimed_days: 2, claimed_today: true, rewards })).toBe(1)
  })

  it('is none past the end of the list', () => {
    expect(shownIndex({ claimed_days: 3, claimed_today: false, rewards })).toBeNull()
    expect(shownIndex({ claimed_days: 0, claimed_today: false, rewards: [] })).toBeNull()
  })
})

describe('a picture', () => {
  it('leaves the sign to show where there is none', () => {
    expect(iconOf('')).toBeNull()
    expect(iconOf('/api/checkin/icon/3')).toBe('/api/checkin/icon/3')
  })
})
