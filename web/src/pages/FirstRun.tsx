import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import '../styles/firstrun.css'
import { api, messageOf } from '../api.ts'
import type { Live } from '../live.ts'
import { hashOf } from '../route.ts'
import { syncPlate } from '../syncview.ts'
import { FAN_MADE, HANDS_OFF, RISK, WHAT_IS_READ } from '../texts.ts'
import type { Settings, Status } from '../types.ts'

type Step = 'read' | 'choose' | 'sync'

const NUMBER: Record<Step, number> = { read: 1, choose: 2, sync: 3 }

/** How long the first sync may take before the page offers to go on without it. */
export const SLOW_MS = 20_000

/**
 * Shown until the player has acknowledged what Guild Board reads and the risk (spec sections 3.3 and
 * 10.4): what is read and kept, then the login or the demo, then the first sync, then the Board.
 */
export function FirstRun({ live, status, settings }: { live: Live; status: Status; settings: Settings }) {
  const [step, setStep] = useState<Step>('read')
  const [agreed, setAgreed] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [wanted, setWanted] = useState<boolean | null>(null)
  const [slow, setSlow] = useState(false)
  const finishing = useRef(false)
  const { saveSettings } = live
  const demo = status.mode === 'demo'
  const loggedIn = demo || (status.account !== null && status.account.uid !== null)
  const done = status.sync.state !== 'syncing' && status.sync.last_ok_at !== null
  // What the plate would say of a sync that needs the player or did not go through; null while all is well.
  const problem = syncPlate(status, live.now(), 0, true).detail

  const finish = useCallback(async () => {
    if (finishing.current) return
    finishing.current = true
    window.location.hash = hashOf('board')
    try {
      await saveSettings({ risk_acknowledged: true })
    } catch (error) {
      finishing.current = false
      setNotice(messageOf(error))
    }
  }, [saveSettings])

  // After a login in Guild Board's window, the first sync starts by itself; the page follows it.
  useEffect(() => {
    if (step === 'choose' && !demo && loggedIn) setStep('sync')
  }, [step, demo, loggedIn])

  useEffect(() => {
    if (step === 'sync' && done) void finish()
  }, [step, done, finish])

  // A sync refused by the five-minute wait or the daily limit changes no state, so after a while the page offers a way on.
  useEffect(() => {
    if (step !== 'sync' || done) return
    const timer = window.setTimeout(() => setSlow(true), SLOW_MS)
    return () => window.clearTimeout(timer)
  }, [step, done])

  const ask = async (path: string) => {
    setNotice(null)
    try {
      await api.post(path)
    } catch (error) {
      setNotice(messageOf(error))
    }
  }

  const startWithWindows = (on: boolean) => {
    setWanted(on)
    saveSettings({ start_with_windows: on }).then(
      () => setWanted(null),
      (error: unknown) => {
        setWanted(null)
        setNotice(messageOf(error))
      },
    )
  }

  let body: ReactNode
  if (step === 'read') {
    body = (
      <>
        <h1>Welcome to Guild Board</h1>
        <p>
          Guild Board keeps track of your Genshin Impact account: what is left to explore, and how your play changes
          over time. Before it starts, here is exactly what it does.
        </p>
        <p>{FAN_MADE}</p>
        <h2>What it reads from HoYoLAB</h2>
        <ul>
          {WHAT_IS_READ.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <h2>What it keeps</h2>
        <p>
          Everything stays in one folder on this PC, <code>{status.data_dir}</code>. Nothing is uploaded unless you sign in to an online account.
        </p>
        <h2>What it never does</h2>
        <ul>
          {HANDS_OFF.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <h2>The risk</h2>
        <div className="fr-risk">
          {RISK.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
        <label className="fr-check">
          <input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} />
          I have read this and want to continue.
        </label>
        <div className="fr-actions">
          <button type="button" className="gb-btn" disabled={!agreed} onClick={() => setStep('choose')}>
            Continue
          </button>
        </div>
      </>
    )
  } else if (step === 'choose') {
    body = (
      <>
        {demo ? (
          <>
            <h1>This is the demo</h1>
            <p>
              This copy of Guild Board runs on a made-up account. Nothing is read from HoYoLAB, so you can look around
              freely.
            </p>
            <div className="fr-actions">
              <button type="button" className="gb-btn" onClick={() => setStep('sync')}>
                Continue with demo data
              </button>
            </div>
          </>
        ) : (
          <>
            <h1>Connect your account</h1>
            <p>
              You log in on HoYoLAB's own page, in a window that Guild Board opens. Guild Board never sees your
              password; it keeps only the login that HoYoLAB hands back, encrypted on this PC.
            </p>
            <div className="fr-actions">
              <button type="button" className="gb-btn" onClick={() => void ask('/api/auth/login')}>
                Log in to HoYoLAB
              </button>
              <button type="button" className="gb-btn quiet" onClick={() => void ask('/api/demo/open')}>
                Look around with demo data
              </button>
              <button type="button" className="gb-link" onClick={() => void finish()}>
                Not now
              </button>
            </div>
          </>
        )}
        <label className="fr-check light">
          <input
            type="checkbox"
            checked={wanted ?? settings.start_with_windows}
            onChange={(event) => startWithWindows(event.target.checked)}
          />
          Start Guild Board when Windows starts
        </label>
        <p className="gb-note">Playtime is measured only while Guild Board is running. Starting it with Windows catches every session.</p>
      </>
    )
  } else if (done) {
    body = (
      <>
        <h1>Ready</h1>
        <p>Opening the Board…</p>
      </>
    )
  } else if (problem !== null) {
    body = (
      <>
        <h1>The first sync did not finish</h1>
        <p>{problem}</p>
        <div className="fr-actions">
          <button type="button" className="gb-btn" onClick={() => void finish()}>
            Open Guild Board anyway
          </button>
        </div>
      </>
    )
  } else {
    body = (
      <>
        <h1>Reading your account</h1>
        <p className="fr-wait">
          <span className="gb-spin" aria-hidden="true" />
          Reading the account for the first time. This takes a few seconds.
        </p>
        {slow && (
          <>
            <p>This is taking longer than it should. You can open Guild Board now; it syncs at the next chance.</p>
            <div className="fr-actions">
              <button type="button" className="gb-btn" onClick={() => void finish()}>
                Open Guild Board anyway
              </button>
            </div>
          </>
        )}
      </>
    )
  }

  return (
    <div className="fr">
      <main className="gb-panel fr-card">
        <div className="fr-brand">✦ Guild Board</div>
        {live.problem !== null && (
          <div className="gb-banner fr-problem" role="alert">
            {live.problem}
          </div>
        )}
        <p className="fr-step">Step {NUMBER[step]} of 3</p>
        {body}
        {notice !== null && (
          <p className="fr-notice" role="status">
            {notice}
          </p>
        )}
      </main>
    </div>
  )
}
