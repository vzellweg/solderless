// Title screen: the campaign as a drawing index, plus the three side modes.
import { h, hud, stars } from './ui.js'
import { store } from './store.js'
import { LEVELS, CHAPTERS } from './levels.js'
import { solvedBoard } from './build.js'
import { solve } from './circuit.js'

export function showMenu(stage, nav) {
  // A lit circuit turning slowly behind the menu.
  const demo = LEVELS.find((l) => l.id === 'ladder')
  const parts = solvedBoard(demo)
  parts.filter((p) => demo.modules.includes(p.ref)).forEach((p, k) => { p.slot = k })
  stage.sync(parts, demo.modules.length, { instant: true })
  stage.setSim(solve(parts))
  stage.view('attract')

  const total = LEVELS.reduce((n, l) => n + store.stars(l.id), 0)
  const index = h('section.paper.menu-index',
    h('header.titleblock', h('h1', 'Lessons'), h('div.tb-cell', `${LEVELS.length} sheets`), h('div.tb-cell.sheet', `${total} of ${LEVELS.length * 3} stars`)),
    CHAPTERS.map((name, c) => [
      h('h2.index-chapter', name),
      LEVELS.filter((l) => l.chapter === c).map((l) => h('button.index-row', { type: 'button', onclick: () => nav.level(l) },
        h('span.index-no', String(LEVELS.indexOf(l) + 1).padStart(2, '0')),
        h('span.index-title', l.title, l.course && h('small', l.course)),
        stars(store.stars(l.id)),
      )),
    ]),
    h('p.index-foot', 'Start at sheet 01 if breadboards are new to you. The last two sheets are the circuits from the ECE 201 and ECE 473/573 lessons.'),
  )
  const mode = (name, what, best, go) => h('button.mode', { type: 'button', onclick: go },
    h('span.mode-name', name), h('span.mode-what', what), best && h('span.mode-best', best))
  const root = h('div.menu',
    h('div.wordmark-wrap',
      h('h1.wordmark', 'Solderless'),
      h('p.pitch', 'Read a schematic, build it on a breadboard, and watch where the current goes.'),
    ),
    h('div.modes',
      mode('Continuity', 'Two probes, sixty seconds. Are they on the same node?', `Best ${store.best('continuity')}`, nav.continuity),
      mode('Inspector', 'A schematic and a finished board. Find the wiring mistake, if there is one.', `Best streak ${store.best('inspector')}`, nav.inspector),
      mode('Free bench', 'Every part, no goal. Build something and see what the current does.', null, nav.sandbox),
    ),
    index,
  )
  hud().append(root)
  const fit = () => {
    const wide = innerWidth > 900
    stage.setInsets({ left: 0, top: wide ? innerHeight * 0.2 : 0, right: wide ? 420 : 0, bottom: wide ? 130 : 0 })
  }
  fit()
  addEventListener('resize', fit)
  return {
    destroy() {
      removeEventListener('resize', fit)
      root.remove()
      stage.view('bench')
    },
  }
}
