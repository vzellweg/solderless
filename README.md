# Solderless

A game for learning to read circuit schematics and build them on a breadboard.
You get a schematic on paper and a 3D breadboard. Build the circuit and the
current shows up as moving dots, LEDs light, and each node you complete is
marked in the same colour on the paper and on the board.

It follows the two circuits from the ECE 201 and ECE 473/573
circuits-to-breadboard lessons: the two-supply resistor network and the
joystick wired to an ADC. The last two lessons are those circuits.

## Run it

```sh
pnpm install
pnpm dev      # http://localhost:5183
pnpm test     # every lesson is solvable, the physics checks out, inspector faults are real
pnpm build    # static site in dist/
```

## What's in it

- **Lessons** (14): how the board is wired inside, reading schematics as
  nodes, series and parallel, voltage dividers, then the two course circuits.
  Some ask for a prediction before the power comes on.
- **Continuity**: two probes on a random board, sixty seconds. Same node or not?
- **Inspector**: a schematic and a finished board. Find the wiring mistake, or
  pass the board if there isn't one.
- **Free bench**: every part, no goal.

Controls: click a part in the bin, then click holes (or drag between two).
Drag a leg to move it. Right-drag turns the camera, scroll zooms.
`X` X-ray, `V` top view, `H` hint, `P` power, `⌘Z` undo, `Delete` removes the
selected part, `F` flips an LED.

## How it's put together

| File | Job |
| --- | --- |
| `src/board.js` | Breadboard geometry: holes, strips, rails |
| `src/circuit.js` | Nets, the DC solver, and the schematic-vs-board check |
| `src/levels.js` | Lesson content: schematic, parts, one known-good build each |
| `src/schematic.js` | Draws a schematic as SVG from the lesson data |
| `src/scene/` | three.js: board, parts, current dots, camera, picking |
| `src/game/` | Lesson play, Continuity, Inspector |

A lesson's netlist is derived from how its schematic is drawn, so the drawing
and the check can't disagree. The solver treats every strip as a node and
every jumper as a tiny resistor, which is what lets the dots follow real
current through wires and along the clips.

Progress is saved in the browser's local storage only.
