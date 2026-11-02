import { type CSSProperties, useLayoutEffect, useRef, useState } from 'react'
import './elements.css'
import './characters.css'
import './endgame.css'
import { api, messageOf } from '../../api.ts'
import { Frame } from '../../frame/Frame.tsx'
import { type Live, useModel } from '../../live.ts'
import type { Element, Endgame as EndgameModel, Roster, TeamView, Week } from '../../types.ts'
import { rise } from '../../ui/motion.tsx'
import { Picture } from '../../ui/Picture.tsx'
import { Segmented } from '../../ui/Segmented.tsx'
import { elementClass, ELEMENTS } from './elements.ts'
import { ElementChip } from './ElementChip.tsx'
import { ReadinessRing } from './ReadinessRing.tsx'
import {
  BUILT, backLabel, clearAction, closeLine, closeShown, endgamePath, faceOf, modeCards, pickKept, theaterBody, theaterNote, theaterPick, weakestLine,
} from './endgameview.ts'
import { toggleFocus } from './rosterview.ts'
import { SyncLine } from './SyncLine.tsx'
import { CharactersTabs } from './Tabs.tsx'

/** A face on a ring; the name is beside it where there is room, and said to a screen reader where there is not. */
function Face({ icon, name, off = false, dps = false, size }: { icon: string | null; name: string; off?: boolean; dps?: boolean; size: string }) {
  return (
    <span className="eg-face" title={name}>
      <Picture
        src={icon}
        sign="bust"
        className={`cx-ava eg-ava${off ? ' off' : ''}${dps ? ' dps' : ''}`}
        style={{ '--size': size } as CSSProperties}
      />
    </span>
  )
}

/** One team: who deals the damage, the team's readiness and a bar for it, and the core's sentence about its weakest member. */
function Team({ team, title, sub }: { team: TeamView; title?: string; sub?: string }) {
  const note = weakestLine(team)
  return (
    <div className="eg-team" data-rise>
      <div className="eg-lab">
        <b>{title ?? team.label}</b>
        <span>{sub ?? `${team.lead_element} damage`}</span>
      </div>
      <div className="eg-faces">
        {team.members.map((member, index) => {
          const face = faceOf(member, index)
          return (
            <div key={member.key} className="eg-fig" title={`${member.name}, ${member.role}: ${member.ready}% ready`}>
              <Face icon={member.icon} name={member.name} off={face.off} dps={face.dps} size="48px" />
              <span>{member.name}</span>
              <em>{member.role}</em>
            </div>
          )
        })}
      </div>
      <div className="eg-tr">
        <b>{team.ready}%</b>
        <span>ready</span>
        <div className="eg-bar">
          <i style={{ width: `${team.ready}%` }} />
        </div>
      </div>
      {note !== null && <div className="eg-why">{note}</div>}
    </div>
  )
}

/** The page's sheets, from the core's model and the player's pick, with the answers of its two buttons given to it. */
export function EndgameView({
  endgame, picked, refusal, onPick, onBack, onFocus,
}: {
  endgame: EndgameModel
  /** The elements the chips show as picked: the player's, until three are in and the core answers. */
  picked: readonly Element[]
  refusal: string | null
  onPick: (element: Element) => void
  /** Takes the player's pick away, so that the calendar's elements show again. */
  onBack: () => void
  onFocus: (key: string) => void
}) {
  const theater = endgame.theater
  return (
    <>
      <section className="eg-modes" aria-label="The three modes">
        {modeCards(endgame).map((mode) => (
          <div key={mode.key} className="gb-panel eg-mode" data-rise>
            <ReadinessRing value={mode.ring} size="74px" count />
            <div>
              <div className="k">{mode.label}</div>
              <div className="v">{mode.value}</div>
              <div className="s">{mode.text}</div>
            </div>
          </div>
        ))}
      </section>

      <div className="eg-cols">
        <div className="eg-left">
          <section className="gb-panel eg-sheet" data-rise>
            <div>
              <h2>Spiral Abyss, floor 12</h2>
              <p className="eg-note">Two teams, one for each half, with no one used twice.</p>
            </div>
            <div className="eg-list">
              {endgame.abyss.length === 0 ? (
                <p className="eg-note">No full team of four yet.</p>
              ) : (
                endgame.abyss.map((team) => <Team key={team.label} team={team} />)
              )}
            </div>
          </section>
          <section className="gb-panel eg-sheet" data-rise>
            <div>
              <h2>Stygian Onslaught</h2>
              <p className="eg-note">Each boss with the elements that do well or badly against it, and your best team for it.</p>
            </div>
            <div className="eg-list tight">
              {endgame.stygian.map((boss) => (
                <div key={boss.name} className="eg-boss" data-rise>
                  <div>
                    <div className="n">{boss.name}</div>
                    <div className="tags">
                      {boss.does_well.map((element) => (
                        <span key={`w-${element}`} className="eg-tag adv">
                          {element} does well
                        </span>
                      ))}
                      {boss.does_badly.map((element) => (
                        <span key={`b-${element}`} className="eg-tag dis">
                          {element} does badly
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="eg-mini">
                    {boss.team === null ? (
                      <span className="eg-note">No team fits yet</span>
                    ) : (
                      <>
                        {boss.team.members.map((member, index) => (
                          <Face key={member.key} icon={member.icon} name={member.name} dps={index === 0} off={member.ready < BUILT} size="34px" />
                        ))}
                        <b>{boss.team.ready}%</b>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <section className="gb-panel eg-sheet eg-theater" data-rise>
          <div>
            <h2>Imaginarium Theater</h2>
            <p className="eg-note">{theaterNote(theater)}</p>
          </div>
          <div className="eg-elsel" role="group" aria-label="Elements of the month">
            {ELEMENTS.map((element) => (
              <button
                key={element}
                type="button"
                className={theater.calendar_elements.includes(element) ? 'month' : undefined}
                aria-pressed={picked.includes(element)}
                onClick={() => onPick(element)}
              >
                <i className={elementClass(element)} aria-hidden="true" />
                {element}
              </button>
            ))}
          </div>
          {pickKept(theater) && (
            <button type="button" className="eg-back" onClick={onBack}>
              {backLabel(theater)}
            </button>
          )}
          <div>
            <h3>Your cast for these elements</h3>
            <div className="eg-cast">
              {theater.cast.length === 0 ? (
                <p className="eg-note">Pick the month&apos;s elements to see your cast.</p>
              ) : (
                theater.cast.map((row) => (
                  <div key={row.element} className={row.thinnest ? 'eg-crow thin' : 'eg-crow'} title={row.thinnest ? 'Your thinnest element this month' : undefined}>
                    <ElementChip element={row.element} />
                    <div className="who">
                      {row.members.length === 0 ? (
                        <span className="eg-note">None yet</span>
                      ) : (
                        row.members.map((member) => <Face key={member.key} icon={member.icon} name={member.name} off={!member.counted} size="40px" />)
                      )}
                    </div>
                    <div className="cnt">
                      {row.ready}
                      <small>ready</small>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
          <div>
            <h3>Teams you can field</h3>
            <div className="eg-list tight">
              {theater.teams.length === 0 ? (
                <p className="eg-note">No full team of four in these elements yet.</p>
              ) : (
                theater.teams.map((team) => <Team key={team.label} team={team} />)
              )}
            </div>
          </div>
          {closeShown(theater) && (
            <div>
              <h3>Close to counting</h3>
              <div className="eg-close">
                {theater.close.map((entry) => (
                  <div key={entry.key} className="eg-cl">
                    <Face icon={entry.icon} name={entry.name} off size="40px" />
                    <div>
                      <b>{entry.name}</b>
                      <span>{closeLine(entry)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>

      <section className="gb-panel eg-sheet eg-clear" data-rise>
        <div>
          <h2>To clear everything</h2>
          <p className="eg-note">What would lift your weakest spots the most, worked out from the teams above.</p>
          {refusal !== null && (
            <p className="eg-refusal" role="status">
              {refusal}
            </p>
          )}
        </div>
        <div className="eg-acts">
          {endgame.clear.length === 0 ? (
            <p className="eg-note">Nothing stands in your way this month.</p>
          ) : (
            endgame.clear.map((action) => {
              const offer = clearAction(action)
              return (
                <div key={action.key} className="eg-act">
                  <Face icon={action.icon} name={action.title} size="52px" />
                  <div>
                    <div className="t">{action.title}</div>
                    <div className="d">{action.text}</div>
                  </div>
                  {offer.href !== null ? (
                    <a className="eg-go" href={offer.href}>
                      {offer.label}
                    </a>
                  ) : (
                    <button type="button" className="eg-go" onClick={() => onFocus(offer.focus ?? action.target)}>
                      {offer.label}
                    </button>
                  )}
                </div>
              )
            })
          )}
        </div>
      </section>
    </>
  )
}

const READINESS = [
  { value: 'now', label: 'Now' },
  { value: 'after', label: 'After your plans' },
] as const

/** Endgame readiness: the Characters plan's second tab, `GET /api/endgame?after=0|1`. */
export function Endgame({ live }: { live: Live }) {
  const [after, setAfter] = useState(false)
  const [bump, setBump] = useState(0)
  const { data, error } = useModel<EndgameModel>(endgamePath(after), live.version + bump)
  const [fresh, setFresh] = useState<{ base: EndgameModel; model: EndgameModel } | null>(null)
  const endgame = data === null ? null : fresh !== null && fresh.base === data ? fresh.model : data
  // The elements as the player has chosen them while there are not yet three; null when the core's are the ones shown.
  const [pending, setPending] = useState<Element[] | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)

  // The page comes in once, when its model first arrives.
  const ready = endgame !== null
  useLayoutEffect(() => {
    if (root.current !== null && ready) rise(root.current.querySelectorAll<HTMLElement>('[data-rise]'), { step: 0.035, start: 0.05 })
  }, [ready])

  const pick = async (element: Element) => {
    if (endgame === null) return
    const next = theaterPick(pending ?? endgame.theater.elements, element)
    const body = theaterBody(next)
    if (body === null) {
      setPending(next)
      return
    }
    try {
      const answer = await api.put<EndgameModel>('/api/endgame/theater', body)
      setFresh({ base: data as EndgameModel, model: answer })
      setPending(null)
      setRefusal(null)
    } catch (failure) {
      setRefusal(messageOf(failure))
    }
  }
  const back = async () => {
    try {
      const answer = await api.delete<EndgameModel>('/api/endgame/theater')
      setFresh({ base: data as EndgameModel, model: answer })
      setPending(null)
      setRefusal(null)
    } catch (failure) {
      setRefusal(messageOf(failure))
    }
  }
  // An action that adds a character to the focus: the focus is read first, since this page does not hold it.
  const addToFocus = async (key: string) => {
    try {
      const roster = await api.get<Roster>('/api/characters')
      const next = toggleFocus(roster.focus.filter((one) => one !== key), key)
      if ('refused' in next) {
        setRefusal(next.refused)
        return
      }
      await api.put<Week>('/api/focus', { characters: next.focus })
      setRefusal(null)
      setBump((count) => count + 1)
    } catch (failure) {
      setRefusal(messageOf(failure))
    }
  }

  return (
    <Frame page="characters" live={live} controls={endgame !== null && <SyncLine live={live} sync={endgame.sync} />}>
      {endgame === null ? (
        <div className="gb-panel gb-empty">{error ?? 'Reading your endgame…'}</div>
      ) : (
        <div className="gb-page eg-page" ref={root}>
          <section className="gb-panel eg-top" data-rise>
            <div className="eg-head">
              <h2>Ready for the endgame</h2>
              <CharactersTabs view="endgame" />
              <span className="eg-grow" />
              <Segmented
                label="Readiness"
                options={READINESS}
                value={after ? 'after' : 'now'}
                onChange={(value) => {
                  setAfter(value === 'after')
                  setPending(null)
                  setFresh(null)
                }}
              />
            </div>
            <p className="eg-note">
              Guild Board builds your teams by itself from your characters, their readiness, their roles and the partners their cards ask for, and checks them
              against this month&apos;s Imaginarium Theater elements, the Spiral Abyss and the Stygian Onslaught bosses. Switch to &quot;After your plans&quot; to see what your focus
              plans will change.
            </p>
          </section>
          <EndgameView
            endgame={endgame}
            picked={pending ?? endgame.theater.elements}
            refusal={refusal}
            onPick={(element) => void pick(element)}
            onBack={() => void back()}
            onFocus={(key) => void addToFocus(key)}
          />
        </div>
      )}
    </Frame>
  )
}
