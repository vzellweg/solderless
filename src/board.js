// Breadboard geometry. One unit = one hole pitch (0.1 in).
// Laid out like the Fritzing boards in the course diagrams: columns 1-30
// run left to right, rows J-F above the trench, E-A below, rails outside.

export const COLS = 30
export const ROWS_TOP = ['J', 'I', 'H', 'G', 'F']
export const ROWS_BOT = ['E', 'D', 'C', 'B', 'A']
export const RAILS = ['TN', 'TP', 'BN', 'BP']
export const ROW_Z = {
  TN: -8.5, TP: -7.5,
  J: -5.5, I: -4.5, H: -3.5, G: -2.5, F: -1.5,
  E: 1.5, D: 2.5, C: 3.5, B: 4.5, A: 5.5,
  BN: 7.5, BP: 8.5,
}
export const ALL_ROWS = Object.keys(ROW_Z)
export const BOARD = { x0: -16, x1: 16, z0: -9.6, z1: 9.6 }

export const colX = (c) => c - 15.5
export const isRail = (row) => row.length === 2
// Rail holes come in groups of five, like the real thing.
export const railHasHole = (c) => c % 6 !== 1

const HOLE_RE = /^(TN|TP|BN|BP|[A-J])(\d+)$/

export function parseHole(id) {
  const m = HOLE_RE.exec(id)
  if (!m) throw new Error(`bad hole "${id}"`)
  return { row: m[1], col: +m[2] }
}

export function isHole(id) {
  const m = HOLE_RE.exec(id)
  if (!m) return false
  const col = +m[2]
  if (col < 1 || col > COLS) return false
  return !isRail(m[1]) || railHasHole(col)
}

export function holePos(id) {
  const { row, col } = parseHole(id)
  return { x: colX(col), z: ROW_Z[row] }
}

/** The metal strip a hole belongs to: a rail, or half a column. */
export function stripOf(id) {
  const { row, col } = parseHole(id)
  if (isRail(row)) return row
  return (ROWS_TOP.includes(row) ? 't' : 'b') + col
}

export function stripHoles(strip) {
  if (RAILS.includes(strip)) {
    const out = []
    for (let c = 1; c <= COLS; c++) if (railHasHole(c)) out.push(strip + c)
    return out
  }
  const rows = strip[0] === 't' ? ROWS_TOP : ROWS_BOT
  return rows.map((r) => r + strip.slice(1))
}

/** Box a strip covers on the board: {x, z, w, d} centre and size. */
export function stripRect(strip) {
  if (RAILS.includes(strip)) return { x: 0, z: ROW_Z[strip], w: 29.6, d: 0.62 }
  const top = strip[0] === 't'
  return { x: colX(+strip.slice(1)), z: top ? -3.5 : 3.5, w: 0.62, d: 4.7 }
}

/** Position of a hole along its strip, for ordering current taps. */
export function stripCoord(id) {
  const { row } = parseHole(id)
  const p = holePos(id)
  return isRail(row) ? p.x : p.z
}

export const ALL_STRIPS = [
  ...RAILS,
  ...Array.from({ length: COLS }, (_, i) => 't' + (i + 1)),
  ...Array.from({ length: COLS }, (_, i) => 'b' + (i + 1)),
]

export const ALL_HOLES = ALL_STRIPS.flatMap(stripHoles)

export function nearestHole(x, z, reach = 0.5) {
  const col = Math.round(x + 15.5)
  if (col < 1 || col > COLS) return null
  let best = null
  let bd = reach
  for (const row of ALL_ROWS) {
    const d = Math.abs(ROW_Z[row] - z)
    if (d < bd) { bd = d; best = row }
  }
  if (!best || Math.abs(colX(col) - x) > reach) return null
  const id = best + col
  return isHole(id) ? id : null
}

export function holeDistance(a, b) {
  const p = holePos(a)
  const q = holePos(b)
  return Math.hypot(p.x - q.x, p.z - q.z)
}

/** Plain-language name for a strip. */
export function stripName(strip) {
  if (strip === 'TP') return 'top + rail'
  if (strip === 'TN') return 'top − rail'
  if (strip === 'BP') return 'bottom + rail'
  if (strip === 'BN') return 'bottom − rail'
  return `column ${strip.slice(1)} (${strip[0] === 't' ? 'F–J' : 'A–E'})`
}
