// The breadboard itself: printed top, the metal clips inside, and the
// coloured bands that mark a node (the same job the highlight regions do
// in the course diagrams).
import * as THREE from 'three'
import {
  BOARD, COLS, ROW_Z, ROWS_TOP, ROWS_BOT, RAILS, ALL_STRIPS, ALL_HOLES,
  colX, railHasHole, stripRect, holePos,
} from '../board.js'

const PX = 112 // texture pixels per hole pitch
const W = BOARD.x1 - BOARD.x0
const D = BOARD.z1 - BOARD.z0
export const THICK = 0.95

function paintTop() {
  const c = document.createElement('canvas')
  c.width = Math.round(W * PX)
  c.height = Math.round(D * PX)
  const g = c.getContext('2d')
  const X = (x) => (x - BOARD.x0) * PX
  const Z = (z) => (z - BOARD.z0) * PX

  g.fillStyle = '#23262c'
  g.fillRect(0, 0, c.width, c.height)
  // Moulding seams between the rail blocks and the main block.
  g.fillStyle = '#16181c'
  for (const z of [-6.55, 6.55]) g.fillRect(0, Z(z) - 3, c.width, 6)
  // Trench.
  const tr = g.createLinearGradient(0, Z(-0.62), 0, Z(0.62))
  tr.addColorStop(0, '#0b0c0e'); tr.addColorStop(0.5, '#15171a'); tr.addColorStop(1, '#0b0c0e')
  g.fillStyle = tr
  g.fillRect(0, Z(-0.62), c.width, PX * 1.24)

  // Rail guide lines.
  g.lineWidth = 5
  for (const [row, color, off] of [['TN', '#3d7bff', -0.62], ['TP', '#ff4d5a', 0.62], ['BN', '#3d7bff', -0.62], ['BP', '#ff4d5a', 0.62]]) {
    g.strokeStyle = color
    g.beginPath(); g.moveTo(X(-14.4), Z(ROW_Z[row] + off)); g.lineTo(X(14.4), Z(ROW_Z[row] + off)); g.stroke()
  }

  const hole = (x, z) => {
    const s = PX * 0.36
    const px = X(x), pz = Z(z)
    g.fillStyle = '#3a3e46' // lit bevel
    g.beginPath(); g.roundRect(px - s / 2 - 3, pz - s / 2 - 3, s + 6, s + 6, 7); g.fill()
    const gr = g.createLinearGradient(0, pz - s / 2, 0, pz + s / 2)
    gr.addColorStop(0, '#020203'); gr.addColorStop(1, '#101216')
    g.fillStyle = gr
    g.beginPath(); g.roundRect(px - s / 2, pz - s / 2, s, s, 5); g.fill()
    g.fillStyle = 'rgba(190,150,90,.28)' // a glint of the clip inside
    g.fillRect(px - s * 0.2, pz + s * 0.12, s * 0.4, s * 0.16)
  }
  for (const id of ALL_HOLES) { const p = holePos(id); hole(p.x, p.z) }

  // Silkscreen.
  g.fillStyle = '#aab1bd'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.font = `600 ${PX * 0.42}px "Recursive Variable", ui-monospace, monospace`
  for (let col = 1; col <= COLS; col++) {
    if (col !== 1 && col % 5) continue
    g.fillText(String(col), X(colX(col)), Z(-6.05))
    g.fillText(String(col), X(colX(col)), Z(6.08))
  }
  for (const r of [...ROWS_TOP, ...ROWS_BOT]) {
    g.fillText(r, X(-15.3), Z(ROW_Z[r]) + 2)
    g.fillText(r, X(15.3), Z(ROW_Z[r]) + 2)
  }
  g.font = `700 ${PX * 0.6}px "Recursive Variable", ui-monospace, monospace`
  for (const [row, ch, color] of [['TN', '−', '#6b9bff'], ['TP', '+', '#ff6a75'], ['BN', '−', '#6b9bff'], ['BP', '+', '#ff6a75']]) {
    g.fillStyle = color
    g.fillText(ch, X(-15.3), Z(ROW_Z[row]))
    g.fillText(ch, X(15.3), Z(ROW_Z[row]))
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

function bandTexture(w, h) {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const g = c.getContext('2d')
  const r = Math.min(w, h) * 0.46
  g.filter = `blur(${Math.min(w, h) * 0.08}px)`
  g.fillStyle = '#fff'
  const m = Math.min(w, h) * 0.14
  g.beginPath(); g.roundRect(m, m, w - 2 * m, h - 2 * m, r); g.fill()
  const tex = new THREE.CanvasTexture(c)
  return tex
}

export function createBoard() {
  const group = new THREE.Group()

  const topMat = new THREE.MeshStandardMaterial({ map: paintTop(), roughness: 0.62, metalness: 0.05, transparent: true })
  const top = new THREE.Mesh(new THREE.PlaneGeometry(W, D), topMat)
  top.rotation.x = -Math.PI / 2
  top.position.set((BOARD.x0 + BOARD.x1) / 2, 0, 0)
  top.receiveShadow = true
  top.renderOrder = 2
  group.add(top)

  const bodyMat = new THREE.MeshStandardMaterial({ color: '#1b1d22', roughness: 0.7, transparent: true })
  const body = new THREE.Mesh(new THREE.BoxGeometry(W, THICK, D), bodyMat)
  body.position.set(0, -THICK / 2 - 0.004, 0)
  body.castShadow = true
  body.renderOrder = 1
  group.add(body)

  // Metal clips, one per strip. Seen in X-ray.
  const copper = new THREE.MeshStandardMaterial({ color: '#c98a4a', metalness: 0.9, roughness: 0.32 })
  const clips = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), copper, ALL_STRIPS.length)
  const m = new THREE.Matrix4()
  ALL_STRIPS.forEach((s, k) => {
    const r = stripRect(s)
    const rail = RAILS.includes(s)
    m.makeScale(rail ? r.w : r.w * 0.82, 0.42, rail ? 0.46 : r.d * 0.98)
    m.setPosition(r.x, -0.5, r.z)
    clips.setMatrixAt(k, m)
  })
  clips.renderOrder = 0
  group.add(clips)

  // Node bands.
  const colTex = bandTexture(48, 320)
  const railTex = bandTexture(1024, 40)
  const bands = new Map()
  for (const s of ALL_STRIPS) {
    const r = stripRect(s)
    const rail = RAILS.includes(s)
    const mat = new THREE.MeshBasicMaterial({
      map: rail ? railTex : colTex, transparent: true, opacity: 0, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false,
    })
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(r.w + 0.45, r.d + 0.45), mat)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(r.x, 0.02, r.z)
    mesh.renderOrder = 3
    mesh.visible = false
    group.add(mesh)
    bands.set(s, { mesh, mat, target: 0, color: new THREE.Color(), pulse: false })
  }

  let xray = 0
  let xrayGoal = 0
  const white = new THREE.Color('#ffffff')

  return {
    group, top,
    setXray(on) { xrayGoal = on ? 1 : 0 },
    get xray() { return xray },
    /** glows: Map strip -> {color, a, pulse} */
    setGlows(glows) {
      for (const [s, b] of bands) {
        const g = glows.get(s)
        b.target = g ? g.a : 0
        b.pulse = !!g?.pulse
        if (g) b.color.set(g.color)
      }
    },
    update(dt, t) {
      xray += (xrayGoal - xray) * Math.min(1, dt * 7)
      // Only blend while X-ray is on, so the top sorts as a solid otherwise.
      const see = xray > 0.004
      topMat.transparent = bodyMat.transparent = see
      topMat.opacity = see ? 1 - xray * 0.86 : 1
      bodyMat.opacity = see ? 1 - xray * 0.72 : 1
      topMat.depthWrite = bodyMat.depthWrite = xray < 0.5
      for (const b of bands.values()) {
        const want = b.target * (b.pulse ? 0.72 + 0.28 * Math.sin(t * 5) : 1)
        b.mat.opacity += (want - b.mat.opacity) * Math.min(1, dt * 12)
        b.mat.color.lerp(b.target ? b.color : white, b.target ? Math.min(1, dt * 14) : 0)
        b.mesh.visible = b.mat.opacity > 0.01
      }
    },
  }
}

export { railHasHole }
