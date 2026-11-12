// Meshes for everything that plugs into the board. Each builder returns a
// group whose userData carries the paths current takes through the part,
// so the flow animation can follow real geometry.
import * as THREE from 'three'
import { holePos, parseHole, ROW_Z } from '../board.js'
import { bands, fmtOhms, PINS } from '../circuit.js'
import { BAND_HEX, WIRE_HEX, LED_HEX } from '../theme.js'

const V3 = (x, y, z) => new THREE.Vector3(x, y, z)
const H = (id, y = 0) => { const p = holePos(id); return V3(p.x, y, p.z) }
const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const UP = V3(0, 1, 0)

const metal = () => new THREE.MeshStandardMaterial({ color: '#d4d8dd', metalness: 1, roughness: 0.28 })
const plastic = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.02, ...o })

function tube(points, radius, material, tension = 0.5) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', tension)
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(10, points.length * 7), radius, 8), material)
  mesh.castShadow = true
  mesh.userData.pts = curve.getSpacedPoints(Math.max(8, points.length * 5))
  return mesh
}

function box(w, h, d, material, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
  m.position.set(x, y, z)
  m.castShadow = true
  return m
}

function cyl(r, h, material, x, y, z, seg = 20) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), material)
  m.position.set(x, y, z)
  m.castShadow = true
  return m
}

function pin(id, top = 0.3) {
  const p = holePos(id)
  return cyl(0.065, top + 0.32, metal(), p.x, (top - 0.32) / 2, p.z, 8)
}

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const g = c.getContext('2d')
  draw(g, w, h)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  tex.userData.g = g
  return tex
}

const FONT = '"Recursive Variable", ui-monospace, monospace'

let glowTex
function glowSprite(color) {
  glowTex ??= canvasTex(128, 128, (g) => {
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64)
    gr.addColorStop(0, 'rgba(255,255,255,1)')
    gr.addColorStop(0.25, 'rgba(255,255,255,.45)')
    gr.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = gr
    g.fillRect(0, 0, 128, 128)
  })
  glowTex.userData.shared = true
  const mat = new THREE.SpriteMaterial({ map: glowTex, color, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true, toneMapped: false })
  return new THREE.Sprite(mat)
}

// ------------------------------------------------------------ resistor

function resistor(part, g) {
  const A = H(part.pins.a), B = H(part.pins.b)
  const L = A.distanceTo(B)
  const dir = B.clone().sub(A).normalize()
  const mid = A.clone().lerp(B, 0.5)
  const len = clamp(L * 0.62, 0.9, 2.6)
  const k = len < 1.5 ? 0.78 : 1
  const r = 0.31 * k
  const y = r + 0.1
  const half = len / 2
  const s = mid.clone().addScaledVector(dir, -half).setY(y)
  const e = mid.clone().addScaledVector(dir, half).setY(y)
  const bend = Math.min(0.32, (L - len) / 2 * 0.7)
  const leadA = tube([A.clone().setY(-0.3), A.clone().setY(y * 0.4), A.clone().addScaledVector(dir, bend).setY(y), s], 0.06, metal())
  const leadB = tube([e, B.clone().addScaledVector(dir, -bend).setY(y), B.clone().setY(y * 0.4), B.clone().setY(-0.3)], 0.06, metal())
  g.add(leadA, leadB)

  const prof = [[0, -1], [0.62, -1], [1, -0.86], [1, -0.56], [0.8, -0.4], [0.8, 0.4], [1, 0.56], [1, 0.86], [0.62, 1], [0, 1]]
    .map(([px, py]) => new THREE.Vector2(px * r, py * half))
  const body = new THREE.Group()
  const shell = new THREE.Mesh(new THREE.LatheGeometry(prof, 24), plastic('#d9bd8e', { roughness: 0.42 }))
  shell.castShadow = true
  body.add(shell)
  const cols = [...bands(part.ohms), 'gold']
  const at = [-0.71, -0.24, 0.06, 0.71]
  cols.forEach((c, i) => {
    const fat = Math.abs(at[i]) > 0.5
    const band = cyl((fat ? 1 : 0.8) * r + 0.006, half * (fat ? 0.2 : 0.17), plastic(BAND_HEX[c], { roughness: 0.4 }), 0, at[i] * half, 0, 24)
    band.castShadow = false
    body.add(band)
  })
  body.position.copy(mid).setY(y)
  body.quaternion.setFromUnitVectors(UP, dir)
  g.add(body)
  g.userData.paths = { i: [...leadA.userData.pts, ...leadB.userData.pts] }
  g.userData.labelAt = mid.clone().setY(y + r + 0.25)
  g.userData.label = part.ref
  g.userData.sub = fmtOhms(part.ohms)
  g.userData.tint = [shell.material]
}

// ----------------------------------------------------------------- LED

function led(part, g) {
  const A = H(part.pins.a), K = H(part.pins.k)
  const dir = K.clone().sub(A).normalize()
  const mid = A.clone().lerp(K, 0.5)
  const base = 0.78
  const color = new THREE.Color(LED_HEX[part.color])
  const legA = tube([A.clone().setY(-0.3), A.clone().setY(0.22), mid.clone().addScaledVector(dir, -0.15).setY(base - 0.22), mid.clone().addScaledVector(dir, -0.15).setY(base + 0.05)], 0.055, metal())
  const legK = tube([mid.clone().addScaledVector(dir, 0.15).setY(base + 0.05), mid.clone().addScaledVector(dir, 0.15).setY(base - 0.22), K.clone().setY(0.22), K.clone().setY(-0.3)], 0.055, metal())
  g.add(legA, legK)

  const lens = new THREE.MeshStandardMaterial({
    color: part.burned ? '#2a2422' : color.clone().multiplyScalar(0.55), roughness: 0.18, metalness: 0,
    transparent: true, opacity: part.burned ? 0.95 : 0.86, emissive: color, emissiveIntensity: 0,
  })
  const head = new THREE.Group()
  const rim = cyl(0.52, 0.12, lens, 0, 0.06, 0, 28)
  const barrel = cyl(0.42, 0.62, lens, 0, 0.43, 0, 28)
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.42, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), lens)
  dome.position.y = 0.74
  dome.castShadow = true
  head.add(rim, barrel, dome)
  head.position.copy(mid).setY(base)
  g.add(head)

  const glow = glowSprite(color)
  glow.position.copy(mid).setY(base + 0.6)
  glow.scale.setScalar(0.01)
  glow.renderOrder = 20
  g.add(glow)
  const light = new THREE.PointLight(color, 0, 14, 1.6)
  light.position.copy(mid).setY(base + 1.4)
  g.add(light)

  g.userData.paths = { i: [...legA.userData.pts, ...legK.userData.pts] }
  g.userData.labelAt = mid.clone().setY(base + 1.5)
  g.userData.label = part.ref
  g.userData.plusAt = A.clone().addScaledVector(dir, -0.42).setY(0.15)
  g.userData.led = { lens, glow, light, level: 0, burned: part.burned, top: mid.clone().setY(base + 0.9) }
  g.userData.tint = [lens]
}

// ---------------------------------------------------------------- wire

function wire(part, g) {
  const A = H(part.pins.a), B = H(part.pins.b)
  const L = A.distanceTo(B)
  const dir = B.clone().sub(A).normalize()
  const side = V3(-dir.z, 0, dir.x)
  const h = clamp(0.5 + L * 0.13, 0.6, 2.9)
  const wob = (((part.id.length * 7 + (part.pins.a.charCodeAt(0) + part.pins.b.charCodeAt(1)) * 13) % 10) / 10 - 0.5) * 0.3
  const mid = A.clone().lerp(B, 0.5).setY(0.3 + h).addScaledVector(side, wob)
  const near = Math.min(0.5, L * 0.12)
  const ins = tube([
    A.clone().setY(0.28),
    A.clone().addScaledVector(dir, near * 0.3).setY(0.3 + h * 0.62),
    mid,
    B.clone().addScaledVector(dir, -near * 0.3).setY(0.3 + h * 0.62),
    B.clone().setY(0.28),
  ], 0.115, plastic(WIRE_HEX[part.color] ?? WIRE_HEX.yellow, { roughness: 0.38 }))
  g.add(ins, pin(part.pins.a), pin(part.pins.b))
  g.userData.paths = { i: [A.clone().setY(-0.3), ...ins.userData.pts, B.clone().setY(-0.3)] }
  g.userData.tint = [ins.material]
}

// ----------------------------------------------------------------- pot

function pot(part, g) {
  const pa = H(part.pins.a), pw = H(part.pins.w), pb = H(part.pins.b)
  for (const id of Object.values(part.pins)) g.add(pin(id, 0.25))
  const body = box(2.75, 1.05, 1.35, plastic('#2a63c9', { roughness: 0.4 }), pw.x, 0.72, pw.z)
  g.add(body)
  const knob = new THREE.Group()
  knob.add(cyl(0.52, 0.3, plastic('#e9e4d6', { roughness: 0.35 }), 0, 0.15, 0, 28))
  knob.add(box(0.12, 0.08, 0.5, plastic('#c2362f'), 0, 0.32, -0.26))
  knob.position.set(pw.x, 1.25, pw.z)
  g.add(knob)
  const up = (p) => [p.clone().setY(-0.3), p.clone().setY(0.55)]
  g.userData.paths = {
    ia: [...up(pa), ...up(pw).reverse()],
    ib: [...up(pw), ...up(pb).reverse()],
  }
  g.userData.labelAt = pw.clone().setY(2)
  g.userData.label = part.ref
  g.userData.sub = fmtOhms(part.ohms)
  g.userData.knob = knob
  g.userData.tint = [body.material]
}

// ------------------------------------------------------------ joystick

function joystick(part, g) {
  const pts = PINS.joystick.map((n) => H(part.pins[n]))
  const cx = pts[2].x, z = pts[0].z
  const away = z < 0 ? -1 : 1
  for (const id of Object.values(part.pins)) g.add(pin(id, 0.3))
  g.add(box(5.1, 0.7, 0.55, plastic('#16181c'), cx, 0.6, z))
  const zc = z + away * 2.75
  const face = canvasTex(512, 512, (c, w, h) => {
    c.fillStyle = '#1747b0'; c.fillRect(0, 0, w, h)
    c.fillStyle = '#e9eefc'
    c.font = `600 30px ${FONT}`
    c.textAlign = 'center'
    const y = away < 0 ? h - 26 : 46
    ;['Vcc', 'Xout', 'Yout', 'Sel', 'GND'].forEach((t, k) => c.fillText(t, w / 2 + (k - 2) * (w / 6.5), y))
    c.font = `500 22px ${FONT}`
    c.fillText('Analog thumb joystick', w / 2, away < 0 ? 40 : h - 30)
    c.strokeStyle = '#e9eefc'; c.lineWidth = 4
    for (const [x, yy] of [[40, 40], [w - 40, 40], [40, h - 40], [w - 40, h - 40]]) { c.beginPath(); c.arc(x, yy, 16, 0, 7); c.stroke() }
  })
  const pcbMat = plastic('#1747b0', { roughness: 0.45 })
  const pcb = new THREE.Mesh(new THREE.BoxGeometry(6.5, 0.16, 6.4), [pcbMat, pcbMat, new THREE.MeshStandardMaterial({ map: face, roughness: 0.45 }), pcbMat, pcbMat, pcbMat])
  pcb.position.set(cx, 1.02, zc)
  pcb.castShadow = true
  g.add(pcb)
  g.add(box(3.5, 1.2, 3.5, plastic('#1d1f24', { roughness: 0.5 }), cx, 1.7, zc - away * 0.1))
  const stick = new THREE.Group()
  stick.add(cyl(0.38, 1.3, plastic('#101114'), 0, 0.65, 0))
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.35, 0.5, 40), plastic('#17181c', { roughness: 0.75 }))
  cap.position.y = 1.5
  cap.castShadow = true
  const crown = new THREE.Mesh(new THREE.SphereGeometry(1.5, 40, 12, 0, Math.PI * 2, 0, Math.PI / 2), cap.material)
  crown.scale.y = 0.22
  crown.position.y = 1.75
  stick.add(cap, crown)
  stick.position.set(cx, 2.2, zc - away * 0.1)
  g.add(stick)
  const hop = (a, b) => [a.clone().setY(-0.3), a.clone().setY(0.9), b.clone().setY(0.9), b.clone().setY(-0.3)]
  g.userData.paths = { xa: hop(pts[0], pts[1]), xb: hop(pts[1], pts[4]), ya: hop(pts[0], pts[2]), yb: hop(pts[2], pts[4]) }
  g.userData.stick = stick
  g.userData.labelAt = V3(cx, 4.2, zc)
  g.userData.label = part.ref
  g.userData.tint = [pcbMat]
}

// ------------------------------------------------------------- modules

export const MODULE_X = -20.5
const POST_X = -17.75
export const moduleZ = (slot, count) => (count === 1 ? [-4.6] : count === 2 ? [-5, 3.6] : [-6.4, 0, 6.4])[slot]

const LEAD_INFO = {
  source: { pos: ['red', '+', -1.1], neg: ['black', '−', 1.1] },
  meter: { red: ['red', 'V', -1.1], black: ['black', 'COM', 1.1] },
  mcu: { '3v3': ['red', '3V3', -1.95], pc2: ['yellow', 'PC2', -0.65], pc3: ['blue', 'PC3', 0.65], gnd: ['black', 'GND', 1.95] },
}
export const leadInfo = (part, pinName) => {
  const [color, label] = LEAD_INFO[part.type][pinName]
  return { color, label }
}

/** Where an unplugged lead waits, so it can be picked up. */
export function parkedAt(part, pinName, count) {
  const dz = LEAD_INFO[part.type][pinName][2]
  return V3(-16.75, 0.55, moduleZ(part.slot, count) + dz)
}

function moduleBody(part, g, zc) {
  if (part.type === 'source') {
    const tex = canvasTex(512, 400, (c, w, h) => {
      c.fillStyle = '#2b2f36'; c.fillRect(0, 0, w, h)
      c.fillStyle = '#b9bfc8'; c.font = `800 120px ${FONT}`; c.textAlign = 'left'
      c.fillText(`${part.volts} V`, 34, 150)
      c.font = `500 34px ${FONT}`; c.fillStyle = '#7d8591'
      c.fillText(`${part.ref}  DC supply`, 38, 205)
      c.fillStyle = '#ff5a64'; c.font = `800 70px ${FONT}`; c.fillText('+', w - 86, 120)
      c.fillStyle = '#8fb2ff'; c.fillText('−', w - 86, h - 64)
    })
    const side = plastic('#2b2f36', { roughness: 0.6 })
    const body = new THREE.Mesh(new THREE.BoxGeometry(5.2, 1.5, 4.7), [side, side, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }), side, side, side])
    body.position.set(MODULE_X, -0.2, zc)
    body.castShadow = true
    g.add(body)
    g.userData.lcd = makeLcd(g, MODULE_X - 0.4, 0.56, zc + 1.2, 3.3, 1.2)
  } else if (part.type === 'meter') {
    const body = box(4.6, 1.3, 4.9, plastic('#f0b41c', { roughness: 0.5 }), MODULE_X + 0.3, -0.3, zc)
    g.add(body)
    g.add(box(4.1, 0.1, 4.4, plastic('#2a2d33'), MODULE_X + 0.3, 0.37, zc))
    g.userData.lcd = makeLcd(g, MODULE_X + 0.3, 0.43, zc - 1, 3.5, 1.45)
    const dial = cyl(0.95, 0.3, plastic('#16181b'), MODULE_X + 0.3, 0.5, zc + 1.1, 32)
    g.add(dial, box(0.16, 0.1, 0.9, plastic('#e9ebee'), MODULE_X + 0.6, 0.68, zc + 0.9))
  } else {
    const tex = canvasTex(512, 640, (c, w, h) => {
      c.fillStyle = '#b9bdc4'; c.fillRect(0, 0, w, h)
      c.fillStyle = '#16181c'
      c.fillRect(150, 230, 190, 190)
      c.fillRect(60, 40, 300, 34); c.fillRect(60, h - 74, 300, 34)
      c.fillStyle = '#0d4fa8'; c.font = `800 44px ${FONT}`; c.fillText('Nucleo-64', 60, 150)
      c.font = `500 26px ${FONT}`; c.fillStyle = '#4b5563'; c.fillText('STM32', 60, 186)
      c.textAlign = 'right'; c.font = `700 32px ${FONT}`; c.fillStyle = '#16181c'
      for (const [, label, dz] of Object.values(LEAD_INFO.mcu)) c.fillText(label, w - 44, h / 2 + dz / 6.3 * h + 11)
    })
    const side = plastic('#b0b4bb', { roughness: 0.5 })
    const body = new THREE.Mesh(new THREE.BoxGeometry(5, 0.3, 6.3), [side, side, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 }), side, side, side])
    body.position.set(MODULE_X + 0.2, -0.78, zc)
    body.castShadow = true
    g.add(body)
  }
}

function makeLcd(g, x, y, z, w, d) {
  const tex = canvasTex(256, Math.round(256 * d / w), () => {})
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }))
  mesh.rotation.x = -Math.PI / 2
  mesh.position.set(x, y, z)
  g.add(mesh)
  const lcd = {
    text: null,
    set(text) {
      if (text === this.text) return
      this.text = text
      const c = tex.userData.g
      const { width: cw, height: ch } = c.canvas
      c.fillStyle = '#b4c0a2'; c.fillRect(0, 0, cw, ch)
      c.fillStyle = '#1c2418'; c.textAlign = 'right'; c.textBaseline = 'middle'
      c.font = `700 ${ch * 0.6}px ${FONT}`
      c.fillText(text, cw - 14, ch / 2 + 3)
      tex.needsUpdate = true
    },
  }
  lcd.set('')
  return lcd
}

function moduleMesh(part, g, count) {
  const zc = moduleZ(part.slot, count)
  moduleBody(part, g, zc)
  g.userData.paths = {}
  g.userData.tips = []
  for (const name of PINS[part.type]) {
    const [color, , dz] = LEAD_INFO[part.type][name]
    const post = V3(POST_X, part.type === 'mcu' ? -0.35 : 0.55, zc + dz)
    if (part.type !== 'mcu') g.add(cyl(0.3, 0.5, plastic(WIRE_HEX[color], { roughness: 0.35 }), post.x, 0.5, post.z, 18))
    else g.add(box(0.5, 0.5, 0.5, plastic('#16181c'), post.x, -0.4, post.z))
    const hole = part.pins[name]
    const end = hole ? H(hole, 0.5) : parkedAt(part, name, count)
    const L = post.distanceTo(end)
    const dir = end.clone().sub(post).setY(0).normalize()
    const hgt = hole ? clamp(1.2 + L * 0.07, 1.3, 3.2) : 1.3
    const pts = hole
      ? [post.clone().setY(post.y + 0.2), post.clone().add(V3(0.9, 0.9, 0)), post.clone().lerp(end, 0.55).setY(hgt), end.clone().addScaledVector(dir, -0.25).setY(1.5), end.clone().setY(0.95)]
      : [post.clone().setY(post.y + 0.2), post.clone().lerp(end, 0.5).setY(1.5), end.clone().setY(1.2)]
    const lead = tube(pts, 0.1, plastic(WIRE_HEX[color], { roughness: 0.4 }))
    g.add(lead)
    const probe = part.type === 'meter'
    const grip = cyl(probe ? 0.2 : 0.17, probe ? 1.2 : 0.62, plastic(WIRE_HEX[color], { roughness: 0.35 }), end.x, end.y + (probe ? 0.45 : 0.14), end.z, 14)
    grip.userData.lead = { partId: part.id, pin: name }
    const tip = cyl(0.06, 0.9, metal(), end.x, end.y - 0.4, end.z, 8)
    tip.userData.lead = grip.userData.lead
    g.add(grip, tip)
    g.userData.tips.push({ pin: name, grip, tip, hole, at: end.clone() })
    const path = [...lead.userData.pts, end.clone().setY(-0.3)]
    g.userData.paths[name] = name === 'pos' || name === '3v3' || name === 'red' ? path : path.reverse()
  }
  g.userData.labelAt = V3(MODULE_X, 1.2, zc - 2.9)
  g.userData.label = null
}

// --------------------------------------------------------------- build

const BUILDERS = { resistor, led, wire, pot, joystick }

export function buildPart(part, moduleCount = 1) {
  const g = new THREE.Group()
  g.userData.partId = part.id
  if (part.type === 'source' || part.type === 'meter' || part.type === 'mcu') moduleMesh(part, g, moduleCount)
  else BUILDERS[part.type](part, g)
  g.traverse((o) => { if (o !== g && !o.userData.lead) o.userData.partId = part.id })
  if (!g.userData.led) for (const m of g.userData.tint ?? []) { m.emissive.set('#ffffff'); m.emissiveIntensity = 0 }
  return g
}

/** A string that changes whenever the mesh would. */
export function shapeKey(part) {
  return [part.type, ...Object.values(part.pins), part.ohms, part.color, part.burned, part.volts, part.slot].join('|')
}

export function disposeGroup(g) {
  g.traverse((o) => {
    o.geometry?.dispose()
    for (const m of [o.material].flat()) {
      if (!m) continue
      if (m.map && !m.map.userData.shared) m.map.dispose()
      m.dispose()
    }
  })
}

export { ROW_Z, parseHole }
