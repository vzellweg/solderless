// Campaign content. Each level is one or more steps; a step has a schematic,
// what's already on the board, what's in the parts bin, and one known-good
// build (used by the test, the hint button and the inspector).
import { fmtAmps, fmtVolts } from './circuit.js'

export const CHAPTERS = ['The board', 'Reading schematics', 'Series and parallel', 'Dividers and sensors']

const V5 = { type: 'source', volts: 5 }
const R = (ohms) => ({ type: 'resistor', ohms })
const LED = (color) => ({ type: 'led', color })
const METER = { type: 'meter' }

const node = (label, color, wires, more = {}) => ({ label, color, wires, ...more })
const SUPPLY_ON_RAILS = [['V1.pos', 'TP2'], ['V1.neg', 'TN2']]

// One loop: supply, resistor, LED. Used by the first few levels.
const loopSch = (ohms = '330 Ω') => ({
  size: [8, 5],
  parts: [
    ['V1', 'source', [1, 1], [1, 4], { label: '5 V' }],
    ['R1', 'resistor', [2.5, 1], [5, 1], { label: ohms }],
    ['D1', 'led', [7, 1], [7, 4]],
  ],
  nodes: {
    vcc: node('5 V', 'red', [[[1, 1], [2.5, 1]]]),
    n1: node('Node A', 'violet', [[[5, 1], [7, 1]]]),
    gnd: node('Ground', 'green', [[[7, 4], [1, 4]]]),
  },
})

const ladderSch = (rungs) => {
  const xs = [3.5, 6, 8.5].slice(0, rungs)
  const end = xs.at(-1)
  const names = ['n1', 'n2', 'n3']
  const colors = ['violet', 'blue', 'orange']
  const sch = {
    size: [end + 1, 6],
    parts: [['V1', 'source', [1, 1], [1, 5], { label: '5 V' }]],
    nodes: {
      vcc: node('5 V', 'red', [[[1, 1], [end, 1]]], { dots: xs.slice(0, -1).map((x) => [x, 1]) }),
      gnd: node('Ground', 'green', [[[1, 5], [end, 5]]], { dots: xs.slice(0, -1).map((x) => [x, 5]) }),
    },
  }
  xs.forEach((x, k) => {
    sch.parts.push([`R${k + 1}`, 'resistor', [x, 1], [x, 3], { label: '330 Ω' }])
    sch.parts.push([`D${k + 1}`, 'led', [x, 3], [x, 5]])
    sch.nodes[names[k]] = node(`Node ${'ABC'[k]}`, colors[k], [], { pts: [[x, 3]] })
  })
  return sch
}

const amps = (ctx, ref) => fmtAmps(Math.abs(ctx.current(ref)))

export const LEVELS = [
  // ------------------------------------------------------------ the board
  {
    id: 'first-light', chapter: 0, title: 'First light',
    modules: ['V1'],
    parts: { V1: V5, R1: R(330), D1: LED('red') },
    steps: [{
      brief: 'Plug in the LED. Its long leg goes in the same column as the resistor, its short leg in the same column as the black wire.',
      idea: 'Under each column of five holes is one metal clip. Anything plugged into the same column is wired together. Point at any hole to see its clip.',
      sch: loopSch(),
      pre: [...SUPPLY_ON_RAILS, ['R1', 'TP9', 'H9'], ['wire', 'TN11', 'J11']],
      tray: ['D1'],
      solution: [['D1', 'G9', 'G11']],
      done: 'Each LED leg landed on a clip that was already part of the loop, so current had a full path: + rail, resistor, LED, wire, − rail.',
    }],
  },
  {
    id: 'mind-the-gap', chapter: 0, title: 'Mind the gap',
    modules: ['V1'],
    parts: { V1: V5, R1: R(330), D1: LED('red') },
    steps: [{
      brief: 'The LED sits below the trench and everything else sits above it. Bridge columns 9 and 11 across the trench with two wires.',
      idea: 'The trench down the middle cuts every column in two. Rows F–J and rows A–E are separate clips, even in the same column.',
      sch: loopSch(),
      pre: [...SUPPLY_ON_RAILS, ['R1', 'TP9', 'H9'], ['D1', 'C9', 'C11'], ['wire', 'TN11', 'I11']],
      tray: ['wire'],
      solution: [['wire', 'F9', 'E9'], ['wire', 'F11', 'E11']],
      done: 'Same schematic as last time, different layout. A jumper across the trench turns two clips into one node.',
    }],
  },
  {
    id: 'power-rails', chapter: 0, title: 'Power rails',
    modules: ['V1'],
    parts: { V1: V5, R1: R(330), D1: LED('red'), R2: R(330), D2: LED('green') },
    steps: [{
      brief: 'The supply is unplugged. Put its red lead anywhere on the top + rail and its black lead anywhere on the top − rail.',
      idea: 'A rail is one long clip running the length of the board. Feed it once and every hole along it carries that voltage.',
      sch: loopSch(),
      pre: [['R1', 'TP9', 'H9'], ['D1', 'G9', 'G11'], ['wire', 'TN11', 'J11']],
      tray: [],
      solution: SUPPLY_ON_RAILS,
      done: 'Two leads, and the whole length of both rails is live.',
    }, {
      brief: 'A second LED is waiting on the bottom rails. Run one wire from the top + rail to the bottom + rail, and one between the two − rails.',
      idea: 'The rails on opposite edges are not joined to each other. Long jumpers carry power across the board.',
      sch: ladderSch(2),
      pre: [['R2', 'BP16', 'C16'], ['D2', 'D16', 'D18'], ['wire', 'BN18', 'A18']],
      tray: ['wire'],
      solution: [['wire', 'TP3', 'BP3'], ['wire', 'TN4', 'BN4']],
      done: 'All four rails are live. Both LED branches now hang between the same two nodes, + and −.',
    }],
  },
  {
    id: 'same-strip', chapter: 0, title: 'Same strip',
    modules: ['V1'],
    parts: { V1: V5, R1: R(330), D1: LED('red') },
    steps: [{
      brief: "This LED won't light. Work out why, then drag one of its legs to fix it.",
      idea: 'A part only does something when its legs are in different nodes. Two legs in one clip sit at the same voltage, so nothing pushes current through.',
      sch: loopSch(),
      pre: [...SUPPLY_ON_RAILS, ['R1', 'TP9', 'J9'], ['D1', 'G9', 'H9', { free: true }], ['wire', 'TN11', 'I11']],
      tray: [],
      solution: [['D1', 'G9', 'G11']],
      done: 'Both legs were in column 9. The LED was bypassed by its own clip, and the loop never reached the black wire.',
    }],
  },

  // -------------------------------------------------- reading schematics
  {
    id: 'lines-are-nodes', chapter: 1, title: 'Lines are nodes',
    modules: ['V1'],
    parts: { V1: V5, R1: R(330), D1: LED('red') },
    steps: [{
      brief: 'Empty board. Build this circuit from the schematic.',
      idea: 'On a schematic a line is a node: one piece of connected metal. This circuit has three. Each one is marked here once you have built it on the board.',
      sch: loopSch(),
      tray: ['R1', 'D1', 'wire'],
      solution: [...SUPPLY_ON_RAILS, ['R1', 'TP9', 'H9'], ['D1', 'G9', 'G11'], ['wire', 'J11', 'TN11']],
      done: 'Three nodes on paper, three groups of clips on the board. Where a part sits is up to you. What counts is which node each leg touches.',
    }],
  },
  {
    id: 'shape', chapter: 1, title: "Shape doesn't matter",
    modules: ['V1'],
    parts: { V1: V5, R1: R(330), D1: LED('red') },
    steps: [{
      brief: 'The same kind of loop, drawn the long way round. Build it.',
      idea: 'Ignore how the drawing bends. For each part, ask what its two ends connect to. Here the LED comes before the resistor, and that works too.',
      sch: {
        size: [9, 6],
        parts: [
          ['V1', 'source', [5.5, 5], [3, 5], { label: '5 V' }],
          ['D1', 'led', [6.5, 1], [4, 1]],
          ['R1', 'resistor', [1, 2], [1, 4.5], { label: '330 Ω' }],
        ],
        nodes: {
          vcc: node('5 V', 'red', [[[5.5, 5], [7, 5], [7, 3], [8, 3], [8, 1], [6.5, 1]]]),
          n1: node('Node A', 'violet', [[[4, 1], [1, 1], [1, 2]]]),
          gnd: node('Ground', 'green', [[[1, 4.5], [1, 5], [3, 5]]]),
        },
      },
      tray: ['R1', 'D1', 'wire'],
      solution: [...SUPPLY_ON_RAILS, ['wire', 'TP9', 'J9'], ['D1', 'H9', 'H11'], ['R1', 'J11', 'TN11']],
      done: 'A resistor limits the current from either side of the LED. In a single loop the current is the same everywhere.',
    }],
  },
  {
    id: 'ground', chapter: 1, title: 'Ground',
    modules: ['V1'],
    parts: { V1: V5, R1: R(330), D1: LED('red') },
    steps: [{
      brief: 'This schematic has no wire back to the supply. Build it anyway.',
      idea: 'Every ground symbol is the same node. They are drawn apart to keep the page tidy. On a breadboard, ground is usually the − rail.',
      sch: {
        size: [8, 5.4],
        parts: [
          ['V1', 'source', [1, 1], [1, 3.5], { label: '5 V' }],
          ['R1', 'resistor', [2.5, 1], [5, 1], { label: '330 Ω' }],
          ['D1', 'led', [7, 1], [7, 3.5]],
        ],
        nodes: {
          vcc: node('5 V', 'red', [[[1, 1], [2.5, 1]]]),
          n1: node('Node A', 'violet', [[[5, 1], [7, 1]]]),
          gnd: node('Ground', 'green', [[[1, 3.5], [1, 4.1]], [[7, 3.5], [7, 4.1]]], { grounds: [[1, 4.1], [7, 4.1]] }),
        },
      },
      tray: ['R1', 'D1', 'wire'],
      solution: [...SUPPLY_ON_RAILS, ['R1', 'TP9', 'H9'], ['D1', 'G9', 'G11'], ['wire', 'J11', 'TN11']],
      done: 'Two ground symbols, one rail. Voltages are measured from ground, so it is 0 V by definition.',
    }],
  },

  // -------------------------------------------------- series and parallel
  {
    id: 'series', chapter: 2, title: 'One path',
    modules: ['V1'],
    parts: { V1: V5, R1: R(330), R2: R(330), D1: LED('red') },
    steps: [{
      brief: 'This loop runs on one resistor. Pull out the green jumper and put R2 in its place, so there are two in a row.',
      idea: 'Series means one path. The same current goes through every part, and each part takes a share of the voltage.',
      predict: {
        q: 'With a second 330 Ω in the same path, the LED will be',
        options: ['Brighter', 'Dimmer', 'The same'], answer: 1,
        why: 'More resistance in the only path means less current for everything in it.',
      },
      sch: {
        size: [9.5, 5],
        parts: [
          ['V1', 'source', [1, 1], [1, 4], { label: '5 V' }],
          ['R1', 'resistor', [2, 1], [4.5, 1], { label: '330 Ω' }],
          ['R2', 'resistor', [5, 1], [7.5, 1], { label: '330 Ω' }],
          ['D1', 'led', [8.5, 1], [8.5, 4]],
        ],
        nodes: {
          vcc: node('5 V', 'red', [[[1, 1], [2, 1]]]),
          n1: node('Node A', 'violet', [[[4.5, 1], [5, 1]]]),
          n2: node('Node B', 'blue', [[[7.5, 1], [8.5, 1]]]),
          gnd: node('Ground', 'green', [[[8.5, 4], [1, 4]]]),
        },
      },
      pre: [...SUPPLY_ON_RAILS, ['wire', 'TP8', 'J8'], ['R1', 'H8', 'H12'], ['wire', 'I12', 'I16', { free: true, color: 'green', tag: 'jumper' }], ['D1', 'G16', 'G18'], ['wire', 'J18', 'TN18']],
      tray: ['R2', 'wire'],
      remove: ['jumper'],
      solution: [['R2', 'I12', 'I16']],
      done: (c) => `Current fell from 9.1 mA to ${amps(c, 'D1')}, and it is the same ${amps(c, 'D1')} through R1, R2 and the LED. The voltage steps down along the path: 5 V, ${fmtVolts(c.nodeV('n1'))}, ${fmtVolts(c.nodeV('n2'))}, 0 V.`,
    }],
  },
  {
    id: 'ladder', chapter: 2, title: 'The ladder',
    modules: ['V1'],
    parts: { V1: V5, R1: R(330), D1: LED('red'), R2: R(330), D2: LED('green'), R3: R(330), D3: LED('blue') },
    steps: [{
      brief: 'Add a second rung: R2 and the green LED, between the same two rails as the first.',
      idea: 'Two long lines with parts bridging them is a parallel circuit. The top line is one node and the bottom line is another, so every rung sees the full voltage between them.',
      predict: {
        q: 'With the second rung in, the red LED will be',
        options: ['Dimmer', 'The same', 'Brighter'], answer: 1,
        why: 'Each rung connects straight to the + and − rails, so each gets the full 5 V whatever the others do.',
      },
      sch: ladderSch(2),
      pre: [...SUPPLY_ON_RAILS, ['R1', 'TP9', 'H9'], ['D1', 'G9', 'G11'], ['wire', 'J11', 'TN11']],
      tray: ['R2', 'D2', 'wire'],
      solution: [['R2', 'TP15', 'H15'], ['D2', 'G15', 'G17'], ['wire', 'J17', 'TN17']],
      done: (c) => `The red LED didn't change. The supply now delivers ${amps(c, 'V1')}: each rung draws its own current and they add up in the rails.`,
    }, {
      brief: 'Add a third rung with R3 and the blue LED.',
      idea: 'Each new rung is another path for current. The rails carry the total; each rung carries only its own share.',
      sch: ladderSch(3),
      tray: ['R3', 'D3', 'wire'],
      solution: [['R3', 'TP21', 'H21'], ['D3', 'G21', 'G23'], ['wire', 'J23', 'TN23']],
      done: (c) => `Three rungs, ${amps(c, 'V1')} in total. Pull any rung out and the others stay lit. Old string lights were wired in series, which is why one dead bulb took out the whole string.`,
    }],
  },
  {
    id: 'two-roads', chapter: 2, title: 'Two roads',
    modules: ['V1'],
    parts: { V1: V5, R1: R(1000), R2: R(1000), R3: R(10000), D1: LED('red') },
    steps: [{
      brief: 'R1 is 1 kΩ and the LED is dim. Put R2 right beside R1, with its legs in the same two columns.',
      idea: 'Parts are in parallel when both their ends share the same two nodes. Each one carries its own current, so adding one always lowers the total resistance.',
      predict: {
        q: 'With a second 1 kΩ across the first, the LED will be',
        options: ['Dimmer', 'The same', 'Brighter'], answer: 2,
        why: 'A second path lets more current through. Two equal resistors in parallel act like one of half the value.',
      },
      sch: {
        size: [8, 6.4],
        parts: [
          ['V1', 'source', [1, 2.5], [1, 5.5], { label: '5 V', labelSide: 'left' }],
          ['R1', 'resistor', [3, 2.5], [5.5, 2.5], { label: '1 kΩ' }],
          ['R2', 'resistor', [3, 1], [5.5, 1], { label: '1 kΩ' }],
          ['D1', 'led', [7, 2.5], [7, 5.5]],
        ],
        nodes: {
          vcc: node('5 V', 'red', [[[1, 2.5], [3, 2.5]], [[2.4, 2.5], [2.4, 1], [3, 1]]], { dots: [[2.4, 2.5]] }),
          n1: node('Node A', 'violet', [[[5.5, 2.5], [7, 2.5]], [[5.5, 1], [6.1, 1], [6.1, 2.5]]], { dots: [[6.1, 2.5]] }),
          gnd: node('Ground', 'green', [[[7, 5.5], [1, 5.5]]]),
        },
      },
      pre: [...SUPPLY_ON_RAILS, ['wire', 'TP9', 'J9'], ['R1', 'H9', 'H13'], ['D1', 'G13', 'G15'], ['wire', 'J15', 'TN15']],
      tray: ['R2', 'wire'],
      solution: [['R2', 'I9', 'I13']],
      done: (c) => `LED current went from 3.1 mA to ${amps(c, 'D1')}. Two 1 kΩ resistors side by side act like 500 Ω: 1/R = 1/R1 + 1/R2.`,
    }, {
      brief: 'Now add R3, a 10 kΩ, across the same two columns.',
      idea: 'Current divides in proportion to how easy each path is. A big resistor beside small ones carries very little.',
      predict: {
        q: 'Adding the 10 kΩ will change the LED',
        options: ['A lot', 'Barely at all', 'It gets dimmer'], answer: 1,
        why: 'Current favours the easy paths. A 10 kΩ beside two 1 kΩ resistors adds about a twentieth more.',
      },
      sch: {
        size: [8, 6.4],
        parts: [
          ['V1', 'source', [1, 2.5], [1, 5.5], { label: '5 V', labelSide: 'left' }],
          ['R1', 'resistor', [3, 2.5], [5.5, 2.5], { label: '1 kΩ' }],
          ['R2', 'resistor', [3, 1], [5.5, 1], { label: '1 kΩ' }],
          ['R3', 'resistor', [3, 4], [5.5, 4], { label: '10 kΩ' }],
          ['D1', 'led', [7, 2.5], [7, 5.5]],
        ],
        nodes: {
          vcc: node('5 V', 'red', [[[1, 2.5], [3, 2.5]], [[2.4, 4], [2.4, 1], [3, 1]], [[2.4, 4], [3, 4]]], { dots: [[2.4, 2.5]] }),
          n1: node('Node A', 'violet', [[[5.5, 2.5], [7, 2.5]], [[5.5, 1], [6.1, 1], [6.1, 4], [5.5, 4]]], { dots: [[6.1, 2.5]] }),
          gnd: node('Ground', 'green', [[[7, 5.5], [1, 5.5]]]),
        },
      },
      tray: ['R3', 'wire'],
      solution: [['R3', 'F9', 'F13']],
      done: (c) => `${amps(c, 'D1')}: almost no change. R3 carries ${amps(c, 'R3')}, a tenth of what each 1 kΩ carries. Keep this in mind for the two-supply circuit.`,
    }],
  },

  // -------------------------------------------------- dividers and sensors
  {
    id: 'divider', chapter: 3, title: 'Split the voltage',
    modules: ['V1', 'M1'],
    parts: { V1: V5, M1: METER, R1: R(1000), R2: R(1000), R3: R(10000) },
    steps: [{
      brief: 'Build the two resistors in a row from + to −. Then touch the red probe to the node between them.',
      idea: 'Two resistors in series split the supply voltage between them. The node in the middle sits partway between 5 V and 0 V.',
      predict: {
        q: 'With two equal resistors, the meter will read',
        options: ['0 V', '2.5 V', '5 V'], answer: 1,
        why: 'Equal resistors take equal shares, so the middle sits halfway.',
      },
      sch: dividerSch('R2', '1 kΩ'),
      pre: [...SUPPLY_ON_RAILS, ['M1.black', 'TN5']],
      tray: ['R1', 'R2', 'wire'],
      solution: [['wire', 'TP9', 'J9'], ['R1', 'H9', 'H13'], ['R2', 'G13', 'G17'], ['wire', 'J17', 'TN17'], ['M1.red', 'I13']],
      done: (c) => `${fmtVolts(c.meter('M1'))}. Equal resistors split the 5 V in half.`,
    }, {
      brief: 'Take R2 off the board and put R3, a 10 kΩ, in its place.',
      idea: 'The bigger resistor takes the bigger share of the voltage. Vout = Vin × R(bottom) ÷ R(total).',
      predict: {
        q: 'With 10 kΩ on the bottom, the meter will read about',
        options: ['0.45 V', '2.5 V', '4.55 V'], answer: 2,
        why: 'The meter measures across the bottom resistor, and the bigger resistor takes the bigger share.',
      },
      sch: dividerSch('R3', '10 kΩ'),
      tray: ['R3', 'wire'],
      remove: ['R2'],
      solution: [['R3', 'G13', 'G17']],
      done: (c) => `${fmtVolts(c.meter('M1'))}. Vout = 5 V × 10 ÷ 11. This is a voltage divider, and it is half of what happens inside a joystick.`,
    }],
  },
  {
    id: 'pot', chapter: 3, title: 'A divider with a knob',
    modules: ['V1', 'M1'],
    parts: { V1: V5, M1: METER, RV1: { type: 'pot' } },
    steps: [{
      brief: 'Plug in the pot. Wire one end pin to +, the other end pin to −, and put the red probe on the middle pin. Then turn the knob to 3.3 V.',
      idea: 'A potentiometer is one resistor with a sliding contact called the wiper. The wiper splits it into two resistors, so it is a voltage divider you can turn.',
      sch: {
        size: [8.4, 6],
        parts: [
          ['V1', 'source', [1, 1], [1, 5], { label: '5 V' }],
          ['RV1', 'pot', [4, 1], [4, 5], { w: [5.4, 3], label: '10 kΩ', labelSide: 'left' }],
          ['M1', 'meter', [7.4, 3], [7.4, 5]],
        ],
        nodes: {
          vcc: node('5 V', 'red', [[[1, 1], [4, 1]]]),
          wiper: node('Wiper', 'violet', [[[5.4, 3], [7.4, 3]]]),
          gnd: node('Ground', 'green', [[[1, 5], [7.4, 5]]], { dots: [[4, 5]] }),
        },
      },
      pre: [...SUPPLY_ON_RAILS, ['M1.black', 'TN5']],
      tray: ['RV1', 'wire'],
      solution: [['RV1', 'G12'], ['wire', 'TP12', 'J12'], ['wire', 'J14', 'TN14'], ['M1.red', 'J13']],
      goalText: 'Meter reads 3.3 V',
      goal: (c) => Math.abs(c.meter('M1') - 3.3) < 0.08,
      done: 'The wiper sweeps the whole range from 0 V to 5 V. A joystick is two of these at right angles.',
    }],
  },
  {
    id: 'two-supplies', chapter: 3, title: 'Two supplies', course: 'ECE 201, Module 2',
    modules: ['V1', 'M1', 'V2'],
    parts: { V1: V5, V2: { type: 'source', volts: 3.3 }, M1: METER, R1: R(1000), R2: R(10000), R3: R(1000) },
    steps: [{
      brief: 'This is the circuit from ECE 201 Module 2. Build it, then measure Vx: red probe on Node 3, black probe on the 3.3 V node.',
      idea: 'With two supplies, name the nodes first: ground, 5 V, 3.3 V, and the one junction whose voltage you don’t know yet. That unknown is Node 3.',
      predict: {
        q: 'Node 3 sits between a 5 V supply and a 3.3 V supply. Its voltage will be',
        options: ['Below 3.3 V', 'Between 3.3 V and 5 V', 'Above 5 V'], answer: 1,
        why: 'R1 pulls it toward 5 V, R3 pulls it toward 3.3 V, and R2 tugs it weakly toward ground.',
      },
      sch: {
        size: [10, 6.2],
        parts: [
          ['V1', 'source', [1, 1], [1, 5], { label: '5 V' }],
          ['R1', 'resistor', [2, 1], [4.5, 1], { label: '1 kΩ' }],
          ['R2', 'resistor', [5, 2], [5, 4.5], { label: '10 kΩ' }],
          ['R3', 'resistor', [5.5, 1], [8, 1], { label: '1 kΩ' }],
          ['V2', 'source', [9, 1], [9, 5], { label: '3.3 V', labelSide: 'left' }],
          ['M1', 'meter', [5.5, 1], [8, 1], { tags: 'Vx' }],
        ],
        nodes: {
          v5: node('5 V', 'red', [[[1, 1], [2, 1]]]),
          n3: node('Node 3', 'violet', [[[4.5, 1], [5.5, 1]], [[5, 1], [5, 2]]], { dots: [[5, 1]] }),
          v33: node('3.3 V', 'yellow', [[[8, 1], [9, 1]]]),
          gnd: node('Ground', 'green', [[[1, 5], [9, 5]], [[5, 4.5], [5, 5.5]]], { dots: [[5, 5]], grounds: [[5, 5.5]] }),
        },
      },
      tray: ['R1', 'R2', 'R3', 'wire'],
      solution: [
        ['V1.pos', 'TP2'], ['V1.neg', 'TN2'], ['V2.pos', 'BP2'], ['V2.neg', 'BN2'], ['wire', 'TN4', 'BN4'],
        ['R1', 'TP24', 'I24'], ['R2', 'H20', 'H24'], ['wire', 'TN20', 'J20'], ['wire', 'F24', 'E24'],
        ['R3', 'D24', 'D28'], ['wire', 'A28', 'BP28'], ['M1.red', 'C24'], ['M1.black', 'C28'],
      ],
      done: (c) => `Node 3 settles at ${fmtVolts(c.nodeV('n3'))}, so Vx = ${fmtVolts(c.meter('M1'))}. R1 and R3 are equal, so on their own they would park Node 3 midway between the supplies at 4.15 V. The 10 kΩ to ground drags it down a little.`,
    }],
  },
  {
    id: 'joystick', chapter: 3, title: 'Joystick to ADC', course: 'ECE 473/573, lesson 1',
    modules: ['U1'],
    parts: { U1: { type: 'mcu' }, JS1: { type: 'joystick' } },
    steps: [{
      brief: 'Plug in the joystick, then run four leads from the Nucleo: 3V3 to Vcc, GND to GND, PC2 to Xout, PC3 to Yout. Then push the stick to all four edges.',
      idea: 'Each joystick axis is a pot wired between 3.3 V and ground. Its wiper voltage follows the stick, and the ADC turns 0 to 3.3 V into a number from 0 to 4095.',
      sch: {
        size: [10.6, 8],
        boxes: [{ rect: [4.3, 0.2, 10.3, 7.8], label: 'Joystick module', dashed: true }],
        parts: [
          ['U1', 'mcu', [0.2, 0.2], [3, 7.8], { label: 'Nucleo-64', pins: { '3v3': [3, 1], pc2: [3, 4], pc3: [3, 5.5], gnd: [3, 7] }, names: { '3v3': '3V3', pc2: 'PC2', pc3: 'PC3', gnd: 'GND' } }],
          ['RX', 'pot', [6.4, 2], [6.4, 6], { w: [5, 4], label: '10 kΩ', labelDy: -1.25, map: { a: 'JS1.vcc', w: 'JS1.x', b: 'JS1.gnd' } }],
          ['RY', 'pot', [9, 2], [9, 6], { w: [7.6, 4], label: '10 kΩ', labelDy: -1.25, map: { a: 'JS1.vcc', w: 'JS1.y', b: 'JS1.gnd' } }],
        ],
        nodes: {
          v33: node('3.3 V', 'red', [[[3, 1], [9, 1], [9, 2]], [[6.4, 1], [6.4, 2]]], { dots: [[6.4, 1]] }),
          x: node('Xout', 'yellow', [[[3, 4], [5, 4]]]),
          y: node('Yout', 'blue', [[[3, 5.5], [7.6, 5.5], [7.6, 4]]], { hops: [[6.4, 5.5]] }),
          gnd: node('Ground', 'green', [[[3, 7], [9, 7], [9, 6]], [[6.4, 6], [6.4, 7]]], { dots: [[6.4, 7]] }),
        },
      },
      tray: ['JS1'],
      solution: [['JS1', 'J15'], ['U1.3v3', 'G15'], ['U1.pc2', 'G16'], ['U1.pc3', 'G17'], ['U1.gnd', 'G19']],
      goalText: 'Stick pushed to all four edges',
      goal: (c) => c.flags.size >= 4,
      done: 'No current flows into PC2 or PC3. An ADC input only looks at the voltage, the same way a meter probe does. Where two schematic lines cross with no dot, they are not connected.',
    }],
  },
]

function dividerSch(bottomRef, bottomLabel) {
  return {
    size: [8, 6],
    parts: [
      ['V1', 'source', [1, 1], [1, 5], { label: '5 V' }],
      ['R1', 'resistor', [4, 1], [4, 3], { label: '1 kΩ', labelSide: 'left' }],
      [bottomRef, 'resistor', [4, 3], [4, 5], { label: bottomLabel, labelSide: 'left' }],
      ['M1', 'meter', [6.6, 3], [6.6, 5]],
    ],
    nodes: {
      vcc: node('5 V', 'red', [[[1, 1], [4, 1]]]),
      out: node('Vout', 'violet', [[[4, 3], [6.6, 3]]], { dots: [[4, 3]] }),
      gnd: node('Ground', 'green', [[[1, 5], [6.6, 5]]], { dots: [[4, 5]] }),
    },
  }
}

export const SANDBOX = {
  id: 'sandbox', title: 'Free bench', sandbox: true,
  modules: ['V1', 'M1'],
  parts: { V1: V5, M1: METER },
  stock: [
    { label: '330 Ω', spec: R(330), prefix: 'R' },
    { label: '1 kΩ', spec: R(1000), prefix: 'R' },
    { label: '10 kΩ', spec: R(10000), prefix: 'R' },
    { label: 'Red LED', spec: LED('red'), prefix: 'D' },
    { label: 'Green LED', spec: LED('green'), prefix: 'D' },
    { label: 'Blue LED', spec: LED('blue'), prefix: 'D' },
    { label: 'Pot', spec: { type: 'pot' }, prefix: 'RV' },
  ],
  steps: [{ brief: 'No goal here. Build anything and watch what the current does.', tray: ['wire'], pre: SUPPLY_ON_RAILS }],
}

/** Circuits the inspector draws from: a level and how many steps to build. */
export const INSPECT = ['lines-are-nodes', 'series', 'ladder', 'two-roads', 'divider', 'two-supplies', 'joystick']
