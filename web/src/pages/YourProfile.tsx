import { type ReactNode, useRef, useState } from 'react'
import '../styles/friends.css'
import { api, messageOf } from '../api.ts'
import { Frame } from '../frame/Frame.tsx'
import type { Live } from '../live.ts'
import type { ShareKey, StatKey, YourProfile as ProfileModel } from '../onlinetypes.ts'
import { hashOf } from '../route.ts'
import { Sign } from '../ui/Sign.tsx'
import { Switch } from '../ui/Switch.tsx'
import { Avatar, Chips, Gate, useCopy, usePolled } from './FriendsParts.tsx'
import { gateText, nameText, SHARE_KEYS, statusLine, statusText } from './friendsview.ts'
import { detailOf, headerLine, pinsAfter, pinsKept, previewOf, sharingAfter, tileOf } from './profileview.ts'

/** The picture of what a friend sees beside a name, in words: it is the chips below the tiles. */
const PREVIEW = "Beside your name on your friends' lists:"

/** The right panel's rows share one look: a name with a line under it, and what can be done at the far side. */
function Item({ name, line, children }: { name: string; line: string; children: ReactNode }) {
  return (
    <div className="prf-it">
      <div>
        <b>{name}</b>
        <small>{line}</small>
      </div>
      {children}
    </div>
  )
}

/**
 * Your profile (the online design, sections 6 and 9, mockup 2): what friends see of the player, tile by tile, each with its
 * switch and its pin, the preview of what stands beside the name on their lists, and Finding you. A switch changes on the
 * server or not at all: it moves at once, and goes back with the server's sentence if the change was refused.
 */
export function YourProfile({ live }: { live: Live }) {
  const view = live.status?.online ?? null
  const gated = view === null || gateText(view) !== null
  const { data: profile, error, take } = usePolled<ProfileModel>(gated ? null : '/api/profile', live)
  const account = live.status?.account ?? null
  // What the switches and pins show while a change is on its way to the server: the new state, or the old one if it is refused.
  const [pending, setPending] = useState<{ sharing: ShareKey[]; pins: StatKey[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const nameButton = useRef<HTMLButtonElement>(null)
  const tag = useCopy()

  // The editor goes, and the focus it holds would fall back to the start of the page: it goes to Change.
  const closeName = () => {
    nameButton.current?.focus()
    setEditing(false)
  }

  const sharing = pending?.sharing ?? profile?.sharing ?? []
  const pins = pending?.pins ?? profile?.pins ?? []

  const change = async (path: string, keys: string[], shown: { sharing: ShareKey[]; pins: StatKey[] }) => {
    if (busy) return
    setBusy(true)
    setSaid(null)
    setPending(shown)
    try {
      take(await api.put<ProfileModel>(path, { keys }))
    } catch (failure) {
      setSaid(messageOf(failure))
    } finally {
      setPending(null)
      setBusy(false)
    }
  }
  const toggleShare = (key: ShareKey) => {
    const next = sharingAfter(sharing, key)
    void change('/api/profile/sharing', next, { sharing: next, pins: pinsKept(pins, next) })
  }
  const togglePin = (key: ShareKey) => {
    if (busy) return
    const result = pinsAfter(pins, key, sharing)
    if ('refused' in result) {
      setSaid(result.refused)
      return
    }
    void change('/api/profile/pins', result.pins, { sharing, pins: result.pins })
  }
  const findByUid = async () => {
    if (busy || profile === null) return
    setBusy(true)
    setSaid(null)
    try {
      take(await api.put<ProfileModel>('/api/profile/find-by-uid', { on: !profile.find_by_uid }))
    } catch (failure) {
      setSaid(messageOf(failure))
    } finally {
      setBusy(false)
    }
  }
  const saveName = async () => {
    if (busy) return
    setBusy(true)
    setNameError(null)
    try {
      take(await api.put<ProfileModel>('/api/profile/name', { name: name.trim() }))
      closeName()
      await live.refresh() // the card and Settings read the new name from the status
    } catch (failure) {
      setNameError(messageOf(failure))
    } finally {
      setBusy(false)
    }
  }
  const signOut = async () => {
    try {
      await api.post('/api/online/sign-out')
    } catch (failure) {
      setSaid(messageOf(failure))
    }
    await live.refresh()
  }

  const line = profile === null ? null : statusLine({ status: profile.status, since: profile.since, last_seen: null }, live.now())
  const chips = profile === null ? [] : previewOf({ sharing, pins, stats: profile.stats })
  // The player's own name and tag come from the online server too.
  const [ownName, ownTag] = profile === null ? ['', ''] : [nameText(profile.name), nameText(profile.tag)]
  const controls = (
    <a className="gb-link" href={hashOf('friends')}>
      Back to Friends
    </a>
  )
  return (
    <Frame page="friends" live={live} title="Your profile" controls={controls}>
      {view === null ? null : gated ? (
        <Gate view={view} />
      ) : profile === null || line === null ? (
        <div className="gb-panel gb-empty">{error ?? 'Reading your profile…'}</div>
      ) : (
        <div className="gb-page prf-page">
          <div className="prf-cols">
            <section className="gb-panel frd-card" aria-label="Profile">
              <div className="prf-head">
                <Avatar src={account?.picture_url ?? null} ar={account?.adventure_rank ?? null} dot={line.tone} size="big" />
                <div className="prf-who">
                  <div className="prf-nm" data-testid="your-name">
                    <bdi>{ownName}</bdi>
                    <span>#{ownTag}</span>
                  </div>
                  <div className="prf-meta" data-testid="your-header">
                    {headerLine(profile.server, profile.uid)}
                  </div>
                  <div className={`prf-meta ${line.tone === 'none' ? '' : line.tone}`} data-testid="your-status">
                    {statusText(line)}
                  </div>
                </div>
              </div>

              <h2 className="frd-pt prf-h">What your friends see</h2>
              <p className="frd-ps">
                Turn a stat off and it stays on this PC. Pin up to three to show them beside your name on your friends' lists.
              </p>
              <p className="prf-always" data-testid="friends-always-see">
                Friends you accept also see your name, tag, Adventure Rank, UID and picture, whatever these switches say.
              </p>
              {/* A shared number goes up when this PC learns it, so its changes say when Guild Board ran (audit M14). */}
              <p className="prf-always" data-testid="friends-see-changes">
                Friends can see when a stat you share changes, so they can tell roughly when Guild Board was running.
              </p>
              <div className="prf-tiles">
                {SHARE_KEYS.map((key) => {
                  const item = tileOf(key, { stats: profile.stats, status: profile.status, own: true })
                  const on = sharing.includes(key)
                  const pinned = key !== 'status' && pins.includes(key as StatKey)
                  return (
                    <div key={key} role="group" aria-label={item.name} className={`prf-tile${on ? '' : ' off'}${pinned ? ' pinned' : ''}`}>
                      <div className="prf-tt">
                        <span>{item.name}</span>
                        <span className="gb-grow" />
                        {key !== 'status' && on && (
                          <button
                            type="button"
                            className={pinned ? 'prf-pin on' : 'prf-pin'}
                            aria-label={`Pin ${item.name}`}
                            aria-pressed={pinned}
                            title={pinned ? "Shown on your friends' lists" : "Show on your friends' lists"}
                            onClick={() => togglePin(key)}
                          >
                            <Sign name="pin" />
                          </button>
                        )}
                        <Switch on={on} label={`Share ${item.name}`} className="prf-switch" onPress={() => toggleShare(key)} />
                      </div>
                      <div className="prf-v">
                        {item.value}
                        {item.unit !== '' && <small> {item.unit}</small>}
                      </div>
                      <div className="prf-d">{detailOf(item, on)}</div>
                    </div>
                  )
                })}
              </div>
              {said !== null && (
                <p className="frd-refused" role="alert" data-testid="profile-said">
                  {said}
                </p>
              )}
              <div className="prf-pinsum" data-testid="profile-preview">
                <span>{PREVIEW}</span>
                {chips.length > 0 ? <Chips chips={chips} /> : <span>nothing yet</span>}
              </div>
            </section>

            <section className="gb-panel frd-card prf-set" aria-label="Finding you">
              <h2 className="frd-pt">Finding you</h2>
              <Item name="Find me by UID" line="Others can send you a request with your Genshin UID.">
                <Switch on={profile.find_by_uid} label="Find me by UID" className="prf-switch" onPress={() => void findByUid()} />
              </Item>
              <Item name="Your tag" line={`${ownName}#${ownTag}`}>
                <button
                  type="button"
                  className="gb-btn quiet frd-btn"
                  onClick={() => void tag.copy(`${ownName}#${ownTag}`, 'Tag copied.', 'The tag could not be copied. Select it and copy it by hand.')}
                >
                  Copy
                </button>
              </Item>
              {tag.said !== null && <p className="frd-said" role="status">{tag.said}</p>}
              <Item name="Your name" line="The number stays when it is free under the new name.">
                <button
                  ref={nameButton}
                  type="button"
                  className="gb-btn quiet frd-btn"
                  aria-expanded={editing}
                  onClick={() => {
                    setName(ownName)
                    setNameError(null)
                    setEditing(!editing)
                  }}
                >
                  Change
                </button>
              </Item>
              {editing && (
                <div className="prf-edit" role="group" aria-label="Change your name">
                  <input
                    className="frd-field"
                    aria-label="Your name"
                    maxLength={40}
                    autoComplete="off"
                    spellCheck={false}
                    autoFocus
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void saveName()
                      if (event.key === 'Escape') closeName()
                    }}
                  />
                  <div className="prf-edit-acts">
                    <button type="button" className="gb-btn frd-btn" aria-disabled={busy || undefined} onClick={() => void saveName()}>
                      Save
                    </button>
                    <button type="button" className="gb-btn quiet frd-btn" onClick={closeName}>
                      Cancel
                    </button>
                  </div>
                  {nameError !== null && (
                    <p className="frd-refused" role="alert">
                      {nameError}
                    </p>
                  )}
                </div>
              )}
              <Item name="Signed in with Discord" line={`as ${ownName}#${ownTag}. Your HoYoLAB login never goes there.`}>
                <button type="button" className="gb-btn quiet frd-btn" onClick={() => void signOut()}>
                  Sign out
                </button>
              </Item>
            </section>
          </div>
        </div>
      )}
    </Frame>
  )
}
