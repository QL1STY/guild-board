import { describe, expect, it } from 'vitest'
import type { Status } from '../../types.ts'
import type { WidgetType } from '../../widgets/widget.ts'
import { leftOff, offered, placeWhileHidden, railPages, weekShown } from './hidden.ts'

const status = (on: boolean) => ({ week_and_endgame: on }) as Status

describe('weekShown', () => {
  it('is on only when the core says so: not before it has answered, and not for a core that does not say', () => {
    expect(weekShown(status(true))).toBe(true)
    expect(weekShown(status(false))).toBe(false)
    expect(weekShown(null)).toBe(false)
    expect(weekShown({} as Status)).toBe(false)
  })
})

describe('railPages', () => {
  const pages = ['board', 'characters', 'week', 'backlog'] as const
  it('leaves Your week out while it is hidden, and keeps the order when it is shown', () => {
    expect(railPages(pages, false)).toEqual(['board', 'characters', 'backlog'])
    expect(railPages(pages, true)).toEqual(['board', 'characters', 'week', 'backlog'])
  })
})

describe('placeWhileHidden', () => {
  it('sends the week and the Endgame tab back to the roster while they are hidden, and nothing else', () => {
    expect(placeWhileHidden('#/week')).toBe('#/characters')
    expect(placeWhileHidden('#/characters/endgame')).toBe('#/characters')
    expect(placeWhileHidden('#/characters')).toBeNull()
    expect(placeWhileHidden('#/characters/sandrone')).toBeNull()
    expect(placeWhileHidden('#/characters/sandrone/plan')).toBeNull()
    expect(placeWhileHidden('#/board')).toBeNull()
  })
})

describe('offered', () => {
  const types = [{ id: 'timers' }, { id: 'today', needsWeek: true }] as unknown as readonly WidgetType[]
  it('does not offer the Today widget while the week is hidden, and offers every type when it is shown', () => {
    expect(offered(types, false).map((type) => type.id)).toEqual(['timers'])
    expect(offered(types, true).map((type) => type.id)).toEqual(['timers', 'today'])
  })
})

describe('leftOff', () => {
  const [timers, today] = [{ id: 'timers' }, { id: 'today', needsWeek: true }] as unknown as WidgetType[]
  it('leaves a Today widget off the Board and the overlay while the week is hidden, but not in Edit, where it can be taken off', () => {
    expect(leftOff(today, false, false)).toBe(true)
    expect(leftOff(today, false, true)).toBe(false)
    expect(leftOff(today, true, false)).toBe(false)
    expect(leftOff(timers, false, false)).toBe(false)
    expect(leftOff(undefined, false, false)).toBe(false)
  })
})
