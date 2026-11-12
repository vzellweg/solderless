// The 3D bench: renderer, camera, lights, bloom, picking, and the meshes
// kept in step with the parts list.
import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { createBoard, THICK } from './boardMesh.js'
import { createFlow } from './flow.js'
import { buildPart, shapeKey, disposeGroup, leadInfo } from './parts.js'
import { nearestHole, holePos } from '../board.js'
import { stripFlows } from '../circuit.js'
import { isModule } from '../build.js'

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches

function benchTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 512
  const g = c.getContext('2d')
  g.fillStyle = '#0c2b2f'
  g.fillRect(0, 0, 512, 512)
  g.strokeStyle = 'rgba(160,230,220,.07)'
  g.lineWidth = 1.5
  for (let k = 0; k <= 10; k++) {
    g.beginPath(); g.moveTo(k * 51.2, 0); g.lineTo(k * 51.2, 512); g.stroke()
    g.beginPath(); g.moveTo(0, k * 51.2); g.lineTo(512, k * 51.2); g.stroke()
  }
  g.strokeStyle = 'rgba(160,230,220,.13)'
  g.lineWidth = 3
  g.strokeRect(0, 0, 512, 512)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(30, 30)
  tex.anisotropy = 8
  return tex
}

export function createStage(canvas, labelLayer) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  renderer.shadowMap.enabled = true

  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#071a1d')
  scene.fog = new THREE.Fog('#071a1d', 150, 380)
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  scene.environmentIntensity = 0.42

  const camera = new THREE.PerspectiveCamera(19, 1, 1, 600)
  scene.add(new THREE.HemisphereLight('#cfe9ff', '#10262a', 0.55))
  const key = new THREE.DirectionalLight('#fff4e2', 1.7)
  key.position.set(-16, 34, 14)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  Object.assign(key.shadow.camera, { left: -30, right: 22, top: 20, bottom: -20, near: 5, far: 90 })
  key.shadow.bias = -0.0004
  key.shadow.radius = 5
  scene.add(key)
  const fill = new THREE.DirectionalLight('#7fd6ff', 0.35)
  fill.position.set(20, 12, -18)
  scene.add(fill)

  const bench = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ map: benchTexture(), roughness: 0.92, metalness: 0 }))
  bench.rotation.x = -Math.PI / 2
  bench.position.y = -THICK - 0.01
  bench.receiveShadow = true
  scene.add(bench)

  const board = createBoard()
  scene.add(board.group)
  const flow = createFlow()
  scene.add(flow.points)
  const partLayer = new THREE.Group()
  scene.add(partLayer)

  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 }))
  composer.addPass(new RenderPass(scene, camera))
  const bloom = new UnrealBloomPass(new THREE.Vector2(4, 4), 0.42, 0.55, 1.0)
  composer.addPass(bloom)
  composer.addPass(new OutputPass())

  // -------------------------------------------------------------- camera
  const cam = { az: 0, el: 0.98, zoom: 1, px: 0, pz: 0 }
  const goal = { ...cam }
  let insets = { left: 0, right: 0, top: 0, bottom: 0 }
  let content = { x0: -23.5, x1: 16.4, z0: -10.4, z1: 10.2 }
  let attract = false
  let shake = 0
  let size = { w: 1, h: 1 }

  function placeCamera() {
    const { w, h } = size
    const fx = Math.max(0.3, (w - insets.left - insets.right) / w)
    const fy = Math.max(0.3, (h - insets.top - insets.bottom) / h)
    const tanY = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
    const W = content.x1 - content.x0
    const D = content.z1 - content.z0
    const dH = W / (2 * tanY * camera.aspect * fx)
    const dV = (D * Math.sin(cam.el) + 6 * Math.cos(cam.el)) / (2 * tanY * fy)
    const dist = Math.max(dH, dV) * 1.03 * cam.zoom
    const tx = (content.x0 + content.x1) / 2 + cam.px
    const tz = (content.z0 + content.z1) / 2 + cam.pz
    const ce = Math.cos(cam.el)
    camera.position.set(tx + dist * Math.sin(cam.az) * ce, dist * Math.sin(cam.el), tz + dist * Math.cos(cam.az) * ce)
    if (shake > 0.001) camera.position.add(new THREE.Vector3((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, 0))
    camera.lookAt(tx, 0, tz)
    camera.setViewOffset(w, h, -(insets.left - insets.right) / 2, -(insets.top - insets.bottom) / 2, w, h)
  }

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight
    if (!w || !h) return
    size = { w, h }
    renderer.setSize(w, h, false)
    composer.setSize(w, h)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  new ResizeObserver(resize).observe(canvas)
  resize()

  // ------------------------------------------------------------- picking
  const ray = new THREE.Raycaster()
  const ndc = new THREE.Vector2()
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  const hit = new THREE.Vector3()

  function setRay(cx, cy) {
    const r = canvas.getBoundingClientRect()
    ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1)
    ray.setFromCamera(ndc, camera)
  }
  function pick(cx, cy) {
    setRay(cx, cy)
    const out = { hole: null, partId: null, lead: null, point: null }
    if (ray.ray.intersectPlane(plane, hit)) {
      out.point = hit.clone()
      out.hole = nearestHole(hit.x, hit.z, 0.5)
    }
    const hits = ray.intersectObjects(partLayer.children, true)
    for (const h of hits) {
      if (h.object.userData.lead) { out.lead = h.object.userData.lead; break }
      if (h.object.userData.partId) { out.partId = h.object.userData.partId; break }
    }
    return out
  }

  // ------------------------------------------------------------- pointer
  const handlers = { down: null, move: null, up: null, cancel: null }
  const touches = new Map()
  let orbit = null
  let gesture = null

  canvas.addEventListener('contextmenu', (e) => e.preventDefault())
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId)
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (touches.size === 2) {
        handlers.cancel?.()
        const [a, b] = [...touches.values()]
        gesture = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }
        return
      }
    }
    if (e.button === 2 || e.button === 1) {
      orbit = { x: e.clientX, y: e.clientY, pan: e.shiftKey || e.button === 1, moved: 0 }
      return
    }
    handlers.down?.(pick(e.clientX, e.clientY), e)
  })
  canvas.addEventListener('pointermove', (e) => {
    if (touches.has(e.pointerId)) {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (gesture && touches.size === 2) {
        const [a, b] = [...touches.values()]
        const d = Math.hypot(a.x - b.x, a.y - b.y)
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
        goal.zoom = clamp(goal.zoom * gesture.d / d, 0.3, 1.5)
        goal.az = clamp(goal.az - (mx - gesture.mx) * 0.005, -1.1, 1.1)
        goal.el = clamp(goal.el + (my - gesture.my) * 0.005, 0.4, 1.52)
        gesture = { d, mx, my }
        return
      }
    }
    if (orbit) {
      const dx = e.clientX - orbit.x, dy = e.clientY - orbit.y
      orbit.x = e.clientX; orbit.y = e.clientY
      orbit.moved += Math.abs(dx) + Math.abs(dy)
      if (orbit.pan) {
        goal.px = clamp(goal.px - dx * 0.035 * goal.zoom, -18, 18)
        goal.pz = clamp(goal.pz - dy * 0.045 * goal.zoom, -11, 11)
      } else {
        goal.az = clamp(goal.az - dx * 0.006, -1.1, 1.1)
        goal.el = clamp(goal.el + dy * 0.006, 0.4, 1.52)
      }
      return
    }
    handlers.move?.(pick(e.clientX, e.clientY), e)
  })
  const end = (e) => {
    const wasTouchGesture = gesture && touches.has(e.pointerId)
    touches.delete(e.pointerId)
    if (touches.size < 2) gesture = null
    if (wasTouchGesture) return
    if (orbit) {
      const moved = orbit.moved
      orbit = null
      if (moved < 4) handlers.cancel?.()
      return
    }
    handlers.up?.(pick(e.clientX, e.clientY), e)
  }
  canvas.addEventListener('pointerup', end)
  canvas.addEventListener('pointercancel', end)
  canvas.addEventListener('pointerleave', () => handlers.move?.({ hole: null, partId: null, lead: null, point: null }))
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault()
    const before = goal.zoom
    goal.zoom = clamp(goal.zoom * Math.exp(e.deltaY * (e.ctrlKey ? 0.012 : 0.0016)), 0.3, 1.5)
    setRay(e.clientX, e.clientY)
    if (ray.ray.intersectPlane(plane, hit)) {
      const k = 1 - goal.zoom / before
      const tx = (content.x0 + content.x1) / 2 + goal.px
      const tz = (content.z0 + content.z1) / 2 + goal.pz
      goal.px = clamp(goal.px + (hit.x - tx) * k, -18, 18)
      goal.pz = clamp(goal.pz + (hit.z - tz) * k, -11, 11)
    }
  }, { passive: false })

  // --------------------------------------------------------------- parts
  const meshes = new Map() // part id -> {group, key, born}
  let partsRef = []
  let moduleCount = 1
  let sim = null
  const labels = new Map() // key -> {el, at: Vector3}
  let selected = null
  let hovered = null
  let withValues = true
  let withLeadTags = true

  function label(key, cls, text, at, html) {
    let l = labels.get(key)
    if (!l) {
      l = { el: document.createElement('div') }
      labelLayer.append(l.el)
      labels.set(key, l)
    }
    l.el.className = `tag ${cls}`
    if (html) l.el.innerHTML = text
    else l.el.textContent = text
    l.at = at
    l.live = true
  }

  function rebuildLabels() {
    for (const l of labels.values()) l.live = false
    for (const [id, m] of meshes) {
      const u = m.group.userData
      const part = partsRef.find((p) => p.id === id)
      if (!part) continue
      if (u.label) label(`n:${id}`, 'ref', u.sub && withValues ? `<b>${u.label}</b> ${u.sub}` : `<b>${u.label}</b>`, u.labelAt, true)
      if (u.plusAt) label(`p:${id}`, 'plus', '+', u.plusAt)
      for (const t of withLeadTags ? u.tips ?? [] : []) {
        const info = leadInfo(part, t.pin)
        label(`t:${id}:${t.pin}`, `lead lead-${info.color}${t.hole ? '' : ' loose'}`, info.label, t.at.clone().setY(t.at.y + (part.type === 'meter' ? 1.35 : 0.75)))
      }
    }
    for (const [k, l] of labels) if (!l.live && !k.startsWith('m:')) { l.el.remove(); labels.delete(k) }
  }

  function sync(parts, count = 1, { instant = false } = {}) {
    partsRef = parts
    moduleCount = count
    const now = performance.now()
    const seen = new Set()
    for (const p of parts) {
      seen.add(p.id)
      const placed = isModule(p) || Object.values(p.pins).every(Boolean)
      const key = placed ? shapeKey(p) : null
      const cur = meshes.get(p.id)
      if (cur && cur.key === key) continue
      if (cur) { partLayer.remove(cur.group); disposeGroup(cur.group); meshes.delete(p.id) }
      if (!placed) continue
      const group = buildPart(p, count)
      partLayer.add(group)
      meshes.set(p.id, { group, key, born: instant || cur || isModule(p) ? 0 : now })
    }
    for (const [id, m] of meshes) {
      if (seen.has(id)) continue
      partLayer.remove(m.group); disposeGroup(m.group); meshes.delete(id)
    }
    rebuildLabels()
    refreshFlow()
  }

  function refreshFlow() {
    const list = []
    if (sim?.powered) {
      for (const [id, m] of meshes) {
        const rec = sim.i.get(id)
        const paths = m.group.userData.paths
        if (!rec || !paths) continue
        const part = partsRef.find((p) => p.id === id)
        if (part.type === 'source') {
          list.push({ pts: paths.pos, i: rec.i }, { pts: paths.neg, i: rec.i })
        } else if (part.type === 'mcu') {
          list.push({ pts: paths['3v3'], i: rec.i }, { pts: paths.gnd, i: rec.i })
        } else if (part.type !== 'meter') {
          for (const [k, i] of Object.entries(rec)) if (paths[k]) list.push({ pts: paths[k], i })
        }
      }
      for (const f of stripFlows(sim.taps)) {
        const a = holePos(f.from), b = holePos(f.to)
        list.push({ pts: [new THREE.Vector3(a.x, 0.04, a.z), new THREE.Vector3(b.x, 0.04, b.z)], i: f.i, strip: true })
      }
    }
    flow.setPaths(list)
    flow.setHot(!!sim?.shorts.length)
  }

  // --------------------------------------------------------------- ghost
  let ghost = null
  function setGhost(part, ok = true) {
    const key = part ? shapeKey(part) + ok : null
    if (ghost?.key === key) return
    if (ghost) { scene.remove(ghost.group); disposeGroup(ghost.group); ghost = null }
    if (!part) return
    const group = buildPart(part, moduleCount)
    group.traverse((o) => {
      for (const m of [o.material].flat()) {
        if (!m) continue
        m.transparent = true
        m.opacity = 0.5
        m.depthWrite = false
        if (!ok && m.color) m.color.set('#ff4f58')
      }
      o.castShadow = false
      o.renderOrder = 12
      if (o.isLight) o.intensity = 0
    })
    scene.add(group)
    ghost = { group, key }
  }

  // --------------------------------------------------------------- marks
  const ringGeo = new THREE.RingGeometry(0.3, 0.46, 32)
  const discGeo = new THREE.CircleGeometry(0.3, 24)
  const marks = []
  /** list of {hole | at, color, pulse, fill, label} */
  function setMarks(list) {
    while (marks.length < list.length) {
      const mesh = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, blending: THREE.AdditiveBlending, toneMapped: false }))
      mesh.rotation.x = -Math.PI / 2
      mesh.renderOrder = 25
      scene.add(mesh)
      marks.push({ mesh })
    }
    for (const [k, l] of labels) if (k.startsWith('m:')) { l.el.remove(); labels.delete(k) }
    marks.forEach((m, k) => {
      const spec = list[k]
      m.mesh.visible = !!spec && !spec.noRing
      if (!spec) return
      const p = spec.at ?? holePos(spec.hole)
      m.mesh.position.set(p.x, (spec.at?.y ?? 0) + 0.05, p.z)
      m.mesh.geometry = spec.fill ? discGeo : ringGeo
      m.mesh.material.color.set(spec.color ?? '#ffffff').multiplyScalar(spec.bright ?? 1.5)
      m.pulse = spec.pulse
      m.base = spec.scale ?? 1
      if (spec.label) label(`m:${k}`, `mark ${spec.cls ?? ''}`, spec.label, new THREE.Vector3(p.x, spec.labelY ?? 0.9, p.z))
    })
  }

  // ------------------------------------------------------------------ fx
  const sparks = []
  const sparkGeo = new THREE.BufferGeometry()
  const sparkPos = new Float32Array(600 * 3)
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3))
  const sparkPts = new THREE.Points(sparkGeo, new THREE.PointsMaterial({ color: new THREE.Color('#ffd9a0').multiplyScalar(3), size: 0.22, transparent: true, depthTest: false, blending: THREE.AdditiveBlending, toneMapped: false }))
  sparkPts.frustumCulled = false
  sparkPts.renderOrder = 40
  scene.add(sparkPts)
  const flash = new THREE.PointLight('#ffd9a0', 0, 30, 1.5)
  scene.add(flash)

  function spark(at, n = 40, power = 1) {
    for (let k = 0; k < n && sparks.length < 600; k++) {
      const a = Math.random() * Math.PI * 2
      const s = (2 + Math.random() * 7) * power
      sparks.push({ p: at.clone(), v: new THREE.Vector3(Math.cos(a) * s, 3 + Math.random() * 9 * power, Math.sin(a) * s), life: 0.35 + Math.random() * 0.5 })
    }
    flash.position.copy(at).setY(1.5)
    flash.intensity = 60 * power
    if (!reduceMotion) shake = Math.max(shake, 0.5 * power)
  }
  const puffs = []
  function puff(at) {
    for (let k = 0; k < 7; k++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ color: '#9aa0a6', transparent: true, opacity: 0.5, depthWrite: false }))
      s.position.copy(at).add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.2, (Math.random() - 0.5) * 0.4))
      s.scale.setScalar(0.5)
      s.renderOrder = 35
      scene.add(s)
      puffs.push({ s, life: 1.6 + Math.random(), age: -k * 0.08, vx: (Math.random() - 0.5) * 0.6 })
    }
  }

  // ---------------------------------------------------------------- loop
  const frameCbs = new Set()
  const proj = new THREE.Vector3()
  let last = performance.now()
  let running = true

  function frame(now) {
    if (!running) return
    requestAnimationFrame(frame)
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    const t = now / 1000

    if (attract && !reduceMotion) { goal.az = Math.sin(t * 0.16) * 0.5; goal.el = 0.78 + Math.sin(t * 0.11) * 0.1 }
    const ease = Math.min(1, dt * 6.5)
    for (const k of Object.keys(cam)) cam[k] += (goal[k] - cam[k]) * ease
    shake *= Math.exp(-dt * 9)
    placeCamera()

    for (const cb of frameCbs) cb(dt, t)
    board.update(dt, t)

    for (const [id, m] of meshes) {
      const u = m.group.userData
      const part = partsRef.find((p) => p.id === id)
      if (m.born) {
        const a = clamp((now - m.born) / 260, 0, 1)
        const e = 1 - Math.pow(1 - a, 3)
        m.group.position.y = (1 - e) * 1.6
        if (a >= 1) m.born = 0
      }
      if (u.led && part) {
        const i = sim?.powered ? sim.i.get(id)?.i ?? 0 : 0
        const want = part.burned ? 0 : Math.min(1.35, Math.pow(i / 0.011, 0.6))
        u.led.level += (want - u.led.level) * Math.min(1, dt * 14)
        const L = u.led.level
        u.led.lens.emissiveIntensity = L * 2.6
        u.led.glow.scale.setScalar(0.01 + L * 3.4)
        u.led.glow.material.opacity = Math.min(0.7, L * 0.6)
        u.led.light.intensity = L * 14
      }
      if (u.knob && part) u.knob.rotation.y = -(part.t - 0.5) * 4.6
      if (u.stick && part) {
        u.stick.rotation.z += (-(part.x - 0.5) * 0.85 - u.stick.rotation.z) * Math.min(1, dt * 18)
        u.stick.rotation.x += (-(part.y - 0.5) * 0.85 - u.stick.rotation.x) * Math.min(1, dt * 18)
      }
      if (u.tint) {
        const on = id === selected ? 0.5 : id === hovered ? 0.22 : 0
        for (const mat of u.tint) {
          if (u.led) continue
          if (mat.emissive) mat.emissiveIntensity += (on * 0.5 - mat.emissiveIntensity) * Math.min(1, dt * 14)
        }
      }
      for (const tip of u.tips ?? []) {
        if (tip.hole) continue
        const bob = Math.sin(t * 2.4 + tip.at.z) * 0.12
        tip.grip.position.y = tip.at.y + 0.14 + bob
        tip.tip.position.y = tip.at.y - 0.4 + bob
      }
    }

    marks.forEach((m) => {
      if (!m.mesh.visible) return
      const s = m.base * (m.pulse ? 1 + 0.22 * Math.sin(t * 6) : 1)
      m.mesh.scale.setScalar(s)
    })

    let n = 0
    for (let k = sparks.length - 1; k >= 0; k--) {
      const s = sparks[k]
      s.life -= dt
      if (s.life <= 0) { sparks.splice(k, 1); continue }
      s.v.y -= 30 * dt
      s.p.addScaledVector(s.v, dt)
      if (s.p.y < 0.05) { s.p.y = 0.05; s.v.y *= -0.4 }
      sparkPos.set([s.p.x, s.p.y, s.p.z], n * 3)
      n++
    }
    sparkGeo.setDrawRange(0, n)
    sparkGeo.attributes.position.needsUpdate = true
    flash.intensity *= Math.exp(-dt * 14)
    for (let k = puffs.length - 1; k >= 0; k--) {
      const p = puffs[k]
      p.age += dt
      if (p.age < 0) continue
      const a = p.age / p.life
      if (a >= 1) { scene.remove(p.s); p.s.material.dispose(); puffs.splice(k, 1); continue }
      p.s.position.y += dt * 1.6
      p.s.position.x += dt * p.vx
      p.s.scale.setScalar(0.5 + a * 2.4)
      p.s.material.opacity = 0.45 * (1 - a)
    }

    flow.update(t, size.h)
    composer.render()

    // HTML tags follow their 3D anchors.
    for (const l of labels.values()) {
      proj.copy(l.at).project(camera)
      const x = (proj.x * 0.5 + 0.5) * size.w
      const y = (-proj.y * 0.5 + 0.5) * size.h
      l.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`
    }
  }
  requestAnimationFrame(frame)

  return {
    board, camera, scene,
    on(name, fn) { handlers[name] = fn },
    onFrame(fn) { frameCbs.add(fn); return () => frameCbs.delete(fn) },
    pick,
    sync,
    setSim(s) { sim = s; refreshFlow() },
    setGhost,
    setMarks,
    setSelected(id) { selected = id },
    showValues(on) { withValues = on; rebuildLabels() },
    showLeadTags(on) { withLeadTags = on; rebuildLabels() },
    setHovered(id) { hovered = id },
    spark, puff,
    sparkHole(hole, n, power) { const p = holePos(hole); spark(new THREE.Vector3(p.x, 0.3, p.z), n, power) },
    lcd(id) { return meshes.get(id)?.group.userData.lcd },
    ledTop(id) { return meshes.get(id)?.group.userData.led?.top },
    partAnchor(id) { return meshes.get(id)?.group.userData.labelAt },
    setInsets(v) { insets = { ...insets, ...v } },
    setContent(v) { content = { ...content, ...v } },
    view(name) {
      attract = name === 'attract'
      if (name === 'top') Object.assign(goal, { az: 0, el: 1.5 })
      else if (name === 'bench') Object.assign(goal, { az: 0, el: 0.98 })
      if (name !== 'attract') Object.assign(goal, { zoom: 1, px: 0, pz: 0 })
    },
    isTop() { return goal.el > 1.3 },
    zoomTo(z) { goal.zoom = z },
    screenOf(v) {
      proj.copy(v).project(camera)
      return { x: (proj.x * 0.5 + 0.5) * size.w, y: (-proj.y * 0.5 + 0.5) * size.h }
    },
    stop() { running = false },
  }
}
