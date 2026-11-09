import { num } from '../../format.ts'
import type { Ledger } from '../../ledgertypes.ts'
import { calendarCells, monthTitle } from './ledgerdays.ts'
import { compareRows, wishesCard } from './ledgercards.ts'

/** Compared with last month (the Ledger revamp design, section 4.4): a sentence, two bars, each source's change and one line. */
export function Compared({ month, monthName, previousName }: { month: Ledger['month']; monthName: string; previousName: string }) {
  const compare = compareRows(month)
  const biggest = Math.max(month.earned, month.previous.earned, 1)
  return (
    <section className="gb-panel ld-card ld-ins" data-testid="ledger-compare">
      <h2 className="gb-section-h ld-h">Compared with {previousName}</h2>
      <h3 className="ld-lead">{compare.line}</h3>
      {compare.rows.length > 0 && (
        <>
          <div className="ld-bars">
            <div>
              <span>{previousName}</span>
              <s>
                <i className="before" style={{ width: `${(month.previous.earned / biggest) * 100}%` }} />
              </s>
              <b className="num">{num(month.previous.earned)}</b>
            </div>
            <div>
              <span>{monthName}</span>
              <s>
                <i className="now" style={{ width: `${(month.earned / biggest) * 100}%` }} />
              </s>
              <b className="num">{num(month.earned)}</b>
            </div>
          </div>
          <div className="ld-chg num">
            {compare.rows.map((row) => (
              <div key={row.label}>
                <span>{row.label}</span>
                <b className={row.way === 'same' ? undefined : row.way}>{row.change}</b>
              </div>
            ))}
          </div>
        </>
      )}
      {compare.note !== '' && <p>{compare.note}</p>}
    </section>
  )
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** The class of a calendar cell, as Stats' `.mo-cal` has them: done is `l2`, missed the pale none, unknown `lx`, to come empty. */
function cellClass(state: string, today: boolean): string {
  const base = state === 'done' ? 'l2' : state === 'unknown' ? 'lx' : state === 'future' ? 'pad' : ''
  return [base, today ? 'today' : ''].filter((part) => part !== '').join(' ')
}

/**
 * Daily commissions (the design, section 4.6): the month drawn as Stats draws "October, day by day", its three numbers beside
 * it when the card is wide enough and under it when it is not, and a small key.
 */
export function Commissions({ commissions }: { commissions: Ledger['commissions'] }) {
  const { pad, cells } = calendarCells(commissions)
  const done = commissions.days.filter((day) => day.state === 'done').length
  const known = done + commissions.days.filter((day) => day.state === 'missed').length
  return (
    <section className="gb-panel ld-card ld-ins" data-testid="ledger-commissions">
      <h2 className="gb-section-h ld-h">Daily commissions</h2>
      <h3 className="ld-lead">{known === 0 ? 'No day recorded yet.' : `Done on ${done} of ${known} days.`}</h3>
      <div className="ld-calwrap">
        <div className="ld-calinner">
          <div className="ld-calbox">
            <div className="ld-wd" aria-hidden="true">
              {WEEKDAYS.map((name) => (
                <span key={name}>{name}</span>
              ))}
            </div>
            <div className="ld-cal" role="img" aria-label={`${monthTitle(commissions.days[0]?.day ?? commissions.month + '-01')}: done on ${done} of ${known} days`}>
              {Array.from({ length: pad }, (_, index) => (
                <i key={`pad${index}`} className="pad" />
              ))}
              {cells.map((cell) => (
                <i key={cell.day} className={cellClass(cell.state, cell.today)} title={`${Number(cell.day.slice(8))} ${monthTitle(cell.day)}, ${cell.state === 'future' ? 'to come' : cell.state === 'unknown' ? 'not known' : cell.state}`} />
              ))}
            </div>
            <div className="ld-keys" aria-hidden="true">
              <i className="missed" />
              Missed
              <i className="done" />
              Done
            </div>
          </div>
          <div className="ld-calstats">
            <span className="ld-line">
              Streak now <b>{commissions.streak_now} {commissions.streak_now === 1 ? 'day' : 'days'}</b>
            </span>
            <span className="ld-line">
              Longest <b>{commissions.longest} {commissions.longest === 1 ? 'day' : 'days'}</b>
            </span>
            <div className="ld-big" data-testid="ledger-streak">
              <b className="num">{commissions.streak_now}</b>
              <span>streak now</span>
            </div>
            <div className="ld-big" data-testid="ledger-longest">
              <b className="num">{commissions.longest}</b>
              <span>longest</span>
            </div>
            <div className="ld-big" data-testid="ledger-missed">
              <b className="num">{commissions.missed}</b>
              <span>missed</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

/** The pity track of the character banner (the design, section 4.5): 0 to the hard pity, the soft zone hatched. */
function PityTrack({ now, soft, hard, reach }: { now: number; soft: number; hard: number; reach: number | null }) {
  const width = 320
  const left = 6
  const right = 6
  const y = 30
  const x = (value: number) => left + (value / hard) * (width - left - right)
  const reached = reach ?? now
  return (
    <svg
      className="ld-pity"
      viewBox={`0 0 ${width} 66`}
      width="100%"
      role="img"
      aria-label={
        reach === null
          ? `Character banner pity ${now}`
          : `Character banner pity ${now}, and ${reach} with the wishes in hand`
      }
    >
      <defs>
        <pattern id="ld-soft" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect className="soft-ground" width="5" height="5" />
          <line className="soft-line" x1="0" y1="0" x2="0" y2="5" strokeWidth="2" />
        </pattern>
      </defs>
      <rect className="trk" x={left} y={y} width={width - left - right} height="10" rx="5" />
      <rect x={x(soft)} y={y} width={x(hard) - x(soft)} height="10" fill="url(#ld-soft)" />
      <rect className="now" x={left} y={y} width={x(now) - left} height="10" rx="5" />
      {reach !== null && <rect className="carry" x={x(now)} y={y} width={Math.max(0, x(reached) - x(now))} height="10" />}
      <rect className="rim" x={left} y={y} width={width - left - right} height="10" rx="5" fill="none" />
      <line className="mark" x1={x(now)} x2={x(now)} y1={y - 6} y2={y + 16} strokeWidth="1.5" />
      <text className="mark-text" x={x(now)} y={y - 10} textAnchor="middle">
        {now} now
      </text>
      {reach !== null && (
        <>
          <path className="reach" d={`M${x(reach)},${y - 4} l5,-7 h-10 z`} />
          <text className="reach-text" x={x(reach)} y={y - 14} textAnchor="middle">
            {reach}
          </text>
        </>
      )}
      <text className="scale" x={left} y={y + 30}>
        0
      </text>
      <text className="scale" x={x(soft)} y={y + 30} textAnchor="middle">
        soft pity {soft}
      </text>
      <text className="scale" x={width - right} y={y + 30} textAnchor="end">
        {hard}
      </text>
    </svg>
  )
}

/** The words of a card's line, with the invitation to set the balance as the link it is. */
function WishLine({ line }: { line: string }) {
  const invite = 'Set your balance in Pulls'
  if (!line.startsWith(invite)) return <p>{line}</p>
  return (
    <p>
      <a className="ld-link" href="#/pulls">
        {invite}
      </a>
      {line.slice(invite.length)}
    </p>
  )
}

/**
 * Wishes (the design, section 4.5): the month's wishes earned and made and, after a hairline, the wishes in hand now, every
 * figure Pulls' own; under them the character banner's pity and how far the wishes in hand carry it.
 */
export function Wishes({ wishes }: { wishes: Ledger['wishes'] }) {
  const card = wishesCard(wishes)
  return (
    <section className="gb-panel ld-card ld-ins" data-testid="ledger-wishes">
      <h2 className="gb-section-h ld-h">Wishes</h2>
      <div className="ld-trio num">
        <div className="in">
          <b>{card.earned}</b>
          <span>earned this month</span>
        </div>
        <div className="out">
          <b>{card.made}</b>
          <span>made this month</span>
        </div>
        {card.inHand !== null && (
          <div className="hand">
            <b>{card.inHand}</b>
            <span>in hand now</span>
          </div>
        )}
      </div>
      {wishes.pity !== null && <PityTrack now={wishes.pity.now} soft={wishes.pity.soft} hard={wishes.pity.hard} reach={card.reach} />}
      <WishLine line={card.line} />
    </section>
  )
}
