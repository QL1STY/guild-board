import { useState } from 'react'
import '../styles/codes.css'
import { api, messageOf } from '../api.ts'
import { localDay, plural } from '../format.ts'
import { Frame } from '../frame/Frame.tsx'
import { type Live, useModel } from '../live.ts'
import type { CodeRow, CodesModel } from '../types.ts'
import { PRIMOGEMS_NOTE, loginOffer, primogemsOf, primogemsText, resultText } from './codesview.ts'

/** The primogems a redeemed code gave, corrected in place when the field is left or Enter is pressed. */
function Given({ row }: { row: CodeRow }) {
  const [refused, setRefused] = useState<string | null>(null)
  const save = async (text: string) => {
    const value = primogemsOf(text)
    if (value === null) {
      setRefused(PRIMOGEMS_NOTE)
      return
    }
    if (value === row.primogems) {
      setRefused(null)
      return
    }
    try {
      await api.put(`/api/codes/${encodeURIComponent(row.code)}`, { primogems: value })
      setRefused(null)
    } catch (error) {
      setRefused(messageOf(error))
    }
  }
  return (
    <>
      <input
        key={`${row.code}-${row.primogems}`}
        type="number"
        min={0}
        max={100000}
        step={1}
        aria-label={`Primogems from ${row.code}`}
        defaultValue={row.primogems}
        onBlur={(event) => void save(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
      />
            {refused !== null && <span role="alert">{refused}</span>}
    </>
  )
}

/**
 * The Codes page (the gift codes design, section 1): what the redeemed codes gave, the new livestream codes, one field
 * for the codes the player has, the run's progress and the history, from which a code can be removed. It is reached from the profile panel, not from the rail.
 */
export function Codes({ live }: { live: Live }) {
  const { data, error } = useModel<CodesModel>('/api/codes', live.version)
  const [text, setText] = useState('')
  const [gems, setGems] = useState('')
  const [refused, setRefused] = useState<string | null>(null)

  const send = async (path: string, body?: unknown, method: 'post' | 'delete' = 'post') => {
    setRefused(null)
    try {
      if (method === 'delete') await api.delete(path)
      else await api.post(path, body)
      return true
    } catch (failure) {
      setRefused(messageOf(failure))
      return false
    }
  }
  const redeem = async () => {
    const given = gems.trim() === '' ? null : primogemsOf(gems)
    if (gems.trim() !== '' && given === null) {
      setRefused(PRIMOGEMS_NOTE)
      return
    }
    if (await send('/api/codes/redeem', { text, primogems: given })) {
      setText('')
      setGems('')
    }
  }

  const offer = data === null ? null : loginOffer(data)
  return (
    <Frame page="codes" live={live}>
      {data === null ? (
        <div className="gb-panel gb-empty">{error ?? 'Reading the gift codes…'}</div>
      ) : (
        <div className="cd-page">
          <div className="gb-panel cd-hero">
            <div className="cd-big" data-testid="codes-primogems">
              <b>
                <span className="cd-star" aria-hidden="true">
                  ✦
                </span>
                {primogemsText(data.totals.primogems)}
              </b>
              <small>primogems from {plural(data.totals.redeemed, 'code')}</small>
            </div>

            {offer === 'box' && (
              <div className="cd-loginbox" data-testid="codes-login-first">
                <div>
                  <b>Log in once to redeem codes</b>
                  <small>HoYoverse asks for a fresh login before the first code.</small>
                </div>
                <button type="button" className="gb-btn up-btn" onClick={() => void send('/api/auth/login')}>
                  Log in
                </button>
              </div>
            )}
            <div className="cd-field" data-off={offer === 'box' ? '' : undefined}>
              <input
                className="cd-code"
                type="text"
                aria-label="Codes"
                placeholder="Paste one code or several"
                autoComplete="off"
                spellCheck={false}
                value={text}
                disabled={offer === 'box'}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !data.busy && offer !== 'box' && text.trim() !== '') void redeem()
                }}
              />
              <input
                className="cd-gems"
                type="number"
                min={0}
                max={100000}
                step={1}
                aria-label="Primogems (optional)"
                placeholder="primogems"
                value={gems}
                disabled={offer === 'box'}
                onChange={(event) => setGems(event.target.value)}
              />
              <button type="button" className="cd-go" disabled={data.busy || offer === 'box' || text.trim() === ''} onClick={() => void redeem()}>
                Redeem
              </button>
            </div>
            {offer === 'button' && (
              <div className="cd-login">
                <button type="button" className="gb-btn quiet" onClick={() => void send('/api/auth/login')}>
                  {data.needs_login ? 'Log in' : 'Log in again'}
                </button>
              </div>
            )}
            {refused !== null && (
              <p className="cd-note" role="alert" data-testid="codes-refused">
                {refused}
              </p>
            )}
            {data.progress.length > 0 && (
              <ul className="cd-run" data-testid="codes-progress">
                {data.progress.map((entry, index) => (
                  <li key={`${entry.code}-${index}`}>
                    <code>{entry.code}</code>
                    <span>{entry.text ?? resultText(entry.state)}</span>
                  </li>
                ))}
              </ul>
            )}

            {data.live.length > 0 && (
              <div className="cd-live" data-testid="codes-live">
                <b>
                  {plural(data.live.length, 'new livestream code')} ·{' '}
                  {primogemsText(data.live.reduce((sum, item) => sum + item.primogems, 0))} primogems
                </b>
                {/* The codes shown go with the press: the core redeems only those of them that are still new, never one
                    that it found after the page was drawn (the gift codes design, section 1: a code the player clicked). */}
                <button
                  type="button"
                  className="cd-go"
                  disabled={data.busy}
                  onClick={() => void send('/api/codes/redeem-live', { codes: data.live.map((item) => item.code) })}
                >
                  Redeem all
                </button>
              </div>
            )}
          </div>

          <div className="gb-panel cd-list">
            {data.history.length === 0 ? (
              <p className="cd-empty">No codes yet.</p>
            ) : (
              <ul className="cd-hist" data-testid="codes-history">
                {data.history.map((row) => {
                  const settled = row.result === 'redeemed' || row.result === 'already'
                  return (
                    <li key={row.code}>
                      <code>{row.code}</code>
                      <span className={settled ? 'cd-good' : 'cd-bad'}>{row.text}</span>
                      <span className="cd-pr">{settled && <Given row={row} />}</span>
                      <span className="cd-date">{localDay(row.at)}</span>
                      <button
                        type="button"
                        className="cd-x"
                        aria-label={`Remove ${row.code} from the history`}
                        onClick={() => void send(`/api/codes/${encodeURIComponent(row.code)}`, undefined, 'delete')}
                      >
                        ×
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </Frame>
  )
}
