// Progress and settings, kept in this browser only.
const KEY = 'solderless.v1'

function read() {
  try { return JSON.parse(localStorage.getItem(KEY)) ?? {} } catch { return {} }
}

const data = { stars: {}, best: {}, mute: false, ...read() }

function write() {
  try { localStorage.setItem(KEY, JSON.stringify(data)) } catch { /* private mode: play without saving */ }
}

export const store = {
  stars: (id) => data.stars[id] ?? 0,
  setStars(id, n) { if (n > (data.stars[id] ?? 0)) { data.stars[id] = n; write() } },
  best: (mode) => data.best[mode] ?? 0,
  /** Returns true when this beats the old best. */
  setBest(mode, n) { if (n > (data.best[mode] ?? 0)) { data.best[mode] = n; write(); return true } return false },
  get mute() { return data.mute },
  set mute(v) { data.mute = v; write() },
}
