// Every level must be solvable by its own solution, and unsolved without it.
import assert from 'node:assert/strict'
import { LEVELS } from '../src/levels.js'
import { netlistOf, evaluate, solve, stripFlows, fmtAmps, fmtVolts, bands } from '../src/circuit.js'
import { solvedBoard, makePart, applyPlacement } from '../src/build.js'
import { isHole, stripOf } from '../src/board.js'

const meter = (parts, sim) => {
  const m = parts.find((p) => p.type === 'meter')
  return m && m.pins.red && m.pins.black ? sim.volts(m.pins.red) - sim.volts(m.pins.black) : null
}

for (const level of LEVELS) {
  level.steps.forEach((step, s) => {
    const tag = `${level.id}[${s}]`
    const netlist = netlistOf(step.sch)
    const parts = solvedBoard(level, s)
    const holes = new Set()
    for (const p of parts) for (const h of Object.values(p.pins)) {
      if (!h) continue
      assert.ok(isHole(h), `${tag}: ${p.ref} uses bad hole ${h}`)
      assert.ok(!holes.has(h), `${tag}: hole ${h} used twice`)
      holes.add(h)
    }
    const ev = evaluate(netlist, parts)
    assert.ok(ev.complete, `${tag}: solution does not match schematic ${JSON.stringify(ev.status)} ${JSON.stringify(ev.issues)}`)

    // The step must not start out already solved.
    const before = s ? solvedBoard(level, s - 1) : level.modules.map((r) => makePart(r, level.parts[r]))
    for (const t of step.pre ?? []) applyPlacement(before, level.parts, t, true)
    assert.ok(!evaluate(netlist, before).complete, `${tag}: already complete before the player acts`)

    const sim = solve(parts)
    assert.equal(sim.shorts.length, 0, `${tag}: solution shorts the supply`)
    assert.equal(sim.overloaded.length, 0, `${tag}: solution burns an LED`)
    const flows = stripFlows(sim.taps)
    const bits = parts.filter((p) => p.type === 'led' || p.type === 'source' || p.type === 'mcu')
      .map((p) => `${p.ref} ${fmtAmps(sim.i.get(p.id)?.i ?? 0)}`)
    const mv = meter(parts, sim)
    console.log(`ok ${tag.padEnd(20)} ${bits.join('  ')}${mv === null ? '' : `  meter ${fmtVolts(mv)}`}  (${flows.length} strip flows)`)
  })
}

// Physics spot checks.
{
  const two = LEVELS.find((l) => l.id === 'two-supplies')
  const parts = solvedBoard(two)
  const sim = solve(parts)
  const vx = meter(parts, sim)
  assert.ok(Math.abs(vx - 0.652) < 0.01, `Vx should be about 0.65 V, got ${vx}`)
  const div = LEVELS.find((l) => l.id === 'divider')
  assert.ok(Math.abs(meter(solvedBoard(div, 0), solve(solvedBoard(div, 0))) - 2.5) < 0.01)
  const p1 = solvedBoard(div, 1)
  assert.ok(Math.abs(meter(p1, solve(p1)) - 4.545) < 0.01)
}
// A wire straight across the rails is a short.
{
  const lvl = LEVELS[0]
  const parts = solvedBoard(lvl)
  applyPlacement(parts, lvl.parts, ['wire', 'TP20', 'TN20'])
  assert.equal(solve(parts).shorts.length, 1, 'rail-to-rail wire should short')
}
// An LED with no resistor burns.
{
  const lvl = LEVELS[0]
  const parts = lvl.modules.map((r) => makePart(r, lvl.parts[r]))
  for (const t of [['V1.pos', 'TP2'], ['V1.neg', 'TN2'], ['D1', 'TP9', 'TN9']]) applyPlacement(parts, lvl.parts, t)
  assert.equal(solve(parts).overloaded.length, 1, 'LED straight across the rails should burn')
}
// A backward LED is reported as such.
{
  const lvl = LEVELS[0]
  const parts = solvedBoard(lvl)
  const d = parts.find((p) => p.ref === 'D1')
  d.pins = { a: d.pins.k, k: d.pins.a }
  const ev = evaluate(netlistOf(lvl.steps[0].sch), parts)
  assert.ok(!ev.complete && ev.issues.some((i) => i.kind === 'backward'), 'backward LED should be flagged')
  assert.equal(solve(parts).i.get(d.id).i, 0)
}
assert.deepEqual(bands(330), ['orange', 'orange', 'brown'])
assert.deepEqual(bands(1000), ['brown', 'black', 'red'])
assert.deepEqual(bands(10000), ['brown', 'black', 'orange'])
assert.equal(stripOf('F9'), 't9')

// Inspector cases: every planted fault must really break the board.
{
  const { makeCase } = await import('../src/game/cases.js')
  const seen = {}
  let last = null
  for (let k = 0; k < 3000; k++) {
    const c = makeCase(last)
    last = c.level.id
    const holes = c.parts.flatMap((p) => Object.values(p.pins).filter(Boolean))
    assert.ok(holes.every(isHole), `inspector: bad hole in ${c.level.id}`)
    assert.equal(new Set(holes).size, holes.length, `inspector: doubled hole in ${c.level.id} (${c.fault?.tag})`)
    const ok = evaluate(netlistOf(c.sch), c.parts).complete
    if (!c.fault) assert.ok(ok, 'inspector: a clean board must match')
    else if (!c.fault.ok) assert.ok(!ok, `inspector: fault "${c.fault.tag}" left the board correct`)
    const key = `${c.level.id}: ${c.fault?.tag ?? 'clean'}`
    seen[key] = (seen[key] ?? 0) + 1
  }
  for (const id of ['lines-are-nodes', 'series', 'ladder', 'two-roads', 'divider', 'two-supplies', 'joystick']) {
    const faults = Object.keys(seen).filter((k) => k.startsWith(id) && !k.endsWith('clean'))
    assert.ok(faults.length >= 2, `inspector: ${id} needs at least two kinds of fault, has ${faults}`)
  }
  console.log(`inspector: ${Object.keys(seen).length} kinds of case over 3000 deals`)
}
console.log('all good')
