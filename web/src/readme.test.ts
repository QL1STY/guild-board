import { describe, expect, it } from 'vitest'

import readme from '../../README.md?raw'
import { FAN_MADE, GALLERY_HANDS_OFF, HANDS_OFF, LEDGER_HANDS_OFF, RISK, WHAT_IS_READ } from './texts.ts'

// The README says what Guild Board reads, never does and risks in the first run's own words, so the two cannot drift apart.

describe('the README', () => {
  it('says that Guild Board is fan-made', () => {
    expect(readme).toContain(FAN_MADE)
  })

  it('names, word for word, what is read and what is never done', () => {
    for (const line of [...WHAT_IS_READ, ...HANDS_OFF, LEDGER_HANDS_OFF, GALLERY_HANDS_OFF]) expect(readme).toContain(line)
  })

  it('states the risk, word for word', () => {
    for (const paragraph of RISK) expect(readme).toContain(paragraph)
  })
})
