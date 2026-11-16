import { describe, expect, it } from 'vitest'
import type { BoardModel } from '../types.ts'
import { PLAY_STYLES, playStyle, playTotal } from './playtimeview.ts'

const play = (over: Partial<BoardModel['playtime']> = {}): BoardModel['playtime'] => ({
  running: false, session_started_at: null, today_minutes: 0, week: [], total_minutes: null, counting_since: null, ...over,
})
// Noon UTC lands on the same calendar day on every PC from UTC-12 to UTC+11.
const SINCE = '2025-10-03T12:00:00Z'

describe('the Playtime style', () => {
  it('is the quiet figures when none is saved, and for a style it does not know', () => {
    expect(playStyle({})).toBe('quiet')
    expect(playStyle({ style: 'gold' })).toBe('quiet')
    expect(playStyle({ style: 'plate' })).toBe('plate')
    expect(PLAY_STYLES.map((one) => one.id)).toEqual(['quiet', 'plate'])
  })
})

describe('the time in all', () => {
  it('has no total before Guild Board counted a session, or when the start is not known', () => {
    expect(playTotal(play())).toBeNull()
    expect(playTotal(play({ total_minutes: 90 }))).toBeNull()
    expect(playTotal(play({ counting_since: SINCE }))).toBeNull()
  })

  it('says the hours counted, with thousands apart, and from when Guild Board counted', () => {
    expect(playTotal(play({ total_minutes: 412 * 60 + 20, counting_since: SINCE }))).toEqual({
      value: '412', unit: 'h', since: '3 Oct 2025',
      line: '412 h in all · counted since 3 Oct 2025',
      spoken: '412 hours in all, counted by Guild Board since 3 Oct 2025',
    })
    expect(playTotal(play({ total_minutes: 1234 * 60, counting_since: SINCE }))!.value).toBe('1,234')
  })

  it('says minutes under an hour, and one hour as one', () => {
    expect(playTotal(play({ total_minutes: 35, counting_since: SINCE }))).toMatchObject({
      value: '35', unit: 'min', line: '35 min in all · counted since 3 Oct 2025',
      spoken: '35 minutes in all, counted by Guild Board since 3 Oct 2025',
    })
    expect(playTotal(play({ total_minutes: 61, counting_since: SINCE }))).toMatchObject({
      value: '1', unit: 'h', spoken: '1 hour in all, counted by Guild Board since 3 Oct 2025',
    })
  })

  it('counts nothing as no total, since nothing was played that Guild Board saw', () => {
    expect(playTotal(play({ total_minutes: 0, counting_since: SINCE }))).toBeNull()
  })
})
