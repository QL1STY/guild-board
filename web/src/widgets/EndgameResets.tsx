import '../styles/widget-endgame.css'
import '../styles/widget-endgame-pictures.css'
import { useId } from 'react'
import { useModel, useTick } from '../live.ts'
import type { EndgameResetsModel, Widget } from '../types.ts'
import { InOrder, Medallions, SeasonBars } from './EndgameDrawings.tsx'
import { WithPictures, type PictureLayout } from './EndgamePictures.tsx'
import { DEFAULT_STYLE, ENDGAME_STYLES, metaOf, styleOf } from './endgameview.ts'
import { ONE_CELL_DOWN, useFrameSize, useHead, type WidgetContext, type WidgetType } from './widget.ts'

/*
 * Endgame resets (the widgets and Friends design, 2.4; the polish pass, mockup 2): the three modes with the player's result and
 * the time to each one's reset, in one of four drawings the player picks in Edit (the setting `style`; a widget with none shows
 * With pictures). From one cell tall each draws small, from two cells tall larger; With pictures is a band for each mode at two
 * cells wide and a column at three. It reads the endgame summaries a sync already keeps, through /api/endgame-resets, and asks
 * nothing of the game's account itself. The mode's colour is chosen by the stylesheet from `data-mode`.
 */

const MINUTE_MS = 60_000
const NOTHING_READ = 'No endgame read yet.'
/** From this width in pixels, With pictures draws a column for each mode: three cells across are about 530, two 350. */
const COLUMNS_FROM = 440

function EndgameResetsView({ widget, ctx }: { widget: Widget; ctx: WidgetContext }) {
  useTick(MINUTE_MS)
  const now = ctx.live.now()
  const { data, error } = useModel<EndgameResetsModel>('/api/endgame-resets', ctx.version)
  const { ref, width, height } = useFrameSize()
  const short = height <= ONE_CELL_DOWN
  useHead({ meta: data === null ? null : metaOf(data.not_played, short) })
  if (data === null) {
    return (
      <p className="wid-line" data-centre ref={ref}>
        {error ?? 'Reading your endgame…'}
      </p>
    )
  }
  if (data.modes.length === 0) {
    return (
      <p className="wid-line" data-centre ref={ref}>
        {NOTHING_READ}
      </p>
    )
  }
  const style = styleOf(widget.settings)
  const layout: PictureLayout = short ? 'tiles' : width >= COLUMNS_FROM ? 'columns' : 'bands'
  return (
    <div className="eg" data-style={style} ref={ref}>
      {style === 'pictures' && <WithPictures modes={data.modes} now={now} layout={layout} />}
      {style === 'medallions' && <Medallions modes={data.modes} now={now} short={short} />}
      {style === 'bars' && <SeasonBars modes={data.modes} now={now} short={short} />}
      {style === 'order' && <InOrder modes={data.modes} now={now} short={short} />}
    </div>
  )
}

/** The four drawings to pick from, as a group of radio buttons that each say what they draw. */
function EndgameSettingsForm({
  widget, change,
}: { widget: Widget; ctx: WidgetContext; change: (settings: Record<string, unknown>) => void }) {
  const name = useId()
  const chosen = styleOf(widget.settings)
  return (
    <fieldset className="eg-picks">
      <legend>Style</legend>
      {ENDGAME_STYLES.map((style) => (
        <label key={style.value} className="eg-pick">
          <input
            type="radio"
            name={name}
            value={style.value}
            checked={chosen === style.value}
            onChange={() => change({ ...widget.settings, style: style.value })}
          />
          <span>
            {style.name}
            <small>{style.about}</small>
          </span>
        </label>
      ))}
    </fieldset>
  )
}

export const ENDGAME_RESETS: WidgetType = {
  id: 'endgame-resets',
  name: 'Endgame resets',
  about: 'Your Abyss, Theater and Stygian results, and when each resets.',
  sign: 'tower',
  min: { w: 2, h: 1 },
  max: { w: 3, h: 2 },
  start: { w: 2, h: 1 },
  settings: { style: DEFAULT_STYLE },
  View: EndgameResetsView,
  Settings: EndgameSettingsForm,
}
