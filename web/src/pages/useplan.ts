import { useEffect, useState } from 'react'
import { type Live, useModel, useTick } from '../live.ts'
import type { PlanModel } from '../types.ts'

/**
 * The Plan page's model (`GET /api/plan`), read again when the day turns: the game day changes at 04:00 server time, which the
 * model names (`turns_at`) and the core's clock (`live.now()`) says has passed, so what is open today is never yesterday's. The
 * Plan page and the Board's Today widget both read it this way. `version` is what makes a read again, as for `useModel`.
 */
export function usePlanModel(live: Live, version: number): { data: PlanModel | null; error: string | null } {
  const [bump, setBump] = useState(0)
  const model = useModel<PlanModel>('/api/plan', version + bump)
  useTick(30_000) // the time to the next 04:00 moves on, and the turn of the day is noticed
  const turned = model.data !== null && live.now().getTime() >= new Date(model.data.turns_at).getTime()
  useEffect(() => {
    if (turned) setBump((count) => count + 1)
  }, [turned])
  return model
}
