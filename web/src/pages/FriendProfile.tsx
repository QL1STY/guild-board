import { useEffect, useRef, useState } from 'react'
import '../styles/friends.css'
import { api, messageOf } from '../api.ts'
import { Frame } from '../frame/Frame.tsx'
import type { Live } from '../live.ts'
import type { FriendProfile as ProfileModel, FriendsModel } from '../onlinetypes.ts'
import { hashOf } from '../route.ts'
import { Avatar, CompareButton, Gate, OldMark, pictureOf, usePolled } from './FriendsParts.tsx'
import { clockOf, nameText, showsFriends, statusLine, statusText, uidText } from './friendsview.ts'
import { tilesOfFriend } from './profileview.ts'

/**
 * A friend's profile (the online design, section 9): the left side of Your profile, read-only, with only what they share, a
 * Compare button and a quiet Remove friend that asks first. What they share is read through profileview.ts: it comes from their
 * PC, and what cannot be shown is left out.
 */
export function FriendProfile({ live, user }: { live: Live; user: string }) {
  const view = live.status?.online ?? null
  const gated = view === null || !showsFriends(view)
  const id = encodeURIComponent(user)
  const { data, error } = usePolled<ProfileModel>(gated ? null : `/api/friends/${id}`, live, '/api/friends?fresh=1')
  const friend = data?.friend ?? null
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [refused, setRefused] = useState<string | null>(null)

  // The question takes the place of the link that opened it, so the focus goes to its safe answer, and back to the link after.
  const opener = useRef<HTMLButtonElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const asked = useRef(false)
  useEffect(() => {
    if (asking) cancel.current?.focus()
    else if (asked.current) opener.current?.focus()
    asked.current = asking
  }, [asking])

  const shown = useRef(true) // a player who left while the request was on its way stays where they went
  useEffect(() => {
    shown.current = true
    return () => {
      shown.current = false
    }
  }, [])

  const remove = async () => {
    if (busy) return
    setBusy(true)
    setRefused(null)
    try {
      await api.delete<FriendsModel>(`/api/friends/${id}`)
      if (shown.current) window.location.hash = hashOf('friends')
    } catch (failure) {
      setRefused(messageOf(failure))
    } finally {
      setBusy(false)
    }
  }

  const back = (
    <a className="gb-link" href={hashOf('friends')}>
      Back to Friends
    </a>
  )
  const now = live.now()
  const line = data === null || friend === null ? null : statusLine(friend, clockOf(data, now))
  const tiles = friend === null ? [] : tilesOfFriend(friend.stats)
  const uid = friend === null ? null : uidText(friend.uid)
  const name = friend === null ? '' : nameText(friend.name)
  return (
    <Frame page="friends" live={live} title={name === '' ? undefined : name} controls={back}>
      {view === null ? null : gated ? (
        <Gate view={view} />
      ) : data === null || friend === null || line === null ? (
        <div className="gb-panel gb-empty" data-testid={error === null ? undefined : 'friend-missing'}>
          {error ?? 'Reading the profile…'}
        </div>
      ) : (
        <div className="gb-page prf-page">
          <div className="prf-cols solo">
            <OldMark age={data} view={view} now={now} />
            <section className="gb-panel frd-card" aria-label="Profile">
              <div className="prf-head">
                <Avatar src={friend.has_picture === true ? pictureOf(id) : null} ar={friend.ar} dot={line.tone} size="big" />
                <div className="prf-who">
                  <div className="prf-nm" data-testid="friend-name">
                    <bdi>{name}</bdi>
                    <span>#{nameText(friend.tag)}</span>
                  </div>
                  {uid !== null && (
                    <div className="prf-meta" data-testid="friend-header">
                      UID {uid}
                    </div>
                  )}
                  {line.tone !== 'none' && (
                    <div className={`prf-meta ${line.tone}`} data-testid="friend-status">
                      {statusText(line)}
                    </div>
                  )}
                </div>
                <CompareButton friend={friend} />
              </div>

              <h2 className="frd-pt prf-h">
                What <bdi>{name}</bdi> shares
              </h2>
              {tiles.length === 0 ? (
                <p className="prf-none" data-testid="friend-shares">
                  <bdi>{name}</bdi> shares nothing yet.
                </p>
              ) : (
                <div className="prf-tiles">
                  {tiles.map((item) => (
                    <div key={item.key} role="group" aria-label={item.name} className="prf-tile">
                      <div className="prf-tt">
                        <span>{item.name}</span>
                      </div>
                      <div className="prf-v">
                        {item.value}
                        {item.unit !== '' && <small> {item.unit}</small>}
                      </div>
                      <div className="prf-d">{item.detail}</div>
                    </div>
                  ))}
                </div>
              )}

              <div className="prf-foot">
                {!asking && (
                  <button ref={opener} type="button" className="gb-link" onClick={() => setAsking(true)}>
                    Remove friend
                  </button>
                )}
                {asking && (
                  <div
                    className="prf-ask"
                    role="alertdialog"
                    aria-label={`Confirm removing ${name}`}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') setAsking(false)
                    }}
                  >
                    <p>
                      Remove <bdi>{name}</bdi> from your friends? You will stop seeing each other's stats.
                    </p>
                    <div className="prf-edit-acts">
                      <button type="button" className="gb-btn frd-btn" aria-disabled={busy || undefined} onClick={() => void remove()}>
                        Remove friend
                      </button>
                      <button ref={cancel} type="button" className="gb-btn quiet frd-btn" onClick={() => setAsking(false)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
                {refused !== null && (
                  <p className="frd-refused" role="alert">
                    {refused}
                  </p>
                )}
              </div>
            </section>
          </div>
        </div>
      )}
    </Frame>
  )
}
