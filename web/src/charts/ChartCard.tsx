import { useState } from 'react'
import type { ReactNode } from 'react'
import '../styles/charts.css'

export type TableData = {
  caption?: string
  head: string[]
  rows: string[][]
  /** The columns that hold numbers. They are set flush right. */
  numeric?: number[]
}

/**
 * A table of a chart's data, or of a list. Each row is headed by its first cell (a row header), such as the weekday of
 * When you play, which a screen reader says with each of the row's other cells; it is drawn as they are (charts.css).
 */
export function DataTable({ table }: { table: TableData }) {
  const numeric = table.numeric ?? []
  const side = (column: number) => (numeric.includes(column) ? 'r' : undefined)
  return (
    <table className="tb">
      {table.caption !== undefined && <caption>{table.caption}</caption>}
      <thead>
        <tr>
          {table.head.map((title, column) => (
            <th key={column} scope="col" className={side(column)}>
              {title}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {table.rows.map((row, at) => (
          <tr key={at}>
            {row.map((cell, column) =>
              column === 0 ? (
                <th key={column} scope="row" className={side(column)}>
                  {cell}
                </th>
              ) : (
                <td key={column} className={side(column)}>
                  {cell}
                </td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** The frame every chart sits in: title, subtitle, and the switch between the chart and its table. */
export function ChartCard({
  title,
  subtitle,
  tables,
  className,
  children,
}: {
  title: string
  subtitle?: string
  /** The same data as tables. When given, the card offers "Show as table". */
  tables?: TableData[]
  /** A class of the chart's own, for the card and its table. */
  className?: string
  children: ReactNode
}) {
  const [asTable, setAsTable] = useState(false)
  const offered = (tables ?? []).filter((table) => table.rows.length > 0)
  return (
    <section className={className === undefined ? 'gb-panel ch' : `gb-panel ch ${className}`} aria-label={title}>
      <div className="ch-head">
        <h2>{title}</h2>
        {offered.length > 0 && (
          <button type="button" className="gb-link" onClick={() => setAsTable(!asTable)}>
            {asTable ? 'Show the chart' : 'Show as table'}
          </button>
        )}
      </div>
      {subtitle !== undefined && <div className="cs">{subtitle}</div>}
      {asTable && offered.length > 0 ? (
        <div className="tb-scroll" tabIndex={0}>
          {offered.map((table, at) => (
            <DataTable key={at} table={table} />
          ))}
        </div>
      ) : (
        children
      )}
    </section>
  )
}
