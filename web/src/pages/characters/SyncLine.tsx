import { useEffect, useState } from 'react'
import { api, messageOf } from '../../api.ts'
import { FreshRing } from '../../frame/FreshRing.tsx'
import { type Live, useTick } from '../../live.ts'
import type { CharSync } from '../../types.ts'
import { CALCULATOR_OFF, charactersFresh } from './words.ts'

/**
 * The freshness ring of the Characters pages, at the right end of the top bar (freshness design, section 1): when HoYoLAB
 * was last read, and a press that reads now. A press asks the core for a `characters` run (POST /api/characters/refresh);
 * one it refuses (409) says why in the ring's tip, with the minutes, until the next press or until a new model comes.
 * The ring is always a button, so that the focus stays on it; it takes a press only while the core would take one
 * (`can_refresh`) and no read runs, and otherwise rests (aria-disabled) and the tip says why. The long sentence
 * about the calculator is not here: the pages that show held amounts say it in `CalculatorNote`.
 */
export function SyncLine({ live, sync }: { live: Live; sync: CharSync }) {
  useTick(60_000) // the age and the ring's fill move on
  const [pressing, setPressing] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  // A new answer of the core (a run began or ended, a minute passed) takes the refusal away.
  useEffect(() => setRefusal(null), [sync])
  const view = charactersFresh(sync, live.now(), refusal)
  const press = async () => {
    if (pressing || !sync.can_refresh) return
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
  return (
    <FreshRing
      view={pressing ? { ...view, turning: true, label: 'Reading…' } : view}
      onPress={() => void press()}
      disabled={!sync.can_refresh}
      testId="characters-sync"
    />
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
