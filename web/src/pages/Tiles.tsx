import { Fragment } from 'react'
import { Sparkline } from '../charts/Sparkline.tsx'
import type { Stats, Tile } from '../types.ts'
import { useCountUp } from '../ui/motion.tsx'
import { countedValue, figureOf, type TileView, tileView } from './statsview.ts'

/** A figure as it is written: its unit words small. */
const words = (figure: TileView['figure']) =>
  figure.map((part, at) => (
    <Fragment key={at}>
      {at > 0 && ' '}
      {part.small ? <small>{part.text}</small> : part.text}
    </Fragment>
  ))

/**
 * A tile's big figure. It counts up, from 0 when the page opens and from the figure on the screen when the period
 * changes. Days played's length of the period counts with it then, from the length before, so that "27 of 30" goes to
 * "5 of 7" through figures that can be; it stands still when the page opens. Screen readers are given the figure it
 * ends on, and the counting digits are hidden from them.
 */
function Figure({ tile }: { tile: Tile }) {
  const to = countedValue(tile)
  const shown = useCountUp(to)
  const of = useCountUp(tile.id === 'days' ? tile.of : 0, false)
  return (
    <>
      <span aria-hidden="true">{words(figureOf(tile, shown, of))}</span>
      <span className="sr-only">{words(figureOf(tile, to))}</span>
    </>
  )
}

/** The five figures at the top of the Stats page. */
export function Tiles({ stats }: { stats: Stats }) {
  const last = stats.tiles.length - 1
  return (
    <div className="st-row">
      {stats.tiles.map((tile, index) => {
        const view = tileView(tile, stats)
        return (
          <div key={view.id} className="gb-panel st" role="group" aria-label={view.label} data-testid={`tile-${view.id}`}>
            <div className="k">{view.label}</div>
            <div className="v">
              <Figure tile={tile} />
            </div>
            <div className="d">
              {view.line.strong !== null && <b className={view.line.gain ? undefined : 'flat'}>{view.line.strong}</b>}
              {view.line.strong !== null && ' '}
              {view.line.rest}
            </div>
            {view.trend !== null && (
              <Sparkline
                values={view.trend.values}
                tip={view.trend.tip}
                edge={index === 0 ? 'start' : index === last ? 'end' : undefined}
              />
            )}
            {view.meter !== null && (
              <div className="meter">
                <i style={{ width: `${view.meter * 100}%` }} />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
