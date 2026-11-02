import type { CSSProperties } from 'react'
import { num } from '../format.ts'
import { useTick } from '../live.ts'
import { readyTime, timeLeft } from '../pages/timersview.ts'
import type { Widget } from '../types.ts'
import { Glint } from '../ui/Glint.tsx'
import { Bar, Pips, SegmentRing, Seal } from '../ui/marks.tsx'
import { CountUp } from '../ui/motion.tsx'
import { Picture } from '../ui/Picture.tsx'
import { Sign } from '../ui/Sign.tsx'
import { useHead, useOneCell, type WidgetContext, type WidgetType } from './widget.ts'
import { dailyNotesView, expeditionSlots, nearTime, nextBack, readAt, type SentExpedition } from './widgetview.ts'

/*
 * The widgets of HoYoLAB's Real-Time Notes (spec 13.3): what the last sync read, each saying when (spec 13.5).
 * Countdowns to a known time stay exact; a change in the game shows after the next sync.
 */

const NOTHING_READ = 'Nothing read from HoYoLAB yet.'

/** The resin is counted in segments of this many: the ring of 200 has ten (look pass spec 9.6). */
const RESIN_SEGMENT = 20

/**
 * Resin now, counted on from the last read as the top bar has it (core.py, resin_now), and when it is full (look pass
 * spec 9.6). The visual centre is the ring of ten segments with the resin's picture in it. The one markup serves every
 * size and widgets.css chooses what each shows: "77/200" and when it is full beside a ring with the picture alone at one
 * cell tall, how long to full beside that at a width of two, and at two cells tall a larger ring with the number inside
 * it and, beside it, how long to full in large figures with the clock time under it. The heading has the read time. The
 * figures glint once when a new read changes the figure shown (look pass spec 14.2), and not when the status counts on
 * from the same read with the clock, every eight minutes, or the clock passes the full time and the figure becomes the
 * maximum. The figure and its read are both the status's.
 */
function ResinView({ ctx }: { widget: Widget; ctx: WidgetContext }) {
  useTick(1000)
  const now = ctx.live.now()
  const notes = ctx.board === null ? null : ctx.board.notes
  useHead({ meta: notes === null ? null : readAt(notes.read_at, now) })
  if (ctx.board === null) return <p className="wid-line">Reading the notes…</p>
  if (notes === null) return <p className="wid-line">{NOTHING_READ}</p>
  const account = ctx.live.status?.account ?? null
  if (account === null || account.resin === null || account.resin_max === null) {
    return <p className="wid-line">Log in to HoYoLAB to see your resin.</p>
  }
  const max = account.resin_max
  const fullAt = notes.resin_full_at
  // The status counts on every few seconds; a full time that has come is full already. Above the maximum, as events give,
  // the count is shown as it is.
  const full = account.resin >= max || (fullAt !== null && Date.parse(fullAt) <= now.getTime())
  const resin = full ? Math.max(account.resin, max) : account.resin
  // When it was full, if the notes say so; when it will be, if they say that: the notes of a full resin may not say.
  const since = full && fullAt !== null ? readyTime(fullAt, now) : null
  const ahead = !full && fullAt !== null ? fullAt : null
  // The glint takes the status's own count with the read it came from, both from one answer: the full time above comes
  // with the Board model, which can arrive before or after the status.
  const glint = { value: account.resin, read: account.resin_read_at }
  return (
    <div className="resin">
      <div className="resin-ring" data-centre>
        <SegmentRing value={resin} max={max} segment={RESIN_SEGMENT}>
          <Picture src="/api/icon/static.resin" sign="moon" className="ring-pic" />
          <Glint className="fig" {...glint}>
            <CountUp value={resin} />
          </Glint>
          <span className="of">of {max}</span>
        </SegmentRing>
      </div>
      <div className="resin-text">
        <div className="resin-now">
          <Glint as="p" className="fig" {...glint}>
            <CountUp value={resin} />
            <small>/{max}</small>
          </Glint>
          {full ? (
            <p className="when sealed">
              <Seal>Full</Seal>
            </p>
          ) : (
            ahead !== null && <p className="when">Full {nearTime(ahead, now)}</p>
          )}
        </div>
        <div className="resin-left">
          {full ? (
            <p className="lead">
              <Seal>Full</Seal>
              {since !== null && ` since ${since}`}
            </p>
          ) : (
            ahead !== null && (
              <>
                <p className="lead">Full in</p>
                <p className="big">{timeLeft((Date.parse(ahead) - now.getTime()) / 1000).replace(/^in /, '')}</p>
                <p className="at">{readyTime(ahead, now)}</p>
              </>
            )
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * The characters' faces (look pass spec 9.7), larger than they were, each in a ring: gold with a green tick when the
 * expedition is back, muted while it is out, and a dashed empty circle for each that could still be sent. HoYoLAB gives
 * no names, only the pictures, which the demo does not download (the person's sign shows then). One cell tall there is
 * no room under a face, so the labels (Back, or when it returns and how long to wait) are there for a screen reader
 * only, and the heading names the next return; from two cells tall they are under the faces, and the heading has the
 * read time. There is no ring of progress: HoYoLAB gives no start time to draw one from.
 *
 * A slot's label, Back or its time of return to the minute, glints once when a new read changes it (look pass spec 14.2),
 * as when a sync moves the time or finds the expedition sent again; the clock bringing it back does not, and nor does the
 * time left beside it, which ticks. The count of those back, in the heading, glints the same way. The slots begin with
 * the expeditions of the notes, so a slot that was sent keeps its place in them, and its label its element.
 */
function ExpeditionsView({ ctx }: { widget: Widget; ctx: WidgetContext }) {
  useTick(1000)
  const { ref, short } = useOneCell()
  const now = ctx.live.now()
  const notes = ctx.board === null ? null : ctx.board.notes
  const slots = notes === null ? [] : expeditionSlots(notes, now)
  const sent = slots.filter((slot): slot is SentExpedition => !('empty' in slot))
  let meta: string | null = null
  const counted = sent.length === 0 ? undefined : `${sent.filter((one) => one.back).length} of ${sent.length} back`
  if (notes !== null) {
    const next = nextBack(notes, now)
    const when = short && next !== null ? `next ${next}` : readAt(notes.read_at, now)
    meta = counted === undefined ? when : `${counted} · ${when}`
  }
  useHead({ meta, counted, read: notes === null ? undefined : notes.read_at })
  if (ctx.board === null) return <p className="wid-line">Reading the notes…</p>
  if (notes === null) return <p className="wid-line">{NOTHING_READ}</p>
  const expeditions = notes.expeditions
  if (expeditions === null) return <p className="wid-line">Expedition details come with the next sync.</p>
  if (expeditions.length === 0) return <p className="wid-line">No expeditions are out.</p>
  return (
    <div ref={ref} className="exp">
      <ul className="ex" data-centre>
        {slots.map((slot, index) =>
          'empty' in slot ? (
            <li key={index} className="empty">
              <span className="face" />
              <span className="t">Not sent</span>
            </li>
          ) : (
            // --n puts the ticks' stamps one after another.
            <li key={index} className={slot.back ? 'back' : undefined} style={{ '--n': index } as CSSProperties}>
              <span className="face">
                <Picture src={slot.icon} sign="person" className="face-pic" />
                {slot.back && (
                  <span className="face-tick">
                    <Sign name="tick" />
                  </span>
                )}
              </span>
              <span className="t">
                <Glint as="b" value={slot.back ? 'Back' : slot.at} read={notes.read_at}>
                  {slot.back ? 'Back' : slot.at}
                </Glint>
                {!slot.back && ` ${slot.left}`}
              </span>
            </li>
          ),
        )}
      </ul>
    </div>
  )
}

const UNREAD_TODAY = 'Not read since 04:00'
const UNREAD_THIS_WEEK = 'Not read since Monday'

/**
 * Commissions done, boss discounts left, realm currency and the Parametric Transformer (look pass spec 9.8): four rows,
 * each a sign or the game's picture, a label, a visual (pips or a bar) and a value. The one markup serves every size and
 * widgets.css chooses: up to two cells tall the rows are compact, with short labels and the visual beside the value, and
 * from three cells tall they have full labels, the visual on a line of its own and, beside it, the period of a count and
 * the times. A count not read since its reset shows dotted pips and says so. The heading has the read time. Each number
 * glints once when a sync reads another (look pass spec 14.2): what the notes say, not the realm currency raised to its
 * maximum by the clock.
 */
function DailyNotesView({ ctx }: { widget: Widget; ctx: WidgetContext }) {
  useTick(1000)
  const now = ctx.live.now()
  const notes = ctx.board === null ? null : ctx.board.notes
  useHead({ meta: notes === null ? null : readAt(notes.read_at, now) })
  if (ctx.board === null) return <p className="wid-line">Reading the notes…</p>
  if (notes === null) return <p className="wid-line">{NOTHING_READ}</p>
  const { commissions, discounts, realm, transformer } = dailyNotesView(notes, now)
  const commissionsText = `${commissions.done} of ${commissions.of} done`
  const discountsText = `${discounts.left} of ${discounts.of} left`
  return (
    <div className="daily">
      <ul className="dn" data-centre>
        <li className="dn-commissions">
          <span className="ic">
            <Sign name="star" />
          </span>
          <span className="lab">Commissions</span>
          <span className={commissions.known ? 'val' : 'val unread'}>
            {commissions.known ? (
              <>
                <Glint as="b" value={notes.commissions_done}>
                  {commissions.done}
                </Glint>{' '}
                of {commissions.of}
                <span className="long"> done</span>
              </>
            ) : (
              UNREAD_TODAY
            )}
          </span>
          <span className="vis">
            <Pips
              total={commissions.of}
              filled={commissions.done}
              unknown={!commissions.known}
              label={commissions.known ? commissionsText : UNREAD_TODAY}
            />
            {commissions.known && <span className="sub">Today, since 04:00</span>}
          </span>
        </li>
        <li className="dn-discounts">
          <span className="ic">
            <Sign name="boss" />
          </span>
          <span className="lab">
            <span className="short">Boss discounts</span>
            <span className="long">Weekly boss discounts</span>
          </span>
          <span className={discounts.known ? 'val' : 'val unread'}>
            {discounts.known ? (
              <>
                <Glint as="b" value={notes.boss_discounts_left}>
                  {discounts.left}
                </Glint>
                <span className="long"> of {discounts.of}</span> left
              </>
            ) : (
              UNREAD_THIS_WEEK
            )}
          </span>
          <span className="vis">
            <Pips
              total={discounts.of}
              filled={discounts.left}
              unknown={!discounts.known}
              label={discounts.known ? discountsText : UNREAD_THIS_WEEK}
            />
            {discounts.known && <span className="sub">This week, since Monday</span>}
          </span>
        </li>
        <li className="dn-realm">
          <span className="ic">
            <Picture src="/api/icon/static.realm_currency" sign="teapot" className="dn-pic" />
          </span>
          <span className="lab">Realm currency</span>
          <span className="val">
            <Glint as="b" value={notes.realm_currency}>
              {num(realm.now)}
            </Glint>
            <span className="long"> of {num(realm.max)}</span>
          </span>
          <span className="vis">
            <Bar value={realm.now} max={realm.max} />
            {realm.isFull ? (
              <span className="sub good">Full</span>
            ) : (
              realm.full !== null && <span className="sub">Full {realm.full}</span>
            )}
          </span>
        </li>
        <li className="dn-transformer">
          <span className="ic">
            <Picture src="/api/icon/static.transformer" sign="transformer" className="dn-pic" />
          </span>
          {transformer.state === 'none' ? (
            <span className="lab">No Parametric Transformer yet</span>
          ) : (
            <>
              <span className="lab">
                <span className="short">Transformer</span>
                <span className="long">Parametric Transformer</span>
              </span>
              {transformer.state === 'ready' ? (
                <span className="val">
                  <Seal>Ready</Seal>
                </span>
              ) : (
                <>
                  <span className="val">
                    <span className="short">{transformer.left}</span>
                    <span className="long">{transformer.at}</span>
                  </span>
                  <span className="vis">
                    <span className="sub">Ready {transformer.left}</span>
                  </span>
                </>
              )}
            </>
          )}
        </li>
      </ul>
    </div>
  )
}

export const RESIN: WidgetType = {
  id: 'resin',
  name: 'Resin',
  about: 'Resin now, and when it is full.',
  sign: 'moon',
  min: { w: 1, h: 1 },
  max: { w: 3, h: 2 },
  start: { w: 2, h: 1 },
  settings: {},
  View: ResinView,
}

export const EXPEDITIONS: WidgetType = {
  id: 'expeditions',
  name: 'Expeditions',
  about: 'Each expedition, and when it comes back.',
  sign: 'compass',
  min: { w: 2, h: 1 },
  max: { w: 4, h: 3 },
  start: { w: 3, h: 2 },
  settings: {},
  View: ExpeditionsView,
}

export const DAILY_NOTES: WidgetType = {
  id: 'daily-notes',
  name: 'Daily notes',
  about: 'Commissions, boss discounts, the transformer and realm currency.',
  sign: 'book',
  min: { w: 2, h: 2 },
  max: { w: 4, h: 3 },
  start: { w: 3, h: 2 },
  settings: {},
  View: DailyNotesView,
}
