// Plays one campaign level (or the free bench): the parts bin, placing and
// moving parts, predictions, shorts and burned LEDs, hints and the win check.
import { h, hud, toast, stars, partIcon, KEY } from '../ui.js'
import { sfx } from '../audio.js'
import { store } from '../store.js'
import { HUE } from '../theme.js'
import { createSchematic } from '../schematic.js'
import { netlistOf, evaluate, solve, buildNets, PINS, fmtAmps, fmtVolts, fmtOhms } from '../circuit.js'
import { makePart, makeWire, applyPlacement, isModule, isRigid, rigidPins, occupied } from '../build.js'
import { ALL_STRIPS, holeDistance, holePos, parseHole, isHole, stripName, stripOf } from '../board.js'
import { leadInfo } from '../scene/parts.js'
import { LEVELS, CHAPTERS } from '../levels.js'

const REACH = { resistor: 12.5, led: 4.3, wire: 99 }
const snapshot = (parts) => structuredClone(parts)
const tipped = new Set() // placement tips already shown this session

const TERM_WORDS = {
  resistor: { a: (r) => `one end of ${r}`, b: (r) => `one end of ${r}` },
  led: { a: (r) => `${r}'s long leg`, k: (r) => `${r}'s short leg` },
  source: { pos: (r) => `the red lead of ${r}`, neg: (r) => `the black lead of ${r}` },
  meter: { red: () => 'the red probe', black: () => 'the black probe' },
  pot: { a: (r) => `an end pin of ${r}`, b: (r) => `an end pin of ${r}`, w: (r) => `the middle pin of ${r}` },
  joystick: { vcc: () => "the joystick's Vcc pin", x: () => "the joystick's Xout pin", y: () => "the joystick's Yout pin", gnd: () => "the joystick's GND pin" },
  mcu: { '3v3': () => "the Nucleo's 3V3 lead", pc2: () => "the Nucleo's PC2 lead", pc3: () => "the Nucleo's PC3 lead", gnd: () => "the Nucleo's GND lead" },
}

export function playLevel(stage, level, nav) {
  const sandbox = !!level.sandbox
  const S = {
    step: 0, parts: [], power: true, tool: null, pending: null, moving: null,
    hoverHole: null, hoverNode: null, selected: null, history: [], stepStart: null,
    shorts: 0, burns: 0, hints: 0, wrong: 0, prediction: null, flags: new Set(),
    done: false, doneNodes: new Set(), hint: null, busy: false, tripAt: 0, counters: {},
  }
  let step, netlist, schematic, sim, ev
  if (window.solderless) window.solderless.level = S
  const byRef = (ref) => S.parts.find((p) => p.ref === ref)
  const byId = (id) => S.parts.find((p) => p.id === id)
  const placed = (p) => Object.values(p.pins).every(Boolean)

  // ------------------------------------------------------------- markup
  const el = {
    brief: h('p.brief'),
    sch: h('div.sch'),
    chips: h('ul.chips'),
    note: h('p.note', { role: 'status' }),
    idea: h('p.idea'),
    predict: h('div.predict'),
    bin: h('div.bin', { role: 'toolbar', 'aria-label': 'Parts bin' }),
    lcd: h('div.lcd'),
    extra: h('div.extra'),
    power: h('button.power', { type: 'button', 'aria-pressed': 'true', onclick: () => setPower(!S.power) }, h('span.rocker'), h('span.power-label', 'Power')),
    actions: h('div.actions'),
    card: h('div.card-wrap.docked'),
  }
  const index = LEVELS.indexOf(level)
  const paper = h('section.paper',
    h('header.titleblock',
      h('h1', level.title),
      h('div.tb-cell', sandbox ? 'No goal' : CHAPTERS[level.chapter]),
      h('div.tb-cell.sheet', sandbox ? 'Bench' : `Sheet ${index + 1} of ${LEVELS.length}`),
    ),
    level.course && h('p.course', `From ${level.course}`),
    el.brief, el.predict, el.sch, el.chips, el.note,
    h('div.idea-wrap', h('span.idea-mark', 'Idea'), el.idea),
    h('footer.paper-foot',
      !sandbox && h('button.btn.ghost', { type: 'button', onclick: hint }, 'Hint', h('kbd', 'H')),
      h('button.btn.ghost', { type: 'button', onclick: resetStep }, 'Start over'),
      h('button.btn.ghost', { type: 'button', onclick: () => nav.menu() }, 'Menu'),
    ),
  )
  const btn = (label, key, fn, cls = '') => h(`button.tool${cls}`, { type: 'button', onclick: fn }, label, key && h('kbd', key))
  el.xray = btn('X-ray', 'X', () => setXray(!stage.board.xrayOn))
  el.view = btn('Top view', 'V', toggleView)
  el.sound = btn(store.mute ? 'Sound off' : 'Sound on', '', () => { store.mute = !store.mute; el.sound.firstChild.textContent = store.mute ? 'Sound off' : 'Sound on' })
  el.actions.append(el.xray, el.view, btn('Undo', '⌘Z', undo), el.sound)
  const panel = h('aside.panel', el.extra, el.actions, h('div.psu', el.power, el.lcd))
  const bottom = h('div.bottom', el.bin)
  const root = h('div.play', paper, panel, bottom, el.card)
  hud().append(root)

  function fitStage() {
    const p = paper.getBoundingClientRect()
    const b = bottom.getBoundingClientRect()
    const wide = p.width < innerWidth * 0.62
    document.documentElement.style.setProperty('--free-left', `${wide ? p.right : 0}px`)
    stage.setInsets({
      left: wide ? p.right + 6 : 0,
      top: wide ? panel.getBoundingClientRect().bottom + 4 : p.bottom + 6,
      right: S.cardOpen && innerWidth > 1100 ? 440 : 10,
      bottom: innerHeight - b.top + 10,
    })
    document.documentElement.style.setProperty('--panel-w', `${panel.getBoundingClientRect().width}px`)
  }

  function enterStep(k, first = false) {
    S.step = k
    step = level.steps[k]
    for (const t of step.pre ?? []) applyPlacement(S.parts, level.parts, t, true)
    netlist = step.sch ? netlistOf(step.sch) : null
    S.doneNodes = new Set()
    S.prediction = null
    S.hint = null
    S.done = false
    S.history = []
    el.brief.textContent = step.brief
    el.idea.textContent = step.idea ?? ''
    el.idea.parentElement.hidden = !step.idea
    el.sch.replaceChildren()
    el.chips.replaceChildren()
    if (step.sch) {
      schematic = createSchematic(step.sch, level.parts)
      schematic.onNode((name) => { S.hoverNode = name; glows() })
      schematic.onPart((ref) => stage.setHovered(ref ? byRef(ref)?.id : null))
      el.sch.append(schematic.el)
      for (const [name, nd] of Object.entries(step.sch.nodes)) {
        el.chips.append(h('li.chip', {
          'data-node': name, style: { '--hue': HUE[nd.color] },
          onpointerenter: () => { S.hoverNode = name; glows() }, onpointerleave: () => { S.hoverNode = null; glows() },
        }, h('span.swatch'), nd.label, h('span.state')))
      }
      if (step.goalText) el.chips.append(h('li.chip.goal', { 'data-node': '_goal' }, h('span.swatch'), step.goalText, h('span.state')))
    } else schematic = null
    el.sch.hidden = !step.sch
    el.chips.hidden = !step.sch
    renderPredict()
    if (step.predict) S.power = false
    else if (!S.power && !first) S.power = true
    S.stepStart = snapshot(S.parts)
    stage.sync(S.parts, level.modules.length, { instant: first })
    refresh()
    if (first && !sandbox && index === 0) introXray()
  }

  function introXray() {
    setXray(true)
    setTimeout(() => { if (!S.done) setXray(false) }, 2600)
  }

  function renderPredict() {
    const p = step.predict
    el.predict.replaceChildren()
    el.predict.hidden = !p
    if (!p) return
    if (S.prediction === null) {
      el.predict.append(
        h('p.predict-q', h('strong', 'Predict first. '), p.q, '…'),
        h('div.predict-opts', p.options.map((o, k) => h('button.btn', { type: 'button', onclick: () => choose(k) }, o))),
        h('p.predict-foot', 'The power stays off until you pick.'),
      )
    } else {
      el.predict.append(h('p.predict-q.made', 'Your call: ', h('strong', p.options[S.prediction]), '. Build it and see.'))
    }
  }

  function choose(k) {
    S.prediction = k
    sfx('pick')
    renderPredict()
    setPower(true)
  }

  // ------------------------------------------------------------ refresh
  function context() {
    return {
      sim, flags: S.flags,
      current: (ref) => sim.i.get(byRef(ref)?.id)?.i ?? 0,
      nodeV: (name) => sim.v.get(ev?.nodeNet[name]?.[0]) ?? 0,
      meter: (ref) => { const m = byRef(ref); return m?.pins.red && m.pins.black ? (sim.volts(m.pins.red) ?? 0) - (sim.volts(m.pins.black) ?? 0) : 0 },
    }
  }

  function refresh() {
    sim = solve(S.parts, S.power)
    ev = netlist ? evaluate(netlist, S.parts) : null
    stage.sync(S.parts, level.modules.length)
    stage.setSim(sim)
    stage.setSelected(S.selected)
    glows()
    marks()
    renderBin()
    renderReadouts()
    renderStatus()
    hazards()
    checkDone()
  }

  function glows() {
    const map = new Map()
    const netOf = ev?.netOf ?? buildNets(S.parts)
    const groups = new Map()
    for (const s of ALL_STRIPS) {
      const r = netOf.strip(s)
      if (!groups.has(r)) groups.set(r, [])
      groups.get(r).push(s)
    }
    const paint = (net, g) => { for (const s of groups.get(net) ?? []) map.set(s, g) }
    if (ev) {
      for (const [name, st] of Object.entries(ev.status)) {
        const color = HUE[step.sch.nodes[name].color]
        const hot = S.hoverNode === name
        if (st === 'done') for (const net of ev.nodeNet[name]) paint(net, { color, a: hot || S.flash ? 1 : 0.5 })
        else if (st === 'conflict') for (const net of ev.nodeNet[name]) paint(net, { color: '#ff3030', a: 0.75, pulse: true })
        else if (hot) for (const net of ev.nodeNet[name]) paint(net, { color, a: 0.6, pulse: true })
      }
    }
    const hov = S.hoverHole ? netOf(S.hoverHole) : null
    if (hov) for (const s of groups.get(hov)) map.set(s, map.has(s) ? { ...map.get(s), a: 1 } : { color: '#cfefff', a: 0.42 })
    stage.board.setGlows(map)
    if (schematic) {
      const names = hov ? [...(ev?.netNodes.get(hov) ?? [])] : []
      if (S.hoverNode) names.push(S.hoverNode)
      schematic.setHover(names)
      for (const li of el.chips.children) li.classList.toggle('hover', names.includes(li.dataset.node))
    }
  }

  function marks() {
    const list = []
    if (S.hoverHole) {
      const v = sim?.powered ? sim.volts(S.hoverHole) : null
      list.push({ hole: S.hoverHole, color: '#ffffff', bright: 1.1, label: v === null ? stripName(stripOf(S.hoverHole)) : `${fmtVolts(v)}`, cls: 'volt' })
    }
    if (S.pending) list.push({ hole: S.pending, color: '#ffd028', pulse: true })
    for (const hole of S.hint ?? []) list.push({ hole, color: '#5ee6ff', pulse: true, bright: 2 })
    stage.setMarks(list)
  }

  // ---------------------------------------------------------------- bin
  function binItems() {
    const items = []
    for (const p of S.parts) {
      if (!isModule(p)) continue
      for (const pin of PINS[p.type]) {
        if (p.pins[pin]) continue
        const info = leadInfo(p, pin)
        items.push({ key: `lead:${p.id}:${pin}`, kind: 'lead', part: p, pin, label: `${p.ref} ${info.label}`, sub: 'lead', icon: { type: 'lead', color: info.color } })
      }
    }
    const listed = new Set()
    const add = (p) => {
      listed.add(p.ref)
      const spec = p
      items.push({
        key: `part:${p.ref}`, kind: 'part', part: p, label: p.ref, used: placed(p),
        sub: p.type === 'resistor' || p.type === 'pot' ? fmtOhms(p.ohms) : p.type === 'led' ? `${p.color} LED` : 'joystick', icon: spec,
      })
    }
    for (const name of step.tray ?? []) {
      if (name === 'wire') continue
      let p = byRef(name)
      if (!p) { p = makePart(name, level.parts[name]); S.parts.push(p) }
      add(p)
    }
    for (const p of S.parts) if (!isModule(p) && p.type !== 'wire' && !listed.has(p.ref) && !placed(p) && !p.stock) add(p)
    for (const [k, s] of (level.stock ?? []).entries()) items.push({ key: `stock:${k}`, kind: 'stock', k, label: s.label, sub: 'any number', icon: s.spec })
    if ((step.tray ?? []).includes('wire')) items.push({ key: 'wire', kind: 'wire', label: 'Wire', sub: 'any number', icon: { type: 'wire' } })
    return items
  }

  let binCache = []
  function renderBin() {
    binCache = binItems()
    const active = toolKey()
    el.bin.replaceChildren(...binCache.map((it, k) => h(`button.slot${it.used ? '.used' : ''}${it.key === active ? '.active' : ''}`, {
      type: 'button', 'aria-pressed': String(it.key === active), title: it.used ? `${it.label} is on the board` : `Pick up ${it.label}`,
      onclick: () => pickItem(it),
      onpointerenter: () => { if (it.part) { stage.setHovered(it.part.id); schematic?.setHotPart(it.part.ref) } },
      onpointerleave: () => { stage.setHovered(null); schematic?.setHotPart(null) },
    }, partIcon(it.icon), h('span.slot-name', it.label), h('span.slot-sub', it.used ? 'on the board' : it.sub), k < 9 && h('kbd', String(k + 1)))))
    el.bin.hidden = !binCache.length
    if (schematic) schematic.setPlaced(new Set(S.parts.filter((p) => isModule(p) ? Object.values(p.pins).some(Boolean) : placed(p)).map((p) => p.ref).concat(['RX', 'RY'].filter(() => byRef('JS1') && placed(byRef('JS1'))))))
  }

  function toolKey() {
    const t = S.tool
    if (!t) return null
    if (t.kind === 'lead') return `lead:${t.partId}:${t.pin}`
    if (t.kind === 'part') return `part:${t.ref}`
    if (t.kind === 'stock') return `stock:${t.k}`
    return 'wire'
  }

  function pickItem(it) {
    if (S.done) return
    if (it.key === toolKey()) { setTool(null); return }
    if (it.used) { select(it.part.id); toast(`${it.label} is already on the board. Drag a leg to move it, or press Delete to take it off.`); return }
    if (it.kind === 'lead') setTool({ kind: 'lead', partId: it.part.id, pin: it.pin })
    else if (it.kind === 'part') setTool({ kind: 'part', ref: it.part.ref })
    else if (it.kind === 'stock') setTool({ kind: 'stock', k: it.k })
    else setTool({ kind: 'wire' })
    sfx('pick')
  }

  function setTool(tool) {
    S.tool = tool
    S.pending = null
    S.selected = null
    S.hint = null
    stage.setSelected(null)
    stage.setGhost(null)
    renderBin()
    marks()
    root.classList.toggle('holding', !!tool)
    const tipKey = tool && (tool.kind === 'lead' ? 'lead' : toolType())
    if (tool && !tipped.has(tipKey)) {
      tipped.add(tipKey)
      const type = toolType()
      toast(type === 'led' ? 'Click the hole for the long leg (+), then the hole for the short leg.'
        : tool.kind === 'lead' ? 'Click a hole to plug the lead in.'
        : isRigidType(type) ? 'Click a hole for the first pin. The rest follow along the row.'
        : 'Click one hole, then another. Or drag between them.')
    }
  }
  const isRigidType = (t) => t === 'pot' || t === 'joystick'
  function toolSpec() {
    const t = S.tool
    if (!t) return null
    if (t.kind === 'wire') return { type: 'wire', color: 'yellow' }
    if (t.kind === 'part') return byRef(t.ref)
    if (t.kind === 'stock') return level.stock[t.k].spec
    return null
  }
  const toolType = () => toolSpec()?.type ?? null

  // ------------------------------------------------------------ editing
  function commit(fn, sound = 'plug') {
    S.history.push(snapshot(S.parts))
    if (S.history.length > 60) S.history.shift()
    fn()
    S.hint = null
    sfx(sound)
    refresh()
  }

  function undo() {
    const prev = S.history.pop()
    if (!prev || S.done) { sfx('nope'); return }
    S.parts = prev
    S.selected = null
    setTool(null)
    sfx('unplug')
    refresh()
  }

  function resetStep() {
    if (S.done) return
    S.history.push(snapshot(S.parts))
    S.parts = snapshot(S.stepStart)
    S.selected = null
    setTool(null)
    sfx('unplug')
    refresh()
  }

  function checkSpan(type, a, b) {
    if (a === b) return 'Pick a different hole for the second leg.'
    const d = holeDistance(a, b)
    if (d > (REACH[type] ?? 99)) return type === 'led' ? "An LED's legs only reach about four holes." : 'That is further than the leads reach.'
    return null
  }

  function placeTwo(a, b) {
    const t = S.tool
    const type = toolType()
    const bad = checkSpan(type, a, b)
    if (bad) { toast(bad); sfx('nope'); S.pending = null; marks(); return }
    commit(() => {
      if (t.kind === 'wire') S.parts.push(makeWire(a, b))
      else {
        let p
        if (t.kind === 'stock') {
          const s = level.stock[t.k]
          S.counters[s.prefix] = (S.counters[s.prefix] ?? 0) + 1
          p = Object.assign(makePart(`${s.prefix}${S.counters[s.prefix]}`, s.spec), { stock: true })
          S.parts.push(p)
        } else p = byRef(t.ref)
        const [p1, p2] = PINS[p.type]
        p.pins[p1] = a
        p.pins[p2] = b
      }
    })
    S.pending = null
    stage.setGhost(null)
    if (t.kind === 'part') setTool(null)
    else marks()
  }

  function placeRigid(hole) {
    const t = S.tool
    const spec = toolSpec()
    const pins = rigidPins(spec.type, hole)
    const occ = occupied(S.parts)
    if (!pins || Object.values(pins).some((x) => occ.has(x))) { toast('It does not fit there. All its pins need free holes in one row.'); sfx('nope'); return }
    commit(() => {
      let p
      if (t.kind === 'stock') {
        const s = level.stock[t.k]
        S.counters[s.prefix] = (S.counters[s.prefix] ?? 0) + 1
        p = Object.assign(makePart(`${s.prefix}${S.counters[s.prefix]}`, s.spec), { stock: true })
        S.parts.push(p)
      } else p = byRef(t.ref)
      p.pins = pins
    })
    stage.setGhost(null)
    if (t.kind === 'part') setTool(null)
  }

  function plugLead(hole) {
    const { partId, pin } = S.tool
    commit(() => { byId(partId).pins[pin] = hole })
    setTool(null)
  }

  function removePart(p) {
    if (!p || p.locked) { toast('That one is fixed in place for this level.'); sfx('nope'); return }
    commit(() => {
      if (p.type === 'wire' || p.stock) S.parts.splice(S.parts.indexOf(p), 1)
      else {
        for (const k of Object.keys(p.pins)) p.pins[k] = null
        if (p.type === 'led') p.burned = false
      }
    }, 'unplug')
    S.selected = null
    stage.setSelected(null)
  }

  function flip(p) {
    if (!p || p.type !== 'led' || p.locked) return
    commit(() => { p.pins = { a: p.pins.k, k: p.pins.a } })
  }

  function select(id) {
    S.selected = id
    stage.setSelected(id)
    renderSelection()
  }

  const selBar = h('div.selbar')
  root.append(selBar)
  function renderSelection() {
    const p = byId(S.selected)
    selBar.replaceChildren()
    selBar.hidden = !p
    if (!p) return
    const name = p.type === 'wire' ? 'Wire' : p.type === 'resistor' ? `${p.ref}, ${fmtOhms(p.ohms)}` : p.ref
    selBar.append(h('span.sel-name', name))
    if (p.locked) selBar.append(h('span.sel-note', 'Fixed for this level'))
    else {
      if (p.type === 'led') selBar.append(h('button.btn.small', { type: 'button', onclick: () => flip(p) }, 'Flip', h('kbd', 'F')))
      selBar.append(h('button.btn.small', { type: 'button', onclick: () => removePart(p) }, 'Take off', h('kbd', '⌫')))
    }
  }

  // ------------------------------------------------------------ pointer
  const free = (hole, except) => hole && !occupied(S.parts, except).has(hole)

  function ghostFor(hole) {
    if (!hole) { stage.setGhost(null); return }
    const t = S.tool
    if (S.moving) {
      const m = S.moving
      const p = m.part
      if (isRigid(p)) {
        const { row, col } = parseHole(hole)
        const anchor = row + (col - m.index)
        const pins = isHole(anchor) ? rigidPins(p.type, anchor) : null
        const occ = occupied(S.parts, p)
        stage.setGhost(pins ? { ...p, id: 'ghost', pins } : null, !!pins && !Object.values(pins).some((x) => occ.has(x)))
      } else if (!isModule(p)) {
        const pins = { ...p.pins, [m.pin]: hole }
        const [a, b] = Object.values(pins)
        stage.setGhost({ ...p, id: 'ghost', pins }, free(hole, p) && !checkSpan(p.type, a, b))
      }
      return
    }
    if (!t) { stage.setGhost(null); return }
    const spec = toolSpec()
    if (t.kind === 'lead') { stage.setGhost(null); return }
    if (isRigidType(spec.type)) {
      const pins = rigidPins(spec.type, hole)
      const occ = occupied(S.parts)
      stage.setGhost(pins ? { ...makePart('ghost', spec), ...spec, id: 'ghost', ref: 'ghost', pins } : null, !!pins && !Object.values(pins).some((x) => occ.has(x)))
      return
    }
    if (S.pending && hole !== S.pending) {
      const [p1, p2] = PINS[spec.type]
      stage.setGhost({ ...spec, id: 'ghost', ref: 'ghost', type: spec.type, pins: { [p1]: S.pending, [p2]: hole } }, free(hole) && !checkSpan(spec.type, S.pending, hole))
    } else stage.setGhost(null)
  }

  stage.on('down', (pk) => {
    if (S.done || S.busy) return
    const t = S.tool
    if (t) {
      if (t.kind === 'lead' || isRigidType(toolType())) return
      if (!S.pending && pk.hole) {
        if (free(pk.hole)) { S.pending = pk.hole; sfx('pick'); marks() }
        else { toast('That hole is taken. One lead per hole.'); sfx('nope') }
      }
      return
    }
    const occ = pk.hole ? occupied(S.parts).get(pk.hole) : null
    const lead = pk.lead ? { part: byId(pk.lead.partId), pin: pk.lead.pin } : occ && isModule(occ.part) ? occ : null
    if (lead) {
      if (lead.part.lockedPins?.has(lead.pin)) { toast('That lead is fixed in place for this level.'); sfx('nope'); return }
      if (lead.part.pins[lead.pin]) commit(() => { lead.part.pins[lead.pin] = null }, 'unplug')
      setTool({ kind: 'lead', partId: lead.part.id, pin: lead.pin })
      return
    }
    if (occ) {
      S.moving = { part: occ.part, pin: occ.pin, from: pk.hole, index: PINS[occ.part.type].indexOf(occ.pin) }
      return
    }
    S.downPart = pk.partId
  })

  stage.on('move', (pk) => {
    if (S.hoverHole !== pk.hole) {
      S.hoverHole = pk.hole
      glows()
      marks()
    }
    if (!S.tool && !S.moving) stage.setHovered(pk.partId)
    ghostFor(pk.hole)
  })

  stage.on('up', (pk) => {
    if (S.done || S.busy) return
    const t = S.tool
    if (S.moving) {
      const m = S.moving
      S.moving = null
      stage.setGhost(null)
      const p = m.part
      if (!pk.hole || pk.hole === m.from) { select(p.id); return }
      if (p.locked) { toast('That one is fixed in place for this level.'); sfx('nope'); return }
      if (isRigid(p)) {
        const { row, col } = parseHole(pk.hole)
        const anchor = row + (col - m.index)
        const pins = isHole(anchor) ? rigidPins(p.type, anchor) : null
        const occ = occupied(S.parts, p)
        if (!pins || Object.values(pins).some((x) => occ.has(x))) { toast('It does not fit there.'); sfx('nope'); return }
        commit(() => { p.pins = pins })
        return
      }
      if (!free(pk.hole, p)) { toast('That hole is taken. One lead per hole.'); sfx('nope'); return }
      const pins = { ...p.pins, [m.pin]: pk.hole }
      const bad = checkSpan(p.type, ...Object.values(pins))
      if (bad) { toast(bad); sfx('nope'); return }
      commit(() => { p.pins = pins })
      select(p.id)
      return
    }
    if (!t) {
      if (pk.partId && pk.partId === S.downPart) select(pk.partId)
      else if (!pk.partId) select(null)
      S.downPart = null
      return
    }
    if (!pk.hole) return
    if (t.kind === 'lead') {
      if (free(pk.hole)) plugLead(pk.hole)
      else { toast('That hole is taken. One lead per hole.'); sfx('nope') }
    } else if (isRigidType(toolType())) placeRigid(pk.hole)
    else if (S.pending && pk.hole !== S.pending) {
      if (free(pk.hole)) placeTwo(S.pending, pk.hole)
      else { toast('That hole is taken. One lead per hole.'); sfx('nope') }
    }
  })

  stage.on('cancel', cancel)
  function cancel() {
    if (S.pending) { S.pending = null; stage.setGhost(null); marks() }
    else if (S.tool) setTool(null)
    else select(null)
  }

  // ------------------------------------------------------------ readouts
  let knob, pad
  function renderReadouts() {
    const rows = []
    for (const p of S.parts) {
      if (p.type === 'source') {
        const i = sim.i.get(p.id)?.i ?? 0
        const on = S.power && p.pins.pos && p.pins.neg
        rows.push(h('div.lcd-row', h('span.lcd-k', `${p.ref} ${p.volts} V`), h('span.lcd-v', on ? `${i < -1e-5 ? '−' : ''}${fmtAmps(i)}` : 'off')))
      } else if (p.type === 'meter') {
        const both = p.pins.red && p.pins.black
        const v = both ? (sim.volts(p.pins.red) ?? 0) - (sim.volts(p.pins.black) ?? 0) : null
        rows.push(h('div.lcd-row.big', h('span.lcd-k', 'Meter'), h('span.lcd-v', v === null ? '– – –' : fmtVolts(v))))
      } else if (p.type === 'mcu') {
        const on = S.power && p.pins['3v3'] && p.pins.gnd
        for (const pin of ['pc2', 'pc3']) {
          const v = on && p.pins[pin] ? Math.max(0, (sim.volts(p.pins[pin]) ?? 0) - (sim.volts(p.pins.gnd) ?? 0)) : null
          const count = v === null ? null : Math.round(Math.min(1, v / 3.3) * 4095)
          rows.push(h('div.lcd-row', h('span.lcd-k', `${pin.toUpperCase()} ADC`), h('span.lcd-v', count === null ? '– – –' : String(count)),
            h('span.lcd-bar', h('span', { style: { width: `${count === null ? 0 : (count / 4095) * 100}%` } }))))
        }
      }
    }
    el.lcd.replaceChildren(...rows)
    for (const p of S.parts) {
      const lcd = isModule(p) ? stage.lcd(p.id) : null
      if (!lcd) continue
      if (p.type === 'source') lcd.set(S.power && p.pins.pos && p.pins.neg ? fmtAmps(sim.i.get(p.id)?.i ?? 0) : 'OFF')
      if (p.type === 'meter') lcd.set(p.pins.red && p.pins.black ? fmtVolts((sim.volts(p.pins.red) ?? 0) - (sim.volts(p.pins.black) ?? 0)) : '---')
    }
    el.power.setAttribute('aria-pressed', String(S.power))
    el.power.classList.toggle('locked', !!step.predict && S.prediction === null)

    // Controls for parts you can move by hand.
    const pot = S.parts.find((p) => p.type === 'pot' && placed(p))
    const js = S.parts.find((p) => p.type === 'joystick' && placed(p))
    if (pot && !knob) {
      knob = h('label.knob', h('span', 'Knob'), h('input', {
        type: 'range', min: 0, max: 1, step: 0.005, value: pot.t,
        oninput: (e) => { const q = S.parts.find((x) => x.type === 'pot' && placed(x)); if (q) { q.t = +e.target.value; refresh() } },
      }))
      el.extra.append(knob)
    } else if (!pot && knob) { knob.remove(); knob = null }
    if (js && !pad) {
      const thumb = h('span.pad-thumb')
      pad = h('div.pad', { tabindex: 0, role: 'application', 'aria-label': 'Joystick. Drag, or use the arrow keys.' }, thumb)
      const set = (x, y) => {
        const q = S.parts.find((p) => p.type === 'joystick' && placed(p))
        if (!q) return
        q.x = Math.min(1, Math.max(0, x)); q.y = Math.min(1, Math.max(0, y))
        thumb.style.left = `${q.x * 100}%`; thumb.style.top = `${(1 - q.y) * 100}%`
        if (q.x > 0.95) S.flags.add('right'); if (q.x < 0.05) S.flags.add('left')
        if (q.y > 0.95) S.flags.add('up'); if (q.y < 0.05) S.flags.add('down')
        refresh()
      }
      const from = (e) => { const r = pad.getBoundingClientRect(); set((e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height) }
      pad.addEventListener('pointerdown', (e) => { pad.setPointerCapture(e.pointerId); pad.dataset.drag = '1'; from(e) })
      pad.addEventListener('pointermove', (e) => { if (pad.dataset.drag) from(e) })
      const rel = () => { delete pad.dataset.drag; set(0.5, 0.5) }
      pad.addEventListener('pointerup', rel)
      pad.addEventListener('pointercancel', rel)
      pad.addEventListener('keydown', (e) => {
        const d = { ArrowLeft: [0, 0.5], ArrowRight: [1, 0.5], ArrowUp: [0.5, 1], ArrowDown: [0.5, 0] }[e.key]
        if (d) { e.preventDefault(); set(...d) }
      })
      pad.addEventListener('keyup', (e) => { if (e.key.startsWith('Arrow')) set(0.5, 0.5) })
      el.extra.append(h('div.pad-wrap', h('span', 'Stick'), pad))
    } else if (!js && pad) { pad.parentElement.remove(); pad = null }
  }
  const say = (key) => TERM_WORDS[byRef(key.split('.')[0])?.type]?.[key.split('.')[1]]?.(key.split('.')[0]) ?? key
  const nodeLabel = (n) => step.sch.nodes[n].label

  function renderStatus() {
    if (!ev) { el.note.textContent = sim.shorts.length ? 'Short circuit.' : S.free ? 'Free play. Move things, break things, see what changes.' : ''; return }
    let goalOk = false
    for (const li of el.chips.children) {
      const n = li.dataset.node
      if (n === '_goal') { goalOk = ev.complete && !!step.goal?.(context()); li.dataset.state = goalOk ? 'done' : 'empty' }
      else li.dataset.state = ev.status[n]
      li.querySelector('.state').textContent = li.dataset.state === 'done' ? '✓' : li.dataset.state === 'conflict' ? '!' : ''
    }
    schematic.setStatus(ev.status)
    for (const p of S.parts) if (p.type === 'led') schematic.setLit(p.ref, sim.powered ? Math.min(1, (sim.i.get(p.id)?.i ?? 0) / 0.01) : 0)

    let k = 0
    for (const [name, st] of Object.entries(ev.status)) {
      if (st === 'done' && !S.doneNodes.has(name)) { S.doneNodes.add(name); if (!S.quiet) sfx('node', k) }
      if (st !== 'done') S.doneNodes.delete(name)
      k++
    }

    const is = ev.issues[0]
    let note = ''
    let bad = false
    if (sim.shorts.length) { note = 'Short circuit. There is a path from + to − with nothing in it to limit the current.'; bad = true }
    else if (is?.kind === 'extra') { note = `Take ${is.ref} off the board. It is not in this schematic.`; bad = true }
    else if (is?.kind === 'same-node') { note = `${is.ref} has both legs in the same node, so no current goes through it.`; bad = true }
    else if (is?.kind === 'backward') { note = `${is.ref} is in backward. Current only passes from its long leg to its short leg.`; bad = true }
    else if (is?.kind === 'joined') { note = `${is.nodes.map(nodeLabel).join(' and ')} are joined on the board. On the schematic they are separate nodes.`; bad = true }
    else if (ev.complete && step.predict && S.prediction === null) note = 'It matches the schematic. Make your prediction to switch the power on.'
    else if (ev.complete && !S.power) note = 'It matches the schematic. Switch the power on.'
    else if (ev.complete && step.goal && !goalOk) note = `Wired correctly. Now: ${step.goalText.toLowerCase()}.`
    else if (!ev.complete) {
      const left = Object.values(ev.status).filter((s) => s !== 'done').length
      note = `${left} ${left === 1 ? 'node' : 'nodes'} to go.`
    }
    el.note.textContent = note
    el.note.classList.toggle('bad', bad)
  }

  // ------------------------------------------------------------- hazards
  function hazards() {
    const now = performance.now()
    if (sim.shorts.length && now - S.tripAt > 1500) {
      S.tripAt = now
      S.shorts++
      sfx('zap')
      for (const id of sim.shorts) {
        const p = byId(id)
        for (const hole of [p.pins.pos ?? p.pins['3v3'], p.pins.neg ?? p.pins.gnd]) stage.sparkHole(hole, 45, 1)
      }
      for (const p of S.parts) {
        if (p.type === 'wire' && Math.abs(sim.i.get(p.id)?.i ?? 0) > 1) for (const hole of [p.pins.a, p.pins.b]) stage.sparkHole(hole, 30, 0.8)
      }
      toast('Short circuit. The supply cut out. Find the path that joins + to − and break it.', 'bad')
      setTimeout(() => { if (sim?.shorts.length) setPower(false, true) }, 900)
    }
    for (const id of sim.overloaded) {
      const p = byId(id)
      if (p.burning) continue
      p.burning = true
      const amps = sim.i.get(id).i
      setTimeout(() => {
        const q = byId(id)
        if (!q || q.burned || !placed(q)) return
        q.burned = true
        q.burning = false
        S.burns++
        const top = stage.ledTop(id)
        if (top) { stage.spark(top, 18, 0.5); stage.puff(top) }
        sfx('pop')
        toast(`${q.ref} took ${fmtAmps(amps)} and burned out. An LED needs a resistor in its path. Take it off the board to swap in a fresh one.`, 'bad')
        refresh()
      }, 380)
    }
  }

  function setPower(on, tripped = false) {
    if (S.done) return
    if (on && step.predict && S.prediction === null) { toast('Make your prediction first.'); sfx('nope'); return }
    if (S.power === on) return
    S.power = on
    sfx(on ? 'power' : 'off')
    if (!on && !tripped) toast('Power off. Nothing flows.')
    refresh()
  }

  function setXray(on) {
    stage.board.xrayOn = on
    stage.board.setXray(on)
    el.xray.classList.toggle('on', on)
    el.xray.setAttribute('aria-pressed', String(on))
  }
  function toggleView() {
    const top = !stage.isTop()
    stage.view(top ? 'top' : 'bench')
    el.view.firstChild.textContent = top ? 'Bench view' : 'Top view'
  }

  // ---------------------------------------------------------------- hint
  function hint() {
    if (S.done || !ev) return
    S.hints++
    S.hint = null
    const occ = occupied(S.parts)
    for (const t of step.solution ?? []) {
      const [name, h1, h2] = t
      if (name === 'wire') continue
      const [ref, pin] = name.split('.')
      const p = byRef(ref)
      if (!p) continue
      if (pin ? p.pins[pin] : placed(p)) continue
      const holes = pin ? [h1] : isRigid(p) ? Object.values(rigidPins(p.type, h1)) : [h1, h2]
      if (holes.some((x) => occ.has(x))) continue
      S.hint = holes
      toast(pin ? `Try plugging ${say(name)} in here.` : p.type === 'led' ? `${ref} could go here. Long leg in ${h1}, short leg in ${h2}.` : `${ref} could go here.`)
      marks()
      sfx('pick')
      return
    }
    const todo = Object.entries(ev.status).find(([, st]) => st !== 'done')
    if (todo) {
      const [name, st] = todo
      const terms = [...netlist.nodes[name]].map(say)
      const list = terms.length > 1 ? `${terms.slice(0, -1).join(', ')} and ${terms.at(-1)}` : terms[0]
      S.hoverNode = name
      glows()
      setTimeout(() => { if (S.hoverNode === name) { S.hoverNode = null; glows() } }, 2600)
      toast(st === 'conflict'
        ? `${nodeLabel(name)} is touching another node. Look for a wire or a shared column that joins them.`
        : `${nodeLabel(name)} is not joined up yet. It needs ${list} in one connected group of holes, and nothing else.`)
    }
  }

  // ---------------------------------------------------------------- done
  function checkDone() {
    if (S.done || sandbox || !ev?.complete || !S.power) return
    if (sim.shorts.length || sim.overloaded.length) return
    if (step.predict && S.prediction === null) return
    if (step.goal && !step.goal(context())) return
    S.done = true
    setTool(null)
    select(null)
    const last = S.step === level.steps.length - 1
    const p = step.predict
    const right = p ? S.prediction === p.answer : null
    if (right === false) S.wrong++
    setTimeout(() => sfx('win'), 250)
    S.flash = true
    glows()
    setTimeout(() => { S.flash = false; glows() }, 700)
    const ctx = context()
    const text = typeof step.done === 'function' ? step.done(ctx) : step.done
    const body = [h('p.done-text', text)]
    if (p) body.push(h(`p.verdict${right ? '.right' : '.wrong'}`, h('strong', right ? 'You called it. ' : `You said “${p.options[S.prediction]}”. It was “${p.options[p.answer]}”. `), p.why))
    let earned = 0
    if (last) {
      const clean = !S.shorts && !S.burns
      const unaided = !S.hints && !S.wrong
      earned = 1 + clean + unaided
      store.setStars(level.id, earned)
      const hasPredict = level.steps.some((s) => s.predict)
      body.push(h('ul.rubric',
        h('li.yes', 'Built to match the schematic'),
        h(`li${clean ? '.yes' : '.no'}`, clean ? 'Nothing shorted or burned' : `${S.shorts ? 'Shorted the supply' : 'Burned an LED'} along the way`),
        h(`li${unaided ? '.yes' : '.no'}`, unaided ? (hasPredict ? 'No hints, every prediction right' : 'No hints') : S.hints ? 'Used a hint' : 'Missed a prediction'),
      ))
    }
    const next = LEVELS[index + 1]
    const card = h('div.card.done', { role: 'dialog', 'aria-label': 'Step complete' },
      h('h2', last ? 'It works' : 'That part works'),
      last && stars(earned),
      body,
      h('div.card-actions',
        last
          ? [next ? h('button.btn.primary', { type: 'button', onclick: () => nav.level(next) }, `Next: ${next.title}`) : h('button.btn.primary', { type: 'button', onclick: () => nav.menu() }, 'Back to the menu'),
            h('button.btn.ghost', { type: 'button', onclick: tinker }, 'Stay and tinker'),
            next && h('button.btn.ghost', { type: 'button', onclick: () => nav.menu() }, 'Menu')]
          : h('button.btn.primary', { type: 'button', onclick: () => { el.card.replaceChildren(); S.cardOpen = false; fitStage(); enterStep(S.step + 1) } }, 'Next step'),
      ),
    )
    setTimeout(() => {
      S.cardOpen = true
      fitStage()
      el.card.replaceChildren(card)
      card.querySelector('.btn.primary')?.focus()
      if (last) Array.from({ length: earned }, (_, k) => setTimeout(() => sfx('star'), 350 + k * 220))
    }, 900)
  }

  function tinker() {
    el.card.replaceChildren()
    S.cardOpen = false
    fitStage()
    S.done = false
    netlist = null
    ev = null
    for (const p of S.parts) { p.locked = false; p.lockedPins = undefined }
    S.free = true
    el.chips.hidden = true
    refresh()
  }

  // ---------------------------------------------------------------- keys
  function onKey(e) {
    if (KEY.isTyping(e) || e.altKey) return
    const k = e.key.toLowerCase()
    if ((e.metaKey || e.ctrlKey) && k === 'z') { e.preventDefault(); undo(); return }
    if (e.metaKey || e.ctrlKey) return
    if (k === 'escape') cancel()
    else if (k === 'x') setXray(!stage.board.xrayOn)
    else if (k === 'v') toggleView()
    else if (k === 'h' && !sandbox) hint()
    else if (k === 'p') setPower(!S.power)
    else if ((k === 'delete' || k === 'backspace') && S.selected) { e.preventDefault(); removePart(byId(S.selected)) }
    else if (k === 'f' && S.selected) flip(byId(S.selected))
    else if (/^[1-9]$/.test(k) && binCache[+k - 1]) pickItem(binCache[+k - 1])
  }
  addEventListener('keydown', onKey)

  // Keep the selection bar next to the selected part.
  const offFrame = stage.onFrame(() => {
    const at = S.selected && stage.partAnchor(S.selected)
    if (!at) { selBar.hidden = true; return }
    const p = stage.screenOf(at)
    selBar.hidden = false
    selBar.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -190%)`
  })

  // --------------------------------------------------------------- setup
  S.parts = level.modules.map((ref, k) => Object.assign(makePart(ref, level.parts[ref]), { slot: k }))
  enterStep(0, true)
  fitStage()
  const ro = new ResizeObserver(fitStage)
  ro.observe(paper); ro.observe(bottom); ro.observe(panel)
  addEventListener('resize', fitStage)


  return {
    destroy() {
      removeEventListener('keydown', onKey)
      removeEventListener('resize', fitStage)
      ro.disconnect()
      offFrame()
      for (const n of ['down', 'move', 'up', 'cancel']) stage.on(n, null)
      stage.setGhost(null)
      stage.setMarks([])
      stage.board.setGlows(new Map())
      stage.board.xrayOn = false
      stage.board.setXray(false)
      stage.setSelected(null)
      stage.setHovered(null)
      root.remove()
    },
  }
}
