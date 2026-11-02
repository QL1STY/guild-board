import { expect, test } from 'vitest'
import { asksLogin, loginOffer, primogemsOf, primogemsText, resultText } from './codesview.ts'

test('asksLogin offers the login without one, and when HoYoverse refused the saved one', () => {
  const model = { needs_login: false, progress: [{ state: 'redeemed' }] }
  expect(asksLogin(model)).toBe(false)
  expect(asksLogin({ ...model, needs_login: true })).toBe(true)
  expect(asksLogin({ ...model, progress: [{ state: 'login' }] })).toBe(true)
})

test('loginOffer puts the box first until a code has gone through or a login has finished', () => {
  const model = { needs_login: false, login_first: false, progress: [{ state: 'redeemed' }] }
  expect(loginOffer(model)).toBeNull()
  expect(loginOffer({ ...model, login_first: true })).toBe('box')
  // Even with no saved login at all, the box is the one offer, not a second button beside it.
  expect(loginOffer({ ...model, login_first: true, needs_login: true })).toBe('box')
  // Once past the first code, the old offers stay: none saved, or the saved one refused for a code.
  expect(loginOffer({ ...model, needs_login: true })).toBe('button')
  expect(loginOffer({ ...model, progress: [{ state: 'login' }] })).toBe('button')
})

test('resultText gives the texts of the core for each result', () => {
  expect(resultText('redeemed')).toBe('Redeemed')
  expect(resultText('already')).toBe('Already redeemed on this account')
  expect(resultText('expired')).toBe('Expired')
  expect(resultText('invalid')).toBe('Not a valid code')
  expect(resultText('low_ar')).toBe('Adventure Rank too low')
  expect(resultText('login')).toBe('Log in again to redeem codes')
  expect(resultText('failed')).toBe('HoYoverse did not answer, try again')
})

test('resultText names the two states of a run and leaves a settled text as it is', () => {
  expect(resultText('waiting')).toBe('Waiting')
  expect(resultText('sending')).toBe('Sending')
  expect(resultText('You redeemed this code on 26 Oct.')).toBe('You redeemed this code on 26 Oct.')
})

test('primogemsText groups thousands', () => {
  expect(primogemsText(2340)).toBe('2,340')
  expect(primogemsText(0)).toBe('0')
})

test('primogemsOf takes a whole number from 0 to 100,000 and nothing else', () => {
  expect(primogemsOf('50')).toBe(50)
  expect(primogemsOf('0')).toBe(0)
  expect(primogemsOf('100000')).toBe(100000)
  for (const bad of ['', ' ', '-1', '1.5', '100001', 'abc']) expect(primogemsOf(bad), bad).toBeNull()
})
