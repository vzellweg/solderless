// Every sound is synthesised, so there are no audio files to load.
import { store } from './store.js'

let ctx
let master

function ac() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)()
    master = ctx.createGain()
    master.gain.value = 0.5
    const comp = ctx.createDynamicsCompressor()
    master.connect(comp).connect(ctx.destination)
  }
  if (ctx.state === 'suspended') ctx.resume()
  return ctx
}

function tone({ f = 440, to, type = 'sine', t = 0.15, g = 0.2, at = 0, attack = 0.004 }) {
  const c = ac()
  const t0 = c.currentTime + at
  const o = c.createOscillator()
  const v = c.createGain()
  o.type = type
  o.frequency.setValueAtTime(f, t0)
  if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + t)
  v.gain.setValueAtTime(0, t0)
  v.gain.linearRampToValueAtTime(g, t0 + attack)
  v.gain.exponentialRampToValueAtTime(0.0001, t0 + t)
  o.connect(v).connect(master)
  o.start(t0)
  o.stop(t0 + t + 0.02)
}

function noise({ t = 0.1, g = 0.2, f = 2000, q = 1, at = 0, type = 'bandpass' }) {
  const c = ac()
  const t0 = c.currentTime + at
  const len = Math.ceil(c.sampleRate * t)
  const buf = c.createBuffer(1, len, c.sampleRate)
  const d = buf.getChannelData(0)
  for (let k = 0; k < len; k++) d[k] = Math.random() * 2 - 1
  const src = c.createBufferSource()
  src.buffer = buf
  const flt = c.createBiquadFilter()
  flt.type = type
  flt.frequency.value = f
  flt.Q.value = q
  const v = c.createGain()
  v.gain.setValueAtTime(g, t0)
  v.gain.exponentialRampToValueAtTime(0.0001, t0 + t)
  src.connect(flt).connect(v).connect(master)
  src.start(t0)
}

const SOUNDS = {
  plug() { noise({ t: 0.035, g: 0.35, f: 3200, q: 2 }); tone({ f: 190, to: 120, t: 0.07, g: 0.25, type: 'triangle' }) },
  unplug() { noise({ t: 0.05, g: 0.2, f: 1400, q: 1.5 }); tone({ f: 240, to: 380, t: 0.06, g: 0.12, type: 'triangle' }) },
  pick() { tone({ f: 660, t: 0.05, g: 0.08, type: 'triangle' }) },
  nope() { tone({ f: 150, to: 110, t: 0.14, g: 0.16, type: 'square' }) },
  node(k = 0) { tone({ f: [523, 659, 784, 988, 1175, 1319][k % 6], t: 0.5, g: 0.13 }); tone({ f: [523, 659, 784, 988, 1175, 1319][k % 6] * 2, t: 0.3, g: 0.04 }) },
  power() { tone({ f: 70, to: 140, t: 0.35, g: 0.18, type: 'sawtooth' }); noise({ t: 0.3, g: 0.05, f: 500, q: 0.6 }) },
  off() { tone({ f: 140, to: 50, t: 0.3, g: 0.14, type: 'sawtooth' }) },
  win() { [523, 659, 784, 1047, 1319].forEach((f, k) => { tone({ f, t: 0.7, g: 0.13, at: k * 0.085 }); tone({ f: f * 2.01, t: 0.4, g: 0.035, at: k * 0.085 }) }) },
  star() { tone({ f: 1568, t: 0.35, g: 0.1 }); tone({ f: 2093, t: 0.35, g: 0.06, at: 0.05 }) },
  zap() { noise({ t: 0.5, g: 0.5, f: 1800, q: 0.5 }); tone({ f: 900, to: 45, t: 0.45, g: 0.3, type: 'sawtooth' }) },
  pop() { tone({ f: 420, to: 60, t: 0.12, g: 0.5, type: 'square' }); noise({ t: 0.6, g: 0.16, f: 5200, q: 0.4, at: 0.05, type: 'highpass' }) },
  beep() { tone({ f: 2050, t: 0.16, g: 0.13, type: 'square' }) },
  open() { tone({ f: 330, t: 0.09, g: 0.1, type: 'triangle' }) },
  wrong() { tone({ f: 185, to: 92, t: 0.32, g: 0.22, type: 'sawtooth' }) },
  tick() { tone({ f: 1200, t: 0.03, g: 0.06, type: 'square' }) },
  right() { tone({ f: 880, t: 0.12, g: 0.12 }); tone({ f: 1320, t: 0.2, g: 0.1, at: 0.07 }) },
}

export function sfx(name, ...args) {
  if (store.mute) return
  try { SOUNDS[name]?.(...args) } catch { /* audio is a nicety */ }
}
