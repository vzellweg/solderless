// Builds inspector cases: a known-good board, sometimes with one planted fault.
// Pure data so the test can deal thousands of them.
import { netlistOf, evaluate, fmtOhms, bands } from '../circuit.js'
import { solvedBoard, occupied, isModule } from '../build.js'
import { COLS, ROWS_TOP, parseHole, isHole, stripOf, stripHoles, isRail } from '../board.js'
import { LEVELS, INSPECT } from '../levels.js'

const pick = (list) => list[Math.floor(Math.random() * list.length)]
const shuffle = (list) => list.map((v) => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map((x) => x[1])
export const BAND_ORDER = ['black', 'brown', 'red', 'orange', 'yellow', 'green', 'blue', 'violet', 'grey', 'white']
const bandWords = (ohms) => bands(ohms).join(', ')

/** Slide the whole build sideways so the same circuit doesn't always sit in the same holes. */
function shifted(parts) {
  const fixed = (p, row) => isRail(row) && isModule(p)
  const cols = parts.flatMap((p) => Object.values(p.pins).filter(Boolean).map((x) => parseHole(x)).filter((x) => !fixed(p, x.row)).map((x) => x.col))
  const options = [-12, -6, 0, 6].filter((d) => Math.min(...cols) + d >= 2 && Math.max(...cols) + d <= COLS - 1)
  const d = pick(options)
  for (const p of parts) {
    for (const [k, x] of Object.entries(p.pins)) {
      if (!x) continue
      const { row, col } = parseHole(x)
      if (fixed(p, row)) continue
      p.pins[k] = row + (col + d)
    }
  }
  return parts
}

// Each mutation returns {culprit, why, tag} or null if it can't apply here.
const MUTATIONS = [
  function offByOne(parts, occ) {
    for (const p of shuffle(parts.filter((q) => q.type === 'wire' || q.type === 'resistor' || q.type === 'led'))) {
      for (const pin of shuffle(Object.keys(p.pins))) {
        const { row, col } = parseHole(p.pins[pin])
        if (isRail(row)) continue
        for (const d of shuffle([-1, 1])) {
          const to = row + (col + d)
          if (!isHole(to) || occ.has(to)) continue
          p.pins[pin] = to
          return { culprit: p, tag: 'One column off', why: `${name(p)} has a leg in column ${col + d}. It belongs in column ${col}, one hole over.` }
        }
      }
    }
    return null
  },
  function trench(parts, occ) {
    for (const p of shuffle(parts.filter((q) => q.type === 'resistor' || q.type === 'led' || q.type === 'wire'))) {
      for (const pin of shuffle(Object.keys(p.pins))) {
        const { row, col } = parseHole(p.pins[pin])
        if (isRail(row)) continue
        const other = Object.values(p.pins).find((x) => x !== p.pins[pin])
        const top = ROWS_TOP.includes(row)
        const to = (top ? 'E' : 'F') + col
        if (occ.has(to) || stripOf(other) === stripOf(to)) continue
        p.pins[pin] = to
        return { culprit: p, tag: 'Wrong side of the trench', why: `${name(p)} has a leg in row ${top ? 'E' : 'F'}, on the far side of the trench. Column ${col} is two separate clips.` }
      }
    }
    return null
  },
  function sameStrip(parts, occ) {
    for (const p of shuffle(parts.filter((q) => q.type === 'resistor' || q.type === 'led'))) {
      const [k1, k2] = Object.keys(p.pins)
      if (isRail(parseHole(p.pins[k1]).row)) continue
      const to = stripHoles(stripOf(p.pins[k1])).find((x) => !occ.has(x))
      if (!to) continue
      p.pins[k2] = to
      return { culprit: p, tag: 'Both legs in one clip', why: `Both legs of ${name(p)} are in column ${parseHole(to).col}. They sit on the same node, so it does nothing.` }
    }
    return null
  },
  function backward(parts) {
    const p = pick(parts.filter((q) => q.type === 'led'))
    if (!p) return null
    p.pins = { a: p.pins.k, k: p.pins.a }
    return { culprit: p, tag: 'LED reversed', why: `${p.ref} is in backward. Its long leg (+) has to face the higher voltage.`, ok: true }
  },
  function value(parts) {
    const p = pick(parts.filter((q) => q.type === 'resistor'))
    if (!p) return null
    const was = p.ohms
    p.ohms = pick([330, 1000, 10000].filter((v) => v !== was))
    return { culprit: p, tag: 'Wrong resistor', why: `${p.ref} should be ${fmtOhms(was)} (${bandWords(was)}). The bands on this one read ${fmtOhms(p.ohms)} (${bandWords(p.ohms)}).`, ok: true }
  },
  function value2(parts) { return MUTATIONS[4](parts) },
  function wrongRail(parts, occ) {
    for (const p of shuffle(parts.filter((q) => q.type === 'wire' || q.type === 'resistor'))) {
      for (const pin of shuffle(Object.keys(p.pins))) {
        const { row, col } = parseHole(p.pins[pin])
        if (!isRail(row)) continue
        const to = row[0] + (row[1] === 'P' ? 'N' : 'P') + col
        if (occ.has(to)) continue
        p.pins[pin] = to
        return { culprit: p, tag: 'Wrong rail', why: `${name(p)} is plugged into the ${row[1] === 'P' ? '−' : '+'} rail. It belongs on the ${row[1] === 'P' ? '+' : '−'} rail next to it.` }
      }
    }
    return null
  },
]
MUTATIONS.push(
  function leadSlip(parts, occ) {
    for (const p of shuffle(parts.filter(isModule))) {
      for (const pin of shuffle(Object.keys(p.pins))) {
        if (!p.pins[pin]) continue
        const { row, col } = parseHole(p.pins[pin])
        if (isRail(row)) continue
        for (const d of shuffle([-1, 1])) {
          const to = row + (col + d)
          if (!isHole(to) || occ.has(to)) continue
          p.pins[pin] = to
          return { culprit: p, tag: 'One column off', why: `${LEAD_WORDS[p.type][pin]} is in column ${col + d}. It belongs in column ${col}.` }
        }
      }
    }
    return null
  },
  function leadSwap(parts) {
    const p = parts.find((q) => q.type === 'mcu')
    if (!p) return null
    const [a, b] = shuffle(Object.keys(p.pins)).slice(0, 2)
    ;[p.pins[a], p.pins[b]] = [p.pins[b], p.pins[a]]
    return { culprit: p, tag: 'Leads crossed', why: `${LEAD_WORDS.mcu[a]} and ${LEAD_WORDS.mcu[b].replace('The Nucleo’s ', 'its ')} are swapped.` }
  },
)
const LEAD_WORDS = {
  source: { pos: 'A supply’s red lead', neg: 'A supply’s black lead' },
  meter: { red: 'The red probe', black: 'The black probe' },
  mcu: { '3v3': 'The Nucleo’s 3V3 lead', pc2: 'The Nucleo’s PC2 lead', pc3: 'The Nucleo’s PC3 lead', gnd: 'The Nucleo’s GND lead' },
}
export const MODULE_WORDS = { source: 'a supply and its leads', meter: 'the meter probes', mcu: 'the Nucleo leads' }
const name = (p) => (p.type === 'wire' ? `The ${p.color} wire` : p.ref)

export function makeCase(lastId) {
  const want = pick(INSPECT.filter((id) => id !== lastId))
  const level = LEVELS.find((l) => l.id === want)
  const sch = level.steps.at(-1).sch
  const netlist = netlistOf(sch)
  for (let guard = 0; guard < 40; guard++) {
    const parts = shifted(solvedBoard(level))
    parts.filter((p) => level.modules.includes(p.ref)).forEach((p) => { p.slot = level.modules.indexOf(p.ref); p.locked = true })
    const holes = parts.flatMap((p) => Object.values(p.pins).filter(Boolean))
    if (new Set(holes).size < holes.length || !holes.every(isHole) || !evaluate(netlist, parts).complete) continue
    if (Math.random() < 0.28) return { level, sch, parts, fault: null }
    const before = parts.map((p) => ({ id: p.id, pins: { ...p.pins } }))
    const fault = pick(MUTATIONS)(parts, occupied(parts))
    if (!fault) continue
    if (!fault.ok && evaluate(netlist, parts).complete) continue
    fault.was = before.find((b) => b.id === fault.culprit.id).pins
    return { level, sch, parts, fault }
  }
  throw new Error('could not build an inspector case')
}

