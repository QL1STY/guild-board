import { useCallback, useEffect, useRef, useState } from 'react'
import { api, messageOf, type RequestOptions } from '../api.ts'

/** Where a widget's own data is kept (board/layouts.py): a note's text, a stopwatch's time. */
export function dataPath(widgetId: string): string {
  return `/api/widgets/${encodeURIComponent(widgetId)}/data`
}

/**
 * A widget's own data, read when the widget shows and again at each of the core's events (`version`), as another PC can
 * change it; null until it is read. A first read that fails, as while Guild Board restarts, says why in `problem` and is
 * tried again at the next event, so the widget does not stay empty. `from` makes the widget's shape out of whatever is
 * kept, an empty widget's null included; it is a function of the module, the same at every render. `save` shows the new
 * data at once and resolves to whether the core kept it, and a save that fails says why in `problem`. What a save holds is
 * newer than what is kept: no read begins while one is on its way or after one failed, and a read that a save overtook is
 * left unused. Only the newest save's answer counts for that: an older save that fails after a newer one was kept leaves
 * no problem and holds back no read.
 */
export function useWidgetData<T>(widgetId: string, from: (data: unknown) => T, version: number) {
  const [data, setData] = useState<T | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const unread = useRef(true)
  const saves = useRef(0) // each save counts here, so that a read can tell that one came after it began
  const saving = useRef(0)
  const failed = useRef(false) // the last save did not reach the core
  useEffect(() => {
    if (saving.current > 0 || failed.current) return
    let alive = true
    const began = saves.current
    api.get<{ data: unknown }>(dataPath(widgetId)).then(
      (answer) => {
        if (!alive || saves.current !== began) return
        unread.current = false
        setData(from(answer.data))
        setProblem(null)
      },
      (error: unknown) => {
        if (alive && unread.current) setProblem(messageOf(error))
      },
    )
    return () => {
      alive = false
    }
  }, [widgetId, from, version])
  const save = useCallback(
    async (next: T, options?: RequestOptions): Promise<boolean> => {
      const mine = (saves.current += 1)
      saving.current += 1
      unread.current = false
      setData(next)
      try {
        await api.put(dataPath(widgetId), { data: next }, options)
        if (mine === saves.current) {
          failed.current = false
          setProblem(null)
        }
        return true
      } catch (error) {
        if (mine === saves.current) {
          failed.current = true
          setProblem(messageOf(error))
        }
        return false
      } finally {
        saving.current -= 1
      }
    },
    [widgetId],
  )
  return { data, problem, save }
}
