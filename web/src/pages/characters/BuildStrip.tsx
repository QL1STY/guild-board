import { type CSSProperties, type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PieceView, Profile, WeaponView } from '../../types.ts'
import { reducedMotion, rise, SPRING_EASE } from '../../ui/motion.tsx'
import { Picture } from '../../ui/Picture.tsx'
import { weaponSign } from './elements.ts'
import { objectPronoun, rollUnits, unfoldSegments, verdictChip, verdictLabel, weaponVerdict } from './profileview.ts'

const SLOT_LABEL: Record<PieceView['slot'], string> = { flower: 'Flower', plume: 'Plume', sands: 'Sands', goblet: 'Goblet', circlet: 'Circlet' }
const index = (i: number) => ({ '--i': i }) as CSSProperties

/** Which of the strip's pieces is open: a slot's name, or `weapon`. */
export type OpenKey = PieceView['slot'] | 'weapon'

function WeaponCard({ weapon, profile, open, onOpen }: { weapon: WeaponView; profile: Profile; open: boolean; onOpen: () => void }) {
  const verdict = weaponVerdict(weapon.verdict)
  return (
    <button type="button" className={open ? 'pf-pc open' : 'pf-pc'} aria-expanded={open} aria-controls="pf-unfold" data-open="weapon" onClick={onOpen}>
      <span className="pf-pc-top">
        <span className="pf-pc-ic">
          <Picture src={weapon.icon} sign={weaponSign(profile.weapon_type)} />
          <span className="pf-lvl">{weapon.level}</span>
        </span>
        <span>
          <span className="pf-pc-slot">
            Weapon {verdict.chip !== null && <em className={`pf-verdict ${verdict.chip}`}>{verdict.label}</em>}
          </span>
          <span className="pf-pc-main">
            {weapon.name}
          </span>
        </span>
      </span>
      <span className="pf-pc-sub">Base ATK {weapon.base_atk}</span>
      <span className="pf-pc-sub">{weapon.sub === null ? 'No second stat' : `${weapon.sub.label} ${weapon.sub.text}`}</span>
      <span className="pf-pc-sub">Refinement {weapon.refinement}</span>
    </button>
  )
}

function PieceCard({ piece, open, onOpen }: { piece: PieceView; open: boolean; onOpen: () => void }) {
  return (
    <button type="button" className={open ? 'pf-pc open' : 'pf-pc'} aria-expanded={open} aria-controls="pf-unfold" data-open={piece.slot} onClick={onOpen}>
      <span className="pf-pc-top">
        <span className="pf-pc-ic">
          <Picture src={piece.icon} sign="flower" />
          <span className="pf-lvl">+{piece.level}</span>
        </span>
        <span>
          <span className="pf-pc-slot">
            {SLOT_LABEL[piece.slot]} <em className={`pf-verdict ${verdictChip(piece.verdict)}`}>{verdictLabel(piece.verdict)}</em>
          </span>
          <span className="pf-pc-main">
            {piece.main.label} {piece.main.text}
          </span>
        </span>
      </span>
      {piece.subs.map((sub) => (
        <span key={sub.key} className="pf-pc-sub">
          <span>
            {sub.label} {sub.text}
          </span>
          <span className="pf-dots" role="img" aria-label={`${sub.rolls} ${sub.rolls === 1 ? 'roll' : 'rolls'}`}>
            {rollUnits(sub).map((unit, i) => (
              <i key={i} className={unit} />
            ))}
          </span>
        </span>
      ))}
    </button>
  )
}

/** A piece "in better light": a big icon, the main stat, each substat with its six segments, and the verdict and why. */
function PieceDetail({ piece, profile }: { piece: PieceView; profile: Profile }) {
  const root = useRef<HTMLDivElement>(null)
  useUnfoldMotion(root)
  return (
    <div className="pf-uf" ref={root}>
      <div className="pf-uf-art">
        <div className="pf-uf-ic">
          <Picture src={piece.icon} sign="flower" />
        </div>
        <div className="pf-uf-name">{piece.name}</div>
        <div className="pf-uf-set">
          {piece.set_name}, {SLOT_LABEL[piece.slot]}, +{piece.level}
        </div>
      </div>
      <div>
        <div className="pf-uf-main">
          <span>{piece.main.label}</span>
          <b>{piece.main.text}</b>
          <em>main stat</em>
        </div>
        {piece.subs.map((sub) => (
          <div key={sub.key} className="pf-uf-sub">
            <span className="nm">{sub.label}</span>
            <b>{sub.text}</b>
            <span className="pf-segs" aria-hidden="true">
              {unfoldSegments(sub).map((unit, i) => (
                <i key={i} className={unit} style={index(i)} />
              ))}
            </span>
            <em>
              {sub.rolls} of 6 possible rolls
            </em>
          </div>
        ))}
      </div>
      <div className="pf-uf-judge">
        <em className={`pf-verdict ${verdictChip(piece.verdict)}`}>{verdictLabel(piece.verdict)}</em>
        <p>{piece.why}</p>
        <div className="pf-uf-cv">
          <div>
            <b>{piece.crit_value}</b>
            <span>crit value</span>
          </div>
          <div>
            <b>
              {piece.rolls_wanted} of {piece.rolls_all}
            </b>
            <span>rolls help {objectPronoun(profile.pronouns)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function WeaponDetail({ weapon, profile }: { weapon: WeaponView; profile: Profile }) {
  const root = useRef<HTMLDivElement>(null)
  useUnfoldMotion(root)
  const verdict = weaponVerdict(weapon.verdict)
  const stars = ['', 'One', 'Two', 'Three', 'Four', 'Five'][weapon.rarity] ?? String(weapon.rarity)
  return (
    <div className="pf-uf" ref={root}>
      <div className="pf-uf-art">
        <div className="pf-uf-ic">
          <Picture src={weapon.icon} sign={weaponSign(profile.weapon_type)} />
        </div>
        <div className="pf-uf-name">{weapon.name}</div>
        <div className="pf-uf-set">
          {stars}-star {profile.weapon_type.toLowerCase()}, level {weapon.level}, refinement {weapon.refinement}
        </div>
      </div>
      <div>
        <div className="pf-uf-main">
          <span>Base ATK</span>
          <b>{weapon.base_atk}</b>
          {weapon.sub !== null && (
            <em>
              and {weapon.sub.label} {weapon.sub.text}
            </em>
          )}
        </div>
        <h4 style={{ margin: '0 0 6px', fontFamily: 'var(--c-serif)', fontWeight: 800, color: 'var(--c-gold)', fontSize: 17 }}>{weapon.passive.name}</h4>
        <p style={{ margin: 0, color: 'var(--c-star2)', lineHeight: 1.5 }}>{weapon.passive.text}</p>
      </div>
      <div className="pf-uf-judge">
        {verdict.chip !== null && <em className={`pf-verdict ${verdict.chip}`}>{verdict.label}</em>}
        <p>{verdict.text}</p>
        <div className="pf-uf-cv">
          <div>
            <b>{weapon.base_atk}</b>
            <span>base ATK</span>
          </div>
          {weapon.sub !== null && (
            <div>
              <b>{weapon.sub.text}</b>
              <span>{weapon.sub.label}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** What happens as a piece opens: its parts rise in one after another, and its icon turns in with a little spring. */
function useUnfoldMotion(root: RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const element = root.current
    if (element === null || reducedMotion()) return
    rise(element.children as HTMLCollectionOf<HTMLElement>, { step: 0.07, start: 0.12, duration: 0.4, lift: 14 })
    element.querySelector<HTMLElement>('.pf-uf-ic .pic')?.animate(
      [
        { scale: 0.6, rotate: '-8deg' },
        { scale: 1, rotate: '0deg' },
      ],
      { duration: 700, easing: SPRING_EASE },
    )
  }, [root])
}

/**
 * Her build as a strip of six, the weapon and five pieces with every stat at a glance, and the unfolding below it: a
 * click on a piece opens it "in better light", and the same click, or another piece, closes it or changes it. The
 * unfolding grows to its own height (`interpolate-size`), and keeps the piece that was open while it closes.
 */
export function BuildStrip({ profile, openKey, onOpen }: { profile: Profile; openKey: OpenKey | null; onOpen: (key: OpenKey) => void }) {
  const [shown, setShown] = useState<OpenKey | null>(openKey)
  useEffect(() => {
    if (openKey !== null) setShown(openKey)
  }, [openKey])
  const strip = useRef<HTMLDivElement>(null)
  const weapon = profile.weapon
  const piece = shown === null || shown === 'weapon' ? null : (profile.pieces.find((one) => one.slot === shown) ?? null)
  return (
    <>
      <div className="pf-strip" ref={strip} data-testid="build-strip">
        {weapon !== null && <WeaponCard weapon={weapon} profile={profile} open={openKey === 'weapon'} onOpen={() => onOpen('weapon')} />}
        {profile.pieces.map((one) => (
          <PieceCard key={one.slot} piece={one} open={openKey === one.slot} onOpen={() => onOpen(one.slot)} />
        ))}
      </div>
      <div className={openKey === null ? 'pf-unfold' : 'pf-unfold open'} id="pf-unfold" inert={openKey === null} data-testid="unfold">
        {shown === 'weapon' && weapon !== null && <WeaponDetail key="weapon" weapon={weapon} profile={profile} />}
        {piece !== null && <PieceDetail key={piece.slot} piece={piece} profile={profile} />}
      </div>
    </>
  )
}
