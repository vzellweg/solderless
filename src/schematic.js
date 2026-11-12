// Draws a level's schematic as SVG. Nodes are drawn like the course
// diagrams mark them: a highlighter stroke over the wire.
import { h } from './ui.js'
import { HUE, LED_HEX } from './theme.js'
import { schTerminals } from './circuit.js'

const U = 40
const INK = '#18242e'

export function createSchematic(sch, specs = {}) {
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
  const grow = (x, y, pad = 0) => {
    box.x0 = Math.min(box.x0, x - pad); box.y0 = Math.min(box.y0, y - pad)
    box.x1 = Math.max(box.x1, x + pad); box.y1 = Math.max(box.y1, y + pad)
  }
  const P = ([x, y]) => [x * U, y * U]
  const line = (a, b, cls = 'ink') => { grow(...a); grow(...b); return h(`line.${cls}`, { x1: a[0], y1: a[1], x2: b[0], y2: b[1] }) }
  const text = (str, x, y, anchor = 'middle', cls = 'lbl') => {
    const w = str.length * 7.4
    grow(anchor === 'end' ? x - w : anchor === 'start' ? x : x - w / 2, y - 12)
    grow(anchor === 'end' ? x : anchor === 'start' ? x + w : x + w / 2, y + 4)
    return h(`text.${cls}`, { x, y, 'text-anchor': anchor }, str)
  }

  const nodeEls = {}
  const partEls = {}
  const ledEls = {}
  const gNodes = h('g')
  const gParts = h('g')
  const gDecor = h('g')

  for (const b of sch.boxes ?? []) {
    const [x0, y0, x1, y1] = b.rect.map((v) => v * U)
    grow(x0, y0); grow(x1, y1)
    gDecor.append(h('rect.dashed', { x: x0, y: y0, width: x1 - x0, height: y1 - y0, rx: 8 }))
    if (b.label) gDecor.append(text(b.label, x1 - 8, y1 - 9, 'end', 'lbl note'))
  }

  // ------------------------------------------------------------ nodes
  for (const [name, nd] of Object.entries(sch.nodes)) {
    let d = ''
    for (const w of nd.wires ?? []) {
      w.forEach((pt, k) => {
        const [x, y] = P(pt)
        grow(x, y)
        if (!k) { d += `M${x} ${y}`; return }
        const [px, py] = P(w[k - 1])
        const hops = (nd.hops ?? []).map(P).filter(([hx, hy]) => Math.abs(hy - y) < 0.5 && Math.abs(py - y) < 0.5 && hx > Math.min(px, x) && hx < Math.max(px, x))
        const dir = Math.sign(x - px)
        hops.sort((a, b) => (a[0] - b[0]) * dir)
        for (const [hx] of hops) d += `L${hx - 7 * dir} ${y}A7 7 0 0 ${dir > 0 ? 1 : 0} ${hx + 7 * dir} ${y}`
        d += `L${x} ${y}`
      })
    }
    const g = h('g.node', { 'data-node': name, style: { '--hue': HUE[nd.color] } })
    if (d) g.append(h('path.halo', { d }), h('path.ink', { d }))
    for (const pt of nd.pts ?? []) { const [x, y] = P(pt); grow(x, y); g.append(h('circle.halo-dot', { cx: x, cy: y, r: 11 })) }
    for (const pt of nd.dots ?? []) { const [x, y] = P(pt); g.append(h('circle.dot', { cx: x, cy: y, r: 4.2 })) }
    for (const pt of nd.grounds ?? []) {
      const [x, y] = P(pt)
      g.append(line([x - 13, y], [x + 13, y]), line([x - 8, y + 6], [x + 8, y + 6]), line([x - 3.5, y + 12], [x + 3.5, y + 12]))
      grow(x, y + 16)
    }
    g.append(h('path.hit', { d: d || 'M0 0' }))
    for (const pt of nd.pts ?? []) { const [x, y] = P(pt); g.append(h('circle.hit-dot', { cx: x, cy: y, r: 14 })) }
    nodeEls[name] = g
    gNodes.append(g)
  }

  // ------------------------------------------------------------ parts
  for (const part of sch.parts) {
    const [ref, type, a0, b0, o = {}] = part
    const g = h('g.part', { 'data-ref': ref })
    partEls[ref] = g
    gParts.append(g)
    if (type === 'mcu') {
      const [x0, y0] = P(a0), [x1, y1] = P(b0)
      grow(x0, y0); grow(x1, y1)
      g.append(h('rect.chip', { x: x0, y: y0, width: x1 - x0, height: y1 - y0, rx: 3 }))
      g.append(text(o.label ?? ref, x0 + 10, y0 + 22, 'start', 'lbl ref'))
      for (const [pin, pt] of Object.entries(o.pins)) {
        const [x, y] = P(pt)
        g.append(text(o.names?.[pin] ?? pin, x - 9, y + 4.5, 'end', 'lbl pin'))
      }
      continue
    }
    const a = P(a0), b = P(b0)
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    const d = [(b[0] - a[0]) / len, (b[1] - a[1]) / len]
    const n = [-d[1], d[0]]
    const c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    const at = (along, side = 0) => [c[0] + d[0] * along + n[0] * side, c[1] + d[1] * along + n[1] * side]
    const horiz = Math.abs(d[0]) > 0.5
    const side = horiz ? [0, -1] : o.labelSide === 'left' ? [-1, 0] : [1, 0]
    const away = (side[0] * n[0] + side[1] * n[1]) > 0 ? -1 : 1 // normal side facing away from the label
    let half = 0

    if (type === 'resistor' || type === 'pot') {
      half = 0.75 * U
      const pts = [at(-half)]
      for (let k = 0; k < 6; k++) pts.push(at(-half + ((k + 0.5) / 6) * 2 * half, (k % 2 ? 1 : -1) * 0.24 * U))
      pts.push(at(half))
      g.append(h('polyline.ink', { points: pts.map((p) => p.join(',')).join(' ') }))
      if (type === 'pot') {
        const w = P(o.w)
        const ws = Math.sign((w[0] - c[0]) * n[0] + (w[1] - c[1]) * n[1]) || 1
        const tip = at(0, ws * 0.3 * U)
        g.append(line(w, tip))
        const back = [tip[0] + n[0] * ws * 9, tip[1] + n[1] * ws * 9]
        g.append(h('polygon.fill', { points: [tip, [back[0] + d[0] * 5, back[1] + d[1] * 5], [back[0] - d[0] * 5, back[1] - d[1] * 5]].map((p) => p.join(',')).join(' ') }))
      }
    } else if (type === 'source') {
      half = 0.55 * U
      g.append(h('circle.ink.paper', { cx: c[0], cy: c[1], r: half }))
      const p = at(-half * 0.45), m = at(half * 0.45)
      g.append(line([p[0] - 6, p[1]], [p[0] + 6, p[1]]), line([p[0], p[1] - 6], [p[0], p[1] + 6]), line([m[0] - 6, m[1]], [m[0] + 6, m[1]]))
    } else if (type === 'led') {
      half = 0.3 * U
      const tri = [at(-half, 0.32 * U), at(-half, -0.32 * U), at(half)]
      const fill = h('polygon.ink.led', { points: tri.map((p) => p.join(',')).join(' ') })
      ledEls[ref] = fill
      g.append(fill, line(at(half, 0.32 * U), at(half, -0.32 * U)))
      for (const off of [-0.12, 0.2]) {
        const s = at(off * U, away * 0.42 * U), e = at((off + 0.2) * U, away * 0.72 * U)
        const ux = (e[0] - s[0]) / Math.hypot(e[0] - s[0], e[1] - s[1]), uy = (e[1] - s[1]) / Math.hypot(e[0] - s[0], e[1] - s[1])
        g.append(line(s, e, 'ink thin'))
        g.append(h('polygon.fill', { points: [e, [e[0] - ux * 6 - uy * 3, e[1] - uy * 6 + ux * 3], [e[0] - ux * 6 + uy * 3, e[1] - uy * 6 - ux * 3]].map((p) => p.join(',')).join(' ') }))
      }
    } else if (type === 'meter' && !o.tags) {
      half = 0.45 * U
      g.append(h('circle.ink.paper', { cx: c[0], cy: c[1], r: half }), text('V', c[0], c[1] + 5.5, 'middle', 'lbl ref'))
      const p = at(-half - 9, -10)
      g.append(text('+', p[0], p[1] + 4, 'middle', 'lbl probe'))
    } else if (type === 'meter') {
      g.append(text('+', a[0] + 8, a[1] + 24, 'middle', 'lbl probe'), text('−', b[0] - 8, b[1] + 24, 'middle', 'lbl probe'))
      g.append(text(o.tags, c[0], c[1] + 40, 'middle', 'lbl probe vx'))
      g.classList.add('meter')
      continue
    }
    g.append(line(a, at(-half)), line(at(half), b))
    if (type !== 'meter') {
      const value = o.label ?? ''
      if (horiz) {
        const t = text(`${ref} ${value}`.trim(), c[0], c[1] - 0.56 * U, 'middle')
        t.textContent = ''
        t.append(h('tspan.ref', ref), value ? ` ${value}` : '')
        g.append(t)
      } else {
        // Beside an upright part the label stacks: name over value.
        const lx = c[0] + side[0] * (type === 'source' ? 0.8 : 0.5) * U
        const ly = c[1] + (o.labelDy ?? 0) * U + (value ? -3 : 4.5)
        const t = text(value.length > ref.length ? value : ref, lx, ly, side[0] < 0 ? 'end' : 'start')
        t.textContent = ''
        t.append(h('tspan.ref', { x: lx }, ref))
        if (value) { t.append(h('tspan', { x: lx, dy: 15 }, value)); grow(lx, ly + 18) }
        g.append(t)
      }
    }
    g.append(h('rect.hit', { x: Math.min(a[0], b[0]) - 14, y: Math.min(a[1], b[1]) - 14, width: Math.abs(b[0] - a[0]) + 28, height: Math.abs(b[1] - a[1]) + 28 }))
  }

  const pad = 16
  const svg = h('svg.schematic', {
    viewBox: `${box.x0 - pad} ${box.y0 - pad} ${box.x1 - box.x0 + pad * 2} ${box.y1 - box.y0 + pad * 2}`,
    role: 'img', 'aria-label': 'Circuit schematic',
  }, gDecor, gNodes, gParts)

  let onNode = () => {}
  let onPart = () => {}
  for (const [name, g] of Object.entries(nodeEls)) {
    g.addEventListener('pointerenter', () => onNode(name))
    g.addEventListener('pointerleave', () => onNode(null))
  }
  for (const [ref, g] of Object.entries(partEls)) {
    g.addEventListener('pointerenter', () => onPart(ref))
    g.addEventListener('pointerleave', () => onPart(null))
  }

  return {
    el: svg,
    terminals: () => sch.parts.flatMap((p) => schTerminals(p).map(([pin]) => `${p[0]}.${pin}`)),
    /** status: {node: 'empty' | 'partial' | 'conflict' | 'done'} */
    setStatus(status) { for (const [n, g] of Object.entries(nodeEls)) g.dataset.state = status[n] ?? 'empty' },
    setHover(names) { for (const [n, g] of Object.entries(nodeEls)) g.classList.toggle('hover', names.includes(n)) },
    setPlaced(refs) { for (const [r, g] of Object.entries(partEls)) g.classList.toggle('todo', !refs.has(r)) },
    setHotPart(ref) { for (const [r, g] of Object.entries(partEls)) g.classList.toggle('hot', r === ref) },
    setLit(ref, level) {
      const el = ledEls[ref]
      if (!el) return
      const color = LED_HEX[specs[ref]?.color ?? 'red']
      el.style.fill = level > 0.03 ? color : ''
      el.style.filter = level > 0.03 ? `drop-shadow(0 0 ${3 + level * 7}px ${color})` : ''
    },
    onNode(fn) { onNode = fn },
    onPart(fn) { onPart = fn },
  }
}

export { INK }
