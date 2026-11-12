// Circuit model: nets, a DC solver, and the schematic-vs-board check.
// No DOM or three.js in here so it can run under node for tests.
import { stripOf, stripCoord, RAILS } from './board.js'

export const LED_VF = { red: 1.9, yellow: 2.0, green: 2.1, blue: 2.9, white: 3.0 }
const LED_RD = 10 // ohms, once conducting
export const LED_MAX = 0.03 // amps before it pops
const WIRE_R = 0.01
const SOURCE_R = 0.2
const METER_R = 1e7
const SHORT_AMPS = 2

/** Pin names per part type. */
export const PINS = {
  resistor: ['a', 'b'],
  wire: ['a', 'b'],
  led: ['a', 'k'],
  source: ['pos', 'neg'],
  meter: ['red', 'black'],
  pot: ['a', 'w', 'b'],
  joystick: ['vcc', 'x', 'y', 'sel', 'gnd'],
  mcu: ['3v3', 'pc2', 'pc3', 'gnd'],
}

// ---------------------------------------------------------------- nets

/** Which strips are joined by jumper wires. Returns netOf(hole). */
export function buildNets(parts) {
  const parent = new Map()
  const find = (s) => {
    let r = s
    while (parent.has(r)) r = parent.get(r)
    while (parent.has(s)) { const n = parent.get(s); parent.set(s, r); s = n }
    return r
  }
  for (const p of parts) {
    if (p.type !== 'wire' || !p.pins.a || !p.pins.b) continue
    const a = find(stripOf(p.pins.a))
    const b = find(stripOf(p.pins.b))
    if (a !== b) parent.set(a, b)
  }
  const netOf = (hole) => (hole ? find(stripOf(hole)) : null)
  netOf.strip = find
  return netOf
}

// -------------------------------------------------------------- solver

function gauss(A, b) {
  const n = b.length
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r
    if (Math.abs(A[p][c]) < 1e-18) continue
    if (p !== c) { [A[p], A[c]] = [A[c], A[p]]; [b[p], b[c]] = [b[c], b[p]] }
    for (let r = c + 1; r < n; r++) {
      const f = A[r][c] / A[c][c]
      if (!f) continue
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k]
      b[r] -= f * b[c]
    }
  }
  const x = new Array(n).fill(0)
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r]
    for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k]
    x[r] = Math.abs(A[r][r]) < 1e-18 ? 0 : s / A[r][r]
  }
  return x
}

/**
 * Solve the board as a DC circuit. Every strip is a node; jumper wires are
 * tiny resistors so their currents fall out of the same solve.
 * Returns voltages per strip, a current per part, and the taps (current
 * entering each strip at each hole) the flow animation is built from.
 */
export function solve(parts, power = true) {
  const index = new Map()
  const names = []
  const node = (hole) => {
    const s = stripOf(hole)
    let i = index.get(s)
    if (i === undefined) { i = names.length; index.set(s, i); names.push(s) }
    return i
  }
  const conds = [] // {a, b, g, part, key, ha, hb}
  const sources = [] // {a, b, v, part, ha, hb}
  const leds = []
  const cond = (part, key, ha, hb, ohms) => {
    if (!ha || !hb) return
    conds.push({ a: node(ha), b: node(hb), g: 1 / ohms, part, key, ha, hb })
  }
  let ground = null
  for (const p of parts) {
    const q = p.pins
    switch (p.type) {
      case 'resistor': cond(p, 'i', q.a, q.b, p.ohms); break
      case 'wire': cond(p, 'i', q.a, q.b, WIRE_R); break
      case 'meter': cond(p, 'i', q.red, q.black, METER_R); break
      case 'pot':
        cond(p, 'ia', q.a, q.w, Math.max(1, p.ohms * p.t))
        cond(p, 'ib', q.w, q.b, Math.max(1, p.ohms * (1 - p.t)))
        break
      case 'joystick':
        cond(p, 'xa', q.vcc, q.x, Math.max(1, p.ohms * (1 - p.x)))
        cond(p, 'xb', q.x, q.gnd, Math.max(1, p.ohms * p.x))
        cond(p, 'ya', q.vcc, q.y, Math.max(1, p.ohms * (1 - p.y)))
        cond(p, 'yb', q.y, q.gnd, Math.max(1, p.ohms * p.y))
        break
      case 'led':
        if (q.a && q.k && !p.burned) leds.push({ a: node(q.a), k: node(q.k), vf: LED_VF[p.color], part: p, on: false })
        break
      case 'source':
      case 'mcu': {
        const hp = p.type === 'mcu' ? q['3v3'] : q.pos
        const hn = p.type === 'mcu' ? q.gnd : q.neg
        for (const h of Object.values(q)) if (h) node(h)
        if (hn && ground === null) ground = node(hn)
        if (power && hp && hn && !p.tripped) sources.push({ a: node(hp), b: node(hn), v: p.volts, part: p, ha: hp, hb: hn })
        break
      }
    }
  }
  const n = names.length
  const out = {
    powered: power, v: new Map(), i: new Map(), taps: [], shorts: [], overloaded: [],
    volts(hole) { return hole ? this.v.get(stripOf(hole)) ?? null : null },
  }
  if (!n) return out
  if (ground === null) ground = 0

  let V = []
  for (let iter = 0; iter < 40; iter++) {
    const G = Array.from({ length: n }, () => new Array(n).fill(0))
    const I = new Array(n).fill(0)
    const stamp = (a, b, g) => { G[a][a] += g; G[b][b] += g; G[a][b] -= g; G[b][a] -= g }
    for (let k = 0; k < n; k++) G[k][k] += 1e-9
    for (const c of conds) if (c.a !== c.b) stamp(c.a, c.b, c.g)
    for (const s of sources) {
      if (s.a === s.b) continue
      stamp(s.a, s.b, 1 / SOURCE_R)
      I[s.a] += s.v / SOURCE_R
      I[s.b] -= s.v / SOURCE_R
    }
    for (const d of leds) {
      if (d.a === d.k) continue
      const g = d.on ? 1 / LED_RD : 1e-8
      stamp(d.a, d.k, g)
      if (d.on) { I[d.a] += g * d.vf; I[d.k] -= g * d.vf }
    }
    G[ground].fill(0)
    G[ground][ground] = 1
    I[ground] = 0
    V = gauss(G, I)
    let changed = false
    for (const d of leds) {
      const vd = V[d.a] - V[d.k]
      if (!d.on && vd > d.vf + 1e-6) { d.on = true; changed = true }
      else if (d.on && vd < d.vf - 1e-6) { d.on = false; changed = true }
    }
    if (!changed) break
  }

  names.forEach((s, k) => out.v.set(s, V[k]))
  const tap = (hole, i) => { if (Math.abs(i) > 1e-7) out.taps.push({ hole, i }) }
  for (const c of conds) {
    const i = (V[c.a] - V[c.b]) * c.g
    const rec = out.i.get(c.part.id) ?? {}
    rec[c.key] = i
    out.i.set(c.part.id, rec)
    tap(c.ha, -i)
    tap(c.hb, i)
  }
  for (const d of leds) {
    const i = d.on && d.a !== d.k ? Math.max(0, (V[d.a] - V[d.k] - d.vf) / LED_RD) : 0
    out.i.set(d.part.id, { i })
    tap(d.part.pins.a, -i)
    tap(d.part.pins.k, i)
    if (i > LED_MAX) out.overloaded.push(d.part.id)
  }
  for (const s of sources) {
    const i = (s.v - (V[s.a] - V[s.b])) / SOURCE_R
    out.i.set(s.part.id, { i })
    tap(s.ha, i)
    tap(s.hb, -i)
    if (Math.abs(i) > SHORT_AMPS) out.shorts.push(s.part.id)
  }
  return out
}

/** Current along each stretch of strip between two taps, from 1-D KCL. */
export function stripFlows(taps) {
  const by = new Map()
  for (const t of taps) {
    const s = stripOf(t.hole)
    if (!by.has(s)) by.set(s, new Map())
    const m = by.get(s)
    m.set(t.hole, (m.get(t.hole) ?? 0) + t.i)
  }
  const flows = []
  for (const [strip, m] of by) {
    const pts = [...m].sort((p, q) => stripCoord(p[0]) - stripCoord(q[0]))
    let run = 0
    for (let k = 0; k < pts.length - 1; k++) {
      run += pts[k][1]
      if (Math.abs(run) > 1e-7) flows.push({ strip, from: pts[k][0], to: pts[k + 1][0], i: run })
    }
  }
  return flows
}

// ------------------------------------------------- schematic netlists

const onSeg = (p, a, b) => {
  const e = 1e-6
  if (Math.abs(a[0] - b[0]) < e) return Math.abs(p[0] - a[0]) < e && p[1] >= Math.min(a[1], b[1]) - e && p[1] <= Math.max(a[1], b[1]) + e
  if (Math.abs(a[1] - b[1]) < e) return Math.abs(p[1] - a[1]) < e && p[0] >= Math.min(a[0], b[0]) - e && p[0] <= Math.max(a[0], b[0]) + e
  throw new Error('schematic wires must be axis-aligned')
}

/** Terminals of one schematic part as [[pin, point], ...]. */
export function schTerminals(part) {
  const [, type, a, b, o = {}] = part
  if (type === 'mcu') return Object.entries(o.pins)
  const names = PINS[type]
  if (type === 'pot') return [['a', a], ['w', o.w], ['b', b]]
  return [[names[0], a], [names[1], b]]
}

/**
 * Derive the netlist from how the schematic is drawn: a terminal belongs
 * to the node whose wire it touches.
 */
export function netlistOf(sch) {
  const nodes = {}
  const swappable = []
  const refs = new Set()
  for (const name of Object.keys(sch.nodes)) nodes[name] = new Set()
  for (const part of sch.parts) {
    const [ref, type, , , o = {}] = part
    for (const [pin, pt] of schTerminals(part)) {
      const key = o.map?.[pin] ?? `${ref}.${pin}`
      refs.add(key.split('.')[0])
      const hits = Object.entries(sch.nodes).filter(([, nd]) =>
        (nd.wires ?? []).some((w) => w.some((_, k) => k && onSeg(pt, w[k - 1], w[k]))) ||
        (nd.pts ?? []).some((q) => Math.abs(q[0] - pt[0]) < 1e-6 && Math.abs(q[1] - pt[1]) < 1e-6))
      if (hits.length !== 1) throw new Error(`${key} touches ${hits.length} nodes in schematic`)
      nodes[hits[0][0]].add(key)
    }
    if ((type === 'resistor' || type === 'pot') && !o.map) swappable.push([`${ref}.a`, `${ref}.b`])
  }
  return { nodes, swappable, refs }
}

/**
 * Compare the board against a schematic netlist.
 * A node is done when every terminal it lists sits in one board net and
 * nothing from another node shares that net.
 */
export function evaluate(netlist, parts) {
  const netOf = buildNets(parts)
  const termNet = new Map()
  const extra = []
  for (const p of parts) {
    if (p.type === 'wire') continue
    if (!netlist.refs.has(p.ref)) {
      if (Object.values(p.pins).some(Boolean) && p.type !== 'source' && p.type !== 'meter' && p.type !== 'mcu') extra.push(p.ref)
      continue
    }
    for (const [pin, hole] of Object.entries(p.pins)) termNet.set(`${p.ref}.${pin}`, netOf(hole))
  }
  const names = Object.keys(netlist.nodes)

  const score = (swap) => {
    const key = (k) => swap.get(k) ?? k
    const owner = new Map() // board net -> set of schematic nodes on it
    const info = {}
    for (const name of names) {
      const nets = new Set()
      let placed = 0
      for (const t of netlist.nodes[name]) {
        const net = termNet.get(key(t))
        if (net) { placed++; nets.add(net) }
      }
      info[name] = { nets, placed, total: netlist.nodes[name].size }
      for (const net of nets) {
        if (!owner.has(net)) owner.set(net, new Set())
        owner.get(net).add(name)
      }
    }
    const status = {}
    let pts = 0
    for (const name of names) {
      const { nets, placed, total } = info[name]
      const clash = [...nets].some((net) => owner.get(net).size > 1)
      status[name] = !placed ? 'empty' : clash ? 'conflict' : placed === total && nets.size === 1 ? 'done' : 'partial'
      pts += { done: 100, partial: placed, conflict: -5, empty: 0 }[status[name]]
    }
    return { status, pts, owner, info }
  }

  let best = null
  const pairs = netlist.swappable
  for (let mask = 0; mask < 1 << pairs.length; mask++) {
    const swap = new Map()
    pairs.forEach(([a, b], k) => { if (mask >> k & 1) { swap.set(a, b); swap.set(b, a) } })
    const r = score(swap)
    if (!best || r.pts > best.pts) best = r
  }
  const complete = !extra.length && names.every((nm) => best.status[nm] === 'done')

  const issues = []
  for (const ref of extra) issues.push({ kind: 'extra', ref })
  if (!complete) {
    for (const p of parts) {
      if (p.type === 'wire' || !netlist.refs.has(p.ref)) continue
      const holes = Object.values(p.pins).filter(Boolean)
      if (PINS[p.type].length === 2 && holes.length === 2 && netOf(holes[0]) === netOf(holes[1])) issues.push({ kind: 'same-node', ref: p.ref })
      else if (p.type === 'led' && holes.length === 2) {
        const flipped = parts.map((q) => (q === p ? { ...p, pins: { a: p.pins.k, k: p.pins.a } } : q))
        if (evaluateQuick(netlist, flipped)) issues.push({ kind: 'backward', ref: p.ref })
      }
    }
    for (const [, set] of best.owner) if (set.size > 1) issues.push({ kind: 'joined', nodes: [...set] })
  }
  const nodeNet = {}
  for (const nm of names) nodeNet[nm] = [...best.info[nm].nets]
  return { status: best.status, complete, issues, netNodes: best.owner, nodeNet, netOf }
}

function evaluateQuick(netlist, parts) {
  const netOf = buildNets(parts)
  const termNet = new Map()
  for (const p of parts) if (p.type !== 'wire') for (const [pin, h] of Object.entries(p.pins)) termNet.set(`${p.ref}.${pin}`, netOf(h))
  const pairs = netlist.swappable
  for (let mask = 0; mask < 1 << pairs.length; mask++) {
    const swap = new Map()
    pairs.forEach(([a, b], k) => { if (mask >> k & 1) { swap.set(a, b); swap.set(b, a) } })
    const seen = new Map()
    let ok = true
    for (const [name, terms] of Object.entries(netlist.nodes)) {
      let net = null
      for (const t of terms) {
        const n = termNet.get(swap.get(t) ?? t)
        if (!n || (net && n !== net)) { ok = false; break }
        net = n
      }
      if (!ok || seen.has(net)) { ok = false; break }
      seen.set(net, name)
    }
    if (ok) return true
  }
  return false
}

// -------------------------------------------------------------- format

export function fmtOhms(r) {
  if (r >= 1e6) return `${+(r / 1e6).toFixed(1)} MΩ`
  if (r >= 1000) return `${+(r / 1000).toFixed(1)} kΩ`
  return `${r} Ω`
}

export function fmtAmps(i) {
  const a = Math.abs(i)
  if (a >= 1) return `${a.toFixed(1)} A`
  if (a >= 0.0995) return `${(a * 1000).toFixed(0)} mA`
  if (a >= 1e-4) return `${(a * 1000).toFixed(1)} mA`
  if (a >= 1e-7) return `${(a * 1e6).toFixed(0)} µA`
  return '0 mA'
}

export const fmtVolts = (v) => `${(Math.abs(v) < 0.005 ? 0 : v).toFixed(2)} V`

const BAND = ['black', 'brown', 'red', 'orange', 'yellow', 'green', 'blue', 'violet', 'grey', 'white']
/** Three colour-code bands for a resistance: two digits and a multiplier. */
export function bands(ohms) {
  let exp = 0
  let v = ohms
  while (v >= 100) { v /= 10; exp++ }
  const d = Math.round(v)
  return [BAND[Math.floor(d / 10)], BAND[d % 10], BAND[exp]]
}

export { RAILS }
