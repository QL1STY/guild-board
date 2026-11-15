import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import './cv.css'
import './planner.css'
import { api, messageOf } from '../../api.ts'
import { Frame } from '../../frame/Frame.tsx'
import { type Live, useModel } from '../../live.ts'
import { hashOf } from '../../route.ts'
import type { PlanBody, Planner as PlannerModel, SetChoice, Slot, WeaponChoice } from '../../types.ts'
import { clipReveal, reducedMotion, rise } from '../../ui/motion.tsx'
import { Picture } from '../../ui/Picture.tsx'
import { Avatar } from './Avatar.tsx'
import { CardPanel } from './CardPanel.tsx'
import { type Choice, noChoice, resolveParty } from './damage.ts'
import { elementClass } from './elements.ts'
import { verdictShown } from './hidden.ts'
import { PieceEditor } from './PieceEditor.tsx'
import { Picker, type PickTile } from './Picker.tsx'
import { floorsOf, listStale, stepLevel, stepTarget, withTalent } from './plannerview.ts'
import { scaleStyle, useCharactersScale } from './scale.ts'
import { SimStats } from './SimStats.tsx'
import {
  backToHers, buildSignature, pieceChanged, pieceCv, simWithGear, startState, swapSet, type Tested, testedStats, totalCv, withPiece, wornSets,
} from './simstate.ts'
import { atkHeadline, raiseKinds, raiseMains, SLOT_LABEL, SLOT_ORDER, statName, tierClass, weaponSubText } from './simview.ts'
import { SyncLine } from './SyncLine.tsx'
import { PageSwitch, Trail } from './Trail.tsx'
import { Counted, Notes, TalentRows, Team, VerdictBox } from './Verdict.tsx'
import { chipOf, countedLine, ENEMY_NOTE, mattersNote, nothingTested, verdictOf } from './verdictview.ts'

const cap = (word: string) => word.charAt(0).toUpperCase() + word.slice(1)

/** A talent's own name without the line of its group: "Self-Evident Proposition" for "Formule Phenomenale: Self-Evident Proposition". */
const shortName = (name: string) => (name.includes(': ') ? name.slice(name.indexOf(': ') + 2) : name)

/** Text in which the labels of a set's bonuses ("2 pieces:", "4 pieces:") are bold. */
function withBoldLabels(text: string): ReactNode {
  return text.split(/(\d pieces:)/).map((part, index) => (index % 2 === 1 ? <b key={index}>{part}</b> : part))
}

/**
 * A target stepper: lower, "now → target", raise. `next` gives the target one step on in a direction; a button rests when
 * that is where it already is, so the ends of the range and the build she has now are the same thing to it.
 */
function Stepper({ label, now, target, next, onStep }: { label: string; now: number | null; target: number; next: (delta: 1 | -1) => number; onStep: (delta: 1 | -1) => void }) {
  return (
    <div className="pp-step">
      <button type="button" aria-label={`Lower the ${label}`} disabled={next(-1) === target} onClick={() => onStep(-1)}>
        −
      </button>
      <span className="pp-lvl">
        {now !== null && <>{now} → </>}
        <b className={now !== null && target > now ? 'up' : undefined}>{target}</b>
      </span>
      <button type="button" aria-label={`Raise the ${label}`} disabled={next(1) === target} onClick={() => onStep(1)}>
        +
      </button>
    </div>
  )
}

type Open = { kind: 'weapon' } | { kind: 'set'; target: string } | null

/** Her build: her talents and the targets of the plan, the weapon and the set(s) under test, each opening a picker. */
function Build({ model, plan, tested, error, verdict, onPlan, onOpen }: {
  model: PlannerModel
  plan: PlanBody
  tested: Tested | null
  error: string | null
  /** Whether the verdict is shown: "Raise" then marks a main talent below 10 (12.3), in place of stage 1's rule. */
  verdict: boolean
  onPlan: (next: PlanBody) => void
  onOpen: (open: NonNullable<Open>) => void
}) {
  const her = model.pronouns.hers
  const floors = floorsOf(model.now_build)
  const hits = model.sim?.hits ?? null
  const raise =
    model.sim === null ? new Set<string>() : verdict && hits !== null ? raiseMains(model.talents, hits) : raiseKinds(model.talents)
  const sets = tested === null ? [] : wornSets(tested)
  const weapon = tested?.weapon ?? null
  const own = model.sim?.weapon ?? null
  return (
    <section className="pp-col" aria-label={`${cap(her)} build`}>
      <h2>
        {cap(her)} build <small>from HoYoLAB</small>
      </h2>
      {error !== null && (
        <p className="pp-error" role="alert">
          {error}
        </p>
      )}
      <div className="pp-blk">
        <h3>Talents</h3>
        {model.talents.map((talent) => (
          <div key={talent.kind} className="pp-trow">
            <Picture src={talent.icon} sign="crown" className="pp-tic" />
            <div>
              <span className="k">
                {talent.label}
                {talent.bonus > 0 ? `, ${talent.bonus} more from constellations` : ''}
                {raise.has(talent.kind) && <span className="pp-raise">Raise</span>}
              </span>
              <span className="n">{shortName(talent.name)}</span>
            </div>
            {talent.now < talent.max ? (
              <Stepper
                label={`${talent.label} target`}
                now={talent.now}
                target={plan.talents[talent.kind]}
                next={(delta) => stepTarget(plan.talents[talent.kind], delta, talent.now, talent.max)}
                onStep={(delta) => onPlan(withTalent(plan, talent.kind, stepTarget(plan.talents[talent.kind], delta, talent.now, talent.max)))}
              />
            ) : (
              <span className="pp-max">
                <b>{talent.max}</b>the most
              </span>
            )}
          </div>
        ))}
        <div className="pp-trow">
          <Avatar src={model.icon} element={model.element} size="40px" dark />
          <div>
            <span className="k">Character</span>
            <span className="n">Level to reach</span>
          </div>
          <Stepper
            label="level target"
            now={model.now_build === null ? null : floors.level}
            target={plan.level}
            next={(delta) => stepLevel(plan.level, delta, floors.level)}
            onStep={(delta) => onPlan({ ...plan, level: stepLevel(plan.level, delta, floors.level) })}
          />
        </div>
        {model.sim !== null && (
          <p className="pp-note">
            {verdict ? <>“Raise” marks one of {her} main talents that is below level 10.</> : <>“Raise” marks a talent within a level of {her} highest one, and below 10.</>}
          </p>
        )}
      </div>

      {weapon !== null && (
        <div className="pp-blk">
          <h3>Weapon</h3>
          <button type="button" className="pp-pick" data-open="weapon" onClick={() => onOpen({ kind: 'weapon' })}>
            <Picture src={weapon.icon} sign="star" className="pp-pic" />
            <div>
              <b>{weapon.name}</b>
              <span>
                {own !== null && own.key === weapon.key ? `Level ${own.level} · R${own.refinement} · ` : 'Level 90 · R1 · '}
                {weapon.base_atk !== null && `Base ATK ${Math.round(weapon.base_atk)}`}
                {weaponSubText(weapon.sub, weapon.sub_value) !== '' && ` · ${weaponSubText(weapon.sub, weapon.sub_value)}`}
              </span>
            </div>
            <em>Change</em>
          </button>
          <div className="pp-trow pp-wrow">
            <div>
              <span className="k">Refinement</span>
              <span className="n">Level to reach</span>
            </div>
            <Stepper
              label="refinement"
              now={model.now_build === null || model.now_build.refinement === null ? null : floors.refinement}
              target={plan.refinement}
              next={(delta) => stepTarget(plan.refinement, delta, floors.refinement, 5)}
              onStep={(delta) => onPlan({ ...plan, refinement: stepTarget(plan.refinement, delta, floors.refinement, 5) })}
            />
          </div>
          <div className="pp-trow pp-wrow">
            <div>
              <span className="k">Weapon level</span>
              <span className="n">Level to reach</span>
            </div>
            <Stepper
              label="weapon level target"
              now={model.now_build === null || model.now_build.weapon_level === null ? null : floors.weaponLevel}
              target={plan.weapon_level}
              next={(delta) => stepLevel(plan.weapon_level, delta, floors.weaponLevel)}
              onStep={(delta) => onPlan({ ...plan, weapon_level: stepLevel(plan.weapon_level, delta, floors.weaponLevel) })}
            />
          </div>
        </div>
      )}

      {tested !== null && (
        <div className="pp-blk">
          <h3>Artifact set{sets.length > 1 ? 's' : ''}</h3>
          {sets.length === 0 && <p className="pp-note">No two pieces share a set, so there is no set bonus.</p>}
          {sets.map(({ set, pieces }, index) => (
            // Keyed by place, so that choosing a set keeps the tile that was pressed (and its focus).
            <div key={index} className="pp-setblk">
              <button type="button" className="pp-pick pp-artset" data-open="set" onClick={() => onOpen({ kind: 'set', target: set.key })}>
                <Picture src={set.icon} sign="flower" className="pp-pic" />
                <div>
                  <b>{set.name}</b>
                  <span>{pieces} of 5 pieces</span>
                </div>
                <em>Change</em>
              </button>
              <div className="pp-setfx">
                {withBoldLabels(`2 pieces: ${set.two_text}`)}
                {pieces >= 4 && <br />}
                {pieces >= 4 && withBoldLabels(`4 pieces: ${set.four_text}`)}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

/** The five pieces as tiles, the Crit Value legend and the editor of the piece that is selected. */
function Artifacts({ model, tested, slot, onSlot, onTested }: {
  model: PlannerModel
  tested: Tested
  slot: Slot
  onSlot: (slot: Slot) => void
  onTested: (next: Tested) => void
}) {
  const sim = model.sim!
  const her = model.pronouns.hers
  return (
    <section className="pp-col" aria-label="Artifacts">
      <h2>
        Artifacts <small>Crit Value = 2 × Crit Rate + Crit DMG</small>
      </h2>
      <div className="pp-pieces">
        {SLOT_ORDER.map((one) => {
          const piece = tested.pieces[one]
          const cv = piece === undefined ? null : pieceCv(sim, piece)
          const icon = sim.pieces.find((hers) => hers.slot === one)?.icon ?? null
          return (
            <button key={one} type="button" className="pp-piece" data-slot={one} aria-pressed={slot === one} onClick={() => onSlot(one)}>
              {pieceChanged(sim, tested, one) && <span className="tested">Tested</span>}
              <Picture src={icon} sign="flower" className="pp-pc" />
              <span className="sl">
                {SLOT_LABEL[one]}
                {piece !== undefined && ` · +${piece.level}`}
              </span>
              <span className="ms">{piece === undefined ? 'Empty' : statName(piece.main, model.element)}</span>
              {cv !== null && (
                <span className={`pp-cv ${tierClass(cv.tier)}`}>
                  {cv.cv.toFixed(1)} <small>CV</small>
                </span>
              )}
            </button>
          )
        })}
      </div>
      <div className="pp-legend">
        Per piece:
        {['under 15', '15', '25', '35', '45', '50', '54.4'].map((label, tier) => (
          <span key={label} className={`pp-cv ${tierClass(tier)}`}>
            {label}
          </span>
        ))}
        · whole set: 180 · 200 · 220 · 240 · 260 · 300
      </div>
      <PieceEditor
        key={slot}
        sim={sim}
        slot={slot}
        piece={tested.pieces[slot]}
        hers={sim.pieces.find((hers) => hers.slot === slot)}
        icon={sim.pieces.find((hers) => hers.slot === slot)?.icon ?? null}
        element={model.element}
        pronouns={model.pronouns}
        onChange={(piece) => onTested(withPiece(tested, slot, piece))}
        onBack={() => onTested(backToHers(sim, tested, slot))}
      />
      <p className="pp-note">The pieces, the weapon and the set are only tested here: nothing is stored, and {her} own build is not changed.</p>
    </section>
  )
}

/** The planner as the model has it (the design's section 6). */
export function PlannerView({ model, plan, error, version = 0, verdict: verdictOn = false, onPlan, onCard }: {
  model: PlannerModel
  /** The plan as the controls show it, which a change moves at once; the model is the answer to the last one sent. */
  plan: PlanBody
  error: string | null
  /** The core's data version (`live.version`): the picker lists are read again when it changes. */
  version?: number
  /** Whether the verdict is shown (the core's switch `characters.VERDICT`, `Status.verdict`): her damage per talent in place of the ATK change. */
  verdict?: boolean
  onPlan: (next: PlanBody) => void
  /** Opens the Card panel; the header's button for it is there while a page gives this. */
  onCard?: () => void
}) {
  const page = useRef<HTMLDivElement>(null)
  const scale = useCharactersScale()
  const her = model.pronouns.hers
  const sim = model.sim
  const [tested, setTested] = useState<Tested | null>(() => (sim === null ? null : startState(sim)))
  const [slot, setSlot] = useState<Slot>('flower')
  const [open, setOpen] = useState<Open>(null)
  const [weapons, setWeapons] = useState<WeaponChoice[] | null>(null)
  const [allSets, setAllSets] = useState<SetChoice[] | null>(null)
  // The version of the core's data each list was read at. A list read at an older one is read again, and shown as it was meanwhile.
  const [weaponsAt, setWeaponsAt] = useState<number | null>(null)
  const [setsAt, setSetsAt] = useState<number | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  // What the player chose for the verdict: the reaction and the recorded hits of each talent, and the toggles. Forgotten with the page.
  const [choice, setChoice] = useState<Choice>(noChoice)

  useLayoutEffect(() => {
    const root = page.current
    if (root === null || reducedMotion()) return
    rise(root.querySelectorAll<HTMLElement>('.pp-col'), { step: 0.1, start: 0.1, duration: 0.6, lift: 18 })
    const giant = root.querySelector<HTMLElement>('.pp-giant')
    if (giant !== null) clipReveal(giant, { from: 'right', duration: 1.3 })
  }, [model.key])

  // The two lists the pickers show are read when one is first opened, and again when the core's data has changed (the background
  // read fills the entries a picker queued), and kept otherwise.
  useEffect(() => {
    if (open === null) return
    let live = true
    if (open.kind === 'weapon' && listStale(weaponsAt, version)) {
      api.get<{ weapons: WeaponChoice[] }>(`/api/characters/${model.key}/weapons`).then(
        (answer) => {
          if (!live) return
          setWeapons(answer.weapons)
          setWeaponsAt(version)
        },
        (failure) => live && setListError(messageOf(failure)),
      )
    }
    if (open.kind === 'set' && listStale(setsAt, version)) {
      api.get<{ sets: SetChoice[] }>(`/api/artifact-sets?character=${encodeURIComponent(model.key)}`).then(
        (answer) => {
          if (!live) return
          setAllSets(answer.sets)
          setSetsAt(version)
        },
        (failure) => live && setListError(messageOf(failure)),
      )
    }
    return () => {
      live = false
    }
  }, [open, weaponsAt, setsAt, version, model.key])

  const now = sim?.panel ?? null
  const result = useMemo(() => (sim === null || tested === null ? null : testedStats(sim, tested)), [sim, tested])
  const total = sim === null || tested === null ? null : totalCv(sim, tested)
  const headline = now === null || result === null ? null : atkHeadline(now, result)
  // her hits for the team the player chose (her usual one until then): what the rows and notes below are read from
  const hits = useMemo(() => (sim?.hits ? resolveParty(sim.hits, choice) : null), [sim, choice])
  const shown = verdictOn && hits !== null
  // the sim with the effects of the weapon and sets under test, which the pickers' routes brought with them
  const geared = useMemo(() => (sim === null || tested === null ? sim : simWithGear(sim, tested)), [sim, tested])
  const answer = useMemo(
    () => (!shown || geared === null || tested === null || result === null ? null : verdictOf(geared, tested, result, choice, model.pronouns)),
    [shown, geared, tested, result, choice, model.pronouns],
  )
  const line = useMemo(
    () => (answer === null || geared === null || tested === null || result === null ? null : countedLine(geared, tested, result, choice, answer, cap(model.pronouns.hers))),
    [answer, geared, tested, result, choice, model.pronouns],
  )
  const matters = answer === null || hits === null ? '' : mattersNote(hits, answer.talents, choice, model.pronouns)
  const chip = answer === null || sim === null || tested === null ? null : chipOf(answer, nothingTested(sim, tested))

  const weaponTiles: PickTile[] | null =
    weapons === null
      ? null
      : weapons.map((weapon) => ({
          key: weapon.key, name: weapon.name, icon: weapon.icon, rarity: weapon.rarity,
          disabled: weapon.base_atk === null,
          lines:
            weapon.base_atk === null ? (
              'Not read yet'
            ) : (
              <>
                {'★'.repeat(weapon.rarity)} · Base ATK {Math.round(weapon.base_atk)}
                <br />
                {weaponSubText(weapon.sub, weapon.sub_value)}
              </>
            ),
        }))
  const setTiles: PickTile[] | null = allSets === null ? null : allSets.map((set) => ({ key: set.key, name: set.name, icon: set.icon, rarity: null, lines: set.two_text === '' ? '' : `2: ${set.two_text}` }))

  const chooseWeapon = (key: string) => {
    const chosen = weapons?.find((weapon) => weapon.key === key)
    if (chosen !== undefined && tested !== null) setTested({ ...tested, weapon: chosen })
    setOpen(null)
  }
  const chooseSet = (key: string) => {
    const chosen = allSets?.find((set) => set.key === key)
    if (chosen !== undefined && tested !== null && open?.kind === 'set') setTested(swapSet(tested, open.target, chosen))
    setOpen(null)
  }

  const about = [model.element, sim?.weapon?.type, model.now_build === null ? null : `Level ${model.now_build.level}`, model.now_build === null ? null : `C${model.now_build.constellation}`].filter((part) => part !== null && part !== undefined)
  return (
    <div className="gb-page pp-page" ref={page} style={scaleStyle(scale)}>
      <article className={`pp-card ${elementClass(model.element)}`}>
        <div className="pp-giant" aria-hidden="true">
          {model.name}
        </div>
        <header className="pp-top">
          <div className="pp-who">
            <Avatar src={model.icon} element={model.element} size="76px" dark />
            <div>
              <h2 className="pp-name">{model.name}</h2>
              <div className="pp-sub">
                {about.join(' · ')}
                {about.length > 0 && ' · '}
                {her} build on HoYoLAB
              </div>
              {onCard !== undefined && (
                <button type="button" className="pp-cardbtn" onClick={onCard}>
                  {cap(her)} card
                </button>
              )}
            </div>
          </div>
          {total !== null && headline !== null && (
            <div className="pp-sum">
              <div className="pp-chip">
                <b className={`pp-cvtotal ${tierClass(total.tier)}`}>{total.total.toFixed(1)}</b>
                <span>Crit Value of {her} artifacts</span>
              </div>
              <div className="pp-chip hero" title={chip === null ? undefined : ENEMY_NOTE}>
                {chip !== null ? (
                  <>
                    <b className={chip.cls}>{chip.text}</b>
                    <span>{chip.sub}</span>
                  </>
                ) : (
                  <>
                    <b className={headline.same ? 'same' : headline.up ? 'up' : 'down'}>{headline.text}</b>
                    <span>Stats with the tested pieces</span>
                  </>
                )}
              </div>
            </div>
          )}
        </header>
        <div className="pp-cols">
          <Build
            model={model}
            plan={plan}
            tested={tested}
            error={error}
            verdict={shown}
            onPlan={onPlan}
            onOpen={(next) => {
              setListError(null)
              setOpen(next)
            }}
          />
          {sim !== null && tested !== null && result !== null && now !== null ? (
            <>
              <Artifacts model={model} tested={tested} slot={slot} onSlot={setSlot} onTested={setTested} />
              <section className="pp-col" aria-label={`${cap(her)} stats with the tested pieces`}>
                <h2>
                  With the tested pieces <small>{answer === null ? `${cap(her)} stats` : `${cap(her)} damage and stats`}</small>
                </h2>
                {answer !== null && hits !== null && sim !== null && line !== null && (
                  <>
                    <VerdictBox verdict={answer} />
                    <TalentRows model={model} hits={hits} tables={sim.tables} verdict={answer} choice={choice} onChoice={setChoice} />
                    <Counted line={line} choice={choice} onChoice={setChoice} hers={her} />
                    {sim.hits !== null && <Team hits={sim.hits} choice={choice} onChoice={setChoice} />}
                    <Notes notes={answer.notes} />
                    <h3 className="pp-h3">{cap(her)} stats</h3>
                  </>
                )}
                <SimStats now={now} tested={result} element={model.element} />
                {answer === null ? (
                  <p className="pp-note">What a set or a weapon does only under a condition is not counted here.</p>
                ) : (
                  hits !== null && matters !== '' && <p className="pp-note">{matters}</p>
                )}
              </section>
            </>
          ) : (
            <section className="pp-col pp-wide" aria-label="Artifacts">
              <h2>Artifacts</h2>
              <p className="pp-note">{cap(her)} is not on your account yet, so there are no artifacts to test.</p>
            </section>
          )}
        </div>
      </article>
      {open !== null && (
        <Picker
          title={open.kind === 'weapon' ? `Choose a ${(sim?.weapon?.type ?? 'weapon').toLowerCase()}` : 'Choose an artifact set'}
          sign={open.kind === 'weapon' ? 'star' : 'flower'}
          tiles={open.kind === 'weapon' ? weaponTiles : setTiles}
          error={listError}
          current={open.kind === 'weapon' ? (tested?.weapon.key ?? '') : open.target}
          element={model.element}
          rarities={open.kind === 'weapon'}
          onPick={open.kind === 'weapon' ? chooseWeapon : chooseSet}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  )
}

/**
 * A character's planner page: it keeps the plan the controls show, sends each change 150 ms after the last, and shows the
 * answer. A change still waiting when the page is left, hidden or closed goes at once, with a request that outlives the
 * page, as the Notes widget's text does (audit L26).
 */
export function Planner({ live, characterKey }: { live: Live; characterKey: string }) {
  const [bump, setBump] = useState(0)
  const { data, error: readError } = useModel<PlannerModel>(`/api/characters/${characterKey}/plan`, live.version + bump)
  const [model, setModel] = useState<PlannerModel | null>(null)
  const [plan, setPlan] = useState<PlanBody | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cardOpen, setCardOpen] = useState(false)
  const timer = useRef(0)
  const sent = useRef(0)
  const pending = useRef(false)
  const waiting = useRef<{ body: PlanBody; mine: number } | null>(null) // the change whose 150 ms have not passed

  // What the core says takes the place of what the page shows, unless a change of the player's is still on its way.
  useEffect(() => {
    if (data === null || pending.current) return
    setModel(data)
    setPlan(data.plan)
  }, [data])

  /** Sends change number `mine`, and shows the answer unless a newer change came meanwhile. */
  const put = useCallback(
    async (body: PlanBody, mine: number, keepalive: boolean) => {
      try {
        const answer = await api.put<PlannerModel>(`/api/characters/${characterKey}/plan`, body, { keepalive })
        if (mine !== sent.current) return
        pending.current = false
        setModel(answer)
        setPlan(answer.plan)
      } catch (failure) {
        if (mine !== sent.current) return
        pending.current = false
        setError(messageOf(failure))
        setBump((count) => count + 1) // read the plan the core has, in place of the one it refused
      }
    },
    [characterKey],
  )
  // The page is left, hidden or closed: the change that waits goes now. Closing the window hides the page a moment before
  // it goes (dashboard.py), and leaving the planner would otherwise take the timer with it.
  const leave = useCallback(() => {
    const change = waiting.current
    if (change === null) return
    window.clearTimeout(timer.current)
    waiting.current = null
    void put(change.body, change.mine, true)
  }, [put])
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') leave()
    }
    window.addEventListener('pagehide', leave)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', leave)
      document.removeEventListener('visibilitychange', onVisibility)
      leave()
    }
  }, [leave])

  const send = (next: PlanBody) => {
    setPlan(next)
    setError(null)
    pending.current = true
    window.clearTimeout(timer.current)
    const mine = (sent.current += 1)
    waiting.current = { body: next, mine }
    timer.current = window.setTimeout(() => {
      waiting.current = null
      void put(next, mine, false)
    }, 150)
  }

  return (
    <Frame
      page="characters"
      live={live}
      heading={
        <Trail
          here={model?.name ?? 'Character'}
          character={model === null ? null : { key: characterKey, icon: model.icon, element: model.element }}
        />
      }
      beside={model !== null && <PageSwitch here={model.name} characterKey={characterKey} view="plan" />}
      controls={model !== null && <SyncLine live={live} sync={model.sync} />}
    >
      {model === null || plan === null ? (
        <div className="gb-panel gb-empty">
          {readError ?? 'Reading the planner…'}
          {readError !== null && (
            <>
              {' '}
              <a href={hashOf({ page: 'characters', view: 'roster' })}>Back to the characters</a>
            </>
          )}
        </div>
      ) : (
        <PlannerView
          // Her build changing under the page (a sync) starts the test again from the new one.
          key={`${model.key}:${model.sim === null ? '' : buildSignature(model.sim)}`}
          model={model}
          plan={plan}
          error={error}
          version={live.version}
          verdict={verdictShown(live.status)}
          onPlan={send}
          onCard={() => setCardOpen(true)}
        />
      )}
      {cardOpen && <CardPanel live={live} characterKey={characterKey} onClose={() => setCardOpen(false)} />}
    </Frame>
  )
}
