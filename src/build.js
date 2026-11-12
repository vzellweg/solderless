// Turning level placements into parts on a board. Pure data, no rendering.
import { parseHole, isHole } from './board.js'
import { PINS } from './circuit.js'

let uid = 0
const DEFAULTS = {
  pot: { ohms: 10000, t: 0.5 },
  joystick: { ohms: 10000, x: 0.5, y: 0.5 },
  mcu: { volts: 3.3 },
  led: { burned: false },
}

export function makePart(ref, spec) {
  const pins = {}
  for (const p of PINS[spec.type]) pins[p] = null
  return { id: `p${++uid}`, ref, ...DEFAULTS[spec.type], ...spec, pins, locked: false }
}

export const isModule = (p) => p.type === 'source' || p.type === 'meter' || p.type === 'mcu'
/** Parts whose pins are a rigid row; placed by one anchor hole. */
export const isRigid = (p) => p.type === 'pot' || p.type === 'joystick'

export function rigidPins(type, anchor) {
  const { row, col } = parseHole(anchor)
  const pins = {}
  PINS[type].forEach((name, k) => { pins[name] = row + (col + k) })
  return Object.values(pins).every(isHole) ? pins : null
}

let wireCount = 0
export const WIRE_COLORS = ['yellow', 'blue', 'green', 'orange', 'white', 'violet']

/** Pick an insulation colour the way people do: red for +, black for −. */
export function wireColor(a, b) {
  const rows = [parseHole(a).row, parseHole(b).row]
  if (rows.some((r) => r === 'TP' || r === 'BP')) return 'red'
  if (rows.some((r) => r === 'TN' || r === 'BN')) return 'black'
  return WIRE_COLORS[wireCount % WIRE_COLORS.length]
}

export function makeWire(a, b, color) {
  const w = makePart(`W${++wireCount}`, { type: 'wire', color: color ?? wireColor(a, b) })
  w.pins.a = a
  w.pins.b = b
  return w
}

/**
 * Apply one placement tuple to a parts list:
 *   ['R1', 'TP9', 'H9']      two-legged part
 *   ['wire', 'F9', 'E9']     jumper
 *   ['V1.pos', 'TP2']        one lead of a module
 *   ['RV1', 'G12']           rigid part, by its first pin
 * The trailing object may carry {free, color}.
 */
export function applyPlacement(parts, specs, tuple, locked = false) {
  const opts = typeof tuple.at(-1) === 'object' ? tuple.at(-1) : {}
  const [name, h1, h2] = tuple
  const lock = locked && !opts.free
  if (name === 'wire') {
    const w = makeWire(h1, h2, opts.color)
    w.locked = lock
    if (opts.tag) w.tag = opts.tag
    parts.push(w)
    return w
  }
  const [ref, pin] = name.split('.')
  let part = parts.find((p) => p.ref === ref)
  if (!part) {
    if (!specs[ref]) throw new Error(`no spec for ${ref}`)
    part = makePart(ref, specs[ref])
    parts.push(part)
  }
  if (pin) {
    part.pins[pin] = h1
    if (lock) (part.lockedPins ??= new Set()).add(pin)
    return part
  }
  if (isRigid(part)) part.pins = rigidPins(part.type, h1)
  else {
    const [p1, p2] = PINS[part.type]
    part.pins[p1] = h1
    part.pins[p2] = h2
  }
  part.locked = lock
  return part
}

/** Parts for a level with steps 0..upto prebuilt and solved. For tests and the inspector. */
export function solvedBoard(level, upto = level.steps.length - 1) {
  const parts = level.modules.map((ref) => makePart(ref, level.parts[ref]))
  for (let s = 0; s <= upto; s++) {
    const step = level.steps[s]
    for (const t of step.pre ?? []) applyPlacement(parts, level.parts, t, true)
    for (const ref of step.remove ?? []) {
      const k = parts.findIndex((p) => p.ref === ref || p.tag === ref)
      if (k >= 0) parts.splice(k, 1)
    }
    for (const t of step.solution ?? []) applyPlacement(parts, level.parts, t)
  }
  return parts
}

export function occupied(parts, except) {
  const map = new Map()
  for (const p of parts) {
    if (p === except) continue
    for (const [pin, h] of Object.entries(p.pins)) if (h) map.set(h, { part: p, pin })
  }
  return map
}
