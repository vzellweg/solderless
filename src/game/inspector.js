// Inspector: a schematic and a finished board. Does the board match?
// The same checking a reviewer does on a lesson's diagrams.
import { h, hud, KEY } from '../ui.js'
import { sfx } from '../audio.js'
import { store } from '../store.js'
import { HUE, BAND_HEX } from '../theme.js'
import { createSchematic } from '../schematic.js'
import { netlistOf, evaluate, solve, buildNets, fmtAmps, fmtVolts } from '../circuit.js'
import { isModule } from '../build.js'
import { ALL_STRIPS, holePos } from '../board.js'

import { makeCase, MODULE_WORDS, BAND_ORDER } from './cases.js'

export function playInspector(stage, nav) {
  const S = { streak: 0, checked: 0, right: 0, c: null, selected: null, state: 'ask', lastId: null }
  const stat = (k) => { const v = h('span.stat-v', '0'); return { el: h('div.stat', h('span.stat-k', k), v), v } }
  const st = { streak: stat('Streak'), best: stat('Best'), right: stat('Right') }
  const schBox = h('div.sch')
  const title = h('h1')
  const lead = h('p.lead-in')
  const note = h('p.note', { role: 'status' })
  const key = h('div.band-key', { 'aria-label': 'Resistor colour code' }, BAND_ORDER.map((c, k) =>
    h('span', { style: { background: BAND_HEX[c], color: k < 3 || k === 6 || k === 7 ? '#fff' : '#111' } }, `${k} ${c}`)))
  const paper = h('section.paper',
    h('header.titleblock', title, h('div.tb-cell', 'Inspector'), h('div.tb-cell.sheet', 'Check the board')),
    lead, schBox, note,
    h('div.idea-wrap', h('span.idea-mark', 'Resistor bands'), h('p', 'Two digits, then how many zeros. Brown, black, red is 1, 0 and two zeros: 1 kΩ.')),
    key,
    h('footer.paper-foot', h('button.btn.ghost', { type: 'button', onclick: () => nav.menu() }, 'Menu')),
  )
  const pass = h('button.answer.yes', { type: 'button', onclick: () => answer(null) }, 'Board is correct', h('kbd', 'C'))
  const flag = h('button.answer', { type: 'button', onclick: () => answer(S.selected) }, 'That part is wrong', h('kbd', 'W'))
  const next = h('button.answer.yes', { type: 'button', hidden: true, onclick: deal }, 'Next board', h('kbd', '↵'))
  const bar = h('div.answer-bar', flag, pass, next)
  const why = h('p.why', { hidden: true, role: 'status' })
  const xray = h('button.tool', { type: 'button', onclick: () => setXray(!S.xray) }, 'X-ray', h('kbd', 'X'))
  const view = h('button.tool', { type: 'button', onclick: toggleView }, 'Top view', h('kbd', 'V'))
  const root = h('div.arcade.inspect', paper, h('div.hud-top', st.streak.el, st.best.el, st.right.el), h('aside.panel', h('div.actions', xray, view)), why, bar)
  hud().append(root)
  stage.showValues(false)
  stage.view('bench')

  function fit() {
    const p = paper.getBoundingClientRect()
    const wide = p.width < innerWidth * 0.62
    document.documentElement.style.setProperty('--free-left', `${wide ? p.right : 0}px`)
    bar.style.left = why.style.left = `calc(50% + ${wide ? p.right / 2 : 0}px)`
    root.querySelector('.hud-top').style.left = `calc(50% + ${wide ? p.right / 2 : 0}px)`
    stage.setInsets({ left: wide ? p.right + 6 : 0, top: wide ? 84 : p.bottom + 6, right: 10, bottom: 128 })
  }
  const ro = new ResizeObserver(fit)
  ro.observe(paper)
  addEventListener('resize', fit)

  function setXray(on) {
    S.xray = on
    stage.board.setXray(on)
    xray.classList.toggle('on', on)
  }
  function toggleView() {
    const top = !stage.isTop()
    stage.view(top ? 'top' : 'bench')
    view.firstChild.textContent = top ? 'Bench view' : 'Top view'
  }

  function deal() {
    S.c = makeCase(S.lastId)
    S.lastId = S.c.level.id
    S.selected = null
    S.state = 'ask'
    title.textContent = S.c.level.title
    lead.textContent = 'Does the board match this schematic? Click the part that is wrong and flag it, or pass the board.'
    const sch = createSchematic(S.c.sch, S.c.level.parts)
    sch.setPlaced(new Set(S.c.sch.parts.map((p) => p[0])))
    sch.onPart((ref) => stage.setHovered(ref ? S.c.parts.find((p) => p.ref === ref)?.id : null))
    S.sch = sch
    schBox.replaceChildren(sch.el)
    note.textContent = ''
    why.hidden = true
    next.hidden = true
    pass.hidden = flag.hidden = false
    flag.disabled = true
    flag.style.opacity = 0.5
    setXray(false)
    stage.board.setGlows(new Map())
    stage.setMarks([])
    stage.setSelected(null)
    stage.sync(S.c.parts, S.c.level.modules.length)
    stage.setSim(null)
    for (const p of S.c.parts) stage.lcd(p.id)?.set(p.type === 'meter' ? '---' : 'OFF')
    sfx('tick')
    render()
    fit()
  }

  function select(id) {
    if (S.state !== 'ask') return
    const p = S.c.parts.find((q) => q.id === id)
    S.selected = p ? id : null
    stage.setSelected(S.selected)
    stage.setMarks(p && isModule(p) ? Object.values(p.pins).filter(Boolean).map((hole) => ({ hole, color: '#ffd028' })) : [])
    flag.disabled = !p
    flag.style.opacity = p ? 1 : 0.5
    note.textContent = p ? `Selected: ${p.type === 'wire' ? `the ${p.color} wire` : isModule(p) ? MODULE_WORDS[p.type] : p.ref}.` : ''
    if (p) sfx('pick')
  }

  function answer(id) {
    if (S.state !== 'ask') return
    const f = S.c.fault
    const ok = f ? id === f.culprit.id : id === null
    S.state = 'reveal'
    S.checked++
    if (ok) { S.right++; S.streak++; sfx('right') } else { S.streak = 0; sfx('wrong') }
    const record = store.setBest('inspector', S.streak)
    if (record && S.streak > 1) setTimeout(() => sfx('star'), 300)

    // Power up so the consequence shows, and mark each node the board got right.
    const netlist = netlistOf(S.c.sch)
    const ev = evaluate(netlist, S.c.parts)
    const sim = solve(S.c.parts, true)
    stage.setSim(sim)
    for (const p of S.c.parts) {
      if (p.type === 'source') stage.lcd(p.id)?.set(fmtAmps(sim.i.get(p.id)?.i ?? 0))
      if (p.type === 'meter' && p.pins.red && p.pins.black) stage.lcd(p.id)?.set(fmtVolts(sim.volts(p.pins.red) - sim.volts(p.pins.black)))
    }
    for (const p of S.c.parts) if (p.type === 'led') S.sch.setLit(p.ref, Math.min(1, (sim.i.get(p.id)?.i ?? 0) / 0.01))
    S.sch.setStatus(ev.status)
    const netOf = buildNets(S.c.parts)
    const glow = new Map()
    for (const [node, status] of Object.entries(ev.status)) {
      if (status !== 'done') continue
      for (const s of ALL_STRIPS) if (ev.nodeNet[node].includes(netOf.strip(s))) glow.set(s, { color: HUE[S.c.sch.nodes[node].color], a: 0.5 })
    }
    stage.board.setGlows(glow)
    if (f) {
      stage.setSelected(f.culprit.id)
      const marks = []
      for (const [pin, hole] of Object.entries(f.was)) if (hole !== f.culprit.pins[pin]) marks.push({ hole, color: '#35d07f', pulse: true, bright: 2 })
      const ends = Object.values(f.culprit.pins).filter(Boolean).map(holePos)
      const mid = isModule(f.culprit) ? ends[0] : { x: (ends[0].x + ends.at(-1).x) / 2, z: (ends[0].z + ends.at(-1).z) / 2 }
      marks.push({ at: { x: mid.x, y: 0, z: mid.z }, noRing: true, label: f.tag, cls: 'culprit', labelY: 2.4 })
      stage.setMarks(marks)
    }
    why.textContent = f
      ? `${ok ? 'Found it. ' : id === null ? 'There was a fault. ' : 'Not that one. '}${f.why}`
      : ok ? 'Correct. Every leg lands on the node the schematic gives it.' : 'That part was fine. This board matched the schematic.'
    why.className = `why ${ok ? 'right' : 'wrong'}`
    why.hidden = false
    pass.hidden = flag.hidden = true
    next.hidden = false
    next.focus()
    note.textContent = ''
    render()
  }

  function render() {
    st.streak.v.textContent = S.streak
    st.best.v.textContent = store.best('inspector')
    st.right.v.textContent = `${S.right}/${S.checked}`
  }

  stage.on('down', (pk) => { S.down = pk.partId ?? pk.lead?.partId ?? null })
  stage.on('move', (pk) => { if (S.state === 'ask') stage.setHovered(pk.partId) })
  stage.on('up', (pk) => {
    const id = pk.partId ?? pk.lead?.partId ?? null
    if (id === S.down) select(id)
  })
  stage.on('cancel', () => select(null))

  function onKey(e) {
    if (KEY.isTyping(e) || e.metaKey || e.ctrlKey) return
    const k = e.key.toLowerCase()
    if (k === 'x') setXray(!S.xray)
    else if (k === 'v') toggleView()
    else if (k === 'escape') (S.selected ? select(null) : nav.menu())
    else if (S.state === 'ask' && k === 'c') answer(null)
    else if (S.state === 'ask' && k === 'w' && S.selected) answer(S.selected)
    else if (S.state === 'reveal' && (k === 'enter' || k === ' ')) { e.preventDefault(); deal() }
  }
  addEventListener('keydown', onKey)
  deal()

  return {
    destroy() {
      removeEventListener('keydown', onKey)
      removeEventListener('resize', fit)
      ro.disconnect()
      for (const n of ['down', 'move', 'up', 'cancel']) stage.on(n, null)
      stage.setMarks([])
      stage.board.setGlows(new Map())
      stage.board.setXray(false)
      stage.setSelected(null)
      stage.setHovered(null)
      stage.showValues(true)
      root.remove()
    },
  }
}
