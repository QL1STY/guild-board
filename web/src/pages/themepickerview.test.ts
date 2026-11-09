import { describe, expect, it } from 'vitest'
import { THEME_NAMES } from '../theme.ts'
import {
  boardsOf,
  choiceGoesTo,
  moreToTheRight,
  NATIONS_FROM,
  optionLabel,
  scrollLeftToShow,
  shownTheme,
  sidewaysWheel,
  THEME_OPTIONS,
  themeAfterKey,
  wheelPixels,
} from './themepickerview.ts'

describe('the options', () => {
  it('are in the order of the picker, with their exact names and words: the five looks, Match Windows, then the seven nations', () => {
    expect(THEME_OPTIONS.map((option) => [option.value, option.name, option.words])).toEqual([
      ['parchment', 'Parchment', 'Warm light'],
      ['midnight', 'Midnight', 'True dark'],
      ['slate', 'Slate', 'Soft dark'],
      ['dusk', 'Dusk', 'Warm dark'],
      ['mist', 'Mist', 'Cool light'],
      ['system', 'Match Windows', 'Day and night'],
      ['mondstadt', 'Mondstadt', 'Sky light'],
      ['liyue', 'Liyue', 'Lacquer dark'],
      ['inazuma', 'Inazuma', 'Sakura night'],
      ['sumeru', 'Sumeru', 'Forest light'],
      ['fontaine', 'Fontaine', 'Court blue'],
      ['natlan', 'Natlan', 'Basalt dark'],
      ['snezhnaya', 'Snezhnaya', 'Frost light'],
    ])
  })

  it('has the "Nations" mark before Mondstadt, and nothing else before it but the six', () => {
    expect(NATIONS_FROM).toBe('mondstadt')
    expect(THEME_OPTIONS.findIndex((option) => option.value === NATIONS_FROM)).toBe(6)
  })

  it('give each tile its name and words as its accessible name', () => {
    expect(THEME_OPTIONS.map(optionLabel)).toEqual([
      'Parchment, Warm light',
      'Midnight, True dark',
      'Slate, Soft dark',
      'Dusk, Warm dark',
      'Mist, Cool light',
      'Match Windows, Day and night',
      'Mondstadt, Sky light',
      'Liyue, Lacquer dark',
      'Inazuma, Sakura night',
      'Sumeru, Forest light',
      'Fontaine, Court blue',
      'Natlan, Basalt dark',
      'Snezhnaya, Frost light',
    ])
  })

  it('cover every theme the window has, and Match Windows', () => {
    expect([...THEME_OPTIONS.map((option) => option.value)].sort()).toEqual([...THEME_NAMES, 'system'].sort())
    expect(THEME_OPTIONS).toHaveLength(THEME_NAMES.length + 1)
  })
})

describe('the Boards a tile draws', () => {
  it('is one Board in its own theme for a theme', () => {
    expect(boardsOf('slate')).toEqual(['slate'])
    expect(boardsOf('dusk')).toEqual(['dusk'])
    expect(boardsOf('mist')).toEqual(['mist'])
    for (const nation of ['mondstadt', 'liyue', 'inazuma', 'sumeru', 'fontaine', 'natlan', 'snezhnaya'] as const) {
      expect(boardsOf(nation)).toEqual([nation])
    }
  })

  it('is Parchment with Midnight over it for Match Windows', () => {
    expect(boardsOf('system')).toEqual(['parchment', 'midnight'])
  })
})

describe('the keyboard', () => {
  it('chooses the next tile on the right and down, and the one before on the left and up', () => {
    expect(themeAfterKey('ArrowRight', 'parchment')).toBe('midnight')
    expect(themeAfterKey('ArrowDown', 'midnight')).toBe('slate')
    expect(themeAfterKey('ArrowRight', 'slate')).toBe('dusk')
    expect(themeAfterKey('ArrowLeft', 'mist')).toBe('dusk')
    expect(themeAfterKey('ArrowUp', 'system')).toBe('mist')
  })

  it('reaches Match Windows after Mist, and Mondstadt after Match Windows', () => {
    expect(themeAfterKey('ArrowRight', 'mist')).toBe('system')
    expect(themeAfterKey('ArrowRight', 'system')).toBe('mondstadt')
    expect(themeAfterKey('ArrowLeft', 'mondstadt')).toBe('system')
  })

  it('walks the nations in order', () => {
    expect(themeAfterKey('ArrowRight', 'liyue')).toBe('inazuma')
    expect(themeAfterKey('ArrowRight', 'natlan')).toBe('snezhnaya')
    expect(themeAfterKey('ArrowLeft', 'fontaine')).toBe('sumeru')
  })

  it('goes to the ends with Home and End', () => {
    expect(themeAfterKey('Home', 'natlan')).toBe('parchment')
    expect(themeAfterKey('End', 'parchment')).toBe('snezhnaya')
  })

  it('stays where it is at an end, as the Segmented control does', () => {
    expect(themeAfterKey('ArrowRight', 'snezhnaya')).toBe('snezhnaya')
    expect(themeAfterKey('ArrowLeft', 'parchment')).toBe('parchment')
  })

  it('leaves a key that is not one of its own', () => {
    expect(themeAfterKey('Enter', 'dusk')).toBeNull()
    expect(themeAfterKey('a', 'dusk')).toBeNull()
  })
})

describe('where a choice goes', () => {
  it('is the setting in the window and the visitor’s own choice in the site demo', () => {
    expect(choiceGoesTo(false)).toBe('setting')
    expect(choiceGoesTo(true)).toBe('site')
  })

  it('shows the setting in the window, and in the site demo the visitor’s choice, Parchment before they chose', () => {
    expect(shownTheme(false, 'dusk', 'mist')).toBe('dusk')
    expect(shownTheme(false, undefined, null)).toBe('parchment')
    expect(shownTheme(true, 'dusk', 'mist')).toBe('mist')
    expect(shownTheme(true, 'dusk', null)).toBe('parchment')
  })

  it('shows an unknown word as Parchment', () => {
    expect(shownTheme(false, 'neon' as never, null)).toBe('parchment')
  })
})

describe('the row that scrolls sideways', () => {
  it('scrolls a tile that is cut off on the right into view, with a margin, and leaves one that shows', () => {
    // a row 500 wide, scrolled 0, a tile at 450 to 558: it needs 558 + 12 - 500 more
    expect(scrollLeftToShow({ scrollLeft: 0, viewWidth: 500, scrollWidth: 1400, tileLeft: 450, tileWidth: 108 })).toBe(70)
    expect(scrollLeftToShow({ scrollLeft: 0, viewWidth: 500, scrollWidth: 1400, tileLeft: 100, tileWidth: 108 })).toBeNull()
  })

  it('scrolls a tile that is cut off on the left into view, never below 0', () => {
    expect(scrollLeftToShow({ scrollLeft: 300, viewWidth: 500, scrollWidth: 1400, tileLeft: 250, tileWidth: 108 })).toBe(238)
    expect(scrollLeftToShow({ scrollLeft: 5, viewWidth: 500, scrollWidth: 1400, tileLeft: 0, tileWidth: 108 })).toBe(0)
  })

  it('goes to a snap point, so that the row does not pull a tile half out of view again', () => {
    // tiles at 8, 126, 244, ... 118 apart; snap points are tile lefts less the 8 pixels of padding
    const snaps = [0, 118, 236, 354, 472, 590, 708, 826]
    // a tile at 750 to 858 in a row 500 wide at 0: just fitting needs 370; the first snap point from there is 472
    expect(scrollLeftToShow({ scrollLeft: 0, viewWidth: 500, scrollWidth: 1400, tileLeft: 750, tileWidth: 108, snaps })).toBe(472)
    // cut off on the left: the tile's own snap point, its left less the padding
    expect(scrollLeftToShow({ scrollLeft: 800, viewWidth: 500, scrollWidth: 1400, tileLeft: 244, tileWidth: 108, snaps })).toBe(236)
    // a tile that shows needs nothing
    expect(scrollLeftToShow({ scrollLeft: 236, viewWidth: 500, scrollWidth: 1400, tileLeft: 360, tileWidth: 108, snaps })).toBeNull()
  })

  it('never scrolls past the end of the row', () => {
    expect(scrollLeftToShow({ scrollLeft: 800, viewWidth: 500, scrollWidth: 1400, tileLeft: 1292, tileWidth: 108 })).toBe(900)
  })

  it('shows the fade while more is to the right, and not at the end or when everything fits', () => {
    expect(moreToTheRight({ scrollLeft: 0, viewWidth: 500, scrollWidth: 1400 })).toBe(true)
    expect(moreToTheRight({ scrollLeft: 899, viewWidth: 500, scrollWidth: 1400 })).toBe(false)
    expect(moreToTheRight({ scrollLeft: 900, viewWidth: 500, scrollWidth: 1400 })).toBe(false)
    expect(moreToTheRight({ scrollLeft: 0, viewWidth: 1400, scrollWidth: 1400 })).toBe(false)
  })

  it('turns the wheel into a sideways scroll while the row can still go that way, and leaves the page its own wheel at the ends', () => {
    const row = { scrollLeft: 100, viewWidth: 500, scrollWidth: 1400 }
    expect(sidewaysWheel({ ...row, deltaX: 0, deltaY: 120 })).toBe(120)
    expect(sidewaysWheel({ ...row, deltaX: 0, deltaY: -120 })).toBe(-120)
    expect(sidewaysWheel({ ...row, deltaX: 40, deltaY: 10 })).toBeNull() // a sideways gesture is the browser's own
    expect(sidewaysWheel({ ...row, scrollLeft: 0, deltaX: 0, deltaY: -120 })).toBeNull()
    expect(sidewaysWheel({ ...row, scrollLeft: 900, deltaX: 0, deltaY: 120 })).toBeNull()
    expect(sidewaysWheel({ ...row, scrollWidth: 500, deltaX: 0, deltaY: 120 })).toBeNull()
  })

  it('turns a wheel that counts lines or pages into pixels, and leaves one that counts pixels', () => {
    expect(wheelPixels(100, 0, 700)).toBe(100)
    expect(wheelPixels(3, 1, 700)).toBe(48)
    expect(wheelPixels(1, 2, 700)).toBe(700)
    expect(wheelPixels(-1, 2, 700)).toBe(-700)
  })
})
