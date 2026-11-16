import type { ReactNode } from 'react'
import '../styles/widget-friends.css'
import { useModel, useTick } from '../live.ts'
import type { Friend, FriendsModel, OnlineView } from '../onlinetypes.ts'
import { clockOf, showsFriends } from '../pages/friendsview.ts'
import { hashOf } from '../route.ts'
import type { Widget } from '../types.ts'
import { Picture } from '../ui/Picture.tsx'
import { Sign } from '../ui/Sign.tsx'
import { gateLine, lineOf, metaOf, orderedFriends, rowOf } from './friendsonlineview.ts'
import { useHead, useOneCell, type WidgetContext, type WidgetType } from './widget.ts'

const MINUTE_MS = 60_000

/** A friend's face in a ring, with a dot at its corner while they are in game. With no picture the sign shows. */
function Face({ picture, game, big = false }: { picture: string | null; game: boolean; big?: boolean }) {
  return (
    <span className="fo-av" data-game={game || undefined} data-big={big || undefined}>
      <Picture src={picture} sign="person" className="fo-pic" />
    </span>
  )
}

/** A friend's profile on the Board, and plain text on the overlay, which is not a page: nothing there opens one. */
function FriendLink({
  ctx, friend, className, centre = false, children,
}: { ctx: WidgetContext; friend: Friend; className: string; centre?: boolean; children: ReactNode }) {
  const mark = centre ? { 'data-centre': '' } : {}
  if (ctx.place === 'overlay') return <div className={className} {...mark}>{children}</div>
  return (
    <a className={className} href={hashOf({ page: 'friends', view: 'friend', user: friend.user_id })} {...mark}>
      {children}
    </a>
  )
}

/** The friends themselves, once there is a list. The clock is the Friends page's: a list that is old stands as it was read. */
function FriendsList({ ctx, view }: { ctx: WidgetContext; view: OnlineView }) {
  useTick(MINUTE_MS)
  const now = ctx.live.now()
  const { data, error } = useModel<FriendsModel>('/api/friends', ctx.version)
  const { ref, short } = useOneCell()
  useHead({ meta: data === null ? null : metaOf(data.friends) })
  if (data === null || !showsFriends(view)) return <p className="wid-line" data-centre>{error ?? 'Reading your friends…'}</p>
  const clock = clockOf(data, now)
  if (data.friends.length === 0) {
    return (
      <p className="wid-line" data-centre ref={ref}>
        No friends yet. Add one on the Friends page.
      </p>
    )
  }

  if (short) {
    const line = lineOf(data.friends, clock)
    const body = (
      <>
        {line.who === null ? (
          <span className="fo-av fo-all" data-big>
            <Sign name="people" />
          </span>
        ) : (
          <Face picture={rowOf(line.who, clock).picture} game big />
        )}
        <span className="fo-n">
          <b>{line.title}</b>
          {line.detail !== null && <span>{line.detail}</span>}
        </span>
      </>
    )
    return (
      <div className="fo" ref={ref}>
        {line.who === null ? (
          <div className="fo-one" data-centre>{body}</div>
        ) : (
          <FriendLink ctx={ctx} friend={line.who} className="fo-one" centre>
            {body}
          </FriendLink>
        )}
      </div>
    )
  }

  const rows = orderedFriends(data.friends)
  return (
    <div className="fo" ref={ref}>
      <ul className="fo-list w-scroll" data-centre>
        {rows.map((friend) => {
          const row = rowOf(friend, clock)
          return (
            <li key={friend.user_id} className="fo-r" data-off={row.off || undefined}>
              <FriendLink ctx={ctx} friend={friend} className="fo-row">
                <Face picture={row.picture} game={row.tone === 'game'} />
                <span className="fo-n">
                  <b>
                    <bdi>{row.name}</bdi>
                  </b>
                  {row.text !== '' && <span className="fo-st" data-tone={row.tone}>{row.text}</span>}
                </span>
                {row.when !== '' && <span className="fo-x">{row.when}</span>}
              </FriendLink>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/**
 * Friends online (the widgets and Friends design, 2.5): who is in the game now, then who was last seen. It reads the online
 * account's view (`/api/online`) and, while there are friends to show, the list the Friends page reads (`/api/friends`), and
 * asks nothing of the online server itself. Signed out, it says where to sign in; it stays in "Add a widget" all the same.
 */
function FriendsOnlineView({ ctx }: { widget: Widget; ctx: WidgetContext }) {
  const { data: view, error } = useModel<OnlineView>('/api/online', ctx.version)
  if (view === null) return <p className="wid-line" data-centre>{error ?? 'Reading your friends…'}</p>
  const gate = gateLine(view)
  if (gate !== null) {
    return (
      <p className="wid-line" data-centre>
        {view.state === 'signed_out' && ctx.place === 'board' ? (
          <a className="gb-link" href={hashOf('settings')}>
            {gate}
          </a>
        ) : (
          gate
        )}
      </p>
    )
  }
  return <FriendsList ctx={ctx} view={view} />
}

export const FRIENDS_ONLINE: WidgetType = {
  id: 'friends-online',
  name: 'Friends online',
  about: 'Which friends are in the game now, and when the others were last seen.',
  sign: 'people',
  min: { w: 2, h: 1 },
  max: { w: 3, h: 4 },
  start: { w: 2, h: 2 },
  settings: {},
  View: FriendsOnlineView,
}
