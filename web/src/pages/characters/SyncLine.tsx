import { useEffect, useState } from 'react'
import { api, messageOf } from '../../api.ts'
import type { Live } from '../../live.ts'
import type { CharSync } from '../../types.ts'
import { CALCULATOR_OFF, syncWords } from './words.ts'

/**
 * The Refresh button of the Characters pages and the lines beside it: when HoYoLAB was last read, the minutes to wait
 * after a read that was too soon, and what the core says when nothing can be read. A press asks the core for a
 * `characters` run (POST /api/characters/refresh); one it refuses (409) says why, with the minutes, until the next press
 * or until a new model comes. The button rests, and keeps its focus, while a run goes or one must wait (aria-disabled).
 * The long sentence about the calculator is not here: the pages that show held amounts say it in `CalculatorNote`.
 */
export function SyncLine({ live, sync }: { live: Live; sync: CharSync }) {
  const [pressing, setPressing] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  // A new answer of the core (a run began or ended, a minute passed) takes the refusal away.
  useEffect(() => setRefusal(null), [sync])
  const words = syncWords(sync, live.now())
  const resting = words.disabled || pressing
  const press = async () => {
    if (resting) return
    setPressing(true)
    setRefusal(null)
    try {
      await api.post('/api/characters/refresh')
    } catch (error) {
      setRefusal(messageOf(error))
    } finally {
      setPressing(false)
    }
  }
  const lines = refusal === null ? words.lines.filter((line) => line !== CALCULATOR_OFF) : [refusal]
  return (
    <>
      <button type="button" className="gb-btn cx-refresh" aria-disabled={resting} onClick={() => void press()}>
        {pressing ? 'Reading…' : words.button}
      </button>
      <span className="gb-status cx-sync" data-testid="characters-sync" role="status">
        {lines.join(' ')}
      </span>
    </>
  )
}

/** The sentence about the calculator, where a held amount would be, while HoYoLAB's calculator sync is off. */
export function CalculatorNote({ sync }: { sync: CharSync }) {
  if (sync.calculator !== 'off') return null
  return (
    <p className="cx-note" data-testid="calculator-off">
      {CALCULATOR_OFF}
    </p>
  )
}
