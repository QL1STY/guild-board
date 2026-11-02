import { useId, useLayoutEffect, useRef, useState } from 'react'
import { api, messageOf } from '../api.ts'
import { localDay } from '../format.ts'
import type { HistoryRow, Pulls } from '../types.ts'
import { Picture } from '../ui/Picture.tsx'
import { PullsLuck } from './PullsLuck.tsx'
import { historyCaption, resultWords } from './pullsview.ts'

/**
 * The history (spec 2.4, the mockup's): over the rows, the luck tiles and the graph of the wishes each month (the second
 * pass); then every wish kept, newest first, 5★ rows in a gold wash and 4★ in a purple one, each with its face (the
 * wiki's icon, or its sign), its wish, its count, how a 5★ fell in its wish's words, and its day. Show more reads the
 * rows before the last one shown and adds them below; the rows come in once, one after another, as they appear. The
 * last Show more, which goes with the last rows, hands the focus to the last row.
 */
export function PullsHistory({ history }: { history: Pulls['history'] }) {
  const titleId = useId()
  const [older, setOlder] = useState<HistoryRow[]>([])
  const [more, setMore] = useState(history.more)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const body = useRef<HTMLTableSectionElement>(null)
  const toLast = useRef(false)
  const rows = [...history.rows, ...older]
  const showMore = async () => {
    const last = rows.at(-1)
    if (busy || last === undefined) return
    setBusy(true)
    try {
      // HoYoverse's ids are past what a number in the page can hold exactly: the id goes as the text the core gave.
      const page = await api.get<{ rows: HistoryRow[]; more: boolean }>(`/api/pulls/history?before=${last.id}`)
      setOlder((shown) => [...shown, ...page.rows])
      setMore(page.more)
      toLast.current = !page.more
      setProblem(null)
    } catch (error) {
      setProblem(messageOf(error))
    } finally {
      setBusy(false)
    }
  }
  useLayoutEffect(() => {
    if (more || !toLast.current) return
    toLast.current = false
    ;(body.current?.lastElementChild as HTMLElement | null)?.focus()
  }, [more])
  return (
    <section className="gb-panel pl-history" data-testid="pulls-history" aria-labelledby={titleId}>
      <h2 id={titleId} className="gb-h">
        {historyCaption(history.count)}
      </h2>
      <PullsLuck history={history} />
      <table className="pl-rows">
        <tbody ref={body}>
          {rows.map((row) => (
            <tr key={row.id} className={`pl-r${row.rank}`} data-testid="history-row" data-rank={row.rank} tabIndex={-1}>
              <th scope="row">
                <span className="pl-name">
                  <Picture src={row.icon} sign={row.kind === 'weapon' ? 'gem' : 'person'} className="pl-face" />
                  {row.name}
                </span>
              </th>
              <td>{row.pool_label}</td>
              <td>{row.pity === null ? '' : `pity ${row.pity}`}</td>
              <td className={row.result === 'won' ? 'good' : undefined}>{resultWords(row.result, row.pool)}</td>
              <td className="pl-day-cell">
                <time dateTime={row.at}>{localDay(row.at)}</time>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {more && (
        <button type="button" className="gb-btn quiet pl-more" aria-disabled={busy} onClick={() => void showMore()}>
          Show more
        </button>
      )}
      {problem !== null && (
        <p className="pl-refused" role="alert">
          {problem}
        </p>
      )}
    </section>
  )
}
