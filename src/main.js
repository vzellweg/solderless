import '@fontsource-variable/recursive/full.css'
import './styles.css'
import { createStage } from './scene/stage.js'
import { LEVELS, SANDBOX } from './levels.js'
import { showMenu } from './menu.js'
import { playLevel } from './game/level.js'
import { playContinuity } from './game/continuity.js'
import { playInspector } from './game/inspector.js'

// The board's printed labels use the page font, so wait for it.
await Promise.all([document.fonts.load('600 20px "Recursive Variable"'), document.fonts.load('800 20px "Recursive Variable"')])

const stage = createStage(document.getElementById('stage'), document.getElementById('tags'))
let screen = null
window.solderless = { stage } // handle for poking at the scene from the console

const nav = {
  menu: () => go('menu'),
  level: (l) => go(`level/${l.id}`),
  continuity: () => go('continuity'),
  inspector: () => go('inspector'),
  sandbox: () => go('bench'),
}

function go(route) {
  if (location.hash.slice(1) === route) render()
  else location.hash = route
}

function render() {
  screen?.destroy()
  document.querySelector('.toast')?.classList.remove('show')
  const [name, id] = location.hash.slice(1).split('/')
  const level = LEVELS.find((l) => l.id === id)
  if (name === 'level' && level) screen = playLevel(stage, level, nav)
  else if (name === 'bench') screen = playLevel(stage, SANDBOX, nav)
  else if (name === 'continuity') screen = playContinuity(stage, nav)
  else if (name === 'inspector') screen = playInspector(stage, nav)
  else screen = showMenu(stage, nav)
}

addEventListener('hashchange', render)
render()
