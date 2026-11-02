import { type ReactNode, useEffect, useRef, useState } from 'react'
import '../styles/friends.css'
import { api, messageOf } from '../api.ts'
import { Frame } from '../frame/Frame.tsx'
import type { Live } from '../live.ts'
import type { Card, Friend, FriendsModel, OnlineView } from '../onlinetypes.ts'
import { hashOf } from '../route.ts'
import { Avatar, Chips, CompareButton, Doing, Gate, OldMark, pictureOf, usePolled, useCopy } from './FriendsParts.tsx'
import { chipsOf, clockOf, nameText, SHARES_NOTHING, showsFriends, sortedFriends, statusLine, summaryOf } from './friendsview.ts'

/** The top bar's count: "1 in game, 1 with Guild Board open". Nothing where no friend is either. */
function Count({ friends }: { friends: readonly Friend[] }) {
  const { inGame, open } = summaryOf(friends)
  if (inGame === 0 && open === 0) return null
  return (
    <span className="gb-status" data-testid="friends-count">
      {inGame > 0 && (
        <>
          <b>{inGame}</b> in game
        </>
      )}
      {inGame > 0 && open > 0 && ', '}
      {open > 0 && (
        <>
          <b>{open}</b> with Guild Board open
        </>
      )}
    </span>
  )
}

function Row({ friend, now }: { friend: Friend; now: Date }) {
  const id = encodeURIComponent(friend.user_id)
  const chips = chipsOf(friend)
  const [name, tag] = [nameText(friend.name), nameText(friend.tag)]
  return (
    <li className="frd-row">
      <Avatar src={friend.has_picture === true ? pictureOf(id) : null} ar={friend.ar} />
      <a
        className="frd-name"
        href={hashOf({ page: 'friends', view: 'friend', user: friend.user_id })}
        aria-label={`${name}#${tag}`}
      >
        <span className="frd-nm">
          <bdi>{name}</bdi>
        </span>
        <span className="frd-tg">#{tag}</span>
      </a>
      <Doing line={statusLine(friend, now)} />
      <span className="frd-chips">{chips.length > 0 ? <Chips chips={chips} /> : <span className="frd-none">{SHARES_NOTHING}</span>}</span>
      <CompareButton friend={friend} className="frd-compare" />
    </li>
  )
}

/**
 * One card of the strip above the list: a request or an invite, with its sign in place of a picture, and its buttons. Its
 * sentence is given the name and tag as the server sent them, read through nameText, in their own run of text.
 */
function Request({ card, children, buttons }: { card: Pick<Card, 'name' | 'tag'>; children: (name: ReactNode) => ReactNode; buttons: ReactNode }) {
  return (
    <div className="frd-req">
      <Avatar src={null} size="small" />
      <span className="frd-req-tx">{children(<bdi>{`${nameText(card.name)}#${nameText(card.tag)}`}</bdi>)}</span>
      <span className="frd-req-acts">{buttons}</span>
    </div>
  )
}

export function Friends({ live }: { live: Live }) {
  const view: OnlineView | null = live.status?.online ?? null
  const gated = view === null || !showsFriends(view)
  const { data: model, error, take } = usePolled<FriendsModel>(gated ? null : '/api/friends?fresh=1', live)
  const now = live.now()
  const [busy, setBusy] = useState(false)
  const [refused, setRefused] = useState<string | null>(null) // what the server said to the last press in the strip
  const [query, setQuery] = useState('')
  const [asked, setAsked] = useState<string | null>(null) // what the server said to the last request from the field
  const [link, setLink] = useState<string | null>(null) // an invite link that could not be copied
  const tag = useCopy()
  const invite = useCopy()

  /** One press that changes the list: the answer is the new list. A refusal is said where it was pressed, and nothing moves. */
  const change = async (call: () => Promise<FriendsModel>, onRefused: (sentence: string) => void): Promise<boolean> => {
    if (busy) return false
    setBusy(true)
    try {
      take(await call())
      return true
    } catch (failure) {
      onRefused(messageOf(failure))
      return false
    } finally {
      setBusy(false)
    }
  }
  const press = (call: () => Promise<FriendsModel>) => {
    setRefused(null)
    void change(call, setRefused).then(() => live.refresh())
  }
  const user = (card: Card) => encodeURIComponent(card.user_id)
  const send = async () => {
    const text = query.trim()
    if (text === '') return
    setAsked(null)
    if (await change(() => api.post<FriendsModel>('/api/friends/request', { query: text }), setAsked)) setQuery('')
  }
  const copyLink = async () => {
    setAsked(null)
    try {
      const made = await api.post<{ link: string }>('/api/friends/invite-link')
      const copied = await invite.copy(made.link, 'Invite link copied.', 'The link could not be copied. Select it below and copy it by hand.')
      setLink(copied ? null : made.link)
    } catch (failure) {
      setAsked(messageOf(failure))
    }
  }
  const dropInvite = async () => {
    setRefused(null)
    try {
      await api.delete('/api/friends/invite')
    } catch (failure) {
      setRefused(messageOf(failure))
    }
    await live.refresh()
  }

  const invited = view?.invite ?? null
  const said = view?.message ?? null // what the core said of a link that was used, among others; Settings says it too
  const waiting = model === null ? [] : [...model.incoming]
  const sent = model === null ? [] : [...model.outgoing]
  const myTag = model === null ? '' : `${nameText(model.me.name)}#${nameText(model.me.tag)}`

  // A card that goes takes the focus with it, which leaves a player on the keyboard nowhere: it moves on to the next card, or
  // with none left to the heading of the list.
  const strip = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const cards = (invited === null ? 0 : 1) + (said === null ? 0 : 1) + waiting.length + sent.length
  const cardsBefore = useRef(cards)
  useEffect(() => {
    if (cards < cardsBefore.current && document.activeElement === document.body) {
      const next = strip.current?.querySelector('button') ?? heading.current
      next?.focus({ preventScroll: true })
    }
    cardsBefore.current = cards
  }, [cards])

  // The count is of who is on right now, which an old list cannot say.
  return (
    <Frame page="friends" live={live} controls={model !== null && !model.stale && <Count friends={model.friends} />}>
      {view === null ? null : gated ? (
        <Gate view={view} />
      ) : model === null ? (
        <div className="gb-panel gb-empty">{error ?? 'Reading your friends…'}</div>
      ) : (
        <div className="gb-page frd-page">
          <div className="frd-cols">
            <section className="gb-panel frd-card frd-list" aria-label="Your friends">
              <h2 ref={heading} className="frd-pt" tabIndex={-1}>
                Your friends
              </h2>
              <p className="frd-ps">You see only what each friend chose to share. Click a friend for their profile.</p>
              <OldMark age={model} view={view} now={now} />
              {error !== null && <p className="frd-refused" role="alert">{error}</p>}
              {(cards > 0 || refused !== null) && (
                <div ref={strip} className="frd-reqs" role="group" aria-label="Requests">
                  {said !== null && (
                    <p className="frd-refused frd-note" role="alert">
                      <span>{said}</span>
                      <button type="button" className="gb-link" onClick={() => void dropInvite()}>
                        Ignore
                      </button>
                    </p>
                  )}
                  {invited !== null && (
                    <Request
                      card={invited}
                      buttons={
                        <>
                          <button
                            type="button"
                            className="gb-btn frd-btn"
                            aria-disabled={busy || undefined}
                            onClick={() => press(() => api.post<FriendsModel>('/api/friends/invite'))}
                          >
                            Send request
                          </button>
                          <button type="button" className="gb-btn quiet frd-btn" aria-disabled={busy || undefined} onClick={() => void dropInvite()}>
                            Ignore
                          </button>
                        </>
                      }
                    >
                      {(name) => (
                        <>
                          <b>{name}</b> invited you.
                        </>
                      )}
                    </Request>
                  )}
                  {waiting.map((card) => (
                    <Request
                      key={`in-${card.user_id}`}
                      card={card}
                      buttons={
                        <>
                          <button
                            type="button"
                            className="gb-btn frd-btn"
                            aria-disabled={busy || undefined}
                            onClick={() => press(() => api.post<FriendsModel>(`/api/friends/${user(card)}/accept`))}
                          >
                            Accept
                          </button>
                          <button
                            type="button"
                            className="gb-btn quiet frd-btn"
                            aria-disabled={busy || undefined}
                            onClick={() => press(() => api.post<FriendsModel>(`/api/friends/${user(card)}/decline`))}
                          >
                            Decline
                          </button>
                        </>
                      }
                    >
                      {(name) => (
                        <>
                          <b>{name}</b> wants to be your friend.
                        </>
                      )}
                    </Request>
                  ))}
                  {sent.map((card) => (
                    <Request
                      key={`out-${card.user_id}`}
                      card={card}
                      buttons={
                        <button
                          type="button"
                          className="gb-btn quiet frd-btn"
                          aria-disabled={busy || undefined}
                          onClick={() => press(() => api.delete<FriendsModel>(`/api/friends/${user(card)}`))}
                        >
                          Cancel request
                        </button>
                      }
                    >
                      {(name) => (
                        <>
                          Waiting for <b>{name}</b> to answer.
                        </>
                      )}
                    </Request>
                  ))}
                  {refused !== null && <p className="frd-refused" role="alert">{refused}</p>}
                </div>
              )}
              {model.friends.length === 0 ? (
                <p className="frd-empty">
                  {model.read_at === null
                    ? 'The friends list has not been read yet.'
                    : 'No friends yet. Send a request, or share an invite link.'}
                </p>
              ) : (
                <ul className="frd-flist" aria-label="Friends">
                  {sortedFriends(model.friends).map((friend) => (
                    <Row key={friend.user_id} friend={friend} now={clockOf(model, now)} />
                  ))}
                </ul>
              )}
            </section>

            <section className="gb-panel frd-card frd-add" aria-label="Add a friend">
              <h2 className="frd-pt">Add a friend</h2>
              <p className="frd-ps">Send your tag, or type theirs.</p>
              <div className="frd-line frd-first">
                <span className="frd-mytag" data-testid="my-tag" title={myTag}>
                  <span className="frd-mynm">
                    <bdi>{nameText(model.me.name)}</bdi>
                  </span>
                  <span className="frd-mytg">#{nameText(model.me.tag)}</span>
                </span>
                <button
                  type="button"
                  className="gb-btn quiet frd-btn"
                  onClick={() => void tag.copy(myTag, 'Tag copied.', 'The tag could not be copied. Select it and copy it by hand.')}
                >
                  Copy
                </button>
              </div>
              <p className="frd-hint">Your tag. The number is given to you, so names can repeat.</p>
              {tag.said !== null && <p className="frd-said" role="status">{tag.said}</p>}
              <hr className="frd-hr" />
              <label className="frd-lab" htmlFor="friend-query">
                Their tag or Genshin UID
              </label>
              <div className="frd-line">
                <input
                  id="friend-query"
                  className="frd-field"
                  type="text"
                  maxLength={64}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Name#1234"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void send()
                  }}
                />
                <button
                  type="button"
                  className="gb-btn frd-btn"
                  aria-disabled={busy || query.trim() === '' || undefined}
                  onClick={() => void send()}
                >
                  Send request
                </button>
              </div>
              <p className="frd-hint">A UID works only if its owner turned on Find me by UID.</p>
              {asked !== null && <p className="frd-refused" role="alert">{asked}</p>}
              <hr className="frd-hr" />
              <button type="button" className="gb-link frd-link" onClick={() => void copyLink()}>
                Copy an invite link
              </button>
              <p className="frd-hint">Paste it on Discord. Whoever opens it in Guild Board can send you a request.</p>
              {invite.said !== null && <p className="frd-said" role="status">{invite.said}</p>}
              {link !== null && (
                <input className="frd-field frd-linkfield" readOnly aria-label="Invite link" value={link} onFocus={(event) => event.currentTarget.select()} />
              )}
            </section>
          </div>
        </div>
      )}
    </Frame>
  )
}
