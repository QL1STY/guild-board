import { describe, expect, it } from 'vitest'
import {
  categoryName, categoryTicked, changedStages, changesListing, checkLine, chipsFit, type Clicked, contentTitle, countText, currentStage,
  emptyLine, fileLine, type FocusControl, goBackOffered, importSummary, keptAfter, lastTicked, listLine,
  listLineParts, matchingControl, modelPath, moreLine, newStages, nextTarget, numeral, panelSummary,
  pinnedAt, pipsOf, type Place, placeAfter, reachedLine, sentSearch, shareGroups, sharedWiki, stillShown, takesPlace,
  unknownLine, unlistedDetails,
} from './achievementsview.ts'
import { localTime } from '../format.ts'
import type {
  Achievements, AchievementGroup, AchievementStage, AchievementStatus, ImportPreview, ListCheck, ListMeta,
} from '../types.ts'

const stage = (over: Partial<AchievementStage>): AchievementStage => ({
  id: 1, name: 'n', description: 'd', reward: 5, version: '1.0', status: 'not_started', done_at: null, pinned: false,
  note: '', parts: [], wiki: 'w', ...over,
})

/** An achievement with one stage for each of these statuses (stage ids from 1), and these stages pinned (by number). */
const group = (statuses: AchievementStatus[], pinned: number[] = []): AchievementGroup => ({
  id: 1, name: 'n', category: 'c', counter: null,
  stages: statuses.map((status, index) => stage({ id: index + 1, status, pinned: pinned.includes(index) })),
})

const preview = (counts: Partial<ImportPreview>): ImportPreview => ({
  kind: 'paimon', file: 'export.json', profile: '', profiles: [''], fingerprint: 'f',
  done: 0, in_progress: 0, pins: 0, notes: 0, parts: 0, unknown: [], conflicts: [],
  nothing_new: false, ...counts,
})

describe('the achievements page words', () => {
  /** A group's stages, ticked or not, in order. */
  const ticked = (...done: boolean[]) => done.map((each) => ({ status: each ? 'done' as const : 'not_started' as const }))
  const hilichurl = { unit: 'kills', unit_one: 'kill', targets: [1, 20, 50] }

  it('counts towards the first stage not ticked', () => {
    // Spec 3's "17 of 50 kills": the 1 and 20 stages are ticked.
    expect(nextTarget({ value: 17, targets: [1, 20, 50] }, ticked(true, true, false))).toBe(50)
    expect(countText({ ...hilichurl, value: 17 }, ticked(true, true, false))).toBe('17 of 50 kills')
    // Whatever the count: a stage ticked counts as reached, and one not ticked is the one to go for.
    expect(countText({ ...hilichurl, value: 0 }, ticked(true, false, false))).toBe('0 of 20 kills')
    expect(countText({ ...hilichurl, value: 37 }, ticked(false, false, false))).toBe('37 of 1 kill')
    expect(countText({ value: 1312, targets: [100, 500, 2000] }, ticked(true, true, false))).toBe('1,312 of 2,000')
    expect(countText({ value: 37, targets: [1, 20, 50] }, ticked(true, true, false))).toBe('37 of 50')
  })

  it('names the last target once every stage is ticked', () => {
    expect(nextTarget({ value: 60, targets: [1, 20, 50] }, ticked(true, true, true))).toBe(50)
    expect(countText({ ...hilichurl, value: 60 }, ticked(true, true, true))).toBe('60 of 50 kills')
    expect(countText({ ...hilichurl, value: 0 }, ticked(true, true, true))).toBe('0 of 50 kills')
  })

  it('names the unit for one after a target of 1, when the counter has one', () => {
    expect(countText({ ...hilichurl, value: 0 }, ticked(false, false, false))).toBe('0 of 1 kill')
    expect(countText({ ...hilichurl, value: 1 }, ticked(false, false, false))).toBe('1 of 1 kill')
    expect(countText({ ...hilichurl, unit_one: null, value: 0 }, ticked(false, false, false))).toBe('0 of 1 kills')
    expect(countText({ value: 0, unit: '', unit_one: null, targets: [1, 30, 100] }, ticked(false, false, false)))
      .toBe('0 of 1')
  })

  it('keeps to the first target above the count for a counter whose targets and stages differ in number', () => {
    expect(nextTarget({ value: 37, targets: [1, 20, 50] }, ticked(false))).toBe(50)
    expect(nextTarget({ value: 60, targets: [1, 20, 50] }, ticked(true, true))).toBe(50)
    expect(countText({ ...hilichurl, value: 0 }, ticked(true))).toBe('0 of 1 kill')
  })

  it("says how many of a category's stages are ticked, as its bar's name and tip do", () => {
    expect(categoryTicked({ stages: 480, left: 292 })).toBe('188 of 480 ticked')
    expect(categoryTicked({ stages: 1200, left: 0 })).toBe('1,200 of 1,200 ticked')
    expect(categoryTicked({ stages: 35, left: 35 })).toBe('0 of 35 ticked')
  })

  it("names a game category with what is left, which it shows, and its share ticked, which its bar shows", () => {
    expect(categoryName({ name: 'Wonders of the World', stages: 480, left: 292 }))
      .toBe('Wonders of the World, 292 left, 188 of 480 ticked')
    // A complete category shows no number.
    expect(categoryName({ name: 'Marksmanship', stages: 1200, left: 0 })).toBe('Marksmanship, 1,200 of 1,200 ticked')
  })

  it('sums up an import in one sentence', () => {
    expect(importSummary(preview({ done: 2, in_progress: 1, parts: 2 })))
      .toBe('This import would tick 2 achievements, mark 1 as in progress and add 2 parts.')
    expect(importSummary(preview({ done: 1, pins: 1, notes: 1 })))
      .toBe('This import would tick 1 achievement, pin 1 and add 1 note.')
    expect(importSummary(preview({ nothing_new: true }))).toBe('This file has nothing new for Guild Board.')
    expect(importSummary(preview({ unknown: [99901] })))
      .toBe('This import would only add progress on achievements that are not in the list.')
  })

  it('names the achievements in the file that the list does not hold, at most 20', () => {
    expect(unknownLine([])).toBeNull()
    expect(unknownLine([81219])).toBe('1 achievement in the file is not in the list: 81219. It is kept.')
    expect(unknownLine([81219, 99901])).toBe('2 achievements in the file are not in the list: 81219, 99901. They are kept.')
    const many = Array.from({ length: 25 }, (_, index) => 99901 + index)
    expect(unknownLine(many)).toBe(
      `25 achievements in the file are not in the list: ${many.slice(0, 20).join(', ')} and 5 more. They are kept.`,
    )
  })

  it('asks for a Paimon.moe export', () => {
    expect(fileLine()).toBe('Choose a file: a Paimon.moe export.')
  })

  it('offers the tick when the parts or the count are complete, and only then', () => {
    const parts = [{ label: 'a', done_at: '2026-10-19T09:00:00+00:00' }, { label: 'b', done_at: '2026-10-19T09:00:00+00:00' }]
    expect(reachedLine(stage({ parts }), null, 0)).toBe('All parts are done. Tick it once the game shows it.')
    expect(reachedLine(stage({ parts: [parts[0], { label: 'b', done_at: null }] }), null, 0)).toBeNull()
    const counter = { value: 20, unit: '', unit_one: null, targets: [1, 20, 50] }
    expect(reachedLine(stage({}), counter, 1)).toBe('The count reached 20. Tick it once the game shows it.')
    expect(reachedLine(stage({}), { ...counter, value: 19 }, 1)).toBeNull()
    expect(reachedLine(stage({ status: 'done' }), { ...counter, value: 50 }, 2)).toBeNull()
  })
})

describe('the stage an achievement stands at', () => {
  it('is the first stage not ticked, or the last when all are', () => {
    expect(currentStage(group(['done', 'not_started', 'not_started'])).index).toBe(1)
    expect(currentStage(group(['done', 'done', 'done']))).toMatchObject({ index: 2, allDone: true })
    expect(numeral(2)).toBe('III')
  })

  it('is the stage itself, with whether the achievement is done', () => {
    const three = group(['done', 'in_progress', 'not_started'])
    const now = currentStage(three)
    expect(now.stage).toBe(three.stages[1])
    expect(now).toMatchObject({ index: 1, allDone: false })
    const done = group(['done', 'done'])
    expect(currentStage(done)).toMatchObject({ stage: done.stages[1], allDone: true })
  })

  it('is the first stage not ticked even when a later one is, and the only stage of a single one', () => {
    expect(currentStage(group(['not_started', 'done', 'done']))).toMatchObject({ index: 0, allDone: false })
    expect(currentStage(group(['not_started']))).toMatchObject({ index: 0, allDone: false })
    expect(currentStage(group(['done']))).toMatchObject({ index: 0, allDone: true })
  })

  it('counts the stages ticked, whichever they are, as pips', () => {
    expect(pipsOf(group(['done', 'in_progress', 'not_started']))).toEqual({ total: 3, done: 1 })
    expect(pipsOf(group(['not_started', 'done', 'done']))).toEqual({ total: 3, done: 2 })
    expect(pipsOf(group(['done']))).toEqual({ total: 1, done: 1 })
  })

  it('is pinned while any stage is', () => {
    expect(pinnedAt(group(['done', 'done', 'not_started'], [2]))).toBe(true)
    expect(pinnedAt(group(['done', 'done', 'not_started'], [0]))).toBe(true) // a stage that is not the current one
    expect(pinnedAt(group(['done', 'done', 'not_started']))).toBe(false)
  })

  it('shows up to four parts as chips on the card when their names are short enough to fit', () => {
    expect(chipsFit(['Little Meng', 'Little Lulu', 'Little Fei'])).toBe(true)
    expect(chipsFit(['Marjorie', 'Quinn', 'Sara', 'Vile'])).toBe(true)
    expect(chipsFit(['Left', 'Right'])).toBe(true)
    // Six parts, or three long ones, take a bar and "2 of 6 parts" instead.
    expect(chipsFit(['Amurta', 'Spantamad', 'Divine Tree', 'Wall of Samiel', 'Sumpter Beast', 'Fungi'])).toBe(false)
    expect(chipsFit(['Mushroom Version', 'Special Bird Eggs Version', 'Zaytun Peach Version'])).toBe(false)
    expect(chipsFit([])).toBe(false)
  })

  it('is done on the day its last stage was ticked', () => {
    const done = (...days: (string | null)[]): Pick<AchievementGroup, 'stages'> => ({
      stages: days.map((day, index) => stage({ id: index + 1, status: day === null ? 'not_started' : 'done', done_at: day })),
    })
    expect(lastTicked(done('2026-10-02T10:00:00+00:00', '2026-10-09T08:00:00+00:00'))).toBe('2026-10-09T08:00:00+00:00')
    // In whatever order they were ticked, as an import can leave them.
    expect(lastTicked(done('2026-10-12T10:00:00+00:00', '2026-10-09T08:00:00+00:00'))).toBe('2026-10-12T10:00:00+00:00')
    expect(lastTicked(done('2026-10-02T10:00:00+00:00', null))).toBeNull() // not every stage is done
    expect(lastTicked({ stages: [stage({ status: 'done', done_at: null })] })).toBeNull() // done with no day kept
  })

  it("sums up an achievement's stages and primogems over its panel", () => {
    const tunes = {
      stages: [
        stage({ id: 1, reward: 5, status: 'done' }), stage({ id: 2, reward: 10, status: 'done' }), stage({ id: 3, reward: 20 }),
      ],
    }
    expect(panelSummary(tunes)).toBe('3 stages · 35 primogems · 15 of them earned')
    expect(panelSummary({ stages: tunes.stages.map((each) => ({ ...each, status: 'not_started' as const })) }))
      .toBe('3 stages · 35 primogems')
    expect(panelSummary({ stages: [stage({ reward: 5 })] })).toBe('5 primogems')
    expect(panelSummary({ stages: [stage({ reward: 5, status: 'done' })] })).toBe('5 primogems, earned')
  })

  it('numbers the stages in Roman numerals from I', () => {
    expect(Array.from({ length: 10 }, (_, index) => numeral(index))).toEqual([
      'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X',
    ])
    expect([13, 18, 39, 48].map(numeral)).toEqual(['XIV', 'XIX', 'XL', 'XLIX']) // the 14th, 19th, 40th and 49th
  })
})

describe('the achievement list and its updates', () => {
  it('describes the list and what a check found', () => {
    expect(listLine({ source: 'bundled', version: '7.1', stages: 1854, installed_at: null, dated: '2026-09-23', previous: null }))
      .toBe('Achievement list version 7.1, 1,854 achievements, from 2026-09-23 (the copy that came with Guild Board).')
    expect(checkLine({ up_to_date: true, sha256: 's', version: '7.1', stages: 1854, added: [], changed: [], removed: [] }))
      .toBe('Your list is up to date: version 7.1.')
    expect(checkLine({ up_to_date: false, sha256: 's', version: '7.2', stages: 1857,
      added: [{ id: 1, name: 'a', description: 'd', version: '7.2', category: 'c' }], changed: [], removed: [] }))
      .toBe('Version 7.2: 1 new, 0 changed, 0 no longer listed.')
  })

  it('says where a downloaded list came from and when it was installed, and gives no date for a copy that has none', () => {
    const at = '2026-10-13T08:00:00+00:00'
    const previous = { version: '7.1', stages: 1854, installed_at: at }
    expect(listLine({ source: 'github', version: '7.2', stages: 1857, installed_at: at, dated: null, previous }))
      .toBe(`Achievement list version 7.2, 1,857 achievements, downloaded from Paimon.moe and installed ${localTime(at)}.`)
    // An earlier Guild Board's copy, still installed after an update of Guild Board, has no date.
    expect(listLine({ source: 'bundled', version: '7.0', stages: 1800, installed_at: at, dated: null, previous: null }))
      .toBe('Achievement list version 7.0, 1,800 achievements (the copy that came with Guild Board).')
    // The demo downloads nothing: its newer list is made up.
    expect(listLine({ source: 'demo', version: '7.2', stages: 1857, installed_at: at, dated: null, previous }))
      .toBe(`Achievement list version 7.2, 1,857 achievements, made up for the demo and installed ${localTime(at)}.`)
    expect(listLine({ source: 'demo', version: '7.2', stages: 1857, installed_at: null, dated: null, previous }))
      .toBe('Achievement list version 7.2, 1,857 achievements, made up for the demo.')
  })

  it("gives the list's date as a part of its own, which the panel keeps on one line", () => {
    const at = '2026-10-13T08:00:00+00:00'
    expect(listLineParts({ source: 'bundled', version: '7.1', stages: 1854, installed_at: null, dated: '2026-09-23', previous: null }))
      .toEqual([
        { text: 'Achievement list version 7.1, 1,854 achievements, from ', date: false },
        { text: '2026-09-23', date: true },
        { text: ' (the copy that came with Guild Board).', date: false },
      ])
    expect(listLineParts({ source: 'github', version: '7.2', stages: 1857, installed_at: at, dated: null, previous: null }))
      .toEqual([
        { text: 'Achievement list version 7.2, 1,857 achievements, downloaded from Paimon.moe and installed ', date: false },
        { text: localTime(at), date: true },
        { text: '.', date: false },
      ])
    expect(listLineParts({ source: 'bundled', version: '7.0', stages: 1800, installed_at: at, dated: null, previous: null }))
      .toEqual([{ text: 'Achievement list version 7.0, 1,800 achievements (the copy that came with Guild Board).', date: false }])
  })

  it('lists the new stages under their version, the newest first, then their category, at most 50', () => {
    const added = (id: number, version: string, category: string): ListCheck['added'][number] => ({
      id, name: `Stage ${id}`, description: 'd', version, category,
    })
    // As the core lists them: the categories in order, and the stages of each in the order of the file.
    expect(newStages([added(1, '7.2', 'Wonders'), added(2, '7.1', 'Wonders'), added(3, '7.2', 'Wonders'), added(4, '7.2', 'Memories')]))
      .toEqual({
        versions: [
          {
            version: '7.2',
            categories: [
              { category: 'Wonders', stages: [{ id: 1, name: 'Stage 1' }, { id: 3, name: 'Stage 3' }] },
              { category: 'Memories', stages: [{ id: 4, name: 'Stage 4' }] },
            ],
          },
          { version: '7.1', categories: [{ category: 'Wonders', stages: [{ id: 2, name: 'Stage 2' }] }] },
        ],
        more: 0,
      })
    expect(newStages([added(1, '7.9', 'c'), added(2, '7.10', 'c')]).versions.map((group) => group.version))
      .toEqual(['7.10', '7.9'])
    const many = newStages(Array.from({ length: 60 }, (_, index) => added(index + 1, '7.2', 'c')))
    expect(many.versions[0].categories[0].stages.map((stage) => stage.id))
      .toEqual(Array.from({ length: 50 }, (_, index) => index + 1))
    expect(many.more).toBe(10)
  })

  it('lists the changed stages in the order the core gives them, at most 50', () => {
    const changed = Array.from({ length: 60 }, (_, index): ListCheck['changed'][number] => ({
      id: index + 1, name: `Stage ${index + 1}`, what: ['name'],
    }))
    const named = (count: number) => changed.slice(0, count).map(({ id, name }) => ({ id, name }))
    expect(changedStages(changed)).toEqual({ stages: named(50), more: 10 })
    expect(changedStages(changed.slice(0, 50))).toEqual({ stages: named(50), more: 0 })
    expect(changedStages([])).toEqual({ stages: [], more: 0 })
  })

  it('says how many stages a preview leaves out after the 50 it names, and nothing when it names them all', () => {
    expect(moreLine(10)).toBe('And 10 more.')
    expect(moreLine(1)).toBe('And 1 more.')
    expect(moreLine(1204)).toBe('And 1,204 more.')
    expect(moreLine(0)).toBeNull()
  })

  it('offers Go back to the earlier list again only once a list read after the going back names an earlier one', () => {
    const at = '2026-10-13T08:00:00+00:00'
    const installed: ListMeta = {
      source: 'github', version: '7.2', stages: 1857, installed_at: at, dated: null,
      previous: { version: '7.1', stages: 1854, installed_at: at },
    }
    const bundled: ListMeta = { ...installed, source: 'bundled', version: '7.1', stages: 1854, previous: null }
    expect(goBackOffered(installed, 4, null)).toBe(true) // no going back stands
    // Read 4 was asked for before the going back was answered: the earlier list it names is the one gone back to.
    expect(goBackOffered(installed, 4, 4)).toBe(false)
    expect(goBackOffered(installed, 3, 4)).toBe(false)
    expect(goBackOffered(bundled, 5, 4)).toBe(false) // read after it: there is no earlier list
    expect(goBackOffered(installed, 5, 4)).toBe(true) // read after it, once another list was installed
    expect(goBackOffered(bundled, 5, null)).toBe(false)
  })
})

describe('what the page shows', () => {
  const query: Achievements['query'] = {
    view: 'left', category: '0', pinned: false, search: '', unlisted: false, keep: [],
  }
  const categories: Achievements['categories'] = [{ key: '0', name: 'Wonders of the World', stages: 994, left: 292 }]

  it('names what else is kept on a stage the list does not hold, after its note', () => {
    expect(unlistedDetails({ pinned: true, parts: 2, count: 3 })).toBe('Pinned · 2 parts done · Count: 3')
    expect(unlistedDetails({ pinned: false, parts: 1, count: null })).toBe('1 part done')
    expect(unlistedDetails({ pinned: true, parts: 0, count: null })).toBe('Pinned')
    expect(unlistedDetails({ pinned: false, parts: 0, count: 0 })).toBe('Count: 0') // a count set to 0 is kept too
    expect(unlistedDetails({ pinned: false, parts: 12, count: 1312 })).toBe('12 parts done · Count: 1,312')
    expect(unlistedDetails({ pinned: false, parts: 0, count: null })).toBeNull()
  })

  it('names what it shows', () => {
    expect(contentTitle({ query, categories })).toBe('Wonders of the World')
    expect(contentTitle({ query: { ...query, search: 'zoo' }, categories })).toBe('Search results')
    expect(contentTitle({ query: { ...query, pinned: true, search: 'zoo' }, categories })).toBe('Pinned')
    expect(contentTitle({ query: { ...query, unlisted: true }, categories })).toBe('Not in the current list')
  })

  it('names a special category, whatever the query the page reads its counts with', () => {
    expect(contentTitle({ query, categories }, 'timers')).toBe('Timers')
    expect(contentTitle({ query: { ...query, pinned: true }, categories }, 'timers')).toBe('Timers')
    expect(contentTitle({ query: { ...query, unlisted: true }, categories }, 'commissions')).toBe('Daily commissions')
    expect(contentTitle({ query, categories }, null)).toBe('Wonders of the World')
  })

  it('says why nothing is shown', () => {
    expect(emptyLine(query)).toBe('Nothing left here.')
    expect(emptyLine({ ...query, view: 'done' })).toBe('Nothing here is ticked yet.')
    expect(emptyLine({ ...query, view: 'all' })).toBe('This category has no achievements.')
    expect(emptyLine({ ...query, pinned: true })).toBe('Nothing is pinned yet.')
    expect(emptyLine({ ...query, unlisted: true })).toBe('Every achievement you have progress on is in the current list.')
  })

  it('says where a search looked, since it looks only within the view', () => {
    expect(emptyLine({ ...query, search: ' zoo tycoon ' }))
      .toBe('Nothing left matches zoo tycoon. All shows every achievement.')
    expect(emptyLine({ ...query, view: 'done', search: 'winter night' }))
      .toBe('Nothing ticked matches winter night. All shows every achievement.')
    expect(emptyLine({ ...query, view: 'all', search: 'zoo tycoon' })).toBe('No achievement matches zoo tycoon.')
    // Pinned shows every pinned achievement, whatever the view.
    expect(emptyLine({ ...query, pinned: true, search: 'zoo' })).toBe('Nothing pinned matches zoo.')
    expect(emptyLine({ ...query, pinned: true, view: 'done', search: 'zoo' })).toBe('Nothing pinned matches zoo.')
  })
})

describe('where the focus goes when a change takes its card off the list', () => {
  it('goes to the card that took the place: the next one still shown, or else the one before', () => {
    expect(takesPlace([1, 2, 3, 4], [1, 3, 4], 2)).toBe(3)
    expect(takesPlace([1, 2, 3, 4], [1, 4], 2)).toBe(4)
    expect(takesPlace([1, 2, 3], [1, 2], 3)).toBe(2)
    expect(takesPlace([1, 2], [], 2)).toBeNull()
    expect(takesPlace([1, 2], [5, 6], 2)).toBeNull() // other cards altogether, as in another category
  })

  it('goes to the same control, in the state the lost one had before the change', () => {
    const done = (state: boolean): FocusControl => ({ kind: 'done', usable: true, state })
    const pin = (state: boolean): FocusControl => ({ kind: 'pin', usable: true, state })
    // After a tick in Left, the next box to tick; after unpinning in Pinned, the next stage that is pinned.
    expect(matchingControl([done(true), pin(false), done(false), pin(false)], { kind: 'done', ordinal: 0, state: false }))
      .toBe(2)
    expect(matchingControl([done(false), pin(false), done(false), pin(true)], { kind: 'pin', ordinal: 0, state: true }))
      .toBe(3)
    expect(matchingControl([done(true), done(true)], { kind: 'done', ordinal: 1, state: false })).toBe(1)
  })

  it('goes to the control in the same place when it has no state, or else to the first one that can take it', () => {
    const done: FocusControl = { kind: 'done', usable: true, state: false }
    const wiki: FocusControl = { kind: 'wiki', usable: true, state: null }
    const countDown: FocusControl = { kind: 'count-down', usable: false, state: null } // one that cannot take the focus
    expect(matchingControl([done, wiki, done, wiki], { kind: 'wiki', ordinal: 1, state: null })).toBe(3)
    expect(matchingControl([done, wiki], { kind: 'wiki', ordinal: 1, state: null })).toBe(1)
    expect(matchingControl([countDown, done], { kind: 'count-down', ordinal: 0, state: null })).toBe(1)
    expect(matchingControl([wiki, done], { kind: 'note-save', ordinal: 0, state: null })).toBe(1) // the first Done box
    expect(matchingControl([], { kind: 'done', ordinal: 0, state: false })).toBe(-1)
  })
})

describe('the page model it asks for', () => {
  const query: Achievements['query'] = {
    view: 'left', category: null, pinned: false, search: '', unlisted: false, keep: [],
  }

  it('sends only what is chosen or on', () => {
    expect(modelPath(query)).toBe('/api/achievements?view=left')
    expect(modelPath({ ...query, view: 'all', category: '0', search: ' zoo tycoon ' }))
      .toBe('/api/achievements?view=all&category=0&q=zoo+tycoon')
    expect(modelPath({ ...query, search: '   ' })).toBe('/api/achievements?view=left')
    expect(modelPath({ ...query, pinned: true })).toBe('/api/achievements?view=left&pinned=true')
    expect(modelPath({ ...query, unlisted: true })).toBe('/api/achievements?view=left&unlisted=true')
  })

  it('sends the search without the spaces at its ends, so that those spaces ask for nothing new', () => {
    expect(sentSearch('  pirates ')).toBe('pirates')
    expect(sentSearch(' ')).toBe('')
    expect(modelPath({ ...query, search: ' pirates  ' })).toBe(modelPath({ ...query, search: 'pirates' }))
  })

  it('names each achievement to keep, in a fixed order, so that a change to one already kept asks for nothing new', () => {
    expect(modelPath({ ...query, category: '0', keep: [82008, 81732] }))
      .toBe('/api/achievements?view=left&category=0&keep=81732&keep=82008')
    expect(modelPath({ ...query, keep: [81732, 82008] })).toBe(modelPath({ ...query, keep: [82008, 81732] }))
  })

  it('keeps the achievements changed since the player moved on, the 200 most recent', () => {
    expect(keptAfter([], 81732)).toEqual([81732])
    expect(keptAfter([81732, 82008], 81732)).toEqual([82008, 81732]) // changed again: the most recent
    const many = Array.from({ length: 200 }, (_, index) => index + 1)
    expect(keptAfter(many, 500)).toEqual([...many.slice(1), 500]) // the oldest gives way
    expect(keptAfter(many, 1)).toEqual([...many.slice(1), 1])
  })

  it('keeps a changed achievement in the list for a change that could take it off, never for its note alone', () => {
    expect(changesListing({ status: 'done' })).toBe(true)
    expect(changesListing({ pinned: true })).toBe(true)
    expect(changesListing({ part: { index: 0, done: true } })).toBe(true)
    expect(changesListing({ value: 3 })).toBe(true)
    expect(changesListing(undefined)).toBe(true) // the whole achievement's unpin sends no body
    expect(changesListing({ note: 'Ask Mother first.' })).toBe(false)
  })

  it('stays on the category the core opened on, once it has named it', () => {
    const opening: Place = { category: null, pinned: false, unlisted: false, special: null }
    // Asked without a category, the core opened on Wonders of the World ("0"): the page asks for it from then on, so
    // ticking the last achievement left there does not move the page on to another category.
    expect(placeAfter(opening, { ...query, category: '0' })).toEqual({ ...opening, category: '0' })
    const chosen: Place = { category: '17', pinned: false, unlisted: false, special: null }
    expect(placeAfter(chosen, { ...query, category: '0' })).toBe(chosen) // the player's choice stands
    expect(placeAfter(opening, query)).toBe(opening) // a list without categories names none
  })

  it('stays in a special category while the core names the category it reads the counts with', () => {
    // Opened on Timers, the page still asks for the achievements, for the categories' counts.
    const timers: Place = { category: null, pinned: false, unlisted: false, special: 'timers' }
    expect(placeAfter(timers, { ...query, category: '0' })).toEqual({ ...timers, category: '0' })
  })
})

describe('what a click shows until the model holds it', () => {
  const clicked = (answered: number | null): Clicked => ({ value: true, request: 1, answered })

  it('gives way only to a model read asked for after the change was answered', () => {
    // pinned:1 was answered when read 4 was the newest asked for; status:1 is not answered yet.
    const shown = new Map([['pinned:1', clicked(4)], ['status:1', clicked(null)]])
    expect(stillShown(shown, 3)).toBe(shown)
    expect(stillShown(shown, 4)).toBe(shown) // asked for before the answer: it may not hold the change
    expect([...stillShown(shown, 5).keys()]).toEqual(['status:1'])
  })
})

describe('the wiki link', () => {
  const zoo = [1, 2, 3].map((id) => stage({ id, wiki: 'https://wiki/Zoo%20Tycoon' }))

  it('shows once when every stage shares its address, and per stage otherwise', () => {
    expect(sharedWiki({ stages: zoo })).toBe('https://wiki/Zoo%20Tycoon')
    expect(sharedWiki({ stages: [stage({ wiki: 'https://wiki/One' })] })).toBe('https://wiki/One')
    expect(sharedWiki({ stages: [...zoo, stage({ id: 4, wiki: 'https://wiki/Tundra%20Gunsmith%20%28II%29' })] }))
      .toBeNull()
  })
})

describe('a new read of the cards', () => {
  const groups = (): AchievementGroup[] => [
    { ...group(['done', 'not_started']), id: 81732 },
    { ...group(['in_progress']), id: 84508, name: 'Tundra Gunsmith' },
    { ...group(['not_started']), id: 80001 },
  ]

  it('shareGroups keeps the identity of unchanged groups', () => {
    const before = groups()
    expect(shareGroups(null, before)).toBe(before)
    // Read again with nothing changed: the very list before, so that no card is drawn again.
    expect(shareGroups(before, groups())).toBe(before)
    // One stage ticked: that card's group is the new one, and every other is the one before.
    const read = groups()
    read[1] = { ...read[1], stages: [{ ...read[1].stages[0], status: 'done' }] }
    const shared = shareGroups(before, read)
    expect(shared).not.toBe(before)
    expect(shared[0]).toBe(before[0])
    expect(shared[1]).toBe(read[1])
    expect(shared[2]).toBe(before[2])
  })

  it('a card that came, went or moved is a change, and the others keep their identity', () => {
    const before = groups()
    const fewer = groups().slice(1)
    const shared = shareGroups(before, fewer)
    expect(shared).toHaveLength(2)
    expect(shared[0]).toBe(before[1])
    const moved = groups().reverse()
    const reordered = shareGroups(before, moved)
    expect(reordered).not.toBe(before)
    expect(reordered.map((one) => one.id)).toEqual([80001, 84508, 81732])
    expect(reordered[0]).toBe(before[2])
  })
})
