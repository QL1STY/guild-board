import { expect, test } from 'vitest'

import { LEDGER_FIXTURE } from './ledgertypes.ts'

test('the fixture October adds up with itself', () => {
  const { days, month, commissions, wishes } = LEDGER_FIXTURE
  expect(days).toHaveLength(31)
  expect(days.reduce((sum, day) => sum + day.earned, 0)).toBe(month.earned)
  expect(days.reduce((sum, day) => sum + day.spent, 0)).toBe(month.out)
  expect(month.sources.reduce((sum, source) => sum + source.amount, 0)).toBe(month.earned)
  expect(Object.values(month.previous.sources).reduce((sum, amount) => sum + amount, 0)).toBe(month.previous.earned)
  expect(Math.floor(month.earned / 160)).toBe(wishes.earned)
  expect(commissions.days.filter((day) => day.state === 'missed')).toHaveLength(commissions.missed)
  expect(days[30].held).toBe(10255)
  expect(days[29].held).toBe(10255 - days[30].earned + days[30].spent)
})

test("the fixture's own today is the 31st: its days run to it, its streak counts back from it, and none after it is still to come", () => {
  const { days, commissions } = LEDGER_FIXTURE
  const today = days[days.length - 1].day
  expect(today).toBe('2026-10-31')
  expect(commissions.days.filter((day) => day.day > today)).toEqual([])
  expect(commissions.days.some((day) => day.state === 'future')).toBe(false)
  // 25 October was missed and 26 to 31 were done: the streak of 6 is counted back from the 31st; 10 to 24 is the longest, 15
  let streak = 0
  for (let index = commissions.days.length - 1; index >= 0 && commissions.days[index].state === 'done'; index -= 1) streak += 1
  expect(streak).toBe(commissions.streak_now)
  expect(commissions.days.slice(9, 24).every((day) => day.state === 'done')).toBe(true)
  expect(commissions.longest).toBe(15)
})
