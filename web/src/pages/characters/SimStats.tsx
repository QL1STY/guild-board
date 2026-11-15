import type { Element, PlannerSim } from '../../types.ts'
import { statRows } from './simview.ts'

/** Her stats as HoYoLAB shows them now, with the tested pieces, and the change; a stat that did not move is dim. */
export function SimStats({ now, tested, element }: { now: PlannerSim['panel']; tested: PlannerSim['panel']; element: Element }) {
  return (
    <table className="pp-stats">
      <thead>
        <tr>
          <th>Stat</th>
          <th>Now</th>
          <th>Tested</th>
          <th>Change</th>
        </tr>
      </thead>
      <tbody>
        {statRows(now, tested, element).map((row) => (
          <tr key={row.key} data-stat={row.key} className={row.same ? 'same' : undefined}>
            <td>{row.label}</td>
            <td>{row.now}</td>
            <td>{row.tested}</td>
            <td className={row.same ? 'chg' : `chg ${row.up ? 'up' : 'down'}`}>{row.change}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
