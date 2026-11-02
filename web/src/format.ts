export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** 4812 -> "4,812" */
export function num(value: number): string {
  return Math.round(value).toLocaleString('en-US')
}

/** A percentage. Without decimals it is rounded down, so that 99.6 never reads as "100%". */
export function pct(value: number, digits: 0 | 1 = 0): string {
  if (digits === 0) return `${Math.floor(value + 1e-9)}%`
  const text = value.toFixed(1)
  return `${text.endsWith('.0') ? text.slice(0, -2) : text}%`
}

/** What is left of an exploration: "0.9% left", "12% left". */
export function left(remaining: number): string {
  return `${pct(remaining, remaining < 10 ? 1 : 0)} left`
}

/** Minutes as "45 min" or "1 h 12 min". */
export function duration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes))
  const hours = Math.floor(total / 60)
  const rest = total % 60
  return hours === 0 ? `${rest} min` : `${hours} h ${String(rest).padStart(2, '0')} min`
}

/** The parts of a calendar date written as "2026-09-14". No time zone is involved. */
function parts(day: string): { year: number; month: number; date: number } {
  const [year, month, date] = day.split('-').map(Number)
  return { year, month, date }
}

/** "2026-09-14" -> "14 Sep" */
export function dayMonth(day: string): string {
  const { month, date } = parts(day)
  return `${date} ${MONTHS[month - 1]}`
}

/** "2026-10-13" -> "Tue" */
export function weekday(day: string): string {
  const { year, month, date } = parts(day)
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, date)).getUTCDay()]
}

/** "2026-09-14" -> "Sep" */
export function monthName(day: string): string {
  return MONTHS[parts(day).month - 1]
}

/** "14 Sep to 13 Oct" */
export function period(first: string, last: string): string {
  return first === last ? dayMonth(first) : `${dayMonth(first)} to ${dayMonth(last)}`
}

/** How long ago an instant was. `now` is the core's time, not the browser's. */
export function ago(instant: string, now: Date): string {
  const seconds = (now.getTime() - Date.parse(instant)) / 1000
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const then = new Date(instant)
  return `on ${then.getDate()} ${MONTHS[then.getMonth()]}`
}

/** An instant in the PC's own time: "13 Oct, 10:02". */
export function localTime(instant: string): string {
  const then = new Date(instant)
  const clock = `${String(then.getHours()).padStart(2, '0')}:${String(then.getMinutes()).padStart(2, '0')}`
  return `${then.getDate()} ${MONTHS[then.getMonth()]}, ${clock}`
}

/** The day of an instant in the PC's own time: "13 Oct". */
export function localDay(instant: string): string {
  const then = new Date(instant)
  return `${then.getDate()} ${MONTHS[then.getMonth()]}`
}

/** "1 area", "3 areas" */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${num(count)} ${count === 1 ? one : many}`
}

/** Seconds as "4:12", for the wait on the Sync button. */
export function countdown(seconds: number): string {
  const total = Math.max(0, Math.ceil(seconds))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** A change with its direction: "▲ 21", "▼ 5". Zero is "no change". */
export function change(value: number, text: (amount: number) => string = num): string {
  if (value === 0) return 'no change'
  return `${value > 0 ? '▲' : '▼'} ${text(Math.abs(value))}`
}
