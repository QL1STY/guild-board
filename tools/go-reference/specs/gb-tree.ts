/**
 * Guild Board's shared helper for the gb-*.spec.ts files (tools/go-reference, Guild Board's own file, MIT): a Waverider
 * node as a plain JSON tree, {op, v (const), p (read path), list (subscript), table (lookup), data (a data node's own
 * data, without its `hit`), x (operands)}.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any

export function ser(n: N, depth = 0): N {
  if (n === undefined || n === null) return null
  if (typeof n !== 'object') return n
  if (Array.isArray(n)) return n.map((x) => ser(x, depth + 1))
  if (depth > 80) return { op: 'too-deep' }
  if (!('operation' in n)) {
    const o: N = {}
    for (const [k, v] of Object.entries(n)) o[k] = ser(v, depth + 1)
    return o
  }
  const o: N = { op: n.operation }
  if (n.operation === 'const') o.v = n.value
  if (n.operation === 'read') o.p = n.path.join('.')
  if (n.operation === 'subscript') o.list = [...n.list]
  if (n.operation === 'lookup')
    o.table = Object.fromEntries(
      Object.entries(n.table ?? {}).map(([k, v]) => [k, ser(v, depth + 1)])
    )
  if (n.operation === 'data') {
    const d: N = {}
    for (const [k, v] of Object.entries(n.data ?? {})) {
      if (k === 'hit') continue
      d[k] = ser(v, depth + 1)
    }
    o.data = d
  }
  if (n.operands?.length) o.x = n.operands.map((x: N) => ser(x, depth + 1))
  return o
}

const VARIANTS = ['lunarcharged', 'lunarbloom', 'lunarcrystallize', 'stellarconduct', 'stellarswirl']
export function walk(n: N, f: (n: N) => void, seen = new Set<N>()) {
  if (!n || typeof n !== 'object' || seen.has(n)) return
  seen.add(n)
  f(n)
  for (const k of n.operands ?? []) walk(k, f, seen)
  if (n.table) for (const k of Object.values(n.table)) walk(k, f, seen)
}
export const isDamage = (n: N) => {
  if (n?.operation !== 'data') return false
  if (n.operands?.[0]?.operation === 'read' && n.operands[0].path.join('.') === 'hit.dmg') return true
  let special = false
  walk(n, (m) => {
    if (m.operation === 'read' && VARIANTS.some((v) => m.path?.[m.path.length - 1] === `${v}_baseDmg_`)) special = true
  })
  return special
}
/** The damage nodes a display entry shows, through the match/threshold gates each sits behind (recorded in `gates`): one for each branch
 * that holds a damage node (Nefer's second Phantasm Performance hit is a Lunar-Bloom hit from Constellation 6 and an ordinary one below it). */
export function damagesIn(n: N): { node: N; gates: N[] }[] {
  if (!n || typeof n !== 'object') return []
  if (isDamage(n)) return [{ node: n, gates: [] }]
  const out: { node: N; gates: N[] }[] = []
  if (n.operation === 'match' || n.operation === 'threshold') {
    for (const i of [2, 3]) {
      for (const found of damagesIn(n.operands?.[i])) {
        out.push({ node: found.node, gates: [{ op: n.operation, branch: i, x: [ser(n.operands[0]), ser(n.operands[1])] }, ...found.gates] })
      }
    }
  }
  return out
}
