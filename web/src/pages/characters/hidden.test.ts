import { describe, expect, it } from 'vitest'
import type { Status } from '../../types.ts'
import { endgameShown, placeWhileHidden, verdictShown } from './hidden.ts'

describe('endgameShown', () => {
  it('is on only when the core says so: not before it has answered, and not for a core that does not say', () => {
    expect(endgameShown({ endgame: true } as Status)).toBe(true)
    expect(endgameShown({ endgame: false } as Status)).toBe(false)
    expect(endgameShown(null)).toBe(false)
    expect(endgameShown({} as Status)).toBe(false)
  })
})

describe('placeWhileHidden', () => {
  it("sends the Endgame tab's address to the roster, and no other address anywhere", () => {
    expect(placeWhileHidden('#/characters/endgame')).toBe('#/characters')
    expect(placeWhileHidden('#/characters/endgame/')).toBe('#/characters')
    expect(placeWhileHidden('#/characters')).toBeNull()
    expect(placeWhileHidden('#/characters/sandrone')).toBeNull()
    expect(placeWhileHidden('#/characters/sandrone/plan')).toBeNull()
    expect(placeWhileHidden('#/plan')).toBeNull()
    expect(placeWhileHidden('#/week')).toBeNull() // Your week's address moved to the Plan page (route.ts)
    expect(placeWhileHidden('#/board')).toBeNull()
  })
})

describe('verdictShown', () => {
  it('is on only when the core says so: not before it has answered, and not for a core that does not say', () => {
    expect(verdictShown({ verdict: true } as Status)).toBe(true)
    expect(verdictShown({ verdict: false } as Status)).toBe(false)
    expect(verdictShown(null)).toBe(false)
    expect(verdictShown({} as Status)).toBe(false)
  })
})
