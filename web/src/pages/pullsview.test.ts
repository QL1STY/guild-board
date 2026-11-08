import { describe, expect, it } from 'vitest'
import { ringFill } from '../frame/freshview.ts'
import type { Banner, HistoryRow, NextVersion, PityCard, Pulls, PullsImportEvent, SavingsRow } from '../types.ts'
import {
  achievementsNote, autoLine, balanceWords, bannerLine, bannersBudget, bannersShown, cardForm, cardLabel, correctionLabel,
  endsIn, eventsCount, forecastLine, historyCaption, historyEmpty, historyPath, historyShown, importLine, importWithAuto, isCertain, isRunning, loginImportLine, luckTiles,
  pathWords, percent, pityWords, plannerName, plannerWhen, POOL_LABELS, emptyLine, pullsFresh, pullsRunning, resultWords, rowAmount, rowLabel, sharesPity, skyTitle,
  totalAmount, totalLine, typed, uidLine, verdict, versionAmount, versionOffers, versionTitle, planReason, wishReason, wishWhen,
} from './pullsview.ts'

/** An instant given in this PC's own time, as the page shows times: month 9 is October. */
const local = (month: number, date: number, hours: number, minutes: number): Date =>
  new Date(2026, month, date, hours, minutes)

/** The core's time in these tests: Saturday 24 October 2026, 08:00, in this PC's own time. */
const now = local(9, 24, 8, 0)

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * The demo's character event card (the Pulls plan, Task 5): pity 61 of 90, guaranteed after Qiqi's lost 50/50, its
 * history from 180 days before the demo's import.
 */
const character = (over: Partial<PityCard> = {}): PityCard => ({
  pool: 'character', pity: 61, known: true, hard: 90, soft: 74, four: 7, four_known: true, guarantee: 'guaranteed', path: null,
  last_five: { name: 'Qiqi', pity: 81, at: local(8, 2, 20, 0).toISOString() }, wishes: 219,
  correction: { pity: 0, guaranteed: false }, from: local(3, 16, 10, 0).toISOString(), ...over,
})

/** The demo's weapon event card: pity 23 of 80, a 75/25, Azurelight charted with no Fate Point. */
const weapon = (over: Partial<PityCard> = {}): PityCard =>
  character({
    pool: 'weapon', pity: 23, hard: 80, soft: 63, four: 3, guarantee: 'fifty',
    path: { item: 'Azurelight', points: 0, max: 1 }, last_five: null, wishes: 23, ...over,
  })

/** The demo's standard wish card: pity 44 of 90 after Wolf's Gravestone. It features nothing, so it has no guarantee. */
const standard = (over: Partial<PityCard> = {}): PityCard =>
  character({ pool: 'standard', pity: 44, four: 4, guarantee: 'none', wishes: 120, ...over })

/** The demo's chronicled wish card: pity 5 of 90, with no path chosen. */
const chronicled = (over: Partial<PityCard> = {}): PityCard =>
  character({
    pool: 'chronicled', pity: 5, four: 5, guarantee: 'fifty', path: { item: '', points: 0, max: 1 }, last_five: null,
    wishes: 5, ...over,
  })

describe('the time a banner has left', () => {
  const at = (ms: number) => new Date(now.getTime() + ms).toISOString()

  it('reads as the time left, with "ends" before it', () => {
    expect(endsIn(at(10 * DAY + 22 * HOUR + 5 * MINUTE), now)).toBe('ends in 10 d 22 h')
    expect(endsIn(at(3 * HOUR + 5 * MINUTE), now)).toBe('ends in 3 h 5 min')
    expect(endsIn(at(12 * MINUTE), now)).toBe('ends in 12 min')
  })

  it('says ended once the end has passed', () => {
    expect(endsIn(at(0), now)).toBe('ended')
    expect(endsIn(at(-MINUTE), now)).toBe('ended')
  })
})

describe("a pity card's words", () => {
  it('read the demo character card as the mockup does', () => {
    expect(pityWords(character())).toEqual({
      number: '61',
      of: 'of 90',
      soft: '13 to soft pity',
      four: '4★ in 3',
      tag: 'Next 5★ is the featured one',
    })
  })

  it('read the demo weapon card out of 80, with its own soft pity', () => {
    expect(pityWords(weapon())).toEqual({
      number: '23',
      of: 'of 80',
      soft: '40 to soft pity',
      four: '4★ in 7',
      tag: 'Next 5★ is a 75/25',
    })
  })

  it('say at least where the history cannot tell the pity, and never a number they do not know', () => {
    const words = pityWords(character({ known: false, pity: 40, guarantee: 'unknown' }))
    expect(words.number).toBe('at least 40')
    expect(words.tag).toBe('Guarantee not known')
    // At least 40 wishes since the last 5★: soft pity is at most 34 wishes away.
    expect(words.soft).toBe('at most 34 to soft pity')
    expect(pityWords(character({ known: false, pity: 80 })).soft).toBe('in soft pity') // at least 80 is in it
  })

  it('say in soft pity from the soft pity on', () => {
    expect(pityWords(character({ pity: 73 })).soft).toBe('1 to soft pity')
    expect(pityWords(character({ pity: 74 })).soft).toBe('in soft pity')
    expect(pityWords(character({ pity: 89 })).soft).toBe('in soft pity')
    expect(pityWords(weapon({ pity: 62 })).soft).toBe('1 to soft pity')
    expect(pityWords(weapon({ pity: 63 })).soft).toBe('in soft pity')
  })

  it('count down to the 4★ that comes at the latest every ten wishes', () => {
    expect(pityWords(character({ four: 9 })).four).toBe('4★ in 1')
    expect(pityWords(character({ four: 0 })).four).toBe('4★ in 10')
    expect(pityWords(character({ four: 10 })).four).toBe('4★ now')
    expect(pityWords(character({ four: 12 })).four).toBe('4★ now')
  })

  it('count down within the wishes since the window where the history holds no 4★ to count from (ruling R22)', () => {
    // The demo's chronicled wish: five wishes kept, none a 4★. The count is at least five, so a 4★ comes within five.
    expect(pityWords(chronicled({ four: 5, four_known: false })).four).toBe('4★ within 5')
    expect(pityWords(chronicled({ four: 0, four_known: false })).four).toBe('4★ within 10')
    expect(pityWords(chronicled({ four: 10, four_known: false })).four).toBe('4★ now')
    expect(pityWords(chronicled({ four: 5 })).four).toBe('4★ in 5') // a count the history knows
  })

  it("tag the character event's next 5★", () => {
    expect(pityWords(character({ guarantee: 'guaranteed' })).tag).toBe('Next 5★ is the featured one')
    expect(pityWords(character({ guarantee: 'fifty' })).tag).toBe('Next 5★ is a 50/50')
    expect(pityWords(character({ guarantee: 'unknown' })).tag).toBe('Guarantee not known')
  })

  it("tag the weapon event's next 5★, the Fate Point first", () => {
    const point = { item: 'Azurelight', points: 1, max: 1 as const }
    expect(pityWords(weapon({ path: point })).tag).toBe('Next 5★ is Azurelight')
    expect(pityWords(weapon({ path: point, guarantee: 'unknown' })).tag).toBe('Next 5★ is Azurelight')
    expect(pityWords(weapon({ guarantee: 'guaranteed' })).tag).toBe('Next 5★ is a featured weapon')
    expect(pityWords(weapon({ guarantee: 'fifty' })).tag).toBe('Next 5★ is a 75/25')
    expect(pityWords(weapon({ guarantee: 'unknown' })).tag).toBe('Guarantee not known')
    // A point names no weapon while none is charted.
    const uncharted = { item: '', points: 1, max: 1 as const }
    expect(pityWords(weapon({ path: uncharted, guarantee: 'guaranteed' })).tag).toBe('Next 5★ is a featured weapon')
  })

  it("tag the chronicled wish's next 5★ only once a path is chosen", () => {
    expect(pityWords(chronicled({ path: { item: 'Shenhe', points: 1, max: 1 } })).tag).toBe('Next 5★ is Shenhe')
    expect(pityWords(chronicled({ path: { item: 'Shenhe', points: 0, max: 1 } })).tag).toBe('Next 5★ is a 50/50')
    expect(pityWords(chronicled()).tag).toBeNull()
  })

  it('have no tag for the standard wish, which features nothing', () => {
    expect(pityWords(standard())).toEqual({
      number: '44',
      of: 'of 90',
      soft: '30 to soft pity',
      four: '4★ in 6',
      tag: null,
    })
  })

  it('have no tag for a wish with no guarantee, whatever its pool', () => {
    expect(pityWords(character({ guarantee: 'none' })).tag).toBeNull()
    expect(pityWords(weapon({ guarantee: 'none' })).tag).toBeNull()
  })
})

describe("a card's path", () => {
  it('reads the Epitomized Path with the charted weapon, or says none is charted', () => {
    expect(pathWords(weapon())).toBe('Epitomized Path 0 of 1 · Azurelight')
    expect(pathWords(weapon({ path: { item: 'Azurelight', points: 1, max: 1 } }))).toBe('Epitomized Path 1 of 1 · Azurelight')
    expect(pathWords(weapon({ path: { item: '', points: 0, max: 1 } }))).toBe('No weapon charted')
  })

  it("reads the chronicled wish's path, or says none is chosen", () => {
    expect(pathWords(chronicled({ path: { item: 'Shenhe', points: 1, max: 1 } }))).toBe('Path 1 of 1 · Shenhe')
    expect(pathWords(chronicled())).toBe('No path chosen')
  })

  it('is null for the character event and the standard wish', () => {
    expect(pathWords(character())).toBeNull()
    expect(pathWords(standard())).toBeNull()
  })
})

describe("a banner's line", () => {
  /** The demo's first banner, running, with the character card on it. */
  const banner = (over: Partial<Banner> = {}): Banner => ({
    ann_id: 1, name: "Void Star's Advent", pool: 'character', featured: ['Skirk'], art: null,
    starts_at: local(8, 23, 7, 0).toISOString(), ends_at: local(10, 3, 15, 59).toISOString(), running: true,
    pity: character(), ...over,
  })

  it('names the featured 5★ with your pity and guarantee', () => {
    expect(bannerLine(banner(), false, now)).toBe('Skirk · your pity 61 · guaranteed')
  })

  it('says the second character banner shares the same pity', () => {
    expect(bannerLine(banner({ name: 'La Chanson Cerise', featured: ['Escoffier'] }), true, now)).toBe(
      'Escoffier · shares the same pity',
    )
  })

  it('names both featured weapons with the pity', () => {
    const epitome = banner({
      name: 'Epitome Invocation', pool: 'weapon', featured: ['Azurelight', 'Symphonist of Scents'], pity: weapon(),
    })
    expect(bannerLine(epitome, false, now)).toBe('Azurelight · Symphonist of Scents · pity 23')
  })

  it("says when a banner that does not run yet starts, by the core's time and not the flag read with the model", () => {
    const coming = banner({ starts_at: local(10, 13, 18, 0).toISOString(), ends_at: local(11, 3, 15, 59).toISOString() })
    expect(bannerLine({ ...coming, running: true }, false, now)).toBe('from 13 Nov')
    // A banner read before its start runs once its start has come.
    expect(bannerLine(banner({ running: false }), false, now)).toBe('Skirk · your pity 61 · guaranteed')
  })

  it('says a 50/50, or that the guarantee is not known, with at least where the pity is not known', () => {
    expect(bannerLine(banner({ pity: character({ guarantee: 'fifty' }) }), false, now)).toBe('Skirk · your pity 61 · 50/50')
    expect(bannerLine(banner({ pity: character({ known: false, pity: 40, guarantee: 'unknown' }) }), false, now)).toBe(
      'Skirk · your pity at least 40 · guarantee not known',
    )
  })

  it('names only the featured before any import', () => {
    expect(bannerLine(banner({ pity: null }), false, now)).toBe('Skirk')
    expect(bannerLine(banner({ featured: ['Escoffier'], pity: null }), true, now)).toBe('Escoffier')
  })

  it('says no guarantee for a card that has none', () => {
    expect(bannerLine(banner({ pity: character({ guarantee: 'none' }) }), false, now)).toBe('Skirk · your pity 61')
  })
})

describe('how a 5★ fell, in the words of its wish', () => {
  it("reads the character event's 50/50", () => {
    expect(resultWords('won', 'character')).toBe('won the 50/50')
    expect(resultWords('lost', 'character')).toBe('lost the 50/50')
    expect(resultWords('guaranteed', 'character')).toBe('guaranteed')
    expect(resultWords('featured', 'character')).toBe('the featured one')
  })

  it("reads the weapon event's 75/25 and its Epitomized Path", () => {
    expect(resultWords('won', 'weapon')).toBe('won the 75/25')
    expect(resultWords('lost', 'weapon')).toBe('lost the 75/25')
    expect(resultWords('guaranteed', 'weapon')).toBe('guaranteed')
    expect(resultWords('featured', 'weapon')).toBe('the featured one')
    expect(resultWords('path', 'weapon')).toBe('Epitomized Path')
    expect(resultWords('off-path', 'weapon')).toBe('off the path')
  })

  it("reads the chronicled wish's path", () => {
    expect(resultWords('path', 'chronicled')).toBe('the chosen path')
    expect(resultWords('off-path', 'chronicled')).toBe('off the path')
  })

  it("says nothing for the standard and the beginners' wishes, nor without a result", () => {
    for (const result of ['won', 'lost', 'guaranteed', 'featured', 'path', 'off-path', null] as const) {
      expect(resultWords(result, 'standard'), String(result)).toBe('')
      expect(resultWords(result, 'novice'), String(result)).toBe('')
    }
    expect(resultWords(null, 'character')).toBe('')
    expect(resultWords(null, 'weapon')).toBe('')
  })
})

describe('the chance at the featured 5★', () => {
  it('says certain within the pulls when the pulls by then reach it, with the second copy', () => {
    expect(verdict({ chance: 1, certain_within: 29, pulls_by_then: 86 })).toEqual({ tone: 'certain', label: 'Certain' })
    expect(verdict({ chance: 1, certain_within: 86, pulls_by_then: 86 })).toEqual({ tone: 'certain', label: 'Certain' })
  })

  it('reads the chance as likely from 60%, maybe from 25% and unlikely below', () => {
    expect(verdict({ chance: 0.63, certain_within: 180, pulls_by_then: 86 })).toEqual({ tone: 'likely', label: 'Likely · 63%' })
    expect(verdict({ chance: 0.6, certain_within: 180, pulls_by_then: 86 }).tone).toBe('likely')
    expect(verdict({ chance: 0.599, certain_within: null, pulls_by_then: 86 })).toEqual({ tone: 'maybe', label: 'Maybe · 59%' })
    expect(verdict({ chance: 0.25, certain_within: null, pulls_by_then: 86 }).tone).toBe('maybe')
    expect(verdict({ chance: 0.06, certain_within: 400, pulls_by_then: 3 })).toEqual({ tone: 'unlikely', label: 'Unlikely · 6%' })
  })

  it('never reads 100% short of certain', () => {
    expect(verdict({ chance: 0.9996, certain_within: 180, pulls_by_then: 120 }).label).toBe('Likely · 99%')
  })
})

/** The next version as the demo gives it (the second pass): 7.2, from 4 Nov to 16 Dec, the Welkin Moon on and the Hymn off. */
const SEVEN = (over: Partial<SavingsRow>[] = []): SavingsRow[] =>
  (
    [
      { key: 'commissions', primogems: 2520, fates: 0, on: true, estimated: false },
      { key: 'events', primogems: 2330, fates: 0, on: true, estimated: true },
      { key: 'endgame', primogems: 2850, fates: 0, on: true, estimated: false },
      { key: 'update', primogems: 1000, fates: 0, on: true, estimated: false },
      { key: 'quests', primogems: 500, fates: 0, on: true, estimated: true },
      { key: 'welkin', primogems: 3780, fates: 0, on: true, estimated: false },
      { key: 'gnostic_hymn', primogems: 680, fates: 4, on: false, estimated: false },
    ] satisfies SavingsRow[]
  ).map((row, at) => ({ ...row, ...over[at] }))

const nextVersion = (over: Partial<NextVersion> = {}): NextVersion => ({
  number: '7.2', starts_on: '2026-11-04', ends_on: '2026-12-16', rows: SEVEN(), primogems: 12980, fates: 0, pulls: 81,
  events_typed: null, ...over,
})

describe('the savings', () => {
  const savings = (over: Partial<Pulls['savings']> = {}): Pulls['savings'] => ({
    set: { primogems: 9840, fates: 14, set_at: local(9, 24, 7, 30).toISOString() },
    pulls: 75,
    estimated: { primogems: 9840, fates: 14, income: 0, wishes: 0 },
    income_per_day: 130,
    achievements_left: 1850,
    forecast: { by: '2026-11-03', pulls: 86, default_by: true, days: 10 },
    owned: { welkin: true, gnostic_hymn: false },
    next: nextVersion(),
    by_next_end: 172,
    achievements_pulls: 11,
    ...over,
  })

  it("read the demo balance as the ledger does: the pulls now, what they are made of, and when it was set", () => {
    expect(balanceWords(savings(), now)).toEqual({
      big: '75',
      unit: 'pulls now',
      line: '9,840 primogems and 14 Intertwined Fates',
      set: 'set today, estimated since',
      note: '+130 a day, your last 30 days',
    })
  })

  it('give the balance as it is estimated now, with the day it was set when that was not today', () => {
    const moved = savings({
      set: { primogems: 9840, fates: 14, set_at: local(9, 20, 21, 0).toISOString() },
      estimated: { primogems: 11840, fates: 9, income: 2000, wishes: 5 },
      pulls: 83,
    })
    // The pulls and what they are made of agree: 11,840 primogems are 74 pulls, and 9 fates.
    expect(balanceWords(moved, now)).toMatchObject({
      big: '83',
      line: '11,840 primogems and 9 Intertwined Fates',
      set: 'set on 20 Oct, estimated since',
    })
    const lastNight = savings({ set: { primogems: 9840, fates: 14, set_at: local(9, 23, 23, 59).toISOString() } })
    expect(balanceWords(lastNight, now)?.set).toBe('set on 23 Oct, estimated since')
  })

  it('say when no income has been read yet', () => {
    expect(balanceWords(savings({ income_per_day: null }), now)?.note).toBe(
      "No income read yet. Log in to HoYoLAB for the Traveler's Diary.",
    )
  })

  it("do not name the unfinished achievements in the note: the forecast no longer adds them, and the ledger says them apart", () => {
    expect(balanceWords(savings({ achievements_left: 1850 }), now)?.note).toBe('+130 a day, your last 30 days')
    expect(balanceWords(savings({ achievements_left: 0 }), now)?.note).toBe('+130 a day, your last 30 days')
  })

  it('count one of each as one', () => {
    const one = savings({
      set: { primogems: 1, fates: 1, set_at: local(9, 24, 7, 30).toISOString() },
      estimated: { primogems: 1, fates: 1, income: 0, wishes: 0 },
      pulls: 1,
    })
    expect(balanceWords(one, now)).toMatchObject({
      big: '1', unit: 'pull now', line: '1 primogem and 1 Intertwined Fate',
    })
  })

  it('are null before a balance is set', () => {
    expect(balanceWords(savings({ set: null, pulls: null, estimated: null }), now)).toBeNull()
  })
})

describe('a number typed into a field', () => {
  it('is none where the field is empty, and the number where it is not', () => {
    expect(typed('')).toBeNull()
    expect(typed('   ')).toBeNull()
    expect(typed('12000')).toBe(12000)
    expect(typed('3')).toBe(3)
  })
})

describe("the community's events count, typed (the second pass, spec 3.2)", () => {
  it('is a whole number of primogems from 0 to 100,000', () => {
    expect(eventsCount('2400')).toBe(2400)
    expect(eventsCount(' 2400 ')).toBe(2400)
    expect(eventsCount('0')).toBe(0)
    expect(eventsCount('100000')).toBe(100000)
  })

  it('is none for anything else, so that nothing is sent', () => {
    for (const text of ['', '  ', '-1', '100001', '24.5', '2,400', 'abc', '1e3', '2400 primogems']) {
      expect(eventsCount(text), JSON.stringify(text)).toBeNull()
    }
  })
})

describe('the forecast', () => {
  it('says the banners end on the day it reads to by default', () => {
    expect(forecastLine({ by: '2026-11-03', pulls: 86, default_by: true, days: 10 }, now)).toBe(
      'By 3 Nov, when these banners end: about 86',
    )
  })

  it('reads to a day the player picked', () => {
    expect(forecastLine({ by: '2026-11-11', pulls: 112, default_by: false, days: 18 }, now)).toBe('By 11 Nov: about 112')
  })

  it('names no banners when none runs, and the default is today', () => {
    expect(forecastLine({ by: '2026-10-24', pulls: 75, default_by: true, days: 0 }, now)).toBe('By 24 Oct: about 75')
  })
})

describe('the import line', () => {
  const model = (over: Partial<Pulls['import']> = {}): Pulls['import'] => ({
    state: 'idle', last_at: null, found: 0, pages: 0, pool: null, message: null, auto: null, auto_stopped: null, login: null, every_minutes: null,
    ...over,
  })
  const event = (over: Partial<PullsImportEvent> = {}): PullsImportEvent => ({
    state: 'running', pool: null, pages: 0, found: 0, message: null, ...over,
  })

  it('names the wish being read, its page and what is new so far', () => {
    expect(importLine(event({ pool: 'character', pages: 3, found: 41 }), model())).toBe(
      'Importing the character event wish, page 3 · 41 new',
    )
    // The core may name the pool by its label.
    expect(importLine(event({ pool: 'Character event', pages: 3, found: 41 }), model())).toBe(
      'Importing the character event wish, page 3 · 41 new',
    )
    expect(importLine(event({ pool: 'weapon', pages: 1, found: 0 }), model())).toBe('Importing the weapon event wish, page 1 · 0 new')
    expect(importLine(event({ pool: 'standard', pages: 2, found: 7 }), model())).toBe('Importing the standard wish, page 2 · 7 new')
    expect(importLine(event({ pool: 'chronicled', pages: 1, found: 7 }), model())).toBe('Importing the chronicled wish, page 1 · 7 new')
    expect(importLine(event({ pool: 'novice', pages: 1, found: 7 }), model())).toBe("Importing the beginners' wish, page 1 · 7 new")
  })

  it('says it is importing before the first wish type is read', () => {
    expect(importLine(event(), model())).toBe('Importing…')
  })

  it('says what an import found', () => {
    expect(importLine(event({ state: 'done', found: 41 }), model())).toBe('Imported 41 new wishes.')
    expect(importLine(event({ state: 'done', found: 1 }), model())).toBe('Imported 1 new wish.')
    expect(importLine(event({ state: 'done', found: 0 }), model())).toBe('Nothing new. The history is up to date.')
  })

  it("says a failure's sentence", () => {
    const tooMany = 'HoYoverse says there were too many requests. Wait a minute, then press Import again.'
    expect(importLine(event({ state: 'failed', message: tooMany }), model())).toBe(tooMany)
    expect(importLine(event({ state: 'failed' }), model())).toBe('The import failed unexpectedly. See the log file.')
  })

  it("follows the stream's newest event over the model read before it", () => {
    const read = model({ state: 'running', pool: 'standard', pages: 4, found: 41 })
    expect(importLine(event({ state: 'done', found: 3 }), read)).toBe('Imported 3 new wishes.')
  })

  it("says what the core knows without an event: this session's import, running or how it ended, or the last one", () => {
    // The core's own name for the pool, as its events and its model give it: the label.
    expect(importLine(null, model({ state: 'running', pool: 'Standard', pages: 4, found: 41 }))).toBe(
      'Importing the standard wish, page 4 · 41 new',
    )
    const last = local(9, 13, 10, 2).toISOString()
    const reopen = 'Open Wish → History in the game, then press Import again.'
    expect(importLine(null, model({ state: 'failed', message: reopen, last_at: last }))).toBe(reopen)
    expect(importLine(null, model({ state: 'done', last_at: last, found: 41 }))).toBe('Imported 41 new wishes.')
    expect(importLine(null, model({ state: 'done', last_at: last, found: 0 }))).toBe('Nothing new. The history is up to date.')
    // No import in this session: when the last one that ended well finished.
    expect(importLine(null, model({ state: 'idle', last_at: last }))).toBe('Last import 13 Oct, 10:02')
  })

  it('says nothing before any import', () => {
    expect(importLine(null, model())).toBe('')
  })
})

describe("the wishes' names", () => {
  it("are the core's", () => {
    expect(POOL_LABELS).toEqual({
      character: 'Character event',
      weapon: 'Weapon event',
      standard: 'Standard',
      chronicled: 'Chronicled',
      novice: "Beginners' wish",
    })
  })
})

/** A banner of the demo's run (the plan's Task 5), running at the tests' `now`. */
const demoBanner = (over: Partial<Banner> = {}): Banner => ({
  ann_id: 33201, name: "Void Star's Advent", pool: 'character', featured: ['Skirk'], art: null,
  starts_at: local(8, 23, 7, 0).toISOString(), ends_at: local(9, 30, 6, 0).toISOString(), running: true,
  pity: character(), ...over,
})

describe("the banners, by the core's time", () => {
  const at = (ms: number) => new Date(now.getTime() + ms).toISOString()

  it('run a banner from its start until its end, whatever the flag read with the model says', () => {
    expect(isRunning(demoBanner({ running: false }), now)).toBe(true)
    expect(isRunning(demoBanner({ ends_at: at(-MINUTE) }), now)).toBe(false)
    expect(isRunning(demoBanner({ ends_at: at(0) }), now)).toBe(false)
    expect(isRunning(demoBanner({ starts_at: at(MINUTE), ends_at: at(DAY) }), now)).toBe(false)
    expect(isRunning(demoBanner({ starts_at: at(0) }), now)).toBe(true)
  })

  it('show those running and those to come, and not those that have ended', () => {
    const ended = demoBanner({ ann_id: 1, ends_at: at(-MINUTE), running: true })
    const running = demoBanner({ ann_id: 2, running: false })
    const coming = demoBanner({ ann_id: 3, starts_at: at(DAY), ends_at: at(20 * DAY) })
    expect(bannersShown([ended, running, coming], now).map((banner) => banner.ann_id)).toEqual([2, 3])
  })

  it("have the second running character banner share the first's pity, and only while the first runs", () => {
    const skirk = demoBanner({ ann_id: 1 })
    const escoffier = demoBanner({ ann_id: 2, featured: ['Escoffier'] })
    const epitome = demoBanner({ ann_id: 3, pool: 'weapon', featured: ['Azurelight'] })
    const all = [skirk, escoffier, epitome]
    expect(all.map((banner) => sharesPity(banner, all, now))).toEqual([false, true, false])
    const ended = { ...skirk, ends_at: at(-MINUTE) }
    expect(sharesPity(escoffier, [ended, escoffier, epitome], now)).toBe(false)
  })
})

describe("the night strip's title", () => {
  it('says how long the running banner that ends first has left', () => {
    const later = demoBanner({ ends_at: new Date(now.getTime() + 20 * DAY).toISOString() })
    const first = demoBanner({ ends_at: new Date(now.getTime() + 10 * DAY + 22 * HOUR + 5 * MINUTE).toISOString() })
    // One that has ended by the core's time is not counted, whatever the flag read with the model says.
    const ended = demoBanner({ ends_at: new Date(now.getTime() - MINUTE).toISOString() })
    expect(skyTitle([later, ended, first], now)).toBe('Wishing now · ends in 10 d 22 h')
  })

  it('says when the next banner starts while none runs', () => {
    const coming = demoBanner({ starts_at: local(10, 13, 18, 0).toISOString(), ends_at: local(11, 3, 15, 59).toISOString() })
    const later = demoBanner({ starts_at: local(10, 20, 18, 0).toISOString(), ends_at: local(11, 9, 15, 59).toISOString() })
    expect(skyTitle([later, { ...coming, running: true }], now)).toBe('Coming next · from 13 Nov')
  })

  it('says Wishing now with none announced', () => {
    expect(skyTitle([], now)).toBe('Wishing now')
  })
})

describe("a pity card's name for screen readers", () => {
  it("says the wish, the pity of the hard pity, and what the next 5★ is in its seal's words", () => {
    expect(cardLabel(character())).toBe('Character event: pity 61 of 90, next 5★ is the featured one')
    expect(cardLabel(character({ guarantee: 'fifty' }))).toBe('Character event: pity 61 of 90, next 5★ is a 50/50')
    expect(cardLabel(character({ known: false, pity: 40, guarantee: 'unknown' }))).toBe(
      'Character event: pity at least 40 of 90, guarantee not known',
    )
    expect(cardLabel(weapon())).toBe('Weapon event: pity 23 of 80, next 5★ is a 75/25')
    expect(cardLabel(weapon({ guarantee: 'guaranteed' }))).toBe('Weapon event: pity 23 of 80, next 5★ is a featured weapon')
    expect(cardLabel(weapon({ path: { item: 'Azurelight', points: 1, max: 1 } }))).toBe(
      'Weapon event: pity 23 of 80, next 5★ is Azurelight',
    )
    expect(cardLabel(chronicled({ path: { item: 'Shenhe', points: 0, max: 1 } }))).toBe(
      'Chronicled: pity 5 of 90, next 5★ is a 50/50',
    )
  })

  it('names no guarantee for a wish that has no seal', () => {
    expect(cardLabel(standard())).toBe('Standard: pity 44 of 90')
    expect(cardLabel(chronicled())).toBe('Chronicled: pity 5 of 90') // no path chosen
  })
})

describe("a card's Set… form, which offers only what changes something", () => {
  it('holds the correction where the history cannot tell, or where one is in force', () => {
    expect(cardForm(character({ known: false, correction: null }))).toEqual({ correction: true, path: false })
    expect(cardForm(character({ correction: { pity: 0, guaranteed: false } }))).toEqual({ correction: true, path: false })
    expect(cardForm(weapon({ known: false, correction: null }))).toEqual({ correction: true, path: true })
  })

  it('has no correction on a card its own history settles, where the weapon and chronicled cards keep their paths', () => {
    expect(cardForm(character({ correction: null }))).toBeNull()
    expect(cardForm(standard({ correction: null }))).toBeNull()
    expect(cardForm(weapon({ correction: null }))).toEqual({ correction: false, path: true })
    expect(cardForm(chronicled({ correction: null }))).toEqual({ correction: false, path: true })
  })

  it("names the day the card's history starts, as the model gives it, in this PC's own time (ruling R20)", () => {
    expect(correctionLabel(character({ from: local(3, 27, 12, 0).toISOString() }))).toBe('Before 27 Apr: pity')
    expect(correctionLabel(character())).toBe('Before 16 Apr: pity') // the demo's, 180 days before its import
    // A history read as complete, which the core's planner never gives, has no day to name.
    expect(correctionLabel(character({ from: null }))).toBe('Before the history starts: pity')
  })
})

describe('a chance, and when it is certain', () => {
  it('reads as a whole percentage, rounded down', () => {
    expect(percent(0.74)).toBe('74%')
    expect(percent(0.58)).toBe('58%')
    expect(percent(0.9996)).toBe('99%')
  })

  it('is certain once the pulls by then reach the point where it is', () => {
    expect(isCertain({ certain_within: 29, pulls_by_then: 86 })).toBe(true)
    expect(isCertain({ certain_within: 86, pulls_by_then: 86 })).toBe(true)
    expect(isCertain({ certain_within: 180, pulls_by_then: 86 })).toBe(false)
    expect(isCertain({ certain_within: null, pulls_by_then: 86 })).toBe(false)
  })
})

describe("the planner's and the wishlist's days", () => {
  it('say a planner entry runs now, until its banner ends', () => {
    expect(plannerWhen(demoBanner({ ends_at: local(10, 3, 15, 59).toISOString() }))).toBe('until 3 Nov')
  })

  const plan = (over: Partial<Pulls['planner'][number]> = {}): Pulls['planner'][number] => ({
    banner: demoBanner({ ends_at: local(10, 24, 16, 59).toISOString() }), chance: 1, second: 0.39, certain_within: 29,
    pulls_by_then: 93, icon: null, ...over,
  })

  it("say what a banner's verdict rests on, with the second copy", () => {
    expect(planReason(plan())).toBe('at most 29 pulls · 2nd copy 39%')
    expect(planReason(plan({ chance: 0.63, certain_within: 180, second: 0.09 }))).toBe('93 pulls by then · 2nd copy 9%')
  })

  it("say the pulls by the first banner's end over the banners, and nothing with none", () => {
    expect(bannersBudget([plan()])).toBe('you have 93 pulls by 24 Nov')
    expect(bannersBudget([])).toBe('')
  })

  const entry = (over: Partial<Pulls['wishlist'][number]> = {}): Pulls['wishlist'][number] => ({
    id: 1, name: 'Citlali', kind: 'character', rank: 5, pool: 'character', about: '2026-11-11', copies: 1, icon: null,
    chance: 0.74, certain_within: 209, pulls_by_then: 112, soon: false, ...over,
  })

  it('give a wishlist entry its day, with its copies when several', () => {
    expect(wishWhen(entry())).toBe('about 11 Nov')
    expect(wishWhen(entry({ copies: 3 }))).toBe('about 11 Nov · 3 copies')
  })

  it("say what a wishlist verdict rests on, for all its copies", () => {
    expect(wishReason(entry())).toBe('112 pulls by then')
    expect(wishReason(entry({ chance: 1, certain_within: 29, pulls_by_then: 154 }))).toBe('at most 29 pulls')
    expect(wishReason(entry({ copies: 3 }))).toBe('for all 3 · 112 pulls by then')
  })
})

describe("the planner entry's name", () => {
  const cards = [character(), weapon(), standard(), chronicled()]

  it('names the charted weapon on the weapon banner, and the first featured elsewhere', () => {
    const epitome = demoBanner({ pool: 'weapon', featured: ['Symphonist of Scents', 'Azurelight'], pity: weapon() })
    const plan = (banner: Banner) => ({ banner, chance: 1, second: 0.3, certain_within: 57, pulls_by_then: 86, icon: null })
    expect(plannerName(plan(epitome), cards)).toBe('Azurelight')
    expect(plannerName(plan(demoBanner()), cards)).toBe('Skirk')
  })
})

describe("the history's rarity filter", () => {
  const row = (id: string, rank: 3 | 4 | 5) => ({ id, rank }) as HistoryRow

  it('asks the core for the rarity and up, and the rows before the last one shown', () => {
    expect(historyPath('every', null)).toBe('/api/pulls/history')
    expect(historyPath('every', '1700000000000000346')).toBe('/api/pulls/history?before=1700000000000000346')
    expect(historyPath('four', null)).toBe('/api/pulls/history?rank=4')
    expect(historyPath('five', '17')).toBe('/api/pulls/history?rank=5&before=17')
  })

  it('keeps the rows of the rarity and up', () => {
    const rows = [row('4', 3), row('3', 5), row('2', 4), row('1', 3)]
    expect(historyShown(rows, 'every').map((one) => one.id)).toEqual(['4', '3', '2', '1'])
    expect(historyShown(rows, 'four').map((one) => one.id)).toEqual(['3', '2'])
    expect(historyShown(rows, 'five').map((one) => one.id)).toEqual(['3'])
  })

  it('says when none are kept', () => {
    expect(historyEmpty('four')).toBe('No 4★ or 5★ wishes kept yet.')
    expect(historyEmpty('five')).toBe('No 5★ wishes kept yet.')
  })
})

describe("the history's caption and another account's history", () => {
  it('counts the pulls kept', () => {
    expect(historyCaption(387)).toBe('History · 387 pulls kept')
    expect(historyCaption(1)).toBe('History · 1 pull kept')
    expect(historyCaption(1234)).toBe('History · 1,234 pulls kept')
  })

  it("says whose history it is when it is not the HoYoLAB account's", () => {
    expect(uidLine(700000002, 700000001)).toBe(
      "This history is UID 700000002. Guild Board's HoYoLAB account is UID 700000001.",
    )
    expect(uidLine(700000001, 700000001)).toBeNull()
    expect(uidLine(700000002, null)).toBeNull() // no login: nothing to compare with
    expect(uidLine(null, 700000001)).toBeNull()
  })
})

describe("the ledger's words (the second pass, spec 3.1)", () => {
  it('title the next version with its number and its days, or call it the next version when the calendar cannot place it', () => {
    expect(versionTitle(nextVersion())).toBe('Version 7.2, 4 Nov to 16 Dec')
    expect(versionTitle(nextVersion({ number: null }))).toBe('The next version, 4 Nov to 16 Dec')
  })

  it('say under the title that the version is counted whole', () => {
    expect(versionOffers(nextVersion())).toBe('everything 7.2 offers')
    expect(versionOffers(nextVersion({ number: null }))).toBe('everything it offers')
  })

  it("give the version's primogems, with its fates once the Gnostic Hymn is on", () => {
    expect(versionAmount(nextVersion())).toBe('about 12,980')
    expect(versionAmount(nextVersion({ primogems: 13660, fates: 4 }))).toBe('about 13,660 and 4 fates')
    expect(versionAmount(nextVersion({ primogems: 13660, fates: 1 }))).toBe('about 13,660 and 1 fate')
  })

  it('name each source in the ledger as the spec does', () => {
    expect(SEVEN().map(rowLabel)).toEqual([
      'Daily commissions',
      'Events, estimated',
      'Spiral Abyss, Imaginarium Theater and Stygian Onslaught',
      'The update and its codes',
      'Quests and trials, estimated',
      'Blessing of the Welkin Moon',
      'Gnostic Hymn',
    ])
  })

  it('call the events by their name alone once the player typed the count', () => {
    expect(rowLabel({ key: 'events', primogems: 2400, fates: 0, on: true, estimated: false })).toBe('Events')
  })

  it("give a source's primogems, with its fates where it has any, whether it is on or not", () => {
    const [commissions, , , , , , hymn] = SEVEN()
    expect(rowAmount(commissions)).toBe('2,520')
    expect(rowAmount(hymn)).toBe('680 and 4 fates') // off, and still says what it would add
    expect(rowAmount({ ...hymn, fates: 1 })).toBe('680 and 1 fate')
    expect(rowAmount({ ...hymn, on: true })).toBe('680 and 4 fates')
  })

  it('name the day the total is for, and the version that ends then', () => {
    expect(totalLine(nextVersion())).toBe('By 16 Dec, when 7.2 ends')
    expect(totalLine(nextVersion({ number: null }))).toBe('By 16 Dec, when the next version ends')
  })

  it('give the total in pulls, as an estimate', () => {
    expect(totalAmount(172)).toBe('about 172 pulls')
    expect(totalAmount(1)).toBe('about 1 pull')
    expect(totalAmount(1234)).toBe('about 1,234 pulls')
  })

  it("name the unfinished achievements' pulls, which the total leaves out, and say nothing for none", () => {
    expect(achievementsNote(36)).toBe('and about 36 more if you finish your remaining achievements')
    expect(achievementsNote(1)).toBe('and about 1 more if you finish your remaining achievements')
    expect(achievementsNote(0)).toBeNull()
  })
})

describe('the luck tiles (the second pass, spec 3.3)', () => {
  /** The player's own history of the check: 67 against a typical 62, 5 of 8, 1,226 wishes of which 19 were 5★. */
  const history = (over: Partial<Pulls['history']> = {}): Pulls['history'] => ({
    count: 1226, fives: 19, average_pity: 67, won: 5, lost: 3, luckier_than: 0.91, typical_average: 62.3, months: [],
    rows: [], more: true, ...over,
  })

  it('read three figures, each against what a typical player gets', () => {
    expect(luckTiles(history())).toEqual({
      average: {
        label: 'Average 5★ pity, character event',
        value: '67',
        of: null,
        note: 'A typical player: about 62. Lower is luckier. Luckier than 91% of players.',
      },
      fifty: {
        label: '50/50s won',
        value: '5',
        of: 'of 8',
        note: 'With Capturing Radiance a typical player wins about 55%.',
        won: 5,
        lost: 3,
      },
      kept: { label: 'Wishes kept', value: '1,226', of: null, note: '19 of them 5★, one in every 65 wishes.' },
    })
  })

  it('leave out the comparison with other players where the history cannot give it', () => {
    expect(luckTiles(history({ luckier_than: null })).average.note).toBe('A typical player: about 62. Lower is luckier.')
  })

  it('say a tile has nothing to show yet, in its own words, and give no figure', () => {
    const none = luckTiles(history({ average_pity: null, luckier_than: null, won: 0, lost: 0, fives: 0 }))
    expect(none.average).toEqual({
      label: 'Average 5★ pity, character event', value: null, of: null,
      note: 'No character-event 5★ with a known pity yet.',
    })
    expect(none.fifty).toEqual({ label: '50/50s won', value: null, of: null, note: 'No 50/50 yet.', won: 0, lost: 0 })
    // The wishes kept are known all the same.
    expect(none.kept).toEqual({ label: 'Wishes kept', value: '1,226', of: null, note: 'No 5★ yet.' })
  })

  it('count the 50/50s won of those won and lost', () => {
    expect(luckTiles(history({ won: 0, lost: 2 })).fifty).toMatchObject({ value: '0', of: 'of 2', won: 0, lost: 2 })
    expect(luckTiles(history({ won: 1, lost: 0 })).fifty).toMatchObject({ value: '1', of: 'of 1' })
  })

  it('round the pities to whole wishes, and the wishes between the 5★ to the nearest', () => {
    const rounded = luckTiles(history({ average_pity: 66.6, typical_average: 62.6 })).average
    expect(rounded.value).toBe('67')
    expect(rounded.note).toBe('A typical player: about 63. Lower is luckier. Luckier than 91% of players.')
    expect(luckTiles(history({ count: 100, fives: 3 })).kept.note).toBe('3 of them 5★, one in every 33 wishes.')
  })
})

describe("the import line's day-long updates (the second pass, spec 3.5)", () => {
  const model = (over: Partial<Pulls['import']> = {}): Pulls['import'] => ({
    state: 'done', last_at: local(9, 24, 19, 52).toISOString(), found: 3, pages: 4, pool: null, message: null, auto: null,
    auto_stopped: null, login: null, every_minutes: null, ...over,
  })
  const until = local(9, 25, 19, 52).toISOString() // 19:52 tomorrow, 24 hours after the import
  const evening = local(9, 24, 20, 5)

  it('says it updates itself until the link ends, tomorrow or today', () => {
    expect(autoLine(model({ auto: { until, last_at: null } }), evening)).toBe('Updates itself until 19:52 tomorrow.')
    expect(autoLine(model({ auto: { until, last_at: null } }), local(9, 25, 8, 0))).toBe('Updates itself until 19:52 today.')
  })

  it('says when it last updated, once it has', () => {
    const tick = local(9, 24, 20, 22).toISOString()
    expect(autoLine(model({ auto: { until, last_at: tick } }), local(9, 24, 20, 30))).toBe(
      'Updated 20:22, and again until 19:52 tomorrow.',
    )
  })

  it("names the day of an update that was not today's", () => {
    const yesterday = local(9, 24, 22, 5).toISOString()
    expect(autoLine(model({ auto: { until, last_at: yesterday } }), local(9, 25, 8, 0))).toBe(
      'Updated 24 Oct, 22:05, and again until 19:52 today.',
    )
  })

  it('keeps the hours and minutes two digits long', () => {
    const early = local(9, 25, 7, 5).toISOString()
    expect(autoLine(model({ auto: { until: early, last_at: null } }), evening)).toBe('Updates itself until 07:05 tomorrow.')
  })

  it('says the link has expired, with what to do, once HoYoverse refused it', () => {
    expect(autoLine(model({ auto_stopped: 'expired' }), evening)).toBe(
      'The link from Wish → History has expired. Open it in the game, then press Import.',
    )
  })

  it('says nothing without a kept link, nor once its day is past', () => {
    expect(autoLine(model(), evening)).toBeNull()
    expect(autoLine(model({ auto: { until, last_at: null } }), local(9, 25, 19, 52))).toBeNull()
    expect(autoLine(model({ auto: { until, last_at: null } }), local(9, 25, 21, 0))).toBeNull()
  })

  it("follows the import's own sentence in the top bar's line", () => {
    const updates = 'Updates itself until 19:52 tomorrow.'
    expect(importWithAuto('Imported 41 new wishes.', updates)).toBe('Imported 41 new wishes. Updates itself until 19:52 tomorrow.')
    expect(importWithAuto('Nothing new. The history is up to date.', updates)).toBe(
      'Nothing new. The history is up to date. Updates itself until 19:52 tomorrow.',
    )
  })

  it('ends the import line with a full stop first where its words have none', () => {
    expect(importWithAuto('Last import 13 Oct, 10:02', 'Updates itself until 19:52 tomorrow.')).toBe(
      'Last import 13 Oct, 10:02. Updates itself until 19:52 tomorrow.',
    )
  })

  it("is the import's sentence alone with no kept link, and the link's alone with no sentence", () => {
    expect(importWithAuto('Imported 3 new wishes.', null)).toBe('Imported 3 new wishes.')
    expect(importWithAuto('', 'Updates itself until 19:52 tomorrow.')).toBe('Updates itself until 19:52 tomorrow.')
    expect(importWithAuto('', null)).toBe('')
  })
})

describe('the import line while the history updates itself with the HoYoLAB login', () => {
  const model = (over: Partial<Pulls['import']> = {}): Pulls['import'] => ({
    state: 'idle', last_at: local(9, 13, 10, 2).toISOString(), found: 0, pages: 0, pool: null, message: null, auto: null,
    auto_stopped: null, login: 'on', every_minutes: 30, ...over,
  })

  it('says it updates itself, and when it last did, at rest', () => {
    expect(loginImportLine(null, model())).toBe('Updated automatically with your HoYoLAB login · last 13 Oct, 10:02')
    expect(loginImportLine(null, model({ last_at: null }))).toBe('Updates automatically with your HoYoLAB login.')
  })

  it("follows an import's or an update's own sentence", () => {
    expect(loginImportLine(null, model({ state: 'done', found: 3, message: 'Imported 3 new wishes.' }))).toBe(
      'Imported 3 new wishes. Updates automatically with your HoYoLAB login.',
    )
    const done: PullsImportEvent = { state: 'done', pool: null, pages: 6, found: 0, message: 'Nothing new. The history is up to date.' }
    expect(loginImportLine(done, model())).toBe(
      'Nothing new. The history is up to date. Updates automatically with your HoYoLAB login.',
    )
  })

  it('says a key is being asked for, and a plain notice after a failed update or a refused login', () => {
    expect(loginImportLine(null, model({ login: 'minting' }))).toBe('Getting a key from HoYoLAB…')
    const failed = model({ login: 'failed', state: 'failed', message: 'HoYoverse could not be reached. Check the connection and try again.' })
    expect(loginImportLine(null, failed)).toBe(
      'HoYoverse could not be reached. Check the connection and try again. ' +
        'The last automatic update did not finish. Guild Board tries again in half an hour.',
    )
    expect(loginImportLine(null, model({ login: 'refused' }))).toBe(
      'Last import 13 Oct, 10:02. Automatic updates need a fresh HoYoLAB login. Log in again, or open Wish → History ' +
        'in the game and press Import.',
    )
  })
})

describe('the empty Pulls page', () => {
  it('says it is reading the history now where the login updates it, and how to start an import otherwise', () => {
    expect(emptyLine('on')).toBe('No wish history yet. Guild Board is reading it now with your HoYoLAB login.')
    expect(emptyLine('minting')).toBe(emptyLine('on'))
    const today = 'No wish history yet. Open Wish → History in the game, then press Import.'
    expect(emptyLine(null)).toBe(today)
    expect(emptyLine('refused')).toBe(today)
    expect(emptyLine('failed')).toBe(today)
  })
})

describe('the freshness ring of the Pulls page', () => {
  const model = (over: Partial<Pulls['import']> = {}): Pulls['import'] => ({
    state: 'idle', last_at: local(9, 24, 7, 40).toISOString(), found: 0, pages: 0, pool: null, message: null, auto: null,
    auto_stopped: null, login: 'on', every_minutes: 30, ...over,
  })
  const running = (over: Partial<PullsImportEvent> = {}): PullsImportEvent => ({
    state: 'running', pool: 'character', pages: 3, found: 41, message: null, ...over,
  })

  it('shows the progress in a few words, turning, while an import runs', () => {
    const view = pullsFresh(model(), running(), null, now)
    expect(view).toMatchObject({ tone: 'gold', label: 'page 3 · 41 new', turning: true })
    expect(view.tip).toBe('Importing the character event wish, page 3 · 41 new')
    expect(pullsFresh(model(), running({ pool: null }), null, now).label).toBe('Importing…')
    // The model alone says a run goes when the stream has told nothing yet.
    expect(pullsFresh(model({ state: 'running', pool: 'weapon', pages: 1, found: 0 }), null, null, now).label).toBe('page 1 · 0 new')
  })

  it('keeps turning while the key is asked for after a press, and counts as running', () => {
    const view = pullsFresh(model({ login: 'minting' }), null, null, now)
    expect(view).toMatchObject({ tone: 'gold', label: 'Importing…', turning: true, tip: 'Getting a key from HoYoLAB…' })
    expect(pullsRunning(model({ login: 'minting' }), null)).toBe(true)
    expect(pullsRunning(model(), null)).toBe(false)
    expect(pullsRunning(model(), running())).toBe(true)
    expect(pullsRunning(model({ state: 'running' }), null)).toBe(true)
    expect(pullsRunning(model({ state: 'running' }), running({ state: 'done' }))).toBe(false) // the stream is the newer word
  })

  it('is gold with the age of the newest read, and a fill from it, when the login updates the history', () => {
    const view = pullsFresh(model(), null, null, now)
    expect(view).toMatchObject({ tone: 'gold', label: '20 min ago', turning: false })
    expect(view.fill).toBe(ringFill(local(9, 24, 7, 40).toISOString(), 30, now))
    expect(view.tip).toBe(loginImportLine(null, model()))
  })

  it('takes the newest of the last import and the last update of the kept link', () => {
    const tick = local(9, 24, 7, 55).toISOString()
    const until = local(9, 25, 7, 0).toISOString()
    const view = pullsFresh(model({ login: null, auto: { until, last_at: tick } }), null, null, now)
    expect(view.label).toBe('5 min ago')
    expect(view.fill).toBe(ringFill(tick, 30, now))
    expect(view.tone).toBe('gold')
    const kept = model({ login: null, auto: { until, last_at: tick } })
    expect(view.tip).toBe(importWithAuto(importLine(null, kept), autoLine(kept, now)))
  })

  it('is grey without an update by itself, and the tip says to press Import', () => {
    const view = pullsFresh(model({ login: null, every_minutes: null, state: 'done', found: 3, message: 'Imported 3 new wishes.' }), null, null, now)
    expect(view).toMatchObject({ tone: 'grey', fill: 0, label: '20 min ago' })
    expect(view.tip).toBe('Imported 3 new wishes. Press Import to update it.')
    expect(pullsFresh(model({ login: null, every_minutes: null, last_at: null }), null, null, now)).toMatchObject({
      tone: 'grey', label: 'Not read yet', tip: 'Press Import to update it.',
    })
  })

  it('is empty and gold before any read when the login will update it', () => {
    expect(pullsFresh(model({ last_at: null }), null, null, now)).toMatchObject({ tone: 'gold', fill: 0, label: 'Not read yet' })
  })

  it('is amber and asks for a login once HoYoverse refused it', () => {
    const view = pullsFresh(model({ login: 'refused' }), null, null, now)
    expect(view).toMatchObject({ tone: 'amber', label: 'Log in', turning: false })
    expect(view.tip).toBe(loginImportLine(null, model({ login: 'refused' })))
  })

  it('is amber and says it will retry after an update with the login that did not finish', () => {
    const view = pullsFresh(model({ login: 'failed', state: 'failed', message: 'HoYoverse could not be reached.' }), null, null, now)
    expect(view).toMatchObject({ tone: 'amber', label: 'Will retry' })
    expect(view.tip).toContain('Guild Board tries again in half an hour.')
  })

  it('is amber and asks to open Wish History once the kept link expired', () => {
    const view = pullsFresh(model({ login: null, every_minutes: null, auto_stopped: 'expired' }), null, null, now)
    expect(view).toMatchObject({ tone: 'amber', label: 'Open Wish History' })
    expect(view.tip).toBe('The link from Wish → History has expired. Open it in the game, then press Import.')
  })

  it('is amber when a press ended in a failure, with its sentence as the tip', () => {
    const failed: PullsImportEvent = { state: 'failed', pool: null, pages: 0, found: 0, message: 'No wish history link was found.' }
    const view = pullsFresh(model({ login: null, every_minutes: null }), failed, null, now)
    expect(view).toMatchObject({ tone: 'amber', label: 'Import failed' })
    expect(view.tip).toBe('No wish history link was found.')
  })

  it('shows the refusal of a press as the tip, keeping the rest', () => {
    const view = pullsFresh(model({ login: null, every_minutes: null }), null, 'An import is already running.', now)
    expect(view).toMatchObject({ tone: 'grey', label: '20 min ago', tip: 'An import is already running.' })
  })
})
