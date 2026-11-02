import '../styles/friends.css'
import { GroupedColumns } from '../charts/GroupedColumns.tsx'
import { Frame } from '../frame/Frame.tsx'
import { num, plural } from '../format.ts'
import type { Live } from '../live.ts'
import type { CompareModel } from '../onlinetypes.ts'
import { hashOf } from '../route.ts'
import { Avatar, Gate, OldMark, pictureOf, usePolled } from './FriendsParts.tsx'
import { hoursText } from './statvalues.ts'
import { clockOf, nameText, showsFriends, statusLine, statusText } from './friendsview.ts'
import { groupsOf, monthColumns, monthsTable, scoreLine, scoreOf, type Row, weekColumns, weeksTable } from './compareview.ts'

/** One row of a group: what it measures, each side's value with the leader's in bold, the split bar, and who leads. */
function CompareRow({ row }: { row: Row }) {
  const mine = row.share === null ? null : `${(row.share * 100).toFixed(1)}%`
  const theirs = row.share === null ? null : `${((1 - row.share) * 100).toFixed(1)}%`
  return (
    <div role="row" className="cmp-row" data-testid={`row-${row.id}`}>
      <span role="rowheader" className="cmp-k">
        {row.label}
      </span>
      <span role="cell" className={row.lead === 'me' ? 'cmp-a lead' : 'cmp-a'} title={row.me.text}>
        {row.me.text}
      </span>
      {mine === null || theirs === null ? (
        <span role="cell" />
      ) : (
        <span role="cell" className="cmp-split" aria-hidden="true">
          <i className="m" style={{ width: mine }} />
          <i className="f" style={{ width: theirs }} />
        </span>
      )}
      <span role="cell" className={row.lead === 'friend' ? 'cmp-b lead' : 'cmp-b'} title={row.friend.text}>
        {row.friend.text}
      </span>
      <span role="cell" className={`cmp-who ${row.lead === 'me' ? 'mine' : row.lead === 'friend' ? 'theirs' : 'tie'}`} title={row.verdict}>
        {row.lead === 'friend' ? (
          <>
            <span className="cmp-wn">{row.who}</span>
            <span> +{row.by}</span>
          </>
        ) : (
          row.verdict
        )}
      </span>
    </div>
  )
}

/**
 * Compare (the online design, section 9, mockup 3): the player and a friend at the head with the score between them, a panel
 * for each group of stats that both of them share, and two charts. Only a stat that both share, and that both PCs know, is
 * here; the last line says so. What the friend's PC sent is read through compareview.ts: it can be odd, and what cannot be
 * shown is left out. Each read asks the online server what the two of you share, so it is read when the page opens, each
 * minute and on the online account's news, not at every event of this PC (audit L24).
 */
export function Compare({ live, user }: { live: Live; user: string }) {
  const view = live.status?.online ?? null
  const gated = view === null || !showsFriends(view)
  const id = encodeURIComponent(user)
  const path = gated ? null : `/api/friends/${id}/compare`
  const { data: model, error } = usePolled<CompareModel>(path, live, '/api/friends?fresh=1', live.onlineVersion)
  const account = live.status?.account ?? null
  const now = live.now()
  const friend = model?.friend ?? null
  const name = friend === null ? '' : nameText(friend.name)
  const groups = model === null ? [] : groupsOf(model)
  const score = scoreOf(groups)
  const weeks = model === null ? [] : weekColumns(model)
  const months = model === null ? [] : monthColumns(model)
  const back = (
    <a className="gb-link" href={hashOf('friends')}>
      Back to Friends
    </a>
  )
  const mine = model === null ? null : statusLine({ status: model.me.status, since: model.me.since, last_seen: null }, now)
  const theirs = model === null || friend === null ? null : statusLine(friend, clockOf(model, now))
  return (
    <Frame page="friends" live={live} title={friend === null ? undefined : `You and ${name}`} controls={back}>
      {view === null ? null : gated ? (
        <Gate view={view} />
      ) : model === null || friend === null || mine === null || theirs === null ? (
        <div className="gb-panel gb-empty" data-testid={error === null ? undefined : 'compare-missing'}>
          {error ?? 'Reading the comparison…'}
        </div>
      ) : (
        <div className="gb-page cmp-page">
          <OldMark age={model} view={view} now={now} />
          <section className="gb-panel frd-card" aria-label={`You and ${name}`}>
            <div className="cmp-vs">
              <div className="cmp-side">
                <Avatar src={account?.picture_url ?? null} ar={account?.adventure_rank ?? null} dot={mine.tone} size="big" />
                <div>
                  <div className="cmp-nm">You</div>
                  {mine.tone !== 'none' && (
                    <div className={`cmp-meta ${mine.tone}`} data-testid="compare-me-status">
                      {statusText(mine)}
                    </div>
                  )}
                </div>
              </div>
              {groups.length > 0 ? (
                <div className="cmp-score" data-testid="compare-score">
                  <b>
                    <span className="cmp-mine">{score.me}</span> – <span className="cmp-theirs">{score.friend}</span>
                  </b>
                  <small>{scoreLine(score)}</small>
                </div>
              ) : (
                <span />
              )}
              <div className="cmp-side r">
                <div>
                  <div className="cmp-nm">
                    <bdi>{name}</bdi>
                  </div>
                  {theirs.tone !== 'none' && (
                    <div className={`cmp-meta ${theirs.tone}`} data-testid="compare-friend-status">
                      {statusText(theirs)}
                    </div>
                  )}
                </div>
                <Avatar src={friend.has_picture === true ? pictureOf(id) : null} ar={friend.ar} dot={theirs.tone} size="big" />
              </div>
            </div>
          </section>

          {groups.length === 0 ? (
            <p className="cmp-none" data-testid="compare-none">
              You and <bdi>{name}</bdi> share no stat yet. To compare, share more on <a href={hashOf({ page: 'friends', view: 'me' })}>Your profile</a>.
            </p>
          ) : (
            <>
              <div className="cmp-groups">
                {groups.map((group) => (
                  <section key={group.key} className="gb-panel frd-card" aria-label={group.title}>
                    <h2 className="frd-pt">{group.title}</h2>
                    <div role="table" aria-label={`${group.title}, you and ${name}`}>
                      <div role="row" className="cmp-row head">
                        <span role="columnheader" className="sr-only">
                          Stat
                        </span>
                        <span role="columnheader" className="cmp-a">
                          You
                        </span>
                        <span role="columnheader" className="sr-only">
                          Share
                        </span>
                        <span role="columnheader" className="cmp-b">
                          <bdi>{name}</bdi>
                        </span>
                        <span role="columnheader" className="sr-only">
                          Lead
                        </span>
                      </div>
                      {group.rows.map((row) => (
                        <CompareRow key={row.id} row={row} />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
              {(weeks.length > 0 || months.length > 0) && (
                <div className="cmp-charts">
                  {weeks.length > 0 && (
                    <GroupedColumns
                      title="Play time each week"
                      subtitle={`Hours in game, last ${plural(weeks.length, 'week')}`}
                      columns={weeks}
                      name={name}
                      show={hoursText}
                      table={weeksTable(weeks, name)}
                    />
                  )}
                  {months.length > 0 && (
                    <GroupedColumns
                      title="Primogems earned each month"
                      subtitle={`Earned, last ${plural(months.length, 'month')}`}
                      columns={months}
                      name={name}
                      show={num}
                      table={monthsTable(months, name)}
                    />
                  )}
                </div>
              )}
              <p className="cmp-note" data-testid="compare-note">
                You see only the stats you both share. To see more, share more on <a href={hashOf({ page: 'friends', view: 'me' })}>Your profile</a>.
              </p>
            </>
          )}
        </div>
      )}
    </Frame>
  )
}
