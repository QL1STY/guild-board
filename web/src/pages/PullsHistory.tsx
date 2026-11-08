import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { api, messageOf } from '../api.ts'
import { localDay } from '../format.ts'
import type { HistoryRow, Pulls } from '../types.ts'
import { Picture } from '../ui/Picture.tsx'
import { Segmented } from '../ui/Segmented.tsx'
import { PullsLuck } from './PullsLuck.tsx'
import { historyCaption, historyEmpty, historyPath, historyShown, type HistoryShow, HISTORY_SHOWS, resultWords } from './pullsview.ts'

type Page = { rows: HistoryRow[]; more: boolean }

/**
 * The history (spec 2.4, the mockup's): over the rows, the luck tiles and the graph of the wishes each month (the second
 * pass); then every wish kept, newest first, 5★ rows in a gold wash and 4★ in a purple one, each with its face (the
 * wiki's icon, or its sign), its wish, its count, how a 5★ fell in its wish's words, and its day. Show more reads the
 * rows before the last one shown and adds them below; the rows come in once, one after another, as they appear. The
 * last Show more, which goes with the last rows, hands the focus to the last row.
 *
 * Over the rows, a switch shows every wish, the 4★ and 5★ or the 5★ alone. A rarity's rows are read from the core, which
 * pages them as it pages every wish; while they are read, the rows already shown of that rarity stand in for them.
 */
export function PullsHistory({ history }: { history: Pulls['history'] }) {
  const titleId = useId()
  const [show, setShow] = useState<HistoryShow>('every')
  const [older, setOlder] = useState<HistoryRow[]>([])
  const [more, setMore] = useState(history.more)
  // The rows of a rarity the core gave, and the rarity they are of; null until the first are read.
  const [picked, setPicked] = useState<(Page & { show: HistoryShow }) | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const body = useRef<HTMLTableSectionElement>(null)
  const toLast = useRef(false)
  const shown = useRef(show)
  shown.current = show
  const every = [...history.rows, ...older]
  const ready = show === 'every' || picked?.show === show
  const rows = show === 'every' ? every : picked?.show === show ? picked.rows : historyShown(every, show)
  const hasMore = show === 'every' ? more : picked?.show === show && picked.more

  // A rarity's first rows, read again when the history keeps new wishes.
  useEffect(() => {
    if (show === 'every') return
    let here = true
    api.get<Page>(historyPath(show, null)).then(
      (page) => {
        if (!here) return
        setPicked({ show, ...page })
        setProblem(null)
      },
      (error) => {
        if (here) setProblem(messageOf(error))
      },
    )
    return () => {
      here = false
    }
  }, [show, history.count])

  const showMore = async () => {
    const last = rows.at(-1)
    if (busy || last === undefined) return
    const asked = show
    setBusy(true)
    try {
      // HoYoverse's ids are past what a number in the page can hold exactly: the id goes as the text the core gave.
      const page = await api.get<Page>(historyPath(asked, last.id))
      if (shown.current !== asked) return
      if (asked === 'every') {
        setOlder((kept) => [...kept, ...page.rows])
        setMore(page.more)
      } else {
        setPicked((kept) => (kept?.show === asked ? { show: asked, rows: [...kept.rows, ...page.rows], more: page.more } : kept))
      }
      toLast.current = !page.more
      setProblem(null)
    } catch (error) {
      setProblem(messageOf(error))
    } finally {
      setBusy(false)
    }
  }
  useLayoutEffect(() => {
    if (hasMore || !toLast.current) return
    toLast.current = false
    ;(body.current?.lastElementChild as HTMLElement | null)?.focus()
  }, [hasMore])
  return (
    <section className="gb-panel pl-history" data-testid="pulls-history" aria-labelledby={titleId}>
      <h2 id={titleId} className="gb-h">
        {historyCaption(history.count)}
      </h2>
      <PullsLuck history={history} />
      {history.count > 0 && (
        <div className="pl-show">
          <span className="pl-show-lab">Show</span>
          <Segmented
            label="Show"
            options={HISTORY_SHOWS}
            value={show}
            onChange={(next) => {
              toLast.current = false
              setProblem(null)
              setShow(next)
            }}
          />
        </div>
      )}
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
      {show !== 'every' && ready && rows.length === 0 && <p className="pl-show-none">{historyEmpty(show)}</p>}
      {hasMore && (
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
