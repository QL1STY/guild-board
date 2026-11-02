import { num } from '../format.ts'

/*
 * The texts of the Codes page. Pure: the page only lays them out. The texts of the results are the core's (codes.py,
 * RESULT_TEXT); the core sends them too, and these serve a result key the page has only the key of.
 */

const RESULTS: Record<string, string> = {
  redeemed: 'Redeemed',
  already: 'Already redeemed on this account',
  expired: 'Expired',
  invalid: 'Not a valid code',
  low_ar: 'Adventure Rank too low',
  login: 'Log in again to redeem codes',
  failed: 'HoYoverse did not answer, try again',
  waiting: 'Waiting',
  sending: 'Sending',
}

/** The text of a result key or a run's state; a text that is none of them (a settled code's) stays as it is. */
export function resultText(result: string): string {
  return RESULTS[result] ?? result
}

/** What the page says of a primogems entry the core would refuse. */
export const PRIMOGEMS_NOTE = 'Enter a whole number from 0 to 100,000.'

/** The primogems a field holds: a whole number from 0 to 100,000, else null. */
export function primogemsOf(text: string): number | null {
  const value = Number(text)
  return text.trim() !== '' && Number.isInteger(value) && value >= 0 && value <= 100_000 ? value : null
}

/**
 * Whether the page offers the login: with none saved, and also when HoYoverse refused the saved one for a code. The
 * cookie codes need can go stale while the rest of the login still syncs, so a login that exists may still need renewing.
 */
export function asksLogin(model: { needs_login: boolean; progress: { state: string }[] }): boolean {
  return model.needs_login || model.progress.some((step) => step.state === 'login')
}

/**
 * What the page offers for a login. The box above the field comes first, until a code has gone through or a login has
 * finished (the core's login_first), and the field is shut meanwhile; the button after a refused code stays as it was.
 */
export function loginOffer(model: {
  needs_login: boolean
  login_first: boolean
  progress: { state: string }[]
}): 'box' | 'button' | null {
  if (model.login_first) return 'box'
  return asksLogin(model) ? 'button' : null
}

/** 2340 -> "2,340" */
export function primogemsText(count: number): string {
  return num(count)
}
