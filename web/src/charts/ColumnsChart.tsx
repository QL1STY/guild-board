import type { CSSProperties } from 'react'
import { dayMonth, num } from '../format.ts'
import type { PrimogemColumns } from '../ledgertypes.ts'
import { periodTitle, type Scope } from '../pages/statsview.ts'
import { useRoving } from '../ui/roving.ts'
import { ChartCard } from './ChartCard.tsx'
import { axis, labelEvery } from './scale.ts'
import { SYNC_WORDS, columnTip, columnsTable, segmentsOf, stripeOf, type Stack, type Words } from './stack.ts'

/**
 * A count per day, or per week over a long period, as columns: the chests opened and the primogems earned have one
 * chart. `title` is the card's, which says the unit ("Chests opened per day"); `noun` names what is counted in the
 * table ("Chests"); `scope` is what the Stats answer says of its period, for the subtitle. Only the highest column
 * carries its number. With a `stack`, each column is split by source (the ledger plan, Task 7), its legend above the
 * columns, and its tip and table list the sources; `subtitle` and `note` then say where the numbers come from. `words`
 * name an empty column and a partial one: days without a sync, or for the primogems days without a record.
 */
export function ColumnsChart({
  title,
  noun,
  data,
  scope,
  stack,
  subtitle,
  note,
  words = SYNC_WORDS,
}: {
  title: string
  noun: string
  data: PrimogemColumns
  scope: Scope
  stack?: Stack
  subtitle?: string
  note?: string
  words?: Words
}) {
  const { unit, columns, total, max_index: highest } = data
  const roving = useRoving(columns.length)
  const scale = axis(Math.max(0, ...columns.map((column) => column.value)))
  const every = labelEvery(columns.length, unit)
  const height = (value: number) => `${(value / scale.top) * 100}%`
  const tip = (column: PrimogemColumns['columns'][number]) => columnTip(column, unit, noun, stack, words)
  // A tooltip near an edge opens towards the middle, so that it stays inside the card.
  const edge = (index: number) =>
    index < columns.length / 4 ? ' tip-start' : index >= (columns.length * 3) / 4 ? ' tip-end' : ''
  const missing = columns.some((column) => column.no_data)
  const caughtUp = columns.some((column) => stripeOf(column) === 'gap')
  return (
    <ChartCard
      title={title}
      subtitle={subtitle ?? `${periodTitle(scope)} · ${num(total)} in total`}
      tables={[columnsTable(data, noun, stack, words)]}
    >
      {stack !== undefined && (
        <div className="lg col-groups">
          {stack.order.map((group) => (
            <span key={group}>
              <i className="grp" style={{ '--c': stack.colours[group] } as CSSProperties} />
              {stack.labels[group]}
            </span>
          ))}
        </div>
      )}
      <div className="col">
        <div className="col-y" aria-hidden="true" style={{ minWidth: `${num(scale.top).length}ch` }}>
          {scale.ticks.map((tick) => (
            <span key={tick} style={{ bottom: height(tick) }}>
              {num(tick)}
            </span>
          ))}
        </div>
        <div className="col-plot">
          {scale.ticks.slice(1).map((tick) => (
            <span key={tick} className="col-line" style={{ bottom: height(tick) }} />
          ))}
          <div className="col-bars">
            {columns.map((column, index) => {
              const lines = tip(column)
              const segments = stack === undefined ? [] : segmentsOf(column, stack.order)
              const stripe = stripeOf(column)
              return (
                <div
                  key={column.label}
                  className={`col-item${edge(index)}${lines.length > 1 ? ' stk-tip' : ''}`}
                  role="img"
                  aria-label={lines.join(', ')}
                  data-tip={lines.join('\n')}
                  {...roving(index)}
                >
                  {column.no_data ? (
                    <i className="nd" />
                  ) : (
                    <i
                      className={segments.length > 0 ? 'stk' : (stripe ?? undefined)}
                      style={{ height: height(column.value) }}
                    >
                      {stack !== undefined &&
                        segments.map((segment) => (
                          <span
                            key={segment.group}
                            data-group={segment.group}
                            style={{ height: `${segment.share * 100}%`, '--c': stack.colours[segment.group] } as CSSProperties}
                          />
                        ))}
                      {index === highest && <b>{num(column.value)}</b>}
                    </i>
                  )}
                </div>
              )
            })}
          </div>
        </div>
        <div className="col-x" aria-hidden="true">
          {columns.map((column, index) => (
            <span key={column.label}>{index % every === 0 ? dayMonth(column.label) : ''}</span>
          ))}
        </div>
      </div>
      {(missing || caughtUp) && (
        <div className="lg col-lg">
          {missing && (
            <span>
              <i className="nd" />
              {words.none}
            </span>
          )}
          {caughtUp && (
            <span>
              <i className="gap" />
              {words.partial}
            </span>
          )}
        </div>
      )}
      {note !== undefined && <p className="col-note">{note}</p>}
    </ChartCard>
  )
}
