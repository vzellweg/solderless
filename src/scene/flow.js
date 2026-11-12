// Dots that travel along every path carrying current. They move in the
// direction of conventional current (+ to −), faster where there is more.
import * as THREE from 'three'

const MAX = 6000
const GAP = 0.7

export function createFlow() {
  const pos = new Float32Array(MAX * 3)
  const amp = new Float32Array(MAX * 2)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage))
  geo.setAttribute('aAmp', new THREE.BufferAttribute(amp, 2).setUsage(THREE.DynamicDrawUsage))
  const mat = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 600 }, uColor: { value: new THREE.Color('#ffcf7a') } },
    vertexShader: `
      attribute vec2 aAmp; uniform float uScale; varying float vA;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aAmp.x * uScale / -mv.z;
        vA = aAmp.y;
      }`,
    fragmentShader: `
      uniform vec3 uColor; varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.08, d);
        gl_FragColor = vec4(uColor * (1.2 + 2.0 * a) * vA, a * vA);
      }`,
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
  })
  const points = new THREE.Points(geo, mat)
  points.frustumCulled = false
  points.renderOrder = 30

  let paths = []
  let hot = 0
  const cool = new THREE.Color('#ffcf7a')
  const warm = new THREE.Color('#ff5a3a')

  return {
    points,
    /** list of {pts: Vector3[], i: amps, strip?: bool} */
    setPaths(list) {
      paths = []
      for (const p of list) {
        if (Math.abs(p.i) < 2e-5 || p.pts.length < 2) continue
        const cum = [0]
        for (let k = 1; k < p.pts.length; k++) cum.push(cum[k - 1] + p.pts[k].distanceTo(p.pts[k - 1]))
        const a = Math.abs(p.i)
        const lg = Math.log10(1 + a / 0.001)
        paths.push({
          pts: p.pts, cum, len: cum.at(-1), dir: Math.sign(p.i), strip: !!p.strip,
          speed: Math.min(7, 0.5 + 2 * lg), size: 0.15 + 0.04 * Math.min(lg, 2.2),
        })
      }
    },
    setHot(on) { hot = on ? 1 : 0 },
    update(t, height) {
      mat.uniforms.uScale.value = height * 1.5
      mat.uniforms.uColor.value.copy(cool).lerp(warm, hot)
      let n = 0
      for (const p of paths) {
        const phase = (t * p.speed) % GAP
        const alpha = p.strip ? 0.75 : 1
        for (let d = phase; d < p.len && n < MAX; d += GAP) {
          const s = p.dir > 0 ? d : p.len - d
          let k = 1
          while (k < p.cum.length - 1 && p.cum[k] < s) k++
          const f = (s - p.cum[k - 1]) / Math.max(1e-6, p.cum[k] - p.cum[k - 1])
          const a = p.pts[k - 1], b = p.pts[k]
          pos[n * 3] = a.x + (b.x - a.x) * f
          pos[n * 3 + 1] = a.y + (b.y - a.y) * f
          pos[n * 3 + 2] = a.z + (b.z - a.z) * f
          amp[n * 2] = p.size * (p.strip ? 0.8 : 1)
          amp[n * 2 + 1] = alpha
          n++
        }
      }
      geo.setDrawRange(0, n)
      geo.attributes.position.needsUpdate = true
      geo.attributes.aAmp.needsUpdate = true
    },
  }
}
