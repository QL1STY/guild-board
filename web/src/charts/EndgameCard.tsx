import { type CSSProperties, useState } from 'react'
import '../styles/endgame-card.css'
import { num } from '../format.ts'
import type {
  EndgameAbyss,
  EndgameCardModel,
  EndgameFoe,
  EndgameHeader,
  EndgameMode,
  EndgameRank,
  EndgameStygian,
  EndgameTheater,
} from '../types.ts'
import { sizedArt } from '../ui/artsize.ts'
import { Picture } from '../ui/Picture.tsx'
import { Sign, type SignName } from '../ui/Sign.tsx'
import { ChartCard } from './ChartCard.tsx'
import { actCells, bestText, bossTime, cropStyle, durationText, foeRows, medalsText, starCells } from './endgamecard.ts'

const SUBTITLE = 'This cycle in each mode, with the best so far'
const NONE = 'No endgame results have been read yet.'

/** The sign that stands for each mode's icon where the wiki's is not there yet. */
const MODE_SIGN: Record<EndgameMode['mode'], SignName> = { abyss: 'moon', theater: 'cards', stygian: 'boss' }

/** The header pictures are 4K at most; the core makes a copy of at most this many pixels across, which is plenty for a third of the card. */
const HEADER_SIZE = 1536

/** A style that gives an element its place in a line of things that come in one after another. */
const placed = (index: number): CSSProperties => ({ '--i': index }) as CSSProperties

/** What the card shows while the core has not answered yet, or could not. */
export function EndgameWaiting({ error }: { error: string | null }) {
  return (
    <ChartCard title="Endgame" subtitle={SUBTITLE} className="ec">
      <p className="gb-note">{error ?? 'Reading the endgame results…'}</p>
    </ChartCard>
  )
}

export function EndgameCard({ model }: { model: EndgameCardModel }) {
  const modes = model.modes
  const table = {
    head: ['Mode', 'Latest result', 'Period', 'Best so far'],
    rows: modes.map((mode) => [mode.label, mode.result, mode.period, mode.best]),
    numeric: [3],
  }
  return (
    <ChartCard title="Endgame" subtitle={SUBTITLE} tables={[table]} className="ec">
      {modes.length === 0 ? (
        <p className="gb-note">{NONE}</p>
      ) : (
        <div className="ec-modes">
          {modes.map((mode) => (
            <Mode key={mode.mode} mode={mode} />
          ))}
        </div>
      )}
    </ChartCard>
  )
}

function Mode({ mode }: { mode: EndgameMode }) {
  return (
    <div className={`ec-mode ${mode.mode}`} data-testid={`ec-${mode.mode}`}>
      <Header mode={mode} />
      <div className="ec-body">
        {!mode.played ? (
          <NoResult best={mode.best} />
        ) : mode.mode === 'abyss' ? (
          <Abyss mode={mode} />
        ) : mode.mode === 'theater' ? (
          <Theater mode={mode} />
        ) : (
          <Stygian mode={mode} />
        )}
      </div>
    </div>
  )
}

/**
 * The icon, the name and the line on parchment, and the mode's picture over the right two-thirds, fading toward the left.
 * The picture is a background: where the core has none to give, the place stays parchment, never a broken image.
 */
function Header({ mode }: { mode: EndgameMode }) {
  const { header } = mode
  return (
    <div className="ec-band">
      {header.picture !== null && <HeaderPicture header={header} />}
      <div className="ec-veil" />
      <Picture src={header.icon} sign={MODE_SIGN[mode.mode]} className="ec-ico" />
      <div className="ec-title">
        <b>{mode.label}</b>
        <span>{mode.line}</span>
      </div>
    </div>
  )
}

function HeaderPicture({ header }: { header: EndgameHeader }) {
  const address = sizedArt(header.picture, HEADER_SIZE)
  return (
    <div
      className="ec-bg"
      style={{ ...cropStyle(header.crop), backgroundImage: address === null ? undefined : `url("${address}")` }}
    />
  )
}

/**
 * A mode with no result this cycle: one played before has no tries yet in this one (the Abyss on the 16th), and keeps its best
 * so far at the right; one never played says so.
 */
function NoResult({ best }: { best: string }) {
  if (best === '') return <p className="ec-none">Not played yet</p>
  return (
    <div className="ec-big">
      <span className="ec-none">No tries this cycle yet</span>
      <span className="ec-best">
        Best <b>{best}</b>
      </span>
    </div>
  )
}

/** The big number with its caption, and the best so far at the right. */
function Big({ figure, caption, best }: { figure: string; caption: string; best: string }) {
  return (
    <div className="ec-big">
      <b>{figure}</b>
      <span>{caption}</span>
      <span className="ec-best">
        Best <b>{best}</b>
      </span>
    </div>
  )
}

/** A row of a character's mark: the face, what it is for, the character's name and the figure. */
function Stat({ rank }: { rank: EndgameRank }) {
  return (
    <div className="ec-stat" data-testid="ec-rank">
      <Picture src={rank.face} sign="bust" className="ec-face" />
      <span className="ec-what">{rank.label}</span>
      {rank.name !== null && <span className="ec-who">{rank.name}</span>}
      <span className="ec-v">{num(rank.value)}</span>
    </div>
  )
}

function Foe({ foe, index, end }: { foe: EndgameFoe; index: number; end: boolean }) {
  const text = foe.level > 0 ? `${foe.name} · Lv. ${foe.level}` : foe.name
  return (
    <span
      className={`ec-ic ${end ? 'tip-end' : 'tip-start'}`}
      data-tip={text}
      aria-label={text}
      role="img"
      tabIndex={0}
      style={placed(index)}
    >
      <Picture src={foe.icon} sign="boss" className="ec-pic" />
    </span>
  )
}

function Abyss({ mode }: { mode: EndgameAbyss }) {
  // A detail kept by 1.0.1 has no chambers: the stars are told by the number alone, with no grid of grey stars.
  const floors = mode.chambers === null ? null : starCells(mode.chambers)
  const rows = foeRows(mode.foes)
  const ranks = (mode.ranks ?? []).filter((rank) => rank.kind === 'strike' || rank.kind === 'defeats')
  let lit = 0
  let foe = 0
  return (
    <>
      <Big figure={String(mode.stars)} caption="of 36 stars" best={mode.best} />
      {floors !== null && (
        <div className="ec-floors" role="img" aria-label={`${mode.stars} of 36 stars, floors 9 to 12`}>
          {floors.map((floor) => (
            <div className="ec-floor" key={floor.floor}>
              <span className="ec-fl">Floor {floor.floor}</span>
              {[0, 1, 2].map((chamber) => (
                <span className="ec-stars" key={chamber}>
                  {floor.stars.slice(chamber * 3, chamber * 3 + 3).map((star, at) => (
                    <span className={star === 1 ? 'ec-star' : 'ec-star off'} key={at} style={placed((lit += 1))}>
                      ★
                    </span>
                  ))}
                </span>
              ))}
            </div>
          ))}
        </div>
      )}
      {rows.length > 0 && (
        <>
          <div className="ec-lbl">Floor {mode.floor_shown} enemies</div>
          <div className="ec-foes">
            {rows.map((row) => (
              <div className="ec-foe-row" key={row.chamber}>
                <span className="ec-k">{row.chamber}</span>
                {row.halves.map((half, at) => (
                  <div className="ec-icons" key={at}>
                    {half.map((one, inHalf) => (
                      <Foe key={inHalf} foe={one} index={(foe += 1)} end={at === 1} />
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
      {ranks.length > 0 && (
        <div className="ec-stats">
          {ranks.map((rank) => (
            <Stat key={rank.kind} rank={rank} />
          ))}
        </div>
      )}
    </>
  )
}

function Theater({ mode }: { mode: EndgameTheater }) {
  const acts = actCells(mode.medals ?? [], mode.act)
  // A detail kept by 1.0.1 has no medals, flowers, time or highlights: none of them is shown, rather than a 0.
  const medals = mode.medal_count === null ? null : medalsText(mode.medal_count)
  const ranks = mode.ranks ?? []
  return (
    <>
      <Big figure={`Act ${mode.act}`} caption={medals === null ? 'reached' : `reached · ${medals}`} best={mode.best} />
      {acts.length > 0 && (
        <>
          <div
            className="ec-acts"
            style={{ '--acts': acts.length } as CSSProperties}
            role="img"
            aria-label={`Act ${mode.act} reached of ${acts.length}${medals === null ? '' : `, ${medals}`}`}
          >
            {acts.map((cell, at) => (
              <span className={`ec-act ${cell}`} key={at} style={placed(at)}>
                {at + 1}
              </span>
            ))}
          </div>
          <div className="ec-legend">
            <span>
              <i className="medal" />
              Medal
            </span>
            <span>
              <i className="done" />
              Cleared
            </span>
            <span>
              <i className="off" />
              Not reached
            </span>
          </div>
        </>
      )}
      {(ranks.length > 0 || mode.flowers !== null || mode.seconds !== null) && (
        <div className="ec-stats">
          {ranks.map((rank) => (
            <Stat key={rank.kind} rank={rank} />
          ))}
          {mode.flowers !== null && (
            <div className="ec-stat">
              <span className="ec-glyph flower">
                <Sign name="flower" />
              </span>
              <span className="ec-what">Fantasia Flowers used</span>
              <span className="ec-v">{num(mode.flowers)}</span>
            </div>
          )}
          {mode.seconds !== null && (
            <div className="ec-stat">
              <span className="ec-glyph clock">
                <Sign name="stopwatch" />
              </span>
              <span className="ec-what">Time in battle</span>
              <span className="ec-v">{durationText(mode.seconds)}</span>
            </div>
          )}
        </div>
      )}
    </>
  )
}

/** The wiki's own medal for the difficulty; where there is none, or it cannot be loaded, a badge drawn with the number. */
function Badge({ medal, level }: { medal: string | null; level: number | null }) {
  const [failed, setFailed] = useState<string | null>(null)
  if (medal !== null && failed !== medal) {
    return <img className="ec-medal" src={sizedArt(medal, 128) ?? medal} alt="" draggable={false} onError={() => setFailed(medal)} />
  }
  return (
    <div className="ec-badge">
      <span>{level ?? '–'}</span>
    </div>
  )
}

function Stygian({ mode }: { mode: EndgameStygian }) {
  const next = mode.next
  return (
    <>
      <div className="ec-big ec-big-badge">
        <Badge medal={mode.medal} level={mode.difficulty} />
        <div className="ec-level">
          <b>Difficulty {mode.difficulty ?? '–'}</b>
          {mode.seconds !== null && <span>all three in {durationText(mode.seconds)}</span>}
        </div>
        <span className="ec-best">
          Best <b>{bestText(mode.best)}</b>
        </span>
      </div>
      <div className={mode.dimmed ? 'ec-bosses dimmed' : 'ec-bosses'}>
        {mode.bosses.map((boss, at) => (
          <div
            className={`ec-boss ${at === mode.bosses.length - 1 && at > 0 ? 'tip-end' : 'tip-start'}`}
            key={at}
            role="group"
            aria-label={`${boss.name}, ${bossTime(boss.seconds)}`}
            data-tip={boss.name}
            tabIndex={0}
          >
            <span className="ec-ic" style={placed(at)}>
              <Picture src={boss.icon} sign="boss" className="ec-pic" />
            </span>
            <span className="ec-n" aria-hidden="true">
              {boss.short}
            </span>
            <span className="ec-t" aria-hidden="true">
              {bossTime(boss.seconds)}
            </span>
          </div>
        ))}
      </div>
      {next !== null && (
        <div className="ec-next">
          {mode.next_started ? (
            <>
              Season <b>{next.name}</b> is on now. Its bosses show here after your first try.
            </>
          ) : (
            <>
              Next season <b>{next.name}</b> opens {next.starts}. Its bosses show here after your first try.
            </>
          )}
        </div>
      )}
    </>
  )
}
