import { type CSSProperties, type ReactNode, type Ref, useEffect, useLayoutEffect, useRef, useState } from 'react'
import './elements.css'
import './characters.css'
import './week.css'
import { api, messageOf } from '../../api.ts'
import { Frame } from '../../frame/Frame.tsx'
import { Panel, usePanel } from '../../frame/Panel.tsx'
import { type Live, useModel } from '../../live.ts'
import type { Week as WeekModel, WeekDay, WeekTask } from '../../types.ts'
import { reducedMotion, rise, SPRING_EASE, tokenMs } from '../../ui/motion.tsx'
import { Picture } from '../../ui/Picture.tsx'
import { Sign, type SignName } from '../../ui/Sign.tsx'
import { FOCUS_MAX, toggleFocus } from './rosterview.ts'
import { SyncLine } from './SyncLine.tsx'
import { Tip, type TipProps, useTip } from './Tip.tsx'
import { FOUR_AT_MOST, NO_MATCH, ROOM_FOR_ONE } from './words.ts'
import {
  agendaSections, canTick, cellsFor, dayHeads, dimmed, emptyLines, ganttAxis, ganttRows, howLines, moveFocus, pickRows, resinBar, scrollTarget,
  sectionAt, splitRows, tickBody,
} from './weekview.ts'

/** The sign that stands in for a step's material while its picture is missing, by what the step is. */
const MATERIAL_SIGN: Partial<Record<WeekTask['kind'], SignName>> = { books: 'book', weekly: 'boss', boss: 'boss', flowers: 'flower', artifacts: 'stars' }

type Who = { name: (key: string) => string; icon: (key: string) => string | null }

/** A face on a ring: the name always comes beside it, so colour never tells two characters apart. */
function Face({ icon, className }: { icon: string | null; className?: string }) {
  return <Picture src={icon} sign="bust" className={`cx-ava wk-ava${className === undefined ? '' : ` ${className}`}`} />
}

function Step({
  day, task, who, hot, onHot, onTick,
}: {
  day: WeekDay
  task: WeekTask
  who: Who
  hot: string | null
  onHot: (key: string | null) => void
  onTick: (day: WeekDay, task: WeekTask, done: boolean, button: HTMLElement) => void
}) {
  const names = task.who.map(who.name).join(' and ')
  const ticking = canTick(day)
  const cost = task.free ? (task.kind === 'level' ? 'Ready' : 'No resin') : String(task.resin)
  return (
    <li
      className={`wk-step${task.free ? ' free' : ''}${task.done ? ' done' : ''}${dimmed(task, hot) ? ' dim' : ''}${ticking ? '' : ' plain'}`}
      data-key={task.key}
      data-who={task.who.join(' ')}
    >
      <span className="wk-faces">
        {task.who.slice(0, 2).map((key) => (
          <span key={key} className="wk-face" onMouseEnter={() => onHot(key)} onMouseLeave={() => onHot(null)}>
            <Face icon={who.icon(key)} />
          </span>
        ))}
      </span>
      <div className="wk-body">
        <div className="wk-who">{names}</div>
        <div className="wk-what">{task.title}</div>
        <div className="wk-why">
          {task.kind === 'level' ? (
            <Face icon={who.icon(task.who[0])} className="small" />
          ) : (
            <Picture src={task.material?.icon ?? null} sign={MATERIAL_SIGN[task.kind] ?? 'boss'} className="wk-mat" />
          )}
          <span>{task.why}</span>
        </div>
      </div>
      <div className={task.free ? 'wk-cost free' : 'wk-cost'}>
        <b>{cost}</b>
        {!task.free && <span>resin</span>}
      </div>
      {ticking && (
        <button
          type="button"
          className="wk-tick"
          aria-pressed={task.done}
          aria-label={`${task.done ? 'Not done' : 'Done'}: ${task.title}`}
          onClick={(event) => onTick(day, task, !task.done, event.currentTarget)}
        >
          <Sign name="tick" />
        </button>
      )}
    </li>
  )
}

/**
 * The list behind "Add a character": a search box over every character, the ones the player has first and the rest greyed as pre-farm.
 * With the focus full it says so at its top, and no row can be picked.
 */
export function PickList({
  rows, query, full = false, onQuery, onPick,
}: {
  rows: WeekModel['characters']
  query: string
  full?: boolean
  onQuery: (query: string) => void
  onPick: (key: string) => void
}) {
  const box = useRef<HTMLInputElement>(null)
  // Typing starts at once when the list opens.
  useEffect(() => box.current?.focus(), [])
  return (
    <>
      <input
        ref={box}
        type="search"
        className="wk-find"
        aria-label="Search characters"
        placeholder="Search characters"
        autoComplete="off"
        value={query}
        onChange={(event) => onQuery(event.target.value)}
      />
      {full && <p className="wk-full">{FOUR_AT_MOST}</p>}
      <ul className="wk-opts" data-testid="week-pick-list">
        {rows.map((one) => {
          const taken = one.focus !== null
          const locked = taken || full
          return (
            <li key={one.key}>
              <button
                type="button"
                className={`wk-opt${one.owned ? '' : ' pre'}${taken ? ' in' : ''}`}
                aria-disabled={locked ? 'true' : undefined}
                onClick={() => {
                  if (!locked) onPick(one.key)
                }}
              >
                <Face icon={one.icon} />
                <span className="wk-opt-name">{one.name}</span>
                {taken && <em>In focus</em>}
                {!one.owned && <em>Pre-farm</em>}
              </button>
            </li>
          )
        })}
        {rows.length === 0 && <li className="wk-none">{NO_MATCH}</li>}
      </ul>
    </>
  )
}

/** The one button that adds a character to the focus, and the list it opens. */
function AddCharacter({ week, onToggle, button }: { week: WeekModel; onToggle: (key: string) => void; button: Ref<HTMLButtonElement> }) {
  const panel = usePanel()
  const [query, setQuery] = useState('')
  return (
    <div ref={panel.scope} className="wk-add">
      <button
        ref={button}
        type="button"
        className="gb-btn wk-add-btn"
        aria-haspopup="dialog"
        aria-expanded={panel.opener !== null}
        onClick={(event) => {
          setQuery('')
          panel.toggle(event.currentTarget)
        }}
      >
        Add a character
      </button>
      {panel.opener !== null && (
        <Panel label="Add a character" testId="week-pick" className="wk-pick" opener={panel.opener} scope={panel.scope} onClose={panel.close}>
          <PickList
            rows={pickRows(week, query)}
            query={query}
            full={week.focus.length >= FOCUS_MAX}
            onQuery={setQuery}
            onPick={(key) => {
              panel.close(true)
              onToggle(key)
            }}
          />
        </Panel>
      )}
    </div>
  )
}

/** The week as the core says it: the focus, the agenda, the side and the grid. All the state it shows is given, so it draws the same each time. */
export function WeekView({
  week, hot, selected, refusal, onHot, onToggle, onMove, onTick, onOpenDay, onAgendaScroll, agenda, grid, sel,
}: {
  week: WeekModel
  hot: string | null
  selected: number
  refusal: string | null
  onHot: (key: string | null) => void
  onToggle: (key: string) => void
  onMove: (index: number, delta: -1 | 1) => void
  onTick: (day: WeekDay, task: WeekTask, done: boolean, button: HTMLElement) => void
  onOpenDay: (index: number) => void
  onAgendaScroll: () => void
  agenda?: Ref<HTMLDivElement>
  grid?: Ref<HTMLDivElement>
  sel?: Ref<HTMLDivElement>
}) {
  const { tip, tipOf } = useTip()
  const names = new Map(week.characters.map((one) => [one.key, one]))
  const who: Who = { name: (key) => names.get(key)?.name ?? key, icon: (key) => names.get(key)?.icon ?? null }
  const empty = emptyLines(week)
  const sections = agendaSections(week, selected)
  const heads = dayHeads(week)
  const rows = ganttRows(week)
  const split = splitRows(week)
  const hotCard = (key: string) => ({ onMouseEnter: () => onHot(key), onMouseLeave: () => onHot(null) })
  const tipped = (body: ReactNode): TipProps => tipOf(body)
  // Where the keyboard's focus goes when a cross takes its card away: the button that adds one back.
  const add = useRef<HTMLButtonElement>(null)
  return (
    <div className="gb-page wk-page">
      <section className="gb-panel wk-top" aria-label="Your focus" data-rise>
        <div className="wk-roster">
          <span className="wk-lab">Your week&apos;s focus</span>
          <AddCharacter week={week} onToggle={onToggle} button={add} />
          <span className="wk-hint" role="status">
            {refusal}
          </span>
        </div>
        {empty !== null ? (
          <p className="wk-line" data-testid="week-focus">
            {empty.strip}
          </p>
        ) : (
          <div className="wk-focus" data-testid="week-focus">
            {Array.from({ length: 4 }, (_, index) => {
              const card = week.focus[index]
              if (card === undefined) {
                return (
                  <div key={`empty-${index}`} className="wk-fc empty">
                    {ROOM_FOR_ONE}
                  </div>
                )
              }
              return (
                <div key={card.key} className={`wk-fc${hot === card.key ? ' hot' : ''}`} {...hotCard(card.key)}>
                  <Face icon={card.icon} />
                  <div className="wk-fc-text">
                    <b>
                      {card.position}. {card.name}
                    </b>
                    <span className="goal">{card.goal}</span>
                    <span className="when">{card.ready_text}</span>
                  </div>
                  <div className="wk-ord">
                    <button type="button" aria-label={`Plan ${card.name} earlier`} disabled={index === 0} onClick={() => onMove(index, -1)}>
                      <span className="up">
                        <Sign name="chevron" />
                      </span>
                    </button>
                    <button type="button" aria-label={`Plan ${card.name} later`} disabled={index === week.focus.length - 1} onClick={() => onMove(index, 1)}>
                      <Sign name="chevron" />
                    </button>
                  </div>
                  <button type="button" className="wk-out" aria-label={`Take ${card.name} out of the focus`}
                    onClick={() => {
                      onToggle(card.key)
                      add.current?.focus()
                    }}
                  >
                    <Sign name="cross" />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </section>

      <div className="wk-main" data-rise>
        <section className="gb-panel wk-day" aria-label="Day by day">
          <div className="wk-agenda" ref={agenda} onScroll={onAgendaScroll} tabIndex={0}>
            {empty !== null ? (
              <p className="wk-line">{empty.agenda}</p>
            ) : (
              sections.map((section, index) => {
                const day = week.days[index]
                return (
                  <section key={section.day} className={`wk-sec${section.on ? ' on' : ''}`} data-sec={index}>
                    <div className="wk-head">
                      <div>
                        <div className="wk-date">
                          {section.lead !== null && <em>{section.lead} </em>}
                          {section.label}
                        </div>
                        <div className="wk-sub">{section.sub}</div>
                      </div>
                      <div className="wk-resin">
                        <b>{section.resin}</b>
                        <span>{section.note}</span>
                      </div>
                    </div>
                    <div className="wk-rbar">
                      {resinBar(day).map((segment) => (
                        <div
                          key={segment.key}
                          className={`wk-seg${segment.done ? ' done' : ''}${segment.left ? ' left' : ''}`}
                          style={{ flex: segment.resin } as CSSProperties}
                          {...(segment.left ? {} : tipped(`${who.name(segment.who)}: ${segment.resin} resin`))}
                        >
                          {!segment.left && <Face icon={who.icon(segment.who)} />}
                          {segment.text}
                        </div>
                      ))}
                    </div>
                    {section.alert !== null && (
                      <div className={section.alert.loud ? 'wk-alert' : 'wk-alert calm'}>
                        <Sign name="clock" />
                        {section.alert.text}
                      </div>
                    )}
                    {section.steps.length > 0 && (
                      <ol className="wk-steps">
                        {section.steps.map((task) => (
                          <Step key={task.key} day={day} task={task} who={who} hot={hot} onHot={onHot} onTick={onTick} />
                        ))}
                      </ol>
                    )}
                    {section.spare !== null && <div className="wk-spare">{section.spare}</div>}
                    {section.free.length > 0 && (
                      <>
                        <div className="wk-along">On the way, no resin</div>
                        <ol className="wk-steps">
                          {section.free.map((task) => (
                            <Step key={task.key} day={day} task={task} who={who} hot={hot} onHot={onHot} onTick={onTick} />
                          ))}
                        </ol>
                      </>
                    )}
                  </section>
                )
              })
            )}
          </div>
        </section>
        <aside className="gb-panel wk-side">
          {empty === null && (
            <>
          <div className="wk-blk">
            <h2>When each is ready</h2>
            {(
              <div>
                {rows.map((row) => (
                  <div key={row.key} className={`wk-grow${hot !== null && hot !== row.key ? ' dim' : ''}`} {...hotCard(row.key)}>
                    <Face icon={who.icon(row.key)} />
                    <div className="wk-track">
                      {row.solid > 0 && <span className="bar" style={{ width: `${row.solid}%` }} />}
                      {row.fades && <span className="bar luck" style={{ left: `${row.fade.left}%`, width: `${row.fade.width}%` }} />}
                      {row.mark !== null && <span className="m" style={{ left: `${row.mark}%` }} />}
                      <span className="wk-sr">{who.name(row.key)}</span>
                      <span className="lab" style={{ left: 0 }}>
                        {row.left}
                      </span>
                      {row.right !== null && (
                        <span className="lab r" style={{ left: `${row.right.at}%` }}>
                          {row.right.text}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
                <div className="wk-axis" aria-hidden="true">
                  {ganttAxis(week).map((tick, index, all) => (
                    <span key={tick.text} style={{ left: `${tick.at}%` }} className={index === all.length - 1 ? 'last' : undefined}>
                      {tick.text}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="wk-blk">
            <h2>Where this week&apos;s resin goes</h2>
            {(
              <>
                {split.rows.map((row) => (
                  <div key={row.key} className={`wk-srow${hot !== null && hot !== row.key ? ' dim' : ''}`} {...hotCard(row.key)}>
                    <Face icon={who.icon(row.key)} />
                    <span>{who.name(row.key)}</span>
                    <span className="sb">
                      <i style={{ width: `${row.share}%` }} />
                    </span>
                    <b>{row.resin}</b>
                  </div>
                ))}
                <div className="wk-tot">
                  <span>All week</span>
                  <b>{split.total}</b>
                </div>
              </>
            )}
          </div>
            </>
          )}
          <div className="wk-blk wk-how">
            <h2>How it plans</h2>
            {howLines(week.how).map((line) => (
              <div key={line.lead}>
                <Sign name={line.sign} />
                <span>
                  <b>{line.lead}</b>
                  {line.rest}
                </span>
              </div>
            ))}
          </div>
        </aside>
      </div>

      {empty === null && (
      <section className="gb-panel wk-week" aria-label="The week" data-rise>
        <div className="wk-week-head">
          <h2>The week</h2>
          <p>Click a day to open it in the list</p>
        </div>
        {(
          <div className="wk-grid" ref={grid}>
            <div className="wk-sel" ref={sel} aria-hidden="true" />
            <div />
            {heads.map((head, index) => (
              <button
                key={head.day}
                type="button"
                className="wk-dh"
                data-d={index}
                data-reset={head.reset ? '' : undefined}
                aria-current={index === selected ? 'date' : undefined}
                onClick={() => onOpenDay(index)}
              >
                <b>{head.short}</b>
                <span>{head.note}</span>
                <span className="rs">
                  <i style={{ width: `${head.fill}%` }} />
                </span>
              </button>
            ))}
            {week.focus.flatMap((card) => {
              const cells = cellsFor(week, card.key)
              return [
                <div key={`${card.key}-h`} className={`wk-rowh${hot !== null && hot !== card.key ? ' dim' : ''}`} {...hotCard(card.key)}>
                  <Face icon={card.icon} />
                  <div>
                    <b>{card.name}</b>
                    <span>{card.goal}</span>
                  </div>
                </div>,
                ...cells.map((items, index) => (
                  <div key={`${card.key}-${heads[index].day}`} className="wk-cell" data-d={index} data-who={card.key} onClick={() => onOpenDay(index)}>
                    {items.map((item) =>
                      item.ready ? (
                        <span key={item.task.key} className="ready">
                          <Sign name="tick" />
                          {item.label}
                        </span>
                      ) : (
                        <div
                          key={item.task.key}
                          className={`t${item.free ? ' free' : ''}${hot !== null && hot !== card.key ? ' dim' : ''}`}
                          {...tipped(
                            <>
                              <b>
                                {card.name}, {heads[index].short}
                              </b>
                              {item.task.title}
                              {item.task.free ? '' : `, ${item.task.resin} resin`}: {item.task.why}.
                            </>,
                          )}
                        >
                          <Picture src={item.task.material?.icon ?? null} sign={MATERIAL_SIGN[item.task.kind] ?? 'boss'} className="wk-mat small" />
                          <div>
                            <b>{item.label}</b>
                            <span>{item.sub}</span>
                          </div>
                        </div>
                      ),
                    )}
                  </div>
                )),
              ]
            })}
            {heads.some((head) => head.reset) && <div className="wk-reset" aria-hidden="true" />}
          </div>
        )}
      </section>
      )}
      <Tip tip={tip} />
    </div>
  )
}

/** Your week: the Characters plan's agenda, grid and side from `GET /api/week`. A tick and a focus change are sent at once, and the answer is the page. */
export function Week({ live }: { live: Live }) {
  const [bump, setBump] = useState(0)
  const { data, error } = useModel<WeekModel>('/api/week', live.version + bump)
  const [fresh, setFresh] = useState<{ base: WeekModel; week: WeekModel } | null>(null)
  const week = data === null ? null : fresh !== null && fresh.base === data ? fresh.week : data
  const [hot, setHot] = useState<string | null>(null)
  const [selected, setSelected] = useState(0)
  const [refusal, setRefusal] = useState<string | null>(null)
  const agenda = useRef<HTMLDivElement>(null)
  const grid = useRef<HTMLDivElement>(null)
  const sel = useRef<HTMLDivElement>(null)
  const following = useRef(0)
  const framed = useRef(false)
  const root = useRef<HTMLDivElement>(null)

  const send = async (request: () => Promise<WeekModel>) => {
    try {
      const answer = await request()
      if (data !== null) setFresh({ base: data, week: answer })
      setRefusal(null)
    } catch (failure) {
      setRefusal(messageOf(failure))
      setBump((count) => count + 1)
    }
  }
  const putFocus = (characters: string[]) => send(() => api.put<WeekModel>('/api/focus', { characters }))

  const toggle = (key: string) => {
    if (week === null) return
    const next = toggleFocus(week.focus.map((card) => card.key), key)
    if ('refused' in next) {
      setRefusal(next.refused)
      return
    }
    void putFocus(next.focus)
  }
  const move = (index: number, delta: -1 | 1) => {
    if (week === null) return
    void putFocus(moveFocus(week.focus.map((card) => card.key), index, delta))
  }
  const tick = (day: WeekDay, task: WeekTask, done: boolean, button: HTMLElement) => {
    if (!reducedMotion()) button.animate([{ scale: 0.8 }, { scale: 1 }], { duration: 400, easing: SPRING_EASE })
    void send(() => api.put<WeekModel>('/api/week/ticks', tickBody(day, task, done)))
  }

  // The page comes in once, when its model first arrives.
  const ready = week !== null
  useLayoutEffect(() => {
    if (root.current !== null && ready) rise(root.current.querySelectorAll<HTMLElement>('[data-rise]'), { step: 0.05, start: 0.05 })
  }, [ready])

  // The frame round the chosen day in the grid is where that day's column is. `left` and `width` are what moves, never a transform.
  const place = (animate: boolean) => {
    const frame = sel.current
    const head = grid.current?.querySelector<HTMLElement>(`.wk-dh[data-d="${selected}"]`)
    if (frame === null || head === null || head === undefined) return
    const to = { left: `${head.offsetLeft}px`, width: `${head.offsetWidth}px` }
    if (animate && framed.current && !reducedMotion()) {
      frame.animate([{ left: frame.style.left, width: frame.style.width }, to], { duration: tokenMs('--t-move', 280) * 1.6, easing: SPRING_EASE })
    }
    Object.assign(frame.style, to)
    framed.current = true
    // The dashed line of the weekly reset stands at the left edge of the Monday after today.
    const monday = grid.current?.querySelector<HTMLElement>('.wk-dh[data-reset]')
    const line = grid.current?.querySelector<HTMLElement>('.wk-reset')
    if (monday !== null && monday !== undefined && line !== null && line !== undefined) line.style.left = `${monday.offsetLeft - 1}px`
  }
  const days = week?.days.length
  const focused = week?.focus.length
  useLayoutEffect(() => {
    place(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, days, focused])
  useEffect(() => {
    const again = () => place(false)
    window.addEventListener('resize', again)
    return () => window.removeEventListener('resize', again)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected])

  // Scrolling the agenda moves the frame; opening a day from the grid scrolls the agenda, and that scroll does not move the frame back.
  const onAgendaScroll = () => {
    if (following.current > Date.now()) return
    const box = agenda.current
    if (box === null) return
    const tops = [...box.querySelectorAll<HTMLElement>('.wk-sec')].map((section) => section.offsetTop)
    setSelected(sectionAt(tops, box.scrollTop))
  }
  const openDay = (index: number) => {
    const box = agenda.current
    const section = box?.querySelector<HTMLElement>(`.wk-sec[data-sec="${index}"]`)
    setSelected(index)
    if (box === null || section === null || section === undefined) return
    following.current = Date.now() + 700
    box.scrollTo({ top: scrollTarget(section.offsetTop), behavior: reducedMotion() ? 'auto' : 'smooth' })
  }

  return (
    <Frame page="week" live={live} controls={week !== null && <SyncLine live={live} sync={week.sync} />}>
      {week === null ? (
        <div className="gb-panel gb-empty">{error ?? 'Planning your week…'}</div>
      ) : (
        <div ref={root}>
          <WeekView
            week={week}
            hot={hot}
            selected={selected}
            refusal={refusal}
            onHot={setHot}
            onToggle={toggle}
            onMove={move}
            onTick={tick}
            onOpenDay={openDay}
            onAgendaScroll={onAgendaScroll}
            agenda={agenda}
            grid={grid}
            sel={sel}
          />
        </div>
      )}
    </Frame>
  )
}
