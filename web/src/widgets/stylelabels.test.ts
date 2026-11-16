import { describe, expect, it } from 'vitest'
import { CLOCK_STYLES } from './clockview.ts'
import { ENDGAME_STYLES } from './endgameview.ts'
import { NEXT_UP_STYLES } from './nextupview.ts'
import { PLAY_STYLES } from './playtimeview.ts'

// The four style pickers (Next up, Clock, Endgame resets, Playtime) word their options alike: a short name and a line under
// it, each starting with a capital letter and ending with no full stop.
const PICKERS = {
  'Next up': NEXT_UP_STYLES.map(({ name, about }) => ({ name, about })),
  Clock: CLOCK_STYLES.map(({ name, about }) => ({ name, about })),
  'Endgame resets': ENDGAME_STYLES.map(({ name, about }) => ({ name, about })),
  Playtime: PLAY_STYLES.map(({ name, about }) => ({ name, about })),
}

describe('the labels of the style pickers', () => {
  for (const [picker, options] of Object.entries(PICKERS)) {
    it(`${picker} words its options in sentence case, with no full stop`, () => {
      for (const { name, about } of options) {
        for (const text of [name, about]) {
          expect(text, text).toMatch(/^[A-Z]/)
          expect(text, text).not.toMatch(/[.:;]$/)
        }
      }
    })
  }
})
