import { expect, test } from 'vitest'
import type { PityCard } from './types.ts'

test("a card's guarantee can be none, for the standard wish, which has no featured item to be guaranteed", () => {
  // tsc checks each of these against the type, as it checks the rest of the app when the interface is built.
  const guarantees = ['guaranteed', 'fifty', 'unknown', 'none'] as const satisfies readonly PityCard['guarantee'][]
  expect(new Set(guarantees).size).toBe(4)
})
