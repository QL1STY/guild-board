import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { hashOf } from '../route.ts'
import type { Status } from '../types.ts'
import { Picture } from '../ui/Picture.tsx'
import { Panel, PanelRows, usePanel } from './Panel.tsx'
import { plural } from '../format.ts'
import { primogemsText } from '../pages/codesview.ts'
import { cardText, linksOf, profileRows } from './profileview.ts'

/** The player's picture in a gold ring, with the Adventure Rank on a small tab over the ring's foot. */
function Avatar({ account, ar }: { account: Status['account']; ar: string | null }) {
  return (
    <span className="gb-ava">
      <Picture src={account?.picture_url ?? null} sign="person" className="gb-ava-pic" />
      {ar !== null && <span className="gb-ar">{ar}</span>}
    </span>
  )
}

/**
 * The UID with the server, under the name: on one line, "UID 700000001 · Europe", or, when that does not fit the card, the
 * UID and the server a line each. The one line is drawn first and measured; a longer server name ("TW, HK, MO") splits it.
 * A split is only trusted for the fonts it was measured with: a line measured before the web font is in is wider than
 * one measured after. So each time fonts finish loading the line is drawn on one line again and measured again.
 */
function WhoLine({ line }: { line: string }) {
  const element = useRef<HTMLElement>(null)
  // How many times fonts have finished loading since the card was drawn: the web font loads when the page first draws
  // text in it, which can be after the card's first measure.
  const [loads, setLoads] = useState(0)
  // The line that did not fit, and the loads it was measured after; a new line or a new load is tried on one line
  // again.
  const [crowded, setCrowded] = useState<{ line: string; loads: number } | null>(null)
  const split = crowded !== null && crowded.line === line && crowded.loads === loads
  useEffect(() => {
    let current = true
    const loaded = () => {
      if (current) setLoads((count) => count + 1)
    }
    document.fonts.addEventListener('loadingdone', loaded)
    void document.fonts.ready.then(loaded)
    return () => {
      current = false
      document.fonts.removeEventListener('loadingdone', loaded)
    }
  }, [])
  // Before the browser paints, so that a card that must split never shows one unsplit frame.
  useLayoutEffect(() => {
    const small = element.current
    if (!split && small !== null && small.scrollWidth > small.clientWidth) setCrowded({ line, loads })
  }, [line, loads, split])
  return (
    <small ref={element} className={split ? 'gb-who-line split' : 'gb-who-line'}>
      {split ? line.split(' · ').map((part) => <span key={part}>{part}</span>) : line}
    </small>
  )
}

/**
 * The card at the top of the rail (top bar and undo design, section 3): the picture, the name and the UID with the
 * server. It is a button that opens a panel beside it with the account's rows and a button to Settings. With no account
 * the card says so, and a press opens Settings in place of the panel.
 */
export function ProfileCard({ status }: { status: Status }) {
  const account = status.account
  const panel = usePanel()
  const text = cardText(account)
  // An account that goes while the panel is open takes the panel with it, and it does not come back with the next one.
  const { opener, close } = panel
  useEffect(() => {
    if (account === null && opener !== null) close(false)
  }, [account, opener, close])
  const goToSettings = () => {
    panel.close(false)
    window.location.hash = hashOf('settings')
  }
  const links = linksOf(account === null || account.uid === null ? null : { uid: String(account.uid) })
  const goToCodes = () => {
    panel.close(false)
    window.location.hash = hashOf('codes')
  }
  const goToProfile = () => {
    panel.close(false)
    window.location.hash = hashOf({ page: 'friends', view: 'me' })
  }
  return (
    <div ref={panel.scope} className="gb-who-card">
      <button
        type="button"
        className="gb-who"
        data-testid="profile"
        aria-haspopup={account === null ? undefined : 'dialog'}
        aria-expanded={account === null ? undefined : panel.opener !== null}
        onClick={(event) => (account === null ? goToSettings() : panel.toggle(event.currentTarget))}
      >
        <Avatar account={account} ar={text.ar} />
        <span className="gb-who-name">{text.name}</span>
        {text.line !== '' && <WhoLine line={text.line} />}
      </button>
      {account !== null && panel.opener !== null && (
        <Panel label="Profile" testId="profile-panel" className="gb-pop-rail" opener={panel.opener} scope={panel.scope} onClose={panel.close}>
          <div className="gb-pop-head">
            <Avatar account={account} ar={null} />
            <div>
              <h2>{text.name}</h2>
              {account.adventure_rank !== null && <small>Adventure Rank {account.adventure_rank}</small>}
            </div>
          </div>
          <PanelRows rows={profileRows(account, status.tracking_since)} />
          <div className="gb-pop-sec">Gift codes</div>
          <div className="gb-pop-codes" data-testid="codes-tile">
            <div>
              <b>{primogemsText(status.codes.primogems)}</b>
              <small>primogems from {plural(status.codes.redeemed, 'code')}</small>
            </div>
            <button type="button" className="gb-btn" onClick={goToCodes}>
              Redeem a code
            </button>
          </div>
          {links.length > 0 && <div className="gb-pop-sec">Links</div>}
          <ul className="gb-pop-links" data-testid="profile-links">
            {links.map((link) => (
              <li key={link.label}>
                <button type="button" onClick={() => window.open(link.url, '_blank', 'noopener')}>
                  {link.label}
                  <i aria-hidden="true">↗</i>
                </button>
              </li>
            ))}
          </ul>
          <div className="gb-pop-acts">
            {/* What friends see of the player (the online design, section 9): there once the player is signed in. */}
            {status.online.state === 'signed_in' && (
              <button type="button" className="gb-btn quiet" onClick={goToProfile}>
                Your profile
              </button>
            )}
            <button type="button" className="gb-btn quiet" onClick={goToSettings}>
              Account settings
            </button>
          </div>
        </Panel>
      )}
    </div>
  )
}
