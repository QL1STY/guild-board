import type { CSSProperties, ReactNode } from 'react'
import type { Profile } from '../../types.ts'
import { Picture } from '../../ui/Picture.tsx'
import { weaponSign } from './elements.ts'
import {
  agree, goalMark, matWords, objectPronoun, ownLabel, type PaneKey, pieceBar, piecesByCrit, pityBar, pityStory, rollsHeading, rollsSummary, rollUnits, setsView,
  statShares, statTip, talentText, tally, usesCrit, verdictChip, verdictLabel, weaponVerdict,
} from './profileview.ts'
import { CalculatorNote } from './SyncLine.tsx'
import type { TipProps } from './Tip.tsx'

/** What a pane is given: the profile, the tip maker of the card, which constellation is lit by the pointer, and what a click opens. */
export type PaneProps = {
  profile: Profile
  tipOf: (body: ReactNode) => TipProps
  hot: number | null
  setHot: (index: number | null) => void
  onOpenPiece: (key: string) => void
}

const SLOT_LABEL: Record<string, string> = { flower: 'Flower', plume: 'Plume', sands: 'Sands', goblet: 'Goblet', circlet: 'Circlet' }
const index = (i: number) => ({ '--i': i }) as CSSProperties

/** Attributes: each bar cut by where the stat comes from, with the card's goals in gold, and where her substat rolls went. */
function Attributes({ profile, tipOf }: PaneProps) {
  const stats = profile.owned ? profile.stats : profile.stats.filter((row) => row.goal !== null)
  let unit = 0
  return (
    <>
      <h3>Attributes</h3>
      <div className="pf-srcs">
        {profile.owned && (
          <>
            <span>
              <i className="pf-s-her" />
              {ownLabel(profile.pronouns)}
            </span>
            <span>
              <i className="pf-s-weapon" />
              Weapon
            </span>
            <span>
              <i className="pf-s-artifacts" />
              Artifacts
            </span>
          </>
        )}
        <span>
          <i className="goal" />
          What {profile.pronouns.hers} full potential asks for
        </span>
      </div>
      <div>
        {stats.map((row, rowIndex) => {
          const tip = statTip(row)
          const mark = goalMark(row)
          return (
            <div
              key={row.key}
              className="pf-stat"
              {...tipOf(
                <>
                  <b>{tip.title}</b>
                  {tip.how}
                  {tip.goal !== null && (
                    <>
                      <br />
                      {tip.goal}
                    </>
                  )}
                </>,
              )}
            >
              <span className="lab">{row.label}</span>
              <span className="pf-track">
                {profile.owned &&
                  statShares(row).map((share, shareIndex) => (
                    <i key={share.key} className={`pf-seg pf-s-${share.key}`} style={{ width: `${share.width}%`, ...index(rowIndex + shareIndex) }} />
                  ))}
                {mark !== null && <b className="pf-goal" style={{ left: `${mark}%` }} />}
              </span>
              <span className={row.met === true ? 'num met' : 'num'}>{profile.owned ? row.text : (row.goal_text ?? row.text)}</span>
            </div>
          )
        })}
      </div>
      {!profile.owned && (
        <p className="end">
          These are the goals of {profile.pronouns.hers} card. {ownLabel(profile.pronouns)} numbers show here once {agree(profile.pronouns, 'is', 'are')} yours.
        </p>
      )}
      {profile.pieces.length > 0 && (
        <>
          <h3 className="h2 end">{rollsHeading(profile)}</h3>
          <p className="sub">{rollsSummary(profile)}</p>
          <div className="pf-rolls">
            {profile.rolls.map((roll) => (
              <div
                key={roll.key}
                className="pf-rrow"
                {...tipOf(
                  <>
                    <b>
                      {roll.label}: {roll.rolls} {roll.rolls === 1 ? 'roll' : 'rolls'}
                    </b>
                    {roll.where}
                  </>,
                )}
              >
                <span className="lab">{roll.label}</span>
                <span className="pf-units">
                  {rollUnits(roll).map((u) => {
                    unit += 1
                    return <i key={unit} className={`pf-u ${u}`} style={index(unit)} />
                  })}
                </span>
                <span className="cnt">{roll.rolls}</span>
              </div>
            ))}
          </div>
          <div className="pf-ukey">
            <span>
              <i className="pf-u h" style={{ animation: 'none' }} />
              Helps {objectPronoun(profile.pronouns)}
            </span>
            <span>
              <i className="pf-u s" style={{ animation: 'none' }} />
              Some use
            </span>
            <span>
              <i className="pf-u n" style={{ animation: 'none' }} />
              Wasted
            </span>
          </div>
        </>
      )}
    </>
  )
}

/** The colour of the card's verdict on her weapon, by its chip: green to keep it, red to replace it, gold otherwise. */
const VERDICT_TONE: Record<string, string> = { keep: 'pf-good', swap: 'pf-bad' }

/** Weapon: its icon, what it gives, its passive, the card's verdict on it, and the refinement table. */
function Weapon({ profile }: PaneProps) {
  const weapon = profile.weapon
  if (weapon === null) return <p className="pf-empty">No weapon to show: {agree(profile.pronouns, 'is', 'are')} not yours yet.</p>
  const stars = ['', 'One', 'Two', 'Three', 'Four', 'Five'][weapon.rarity] ?? String(weapon.rarity)
  return (
    <>
      <div className="pf-wtop">
        <Picture src={weapon.icon} sign={weaponSign(profile.weapon_type)} className="pf-wicon" />
        <div>
          <h3>{weapon.name}</h3>
          <p className="sub" style={{ margin: '4px 0 0' }}>
            {stars}-star {profile.weapon_type.toLowerCase()}, level {weapon.level}, refinement {weapon.refinement}
          </p>
        </div>
      </div>
      <div className="pf-kv">
        <div>
          <span>Base ATK</span>
          <b>{weapon.base_atk}</b>
        </div>
        <div>
          <span>{weapon.sub?.label ?? 'Second stat'}</span>
          <b>{weapon.sub?.text ?? 'None'}</b>
        </div>
        <div>
          <span>Level</span>
          <b>{weapon.level} of 90</b>
        </div>
        <div>
          <span>Refinement</span>
          <b>{weapon.refinement} of 5</b>
        </div>
      </div>
      <h4>{weapon.passive.name}</h4>
      <p>{weapon.passive.text}</p>
      <p className={VERDICT_TONE[weaponVerdict(weapon.verdict).chip ?? ''] ?? 'pf-mid'}>{weapon.verdict}</p>
      {weapon.refinements.length > 0 && (
        <>
          <h4 className="end">With more copies</h4>
          <table className="pf-rtab">
            <thead>
              <tr>
                <th>Refinement</th>
                {[1, 2, 3, 4, 5].map((n) => (
                  <th key={n} className={n === weapon.refinement ? 'cur' : undefined}>
                    {n}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weapon.refinements.map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  {row.values.map((value, n) => (
                    <td key={n} className={n + 1 === weapon.refinement ? 'cur' : undefined}>
                      {value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  )
}

/** Artifacts: her set or sets with their bonus text, and the pieces in order of crit value, which unfold in the strip. */
function Artifacts(props: PaneProps) {
  const { profile, onOpenPiece } = props
  const sets = setsView(profile.sets, profile.pronouns)
  const crit = usesCrit(profile)
  if (profile.pieces.length === 0 && sets.length === 0) return <p className="pf-empty">No artifacts to show: {agree(profile.pronouns, 'is', 'are')} not yours yet.</p>
  return (
    <>
      {sets.map((set, i) => (
        <div key={set.name}>
          <h3 style={i > 0 ? { marginTop: 14 } : undefined}>{set.name}</h3>
          <p className="sub">{set.sub}</p>
          {set.bonuses.map((bonus) => (
            <div key={bonus.label} className="pf-bonus">
              <b>{bonus.label}</b>
              {bonus.text}
            </div>
          ))}
        </div>
      ))}
      <h3 className="h2 end">{crit ? 'Each piece, by crit value' : `Each piece, by the rolls ${agree(profile.pronouns, 'wants', 'want')}`}</h3>
      <p className="sub">
        {crit ? 'Crit value is Crit Rate × 2 + Crit DMG, from substats.' : `The rolls ${agree(profile.pronouns, 'wants', 'want')}, out of all of its rolls.`} Click a piece to unfold it.
      </p>
      <div>
        {piecesByCrit(profile).map((piece) => (
          <button key={piece.slot} type="button" className="pf-cvrow" onClick={() => onOpenPiece(piece.slot)}>
            <Picture src={piece.icon} sign="flower" />
            <span>
              <b>{SLOT_LABEL[piece.slot]}</b>
              <small>
                {piece.main.label} {piece.main.text}, +{piece.level}
              </small>
            </span>
            <span className="pf-cvbar" aria-hidden="true">
              <i style={{ width: `${pieceBar(piece, crit)}%` }} />
            </span>
            <span className="pf-cvval">
              <b>{crit ? piece.crit_value : `${piece.rolls_wanted} of ${piece.rolls_all}`}</b>
              <em className={`pf-verdict ${verdictChip(piece.verdict)}`}>{verdictLabel(piece.verdict)}</em>
            </span>
          </button>
        ))}
      </div>
    </>
  )
}

/** Constellation: the six names and what they do. Pointing at a row lights its star on the chart, and the other way round. */
function Constellation({ profile, hot, setHot, tipOf }: PaneProps) {
  const name = profile.about.find((row) => row.label === 'Constellation')?.value ?? 'Constellation'
  const owned = profile.constellations.filter((c) => c.owned).length
  return (
    <>
      <h3>{name}</h3>
      <p className="sub">
        {owned} of {profile.constellations.length} unlocked. Point at a star or a name to match them.
      </p>
      <ol className="pf-clist end">
        {profile.constellations.map((c, i) => {
          // A text takes two lines of its row so that all six fit the panel; the tip shows it whole.
          const tip = tipOf(
            <>
              <b>
                C{c.n}. {c.name}
              </b>
              {c.text}
            </>,
          )
          return (
          <li
            key={c.n}
            className={`${c.owned ? 'lit' : ''}${hot === i ? ' hot' : ''}`.trim()}
            {...tip}
            onMouseEnter={() => setHot(i)}
            onMouseLeave={() => {
              tip.onMouseLeave()
              setHot(null)
            }}
          >
            <Picture src={c.icon} sign="stars" />
            <div>
              <div className="pf-cn">
                <span>
                  C{c.n}. {c.name}
                </span>
                <em>{c.owned ? 'Yours' : 'Not yet'}</em>
              </div>
              <div className="pf-cd">{c.text}</div>
            </div>
          </li>
          )
        })}
      </ol>
    </>
  )
}

/** Talents: the three with their levels, and the materials of the next level, with held and needed. */
function Talents({ profile }: PaneProps) {
  const next = profile.next_level
  const level = next === null ? null : profile.talents.find((t) => t.label === next.talent)?.level ?? null
  const raised = profile.talents.some((t) => t.bonus > 0)
  return (
    <>
      <h3>Talents</h3>
      <div>
        {profile.talents.map((t) => (
          <div key={t.kind} className="pf-tal">
            <Picture src={t.icon} sign="crown" />
            <div>
              <div className="k">{t.label}</div>
              <div className="n">{t.name}</div>
              {t.level !== null && (
                <div className="pf-lv" aria-hidden="true">
                  {Array.from({ length: 10 }, (_, j) => (
                    <i key={j} className={j < t.level! ? 'on' : undefined} />
                  ))}
                </div>
              )}
            </div>
            <div className="big">{talentText(t)}</div>
          </div>
        ))}
      </div>
      {raised && <p className="sub" style={{ marginTop: 8 }}>The levels a constellation adds show apart, as in "10 + 3".</p>}
      {next !== null ? (
        <>
          <h3 className="h2 end">{level === null ? next.talent : `${next.talent} from ${level} to ${level + 1}`}</h3>
          <div className="pf-mats">
            {next.materials.map((material) => {
              const words = matWords(material)
              return (
                <div key={material.key} className="pf-mat">
                  <Picture src={material.icon} sign="chest" />
                  <div>
                    {material.name}
                    <div className="have">{words.held}</div>
                  </div>
                  <em className={words.ready ? 'ok' : 'go'}>{words.chip}</em>
                </div>
              )
            })}
          </div>
          <CalculatorNote sync={profile.sync} />
        </>
      ) : (
        profile.owned && <p className="pf-empty">Nothing to raise: every talent is at its highest level.</p>
      )}
    </>
  )
}

/** Story: the pull timeline from Pulls, the wishes spent, and what the game says of her. */
function Story({ profile }: PaneProps) {
  const story = pityStory(profile)
  const total = tally(profile)
  return (
    <>
      <h3>How {profile.pronouns.she} came to you</h3>
      {story.length === 0 ? (
        <p className="sub">The wish history Guild Board keeps has no copy of {objectPronoun(profile.pronouns)}.</p>
      ) : (
        <div className="pf-tl">
          {story.map((entry, i) => {
            const bar = entry.pity === null ? null : pityBar(entry.pity)
            return (
              <div key={`${entry.when}-${i}`} className="e">
                <div className="pf-when">{entry.when}</div>
                <div className="pf-what">
                  {entry.pity === null ? (
                    'Pity not known'
                  ) : (
                    <>
                      Pity <b>{entry.pity}</b>
                    </>
                  )}
                  , {entry.what}
                </div>
                {bar !== null && (
                  <div className="pf-pbar" title={bar.tip}>
                    <i style={{ width: `${bar.fill}%` }} />
                    <b style={{ left: `${bar.soft}%` }} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      {total !== null && (
        <div className="pf-tally">
          <b>{total.total}</b>
          {total.text}
        </div>
      )}
      <h3 className="h2 end">About {objectPronoun(profile.pronouns)}</h3>
      <div className="pf-about">
        {profile.about.map((row) => (
          <div key={row.label}>
            <span>{row.label}</span>
            {row.value}
          </div>
        ))}
      </div>
    </>
  )
}

const PANE_VIEWS: Record<PaneKey, (props: PaneProps) => ReactNode> = {
  attr: Attributes,
  weapon: Weapon,
  arts: Artifacts,
  cons: Constellation,
  talents: Talents,
  story: Story,
}

/** The page of the sidebar that is shown. */
export function Pane({ pane, ...props }: PaneProps & { pane: PaneKey }) {
  const View = PANE_VIEWS[pane]
  return (
    <div className="pf-pane" data-pane={pane} key={pane}>
      <View {...props} />
    </div>
  )
}
