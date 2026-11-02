import { expect, test } from 'vitest'
import fixture from '../../fixtures/characters/week.json'
import type { Week } from '../../types.ts'
import {
  addDays, agendaSections, canTick, cellsFor, dateLabel, dayHeads, dimmed, emptyLines, ganttAxis, ganttRows, howLines, moveFocus, resinBar,
  pickRows, scrollTarget, sectionAt, shortCell, shortDay, splitRows, tickBody,
} from './weekview.ts'

const week = fixture as unknown as Week
const none: Week = { ...week, focus: [], days: week.days.map((day) => ({ ...day, tasks: [], spare: null })), ready: [], resin_by: [], resin_week: 0 }

test("the agenda has a section for each day, today first, with the day's head as the mockup writes it", () => {
  const sections = agendaSections(week)
  expect(sections.map((section) => section.day)).toEqual(week.days.map((day) => day.day))
  expect(sections[0]).toMatchObject({ lead: 'Today,', label: 'Sunday 25 October', resin: '200 of 200', note: 'resin you have now', on: true })
  expect(sections[1]).toMatchObject({ lead: null, label: 'Monday 26 October', resin: '180 of 180', note: "resin, one day's worth" })
  expect(sections[0].sub).toBe('4 with resin, 2 on the way')
  expect(sections[1].sub).toBe('1 with resin, nothing on the way')
})

test('a day that starts with more than a day of resin says what carried over', () => {
  expect(agendaSections(week)[3]).toMatchObject({ resin: '180 of 190', note: 'resin, with what carried over' })
})

test('each section lists the steps that cost resin, then the ones on the way, which cost none', () => {
  const sunday = agendaSections(week)[0]
  expect(sunday.steps.map((task) => task.kind)).toEqual(['weekly', 'books', 'weekly', 'books'])
  expect(sunday.free.map((task) => task.kind)).toEqual(['flowers', 'level'])
  expect(sunday.alert).toEqual({ text: 'Weekly bosses reset tomorrow at 04:00: do them today.', loud: true })
  expect(agendaSections(week)[1].alert?.loud).toBe(false)
})

test('the resin bar has a segment for each step by its resin, and what is left over', () => {
  const sunday = week.days[0]
  expect(resinBar(sunday).map((segment) => [segment.resin, segment.who, segment.done])).toEqual([
    [30, 'sandrone', false], [120, 'sandrone', false], [30, 'odette', false], [20, 'odette', false],
  ])
  expect(resinBar(sunday).at(-1)?.left).toBe(false)
  expect(resinBar(week.days[2]).at(-1)).toMatchObject({ left: true, resin: 10, text: '10 left' })
  const done = { ...sunday, tasks: sunday.tasks.map((task, index) => (index === 0 ? { ...task, done: true } : task)) }
  expect(resinBar(done)[0].done).toBe(true)
})

test("a spare day says how much resin carries over, in the plan's words, even when the core gave no line", () => {
  const quiet = { ...week, days: week.days.map((day, index) => (index === 1 ? { ...day, tasks: [], spent: 0, spare: null } : day)) }
  expect(agendaSections(quiet)[1].spare).toBe('Nothing to farm with resin today: 180 resin carry over.')
  const said = { ...quiet, days: quiet.days.map((day, index) => (index === 1 ? { ...day, spare: 'Nothing left to farm: 180 resin carry over.' } : day)) }
  expect(agendaSections(said)[1].spare).toBe('Nothing left to farm: 180 resin carry over.')
  expect(agendaSections(week)[1].spare).toBeNull()
})

test('the scroll position names the section the agenda is at: the last one that has reached the top', () => {
  const tops = [0, 700, 1100, 1900, 2300]
  expect(sectionAt(tops, 0)).toBe(0)
  expect(sectionAt(tops, 630)).toBe(0)
  expect(sectionAt(tops, 640)).toBe(1) // 60 px of the next one showing at the top is enough
  expect(sectionAt(tops, 1100)).toBe(2)
  expect(sectionAt(tops, 99999)).toBe(4)
  expect(sectionAt([], 50)).toBe(0)
})

test('opening a day scrolls the agenda to just above its section', () => {
  expect(scrollTarget(1100)).toBe(1080)
  expect(scrollTarget(0)).toBe(0)
})

test('the grid has a column for each day: its short date, today or the weekly reset, and the share of its resin', () => {
  const heads = dayHeads(week)
  expect(heads.map((head) => head.short)).toEqual(['Sun 25', 'Mon 26', 'Tue 27', 'Wed 28', 'Thu 29', 'Fri 30', 'Sat 31'])
  expect(heads.map((head) => head.note)).toEqual(['Today', 'Weekly reset', '', '', '', '', ''])
  expect(heads[0].fill).toBe(100)
  expect(Math.round(heads[2].fill)).toBe(94)
  expect(heads.map((head) => head.reset)).toEqual([false, true, false, false, false, false, false])
  expect(shortDay('2026-11-03')).toBe('Tue 3')
})

test("the grid has a cell for each character and day, with only that character's tasks, short as the mockup has them", () => {
  const sandrone = cellsFor(week, 'sandrone')
  expect(sandrone).toHaveLength(7)
  expect(sandrone[0].map((item) => item.label)).toEqual(['The Doctor', 'Books, 6 runs', 'Ready'])
  expect(sandrone[0].map((item) => item.sub)).toEqual(['30 resin', '120 resin', ''])
  expect(sandrone[0].map((item) => item.ready)).toEqual([false, false, true])
  expect(sandrone[1]).toEqual([])
  expect(sandrone[2].map((item) => item.label)).toEqual(['Artifacts, 1'])
  const alyosha = cellsFor(week, 'alyosha')
  expect(alyosha[0].map((item) => [item.label, item.sub, item.free])).toEqual([['Pick 14', 'no resin', true]])
  expect(alyosha[2].map((item) => item.label)).toEqual(['Boss, 3 runs', 'Pick 9', 'Ready'])
})

test('a short cell is read from the task, by its kind', () => {
  const task = (kind: string, title: string) => ({ kind, title }) as Week['days'][number]['tasks'][number]
  expect(shortCell(task('books', 'Overturned Roost, 6 runs'))).toBe('Books, 6 runs')
  expect(shortCell(task('books', 'Overturned Roost, 1 run'))).toBe('Books, 1 run')
  expect(shortCell(task('boss', 'Chimeric Winged Lions, 3 runs'))).toBe('Boss, 3 runs')
  expect(shortCell(task('weekly', 'Il Dottore, weekly boss'))).toBe('Il Dottore')
  expect(shortCell(task('artifacts', 'An artifact domain, 7 runs'))).toBe('Artifacts, 7')
  expect(shortCell(task('flowers', 'Pick 14 Flockingweed in Fellfrost Peak'))).toBe('Pick 14')
  expect(shortCell(task('enemies', 'Hunt something, 4 runs'))).toBe('Hunt something, 4 runs')
  expect(shortCell(task('level', 'Raise her to level 80'))).toBe('Ready')
})

test('a step can be ticked on today only, and a tick is sent with its day and its task', () => {
  expect(canTick(week.days[0])).toBe(true)
  expect(canTick(week.days[1])).toBe(false)
  const task = week.days[0].tasks[0]
  expect(tickBody(week.days[0], task, true)).toEqual({ day: '2026-10-25', task: task.key, done: true })
  expect(tickBody(week.days[0], { ...task, done: true }, false).done).toBe(false)
})

test('pointing at a character lights only their tasks and dims the others', () => {
  const [weekly, books] = week.days[0].tasks
  expect(dimmed(weekly, null)).toBe(false)
  expect(dimmed(weekly, 'sandrone')).toBe(false)
  expect(dimmed(weekly, 'odette')).toBe(true)
  expect(dimmed({ ...books, who: ['sandrone', 'odette'] }, 'odette')).toBe(false)
})

test('a focus card moves one place earlier or later, and not past either end', () => {
  const keys = ['a', 'b', 'c']
  expect(moveFocus(keys, 1, -1)).toEqual(['b', 'a', 'c'])
  expect(moveFocus(keys, 1, 1)).toEqual(['a', 'c', 'b'])
  expect(moveFocus(keys, 0, -1)).toEqual(keys)
  expect(moveFocus(keys, 2, 1)).toEqual(keys)
})

test("dates are added to a day in the core's own calendar, whatever the browser's clock says", () => {
  expect(addDays('2026-10-25', 7)).toBe('2026-11-01')
  expect(addDays('2026-12-30', 3)).toBe('2027-01-02')
  expect(dateLabel('2026-11-11')).toBe('Wed 11 Nov')
})

test('"when each is ready" has a bar for each character: a luck one fades out from the day her talents are done, with a mark at its half', () => {
  const rows = ganttRows(week)
  expect(rows.map((row) => row.key)).toEqual(['sandrone', 'odette', 'alyosha', 'jahoda'])
  const [sandrone, odette] = rows
  expect(sandrone.fades).toBe(true)
  expect(sandrone.solid).toBeCloseTo(1.5)
  expect(sandrone.fade.left).toBeCloseTo(2.5)
  expect(sandrone.fade.width).toBeCloseTo(97.5)
  expect(sandrone.mark).toBeCloseTo((17 / 21) * 100)
  expect(sandrone.left).toBe('Talents today')
  expect(sandrone.right).toEqual({ at: expect.closeTo((17 / 21) * 100, 5), text: 'goblet: half a chance by Wed 11 Nov' })
  expect(odette.fades).toBe(false)
  expect(odette.solid).toBeCloseTo((4 / 21) * 100)
  expect(odette.left).toBe('Ready Thu 29 Oct')
  expect(odette.mark).toBeNull()
  expect(odette.right).toBeNull()
  const axis = ganttAxis(week)
  expect(axis.map((tick) => tick.text)).toEqual(['Sun 25', 'Sun 1', 'Sun 8', 'Sun 15'])
  expect(axis.map((tick) => Math.round(tick.at))).toEqual([0, 33, 67, 100])
})

test("a character who is not ready within the weeks the plan looks at has a full, faded bar and the core's words", () => {
  const far = { ...week, ready: [{ key: 'sandrone', until: null, luck: null, text: 'Not within three weeks' }] }
  const [row] = ganttRows(far)
  expect(row).toMatchObject({ fades: true, solid: 0, left: 'Not within three weeks', right: null, mark: null })
  expect(row.fade).toEqual({ left: 0, width: 100 })
})

test("where the resin goes lists the most first, each bar as a share of the most, and the week's total", () => {
  const split = splitRows(week)
  expect(split.rows.map((row) => [row.key, row.resin])).toEqual([['sandrone', 670], ['odette', 270], ['jahoda', 210], ['alyosha', 120]])
  expect(split.rows[0].share).toBe(100)
  expect(split.rows[1].share).toBeCloseTo((270 / 670) * 100)
  expect(split.total).toBe('1,270 of 1,280')
})

test('"how it plans" has each line with its first clause in bold, and a sign', () => {
  const lines = howLines(week.how)
  expect(lines).toHaveLength(4)
  expect(lines[0]).toMatchObject({ lead: 'Weekly bosses come first', sign: 'boss' })
  expect(lines[0].rest.startsWith(': one run serves everyone')).toBe(true)
  expect(lines[1].lead).toBe('Then the books open today')
  expect(lines.map((line) => line.sign)).toEqual(['boss', 'book', 'flower', 'tick'])
})

const everyone: Week = {
  ...week,
  characters: [
    { key: 'zhongli', name: 'Zhongli', icon: null, owned: true, focus: 2 },
    { key: 'amber', name: 'Amber', icon: null, owned: false, focus: null },
    { key: 'nefer', name: 'Nefer', icon: null, owned: true, focus: null },
    { key: 'albedo', name: 'Albedo', icon: null, owned: false, focus: 1 },
    { key: 'bennett', name: 'Bennett', icon: null, owned: true, focus: null },
  ],
}

test('the picker lists the characters the player has first, then the rest, each by name, with the focus marked', () => {
  expect(pickRows(everyone, '').map((row) => row.key)).toEqual(['bennett', 'nefer', 'zhongli', 'albedo', 'amber'])
  expect(pickRows(everyone, '').filter((row) => row.focus !== null).map((row) => row.key)).toEqual(['zhongli', 'albedo'])
})

test('the picker narrows by what is typed, in any case and from any part of the name, and keeps its order', () => {
  expect(pickRows(everyone, 'ER').map((row) => row.key)).toEqual(['nefer', 'amber'])
  expect(pickRows(everyone, '  bEn ').map((row) => row.key)).toEqual(['bennett'])
  expect(pickRows(everyone, 'xyz')).toEqual([])
})

test('an empty week shows one line, not empty boxes', () => {
  expect(emptyLines(week)).toBeNull()
  expect(emptyLines(none)).toEqual({ strip: 'Choose up to four characters to plan for.', agenda: 'Nothing to show until you choose a character.' })
  expect(agendaSections(none)).toEqual([])
  expect(ganttRows(none)).toEqual([])
  expect(splitRows(none).rows).toEqual([])
})
