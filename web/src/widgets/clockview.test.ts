import { describe, expect, it } from 'vitest'
import {
  astroDay, astroTurn, CLOCK_DEFAULTS, CLOCK_STYLES, clockMeta, clockSettings, formatTime, msToNextTick, optionsOf, periodOfDay,
  resetLeft, serverTime, showsSeconds, timeText, weeklyWords, wordsState,
} from './clockview.ts'

describe('the clock settings', () => {
  it('a clock saved with no settings is the Istaroth dial, 24 hours, with the date and the server and no seconds', () => {
    expect(clockSettings({})).toEqual({ style: 'istaroth', twelve: false, seconds: false, date: true, server: true, reset: false })
    expect(CLOCK_DEFAULTS.style).toBe('istaroth')
  })

  it('a clock saved with only its seconds (as before the styles) keeps them and takes the rest as its defaults', () => {
    expect(clockSettings({ seconds: true })).toEqual({ ...CLOCK_DEFAULTS, seconds: true })
  })

  it('a style it does not know is Istaroth, and a setting of the wrong kind is its default', () => {
    expect(clockSettings({ style: 'sundial', twelve: 'yes', date: 0 })).toEqual(CLOCK_DEFAULTS)
  })

  it('has the six styles in the order the picker shows them', () => {
    expect(CLOCK_STYLES.map((one) => one.id)).toEqual(['istaroth', 'digital', 'flip', 'astro', 'reset', 'words'])
    expect(CLOCK_STYLES.map((one) => one.name)).toEqual(['Istaroth', 'Figures', 'Flip', 'Astrolabe', 'Time and reset', 'Words'])
  })
})

describe('the time as written', () => {
  const at = new Date(2026, 10, 15, 9, 5, 7)

  it('writes 24 hours as the clock always did, with the seconds when shown', () => {
    expect(timeText(at, { twelve: false, seconds: false })).toBe('09:05')
    expect(timeText(at, { twelve: false, seconds: true })).toBe('09:05:07')
  })

  it('writes 12 hours with AM and PM, and noon and midnight as 12', () => {
    expect(formatTime(9, 5, 7, { twelve: true, seconds: false })).toEqual({ hours: '09', minutes: '05', seconds: null, ampm: 'AM' })
    expect(formatTime(0, 30, 0, { twelve: true, seconds: true })).toEqual({ hours: '12', minutes: '30', seconds: '00', ampm: 'AM' })
    expect(formatTime(12, 0, 0, { twelve: true, seconds: false }).ampm).toBe('PM')
    expect(timeText(new Date(2026, 10, 15, 15, 40), { twelve: true, seconds: false })).toBe('03:40 PM')
  })

  it("writes the server's time at its fixed offset, in the same way", () => {
    const now = new Date('2026-10-13T08:00:00Z')
    expect(serverTime(now, 1, { twelve: false, seconds: false })).toBe('09:00')
    expect(serverTime(now, 1, { twelve: false, seconds: true })).toBe('09:00:00')
    expect(serverTime(new Date('2026-10-13T03:30:00Z'), -5, { twelve: true, seconds: false })).toBe('10:30 PM')
  })

  it('names the part of the day', () => {
    expect([0, 4, 5, 11, 12, 16, 17, 20, 21, 23].map(periodOfDay)).toEqual([
      'Night', 'Night', 'Morning', 'Morning', 'Afternoon', 'Afternoon', 'Evening', 'Evening', 'Night', 'Night',
    ])
  })
})

describe('the clock ticks', () => {
  it('moves each second while seconds are shown, and at the next minute otherwise', () => {
    const at = new Date(2026, 10, 15, 10, 8, 36, 250)
    expect(msToNextTick(at, true)).toBe(750)
    expect(msToNextTick(at, false)).toBe(23_750)
    expect(msToNextTick(new Date(2026, 10, 15, 10, 8, 0, 0), false)).toBe(60_000)
  })

  it('shows seconds only in the styles that have them, and only when they are on', () => {
    expect(showsSeconds({ ...CLOCK_DEFAULTS, seconds: true })).toBe(true)
    expect(showsSeconds({ ...CLOCK_DEFAULTS, seconds: false })).toBe(false)
    expect(showsSeconds({ ...CLOCK_DEFAULTS, style: 'words', seconds: true })).toBe(false)
  })
})

describe('what each style takes', () => {
  it('Words go by five minutes in 12 hours, so seconds and the hours are no choice there', () => {
    const words = optionsOf('words')
    expect(words.seconds).not.toBeNull()
    expect(words.twelve).not.toBeNull()
    expect(words.date).toBeNull()
    expect(optionsOf('istaroth')).toEqual({ twelve: null, seconds: null, date: null, server: null, reset: null })
  })

  it('the reset is always on in Time and reset and in the Astrolabe, and a choice in the others', () => {
    expect(optionsOf('reset').reset).not.toBeNull()
    expect(optionsOf('astro').reset).not.toBeNull()
    expect(optionsOf('digital').reset).toBeNull()
  })
})

describe('the daily reset', () => {
  const daily = '2026-11-16T03:00:00Z'

  it('counts the whole minutes left and how much of the game day has gone', () => {
    const left = resetLeft(daily, new Date('2026-11-15T12:09:30Z'))
    expect(left.hours).toBe(14)
    expect(left.minutes).toBe(50)
    expect(left.share).toBeCloseTo(1 - (14 * 60 + 50.5) / 1440, 4)
  })

  it('has none left at the reset itself', () => {
    expect(resetLeft(daily, new Date('2026-11-16T03:00:01Z'))).toMatchObject({ hours: 0, minutes: 0, share: 1 })
  })

  it("places the reset on a 24-hour dial by this PC's hour of it", () => {
    const at = resetLeft(daily, new Date('2026-11-15T12:00:00Z')).localHour
    const when = new Date(daily)
    expect(at).toBeCloseTo(when.getHours() + when.getMinutes() / 60, 6)
  })

  it('says when the weekly reset is by the days of this PC, today, tomorrow or in some days', () => {
    const now = new Date(2026, 10, 15, 23, 30)
    expect(weeklyWords(new Date(2026, 10, 15, 23, 59).toISOString(), now)).toBe('today')
    expect(weeklyWords(new Date(2026, 10, 16, 4, 0).toISOString(), now)).toBe('tomorrow')
    expect(weeklyWords(new Date(2026, 10, 18, 4, 0).toISOString(), now)).toBe('in 3 days')
  })
})

describe('the Astrolabe', () => {
  it('has midnight at the bottom, six at the left, noon at the top and eighteen at the right', () => {
    expect(astroTurn(0)).toBeCloseTo(0.5)
    expect(astroTurn(6)).toBeCloseTo(0.75)
    expect(astroTurn(12)).toBeCloseTo(0)
    expect(astroTurn(18)).toBeCloseTo(0.25)
    expect(astroTurn(23.99)).toBeLessThan(0.5 + 1e-9 + 0.01)
  })

  it('shows the sun from six to eighteen and the moon otherwise', () => {
    expect([5.99, 6, 12, 17.99, 18, 23].map(astroDay)).toEqual([false, true, true, true, false, false])
  })
})

describe('the Words', () => {
  const lit = (at: Date) =>
    wordsState(at)
      .cells.filter((cell) => cell.on)
      .map((cell) => cell.ch)
      .join('')

  it('lights IT IS, the minutes, PAST or TO, and the hour', () => {
    expect(lit(new Date(2026, 10, 15, 10, 10))).toBe('ITISTENPASTTEN')
    expect(lit(new Date(2026, 10, 15, 22, 40))).toBe('ITISTWENTYTOELEVEN')
    expect(lit(new Date(2026, 10, 15, 10, 0))).toBe('ITISTENOCLOCK')
    expect(lit(new Date(2026, 10, 15, 3, 30))).toBe('ITISHALFPASTTHREE')
  })

  it('reads a quarter as A QUARTER and twenty-five as TWENTY and FIVE', () => {
    expect(lit(new Date(2026, 10, 15, 1, 15))).toBe('ITISAQUARTERPASTONE')
    expect(lit(new Date(2026, 10, 15, 6, 25))).toBe('ITISTWENTYFIVEPASTSIX')
    expect(lit(new Date(2026, 10, 15, 6, 50))).toBe('ITISTENTOSEVEN')
  })

  it('has twelve at midnight and noon, and is 110 letters in ten rows of eleven', () => {
    expect(wordsState(new Date(2026, 10, 15, 0, 0)).phrase).toEqual({ lead: '', hour: 'twelve', tail: " o'clock" })
    expect(lit(new Date(2026, 10, 15, 12, 0))).toBe('ITISTWELVEOCLOCK')
    expect(wordsState(new Date(2026, 10, 15, 12, 0)).cells).toHaveLength(110)
  })

  it('says the same in a sentence, with the hour apart so that it can be set in gold', () => {
    expect(wordsState(new Date(2026, 10, 15, 10, 8)).phrase).toEqual({ lead: 'five past ', hour: 'ten', tail: '' })
    expect(wordsState(new Date(2026, 10, 15, 10, 40)).phrase).toEqual({ lead: 'twenty to ', hour: 'eleven', tail: '' })
    expect(wordsState(new Date(2026, 10, 15, 10, 25)).phrase.lead).toBe('twenty-five past ')
  })

  it('has a dot for each minute past the five', () => {
    expect(wordsState(new Date(2026, 10, 15, 10, 8)).extra).toBe(3)
    expect(wordsState(new Date(2026, 10, 15, 10, 10)).extra).toBe(0)
    expect(wordsState(new Date(2026, 10, 15, 10, 14)).extra).toBe(4)
  })

  it('lights the hour in gold and nothing else', () => {
    const gold = wordsState(new Date(2026, 10, 15, 10, 10)).cells.filter((cell) => cell.gold).map((cell) => cell.ch).join('')
    expect(gold).toBe('TEN')
  })
})

describe('the clock in its heading', () => {
  it('says the server at one cell wide, as it always did, or else the reset, or nothing', () => {
    expect(clockMeta({ narrow: true, server: 'Server 09:00', reset: '14 h 50 min' })).toBe('Server 09:00')
    expect(clockMeta({ narrow: true, server: null, reset: '14 h 50 min' })).toBe('Reset in 14 h 50 min')
    expect(clockMeta({ narrow: true, server: null, reset: null })).toBeNull()
    expect(clockMeta({ narrow: false, server: 'Server 09:00', reset: '14 h 50 min' })).toBeNull()
  })
})
