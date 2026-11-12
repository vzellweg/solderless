// Small DOM helpers shared by every screen.
import { bands } from './circuit.js'
import { BAND_HEX, LED_HEX, WIRE_HEX } from './theme.js'

const SVG_NS = 'http://www.w3.org/2000/svg'
const SVG_TAGS = new Set(['svg', 'g', 'path', 'circle', 'rect', 'line', 'text', 'polyline', 'polygon', 'tspan', 'defs', 'filter', 'feGaussianBlur', 'pattern'])

/** h('div.card', {onclick}, child, 'text', [more]) */
export function h(spec, ...rest) {
  const [tag, ...classes] = spec.split('.')
  const el = SVG_TAGS.has(tag) ? document.createElementNS(SVG_NS, tag) : document.createElement(tag || 'div')
  if (classes.length) el.setAttribute('class', classes.join(' '))
  for (const r of rest.flat(Infinity)) {
    if (r == null || r === false) continue
    if (r instanceof Node) el.append(r)
    else if (typeof r === 'object') {
      for (const [k, v] of Object.entries(r)) {
        if (v == null || v === false) continue
        if (k.startsWith('on')) el.addEventListener(k.slice(2), v)
        else if (k === 'html') el.innerHTML = v
        else if (k === 'style' && typeof v === 'object') for (const [prop, val] of Object.entries(v)) prop.startsWith('--') ? el.style.setProperty(prop, val) : (el.style[prop] = val)
        else el.setAttribute(k, v === true ? '' : v)
      }
    } else el.append(String(r))
  }
  return el
}

export const hud = () => document.getElementById('hud')

let toastTimer
export function toast(text, kind = '') {
  let el = document.querySelector('.toast')
  if (!el) { el = h('div.toast', { role: 'status' }); document.body.append(el) }
  el.textContent = text
  el.className = `toast show ${kind}`
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.classList.remove('show'), kind === 'bad' ? 5200 : 3200)
}

export function stars(n, of = 3) {
  return h('span.stars', { 'aria-label': `${n} of ${of} stars` },
    Array.from({ length: of }, (_, k) => h(`span.star${k < n ? '.on' : ''}`, '★')))
}

/** Little drawings for the parts bin. */
export function partIcon(spec) {
  const svg = h('svg.icon', { viewBox: '0 0 64 36', 'aria-hidden': 'true' })
  const lead = (x1, x2) => h('line', { x1, x2, y1: 18, y2: 18, stroke: '#aeb6bf', 'stroke-width': 2.2, 'stroke-linecap': 'round' })
  if (spec.type === 'resistor') {
    svg.append(lead(2, 62), h('rect', { x: 14, y: 9, width: 36, height: 18, rx: 8, fill: '#d9bd8e' }))
    ;[...bands(spec.ohms), 'gold'].forEach((c, k) => svg.append(h('rect', { x: [19, 25.5, 32, 42][k], y: 9, width: 3.6, height: 18, fill: BAND_HEX[c] })))
  } else if (spec.type === 'led') {
    const c = LED_HEX[spec.color]
    svg.append(
      h('line', { x1: 26, x2: 26, y1: 22, y2: 35, stroke: '#aeb6bf', 'stroke-width': 2.2 }),
      h('line', { x1: 38, x2: 38, y1: 22, y2: 31, stroke: '#aeb6bf', 'stroke-width': 2.2 }),
      h('path', { d: 'M20 24 V13 a12 12 0 0 1 24 0 V24 Z', fill: c, opacity: 0.9 }),
      h('rect', { x: 17, y: 22, width: 30, height: 4, rx: 1.5, fill: c }),
      h('text', { x: 15, y: 35, 'font-size': 10, fill: '#dfe7ea', 'font-weight': 700 }, '+'),
    )
  } else if (spec.type === 'wire' || spec.type === 'lead') {
    const c = WIRE_HEX[spec.color ?? 'yellow']
    svg.append(
      h('path', { d: 'M8 30 C 8 2, 56 2, 56 30', fill: 'none', stroke: c, 'stroke-width': 5, 'stroke-linecap': 'round' }),
      h('line', { x1: 8, x2: 8, y1: 28, y2: 35, stroke: '#cfd5db', 'stroke-width': 2.2 }),
      h('line', { x1: 56, x2: 56, y1: 28, y2: 35, stroke: '#cfd5db', 'stroke-width': 2.2 }),
    )
    if (spec.type === 'lead') svg.append(h('rect', { x: 51, y: 16, width: 10, height: 14, rx: 2, fill: c }))
  } else if (spec.type === 'pot') {
    svg.append(
      h('rect', { x: 12, y: 8, width: 40, height: 18, rx: 3, fill: '#2a63c9' }),
      h('circle', { cx: 32, cy: 17, r: 7, fill: '#e9e4d6' }),
      h('line', { x1: 32, x2: 32, y1: 17, y2: 11, stroke: '#c2362f', 'stroke-width': 2.4 }),
      ...[20, 32, 44].map((x) => h('line', { x1: x, x2: x, y1: 26, y2: 35, stroke: '#aeb6bf', 'stroke-width': 2.2 })),
    )
  } else if (spec.type === 'joystick') {
    svg.append(
      h('rect', { x: 12, y: 4, width: 40, height: 24, rx: 3, fill: '#1747b0' }),
      h('circle', { cx: 32, cy: 15, r: 9, fill: '#17181c' }),
      ...[18, 25, 32, 39, 46].map((x) => h('line', { x1: x, x2: x, y1: 28, y2: 35, stroke: '#aeb6bf', 'stroke-width': 2 })),
    )
  }
  return svg
}

export const KEY = {
  isTyping: (e) => /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) && e.target.type !== 'range',
}
