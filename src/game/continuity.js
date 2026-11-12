// Continuity: two probes on a random board. Same node, or not? A drill for
// the one skill everything else rests on: seeing which holes are joined.
import { h, hud, KEY } from '../ui.js'
import { sfx } from '../audio.js'
import { store } from '../store.js'
import { buildNets } from '../circuit.js'
import { makePart, makeWire, occupied } from '../build.js'
import { ALL_HOLES, ALL_STRIPS, COLS, ROWS_TOP, ROWS_BOT, parseHole, railHasHole, stripOf, stripHoles, isRail } from '../board.js'

const pick = (list) => list[Math.floor(Math.random() * list.length)]
const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1))
const ROUND = 60
const MISS = 5

function makeBoard(level) {
  const parts = []
  const meter = Object.assign(makePart('M1', { type: 'meter' }), { slot: 0 })
  parts.push(meter)
  const used = new Set()
  const take = (...holes) => { if (holes.some((x) => used.has(x)) || new Set(holes).size < holes.length) return false; holes.forEach((x) => used.add(x)); return true }
  const col = () => rand(2, COLS - 1)
  const mainHole = (c = col()) => pick([...ROWS_TOP, ...ROWS_BOT]) + c
  const railHole = (rail) => { let c; do c = col(); while (!railHasHole(c)); return rail + c }
  const wires = Math.min(9, 3 + Math.floor(level / 2))
  const resistors = Math.min(4, 1 + Math.floor(level / 3))
  const makers = [
    () => { const c = col(); return [`F${c}`, `E${c}`] }, // across the trench
    () => { const c = col(); const r = pick(ROWS_TOP); return [r + c, r + Math.min(COLS, c + rand(2, 7))] },
    () => { const c = col(); const r = pick(ROWS_BOT); return [r + c, r + Math.min(COLS, c + rand(2, 7))] },
    () => { const h1 = railHole(pick(['TP', 'TN'])); return [h1, pick(ROWS_TOP) + parseHole(h1).col] },
    () => { const h1 = railHole(pick(['BP', 'BN'])); return [h1, pick(ROWS_BOT) + parseHole(h1).col] },
    () => { const c = rand(2, 5); return level > 3 ? [`TP${c}`, `BP${c}`] : [mainHole(), mainHole()] },
  ]
  for (let k = 0, guard = 0; k < wires && guard < 200; guard++) {
    const [a, b] = pick(makers)()
    if (stripOf(a) === stripOf(b) || !take(a, b)) continue
    parts.push(makeWire(a, b, pick(['yellow', 'blue', 'green', 'orange', 'white', 'violet'])))
    k++
  }
  for (let k = 0, guard = 0; k < resistors && guard < 200; guard++) {
    const c = rand(2, COLS - 6)
    const r = pick([...ROWS_TOP, ...ROWS_BOT])
    const a = r + c, b = r + (c + rand(3, 5))
    if (!take(a, b)) continue
    const p = makePart(`R${k + 1}`, { type: 'resistor', ohms: pick([330, 1000, 10000]) })
    p.pins = { a, b }
    parts.push(p)
    k++
  }
  return { parts, meter }
}

/** Choose two free holes and say why they are, or are not, the same node. */
function makeQuestion(parts) {
  const netOf = buildNets(parts)
  const occ = occupied(parts)
  const free = (x) => !occ.has(x)
  const freeIn = (strip) => stripHoles(strip).filter(free)
  const wires = parts.filter((p) => p.type === 'wire')
  const res = parts.filter((p) => p.type === 'resistor')
  const col = () => rand(1, COLS)
  const kinds = [
    () => { const s = pick(['t', 'b']) + col(); const hs = freeIn(s); return hs.length > 1 ? [hs[0], hs.at(-1)] : null },
    () => { const c = col(); return [pick(freeIn('t' + c)), pick(freeIn('b' + c))] },
    () => { const c = rand(1, COLS - 1); const r = pick([...ROWS_TOP, ...ROWS_BOT]); return [r + c, r + (c + 1)] },
    () => { const rail = pick(['TP', 'TN', 'BP', 'BN']); const hs = freeIn(rail); return [hs[rand(0, 5)], hs[hs.length - 1 - rand(0, 5)]] },
    () => { const side = pick(['T', 'B']); const c = rand(2, 6) + 6 * rand(0, 3); return [`${side}P${c}`, `${side}N${c}`] },
    () => { const w = pick(wires); return w ? [pick(freeIn(stripOf(w.pins.a))), pick(freeIn(stripOf(w.pins.b)))] : null },
    () => { const w = pick(wires); return w ? [pick(freeIn(stripOf(w.pins.a))), pick(freeIn(stripOf(w.pins.b)))] : null },
    () => { const r = pick(res); return r ? [pick(freeIn(stripOf(r.pins.a))), pick(freeIn(stripOf(r.pins.b)))] : null },
    () => { const pol = pick(['P', 'N']); return [pick(freeIn('T' + pol)), pick(freeIn('B' + pol))] },
    () => { const w = pick(wires); if (!w) return null; const net = netOf(w.pins.a); const strips = ALL_STRIPS.filter((s) => netOf.strip(s) === net); return strips.length > 2 ? [pick(freeIn(strips[0])), pick(freeIn(strips.at(-1)))] : null },
  ]
  for (let guard = 0; guard < 80; guard++) {
    const q = pick(kinds)()
    if (!q || !q[0] || !q[1] || q[0] === q[1] || !free(q[0]) || !free(q[1])) continue
    const [a, b] = Math.random() < 0.5 ? q : [q[1], q[0]]
    const same = netOf(a) === netOf(b)
    return { a, b, same, ...explain(a, b, same, parts, netOf) }
  }
  return { a: 'A3', b: 'C3', same: true, why: 'Same column, same side of the trench. That is one clip.', tag: 'column' }
}

function explain(a, b, same, parts, netOf) {
  const sa = stripOf(a), sb = stripOf(b)
  const pa = parseHole(a), pb = parseHole(b)
  if (same) {
    if (sa === sb) return isRail(pa.row) ? { why: 'A rail is one long strip from end to end.', tag: 'rail' } : { why: 'Same column, same side of the trench. That is one clip.', tag: 'column' }
    const net = netOf(a)
    const n = parts.filter((p) => p.type === 'wire' && netOf(p.pins.a) === net).length
    return { why: n > 1 ? `Joined through ${n} jumpers. Follow each wire from clip to clip.` : 'A jumper wire joins those two clips into one node.', tag: 'jumper' }
  }
  if (!isRail(pa.row) && !isRail(pb.row) && pa.col === pb.col) return { why: `The trench splits column ${pa.col}. Rows A–E and F–J are separate clips.`, tag: 'trench' }
  const bridge = parts.find((p) => p.type === 'resistor' && new Set([netOf(p.pins.a), netOf(p.pins.b)]).size === 2 && [netOf(a), netOf(b)].every((n) => n === netOf(p.pins.a) || n === netOf(p.pins.b)))
  if (bridge) return { why: `${bridge.ref} links them, but a resistor is a part, not a wire. Each of its legs is a different node.`, tag: 'resistor' }
  if (pa.row === pb.row && !isRail(pa.row) && Math.abs(pa.col - pb.col) === 1) return { why: 'Holes join down a column, never along a row. Neighbours in a row are separate.', tag: 'row' }
  if (isRail(pa.row) && isRail(pb.row)) return { why: pa.row[0] === pb.row[0] ? 'The + rail and the − rail are separate strips.' : 'Top and bottom rails are not joined unless a wire bridges them.', tag: 'rails' }
  return { why: 'Nothing joins those clips. No shared strip, no jumper between them.', tag: 'apart' }
}

const TAG_WORDS = {
  trench: 'the trench', row: 'neighbours in a row', resistor: 'resistors', rails: 'the rails', jumper: 'jumper wires',
  rail: 'rails', column: 'columns', apart: 'unconnected clips',
}

export function playContinuity(stage, nav) {
  const S = { score: 0, streak: 0, best: 0, time: ROUND, asked: 0, right: 0, level: 0, onBoard: 0, q: null, state: 'intro', missed: {}, parts: [], meter: null }
  const stat = (k) => { const v = h('span.stat-v', '0'); return { el: h('div.stat', h('span.stat-k', k), v), v } }
  const st = { score: stat('Score'), streak: stat('Streak'), time: stat('Seconds') }
  const why = h('p.why', { role: 'status', hidden: true })
  const no = h('button.answer', { type: 'button', onclick: () => answer(false) }, 'Different', h('kbd', '←'))
  const yes = h('button.answer.yes', { type: 'button', onclick: () => answer(true) }, 'Same node', h('kbd', '→'))
  const bar = h('div.answer-bar', { hidden: true }, no, yes)
  const card = h('div.card-wrap')
  const root = h('div.arcade',
    h('button.tool.back', { type: 'button', onclick: () => nav.menu() }, 'Menu'),
    h('div.hud-top', st.score.el, st.streak.el, st.time.el),
    why, bar, card,
  )
  hud().append(root)
  document.documentElement.style.setProperty('--free-left', '0px')
  stage.setInsets({ left: 0, right: 0, top: 84, bottom: 120 })
  stage.view('bench')
  stage.showValues(false)
  stage.showLeadTags(false)

  function intro() {
    card.replaceChildren(h('div.card', { role: 'dialog', 'aria-label': 'Continuity' },
      h('h2', 'Continuity'),
      h('p.done-text', 'The meter’s two probes land on the board. Decide whether they are on the same node, the way a continuity beeper would.'),
      h('p.done-text', 'Sixty seconds. A wrong call costs five. Right calls in a row multiply your score.'),
      h('div.card-actions', h('button.btn.primary', { type: 'button', onclick: start }, 'Start'), h('button.btn.ghost', { type: 'button', onclick: () => nav.menu() }, 'Menu')),
    ))
    card.querySelector('.primary').focus()
    newBoard()
    stage.setMarks([])
  }

  function start() {
    Object.assign(S, { score: 0, streak: 0, best: 0, time: ROUND, asked: 0, right: 0, level: 0, missed: {}, state: 'ask' })
    card.replaceChildren()
    bar.hidden = false
    sfx('power')
    newBoard()
    ask()
  }

  function newBoard() {
    const b = makeBoard(S.level)
    S.parts = b.parts
    S.meter = b.meter
    S.onBoard = 0
    stage.board.setGlows(new Map())
    stage.board.setXray(false)
    stage.sync(S.parts, 1)
    stage.setSim(null)
  }

  function ask() {
    if (S.onBoard >= 5) { S.level++; newBoard() }
    S.onBoard++
    S.q = makeQuestion(S.parts)
    S.meter.pins = { red: S.q.a, black: S.q.b }
    stage.sync(S.parts, 1)
    stage.lcd(S.meter.id)?.set('?')
    stage.setMarks([
      { hole: S.q.a, color: '#ff4f58', pulse: true, label: 'A', cls: 'probe a' },
      { hole: S.q.b, color: '#ffffff', pulse: true, label: 'B', cls: 'probe b' },
    ])
    stage.board.setGlows(new Map())
    stage.board.setXray(false)
    why.hidden = true
    S.state = 'ask'
    sfx('tick')
    render()
  }

  function answer(same) {
    if (S.state !== 'ask') return
    const q = S.q
    const ok = same === q.same
    S.asked++
    S.state = 'reveal'
    ;(same ? yes : no).classList.add('press')
    setTimeout(() => { yes.classList.remove('press'); no.classList.remove('press') }, 140)
    if (ok) {
      S.right++
      S.streak++
      S.best = Math.max(S.best, S.streak)
      S.score += 10 * Math.min(5, 1 + Math.floor((S.streak - 1) / 3))
      sfx(q.same ? 'beep' : 'right')
    } else {
      S.streak = 0
      S.time = Math.max(0, S.time - MISS)
      S.missed[q.tag] = (S.missed[q.tag] ?? 0) + 1
      sfx('wrong')
    }
    // Show the truth: light each probe's node.
    const netOf = buildNets(S.parts)
    const glow = new Map()
    for (const s of ALL_STRIPS) {
      const n = netOf.strip(s)
      if (n === netOf(q.a)) glow.set(s, { color: q.same ? '#35d07f' : '#ff4f58', a: 0.8 })
      else if (n === netOf(q.b)) glow.set(s, { color: '#4a94ff', a: 0.8 })
    }
    stage.board.setGlows(glow)
    stage.board.setXray(!ok)
    stage.lcd(S.meter.id)?.set(q.same ? 'BEEP' : 'OPEN')
    why.textContent = `${ok ? '' : q.same ? 'Same node. ' : 'Different nodes. '}${q.why}`
    why.className = `why ${ok ? 'right' : 'wrong'}`
    why.hidden = false
    render()
    setTimeout(() => { if (S.state === 'reveal') (S.time <= 0 ? finish() : ask()) }, ok ? 750 : 2600)
  }

  function finish() {
    S.state = 'over'
    bar.hidden = true
    why.hidden = true
    stage.setMarks([])
    const record = store.setBest('continuity', S.score)
    sfx(record ? 'win' : 'off')
    const worst = Object.entries(S.missed).sort((a, b) => b[1] - a[1])[0]
    card.replaceChildren(h('div.card', { role: 'dialog', 'aria-label': 'Round over' },
      h('h2', record ? 'New best' : 'Time'),
      h('p.done-text', `${S.score} points. ${S.right} of ${S.asked} right, longest run ${S.best}.`),
      worst && h('p.verdict.wrong', h('strong', 'Watch for '), `${TAG_WORDS[worst[0]]}. That tripped you ${worst[1] === 1 ? 'once' : `${worst[1]} times`}.`),
      !worst && S.asked > 0 && h('p.verdict.right', 'Not a single miss.'),
      h('div.card-actions', h('button.btn.primary', { type: 'button', onclick: start }, 'Go again'), h('button.btn.ghost', { type: 'button', onclick: () => nav.menu() }, 'Menu')),
    ))
    card.querySelector('.primary').focus()
    render()
  }

  function render() {
    st.score.v.textContent = S.score
    const mult = Math.min(5, 1 + Math.floor(Math.max(0, S.streak - 1) / 3))
    st.streak.v.textContent = mult > 1 ? `${S.streak} ×${mult}` : S.streak
    st.time.v.textContent = Math.ceil(S.time)
    st.time.el.classList.toggle('low', S.time <= 10)
  }

  const off = stage.onFrame((dt) => {
    if (S.state !== 'ask') return
    S.time -= dt
    if (S.time <= 0) { S.time = 0; finish() }
    st.time.v.textContent = Math.ceil(S.time)
    st.time.el.classList.toggle('low', S.time <= 10)
  })

  function onKey(e) {
    if (KEY.isTyping(e) || e.metaKey || e.ctrlKey) return
    if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'a') { e.preventDefault(); answer(false) }
    else if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'd') { e.preventDefault(); answer(true) }
    else if (e.key === 'Escape') nav.menu()
  }
  addEventListener('keydown', onKey)
  intro()

  return {
    destroy() {
      S.state = 'gone'
      removeEventListener('keydown', onKey)
      off()
      stage.setMarks([])
      stage.board.setGlows(new Map())
      stage.board.setXray(false)
      stage.showValues(true)
      stage.showLeadTags(true)
      root.remove()
    },
  }
}

export { ALL_HOLES }
