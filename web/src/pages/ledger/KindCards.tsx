import { num } from '../../format.ts'
import type {
  AgainstCard, BecameCard, BossesCard, CompareCard, CostCard, LuckCard, RankCard, WelkinCard, WhereCard,
} from './ledgerkinds.ts'

/**
 * The cards beside the Crystals, Resin and Artifacts charts (the Ledger revamp design, section 6), each the app's panel with the
 * Primogems cards' parts: a heading, a sentence, and one small picture. Their words come from `ledgerkinds.ts`.
 */

/** "Where it went": one segmented bar and a row for each part, a note, and the account's own line at the foot. */
export function WhereView({ card, id }: { card: WhereCard; id: string }) {
  return (
    <section className="gb-panel ld-card ld-where" data-testid={`ledger-card-${id}`}>
      <h2 className="gb-section-h ld-h">{card.title}</h2>
      <p className="ld-sub">{card.sub}</p>
      {card.total > 0 && (
        <div className="ld-segbar" aria-hidden="true">
          {card.items.map((item) => (
            <i key={item.key} style={{ flex: item.value, background: item.color }} />
          ))}
        </div>
      )}
      <ul className="ld-cats">
        {card.items.map((item) => (
          <li key={item.key} className="ld-cat">
            <i style={{ background: item.color }} />
            <span>{item.name}</span>
            <b className="num">{num(item.value)}</b>
            <span className="ld-share num">{Math.round((item.value / card.total) * 100)}%</span>
          </li>
        ))}
        {card.items.length === 0 && <li className="ld-none">Nothing yet this month.</li>}
      </ul>
      {card.note !== '' && <p className="ld-foot-note">{card.note}</p>}
      <div className="ld-cat ld-tot">
        <i className={`ld-ring ${card.foot.ring}`} />
        <span>{card.foot.label}</span>
        <b className="num">{card.foot.value}</b>
        <span className="ld-share" />
      </div>
    </section>
  )
}

/** Compared with the month before: a sentence, two bars, each part's change and a line. */
export function CompareView({ card, id }: { card: CompareCard; id: string }) {
  return (
    <section className="gb-panel ld-card ld-ins" data-testid={`ledger-card-${id}`}>
      <h2 className="gb-section-h ld-h">{card.title}</h2>
      <h3 className="ld-lead">{card.line}</h3>
      <div className="ld-bars">
        {card.bars.map((bar) => (
          <div key={bar.name}>
            <span>{bar.name}</span>
            <s>
              <i className={bar.now ? 'now' : 'before'} style={{ width: `${bar.width}%` }} />
            </s>
            <b className="num">{num(bar.value)}</b>
          </div>
        ))}
      </div>
      <div className="ld-chg num">
        {card.rows.map((row) => (
          <div key={row.label}>
            <span>{row.label}</span>
            <b className={row.way === 'same' ? undefined : row.way}>{row.change}</b>
          </div>
        ))}
      </div>
      <p>{card.note}</p>
    </section>
  )
}

/** The Welkin Moon's 30 days, which ones have passed. */
export function WelkinView({ card }: { card: WelkinCard }) {
  return (
    <section className="gb-panel ld-card ld-ins" data-testid="ledger-card-welkin">
      <h2 className="gb-section-h ld-h">Welkin Moon</h2>
      <h3 className="ld-lead">{card.head}</h3>
      {card.cells !== null && (
        <>
          <div className="ld-days30" role="img" aria-label={card.head}>
            {card.cells.map((cell, index) => (
              <i key={index} className={cell.state === 'to-come' ? '' : cell.state === 'today' ? 'done today' : 'done'} />
            ))}
          </div>
          <div className="ld-keys k2" aria-hidden="true">
            <i className="done" />
            Passed
            <i className="missed" />
            To come
          </div>
        </>
      )}
      <p>{card.note}</p>
    </section>
  )
}

/** A short list with a bar each: the domains run most, the domains that gave the most. */
export function RankView({ card, id }: { card: RankCard; id: string }) {
  return (
    <section className="gb-panel ld-card ld-ins" data-testid={`ledger-card-${id}`}>
      <h2 className="gb-section-h ld-h">{card.title}</h2>
      <h3 className="ld-lead">{card.head}</h3>
      {card.rows.length > 0 && (
        <div className="ld-rank num">
          {card.rows.map((row) => (
            <div key={row.name}>
              <span title={row.name}>{row.name}</span>
              <s>
                <i style={{ width: `${row.width}%` }} />
              </s>
              <b>{row.value}</b>
            </div>
          ))}
        </div>
      )}
      {card.note !== '' && <p>{card.note}</p>}
    </section>
  )
}

/** The month's resin set against the 180 a day that regrows: a meter, three figures and a line. */
export function AgainstView({ card }: { card: AgainstCard }) {
  return (
    <section className="gb-panel ld-card ld-ins" data-testid="ledger-card-against">
      <h2 className="gb-section-h ld-h">Against the 180 a day</h2>
      <h3 className="ld-lead">{card.head}</h3>
      {card.days > 0 && (
        <>
          <div className="ld-meter">
            <i style={{ width: `${Math.min(100, card.percent)}%` }} />
          </div>
          <div className="ld-meter-keys num">
            <span>{num(card.spent)} spent</span>
            <span>
              {num(card.regrown)} regrown in {card.days} {card.days === 1 ? 'day' : 'days'}
            </span>
          </div>
          <RowsList rows={card.rows} />
        </>
      )}
      <p>{card.note}</p>
    </section>
  )
}

/** Rows of a label and a figure, as the comparison's. */
function RowsList({ rows }: { rows: { label: string; value: string }[] }) {
  if (rows.length === 0) return null
  return (
    <div className="ld-chg num">
      {rows.map((row) => (
        <div key={row.label}>
          <span>{row.label}</span>
          <b>{row.value}</b>
        </div>
      ))}
    </div>
  )
}

/** A heading, a sentence, rows and a line: the bosses, the resin for each five-star. */
export function RowsView({ title, card, id }: { title: string; card: BossesCard | CostCard; id: string }) {
  return (
    <section className="gb-panel ld-card ld-ins" data-testid={`ledger-card-${id}`}>
      <h2 className="gb-section-h ld-h">{title}</h2>
      <h3 className="ld-lead">{card.head}</h3>
      <RowsList rows={card.rows} />
      {card.note !== '' && <p>{card.note}</p>}
    </section>
  )
}

/** What became of the month's five-stars: got, used up and kept, one bar, and a row each. */
export function BecameView({ card }: { card: BecameCard }) {
  return (
    <section className="gb-panel ld-card ld-where" data-testid="ledger-card-became">
      <h2 className="gb-section-h ld-h">What became of them</h2>
      <p className="ld-sub">{card.sub}</p>
      <div className="ld-trio num">
        <div className="in">
          <b>+{card.got}</b>
          <span>got</span>
        </div>
        <div className="out">
          <b>{card.used === 0 ? '0' : `−${card.used}`}</b>
          <span>fed or salvaged</span>
        </div>
        <div className="hand">
          <b>{card.kept}</b>
          <span>kept</span>
        </div>
      </div>
      <div className="ld-segbar" aria-hidden="true">
        {card.items
          .filter((item) => item.value > 0)
          .map((item) => (
            <i key={item.key} style={{ flex: item.value, background: item.color }} />
          ))}
      </div>
      <ul className="ld-cats">
        {card.items.map((item) => (
          <li key={item.key} className="ld-cat">
            <i style={{ background: item.color }} />
            <span>{item.name}</span>
            <b className="num">{item.value}</b>
            <span className="ld-share num">{item.share}%</span>
          </li>
        ))}
      </ul>
      <p className="ld-foot-note ld-tot">{card.note}</p>
    </section>
  )
}

/** Domain luck: five-stars per run this month against a typical run's, as two bars, three figures and a line. */
export function LuckView({ card }: { card: LuckCard }) {
  return (
    <section className="gb-panel ld-card ld-ins" data-testid="ledger-card-luck">
      <h2 className="gb-section-h ld-h">Domain luck</h2>
      <h3 className="ld-lead">{card.head}</h3>
      {card.bars.length > 0 && (
        <div className="ld-cmp2 num">
          {card.bars.map((bar) => (
            <div key={bar.name}>
              <span>{bar.name}</span>
              <s>
                <i className={bar.typical ? 'before' : 'now'} style={{ width: `${bar.width}%` }} />
              </s>
              <b>{bar.value}</b>
            </div>
          ))}
        </div>
      )}
      <RowsList rows={card.rows} />
      {card.note !== '' && <p>{card.note}</p>}
    </section>
  )
}
