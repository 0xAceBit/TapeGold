import { evalDesign, signalName, validateDesign, type Design } from '@/mock/netlist';

export interface Hint {
  kind: 'empty' | 'invalid' | 'wrong' | 'dead' | 'double-flip' | 'duplicate' | 'tight' | 'best';
  /** Gate indexes to highlight in the editor and the picture. */
  gates: number[];
  message: string;
}

const gateIndex = (nIn: number, signal: number) => signal - 2 - nIn;

/** Gates whose answer never reaches an output. The last nOut gates drive the outputs. */
function deadGates(d: Design): number[] {
  const n = d.gates.length;
  const live = new Array<boolean>(n).fill(false);
  for (let k = Math.max(0, n - d.nOut); k < n; k++) live[k] = true;
  for (let k = n - 1; k >= 0; k--) {
    if (!live[k]) continue;
    for (const s of [d.gates[k].a, d.gates[k].b]) {
      const i = gateIndex(d.nIn, s);
      if (i >= 0 && i < n) live[i] = true;
    }
  }
  return live.flatMap((l, k) => (l ? [] : [k]));
}

function consumersOf(d: Design, k: number): number[] {
  const sig = 2 + d.nIn + k;
  return d.gates.flatMap((g, i) => (g.a === sig || g.b === sig ? [i] : []));
}

/** Finds the first wasted gate, or null. Order: unused gates, a flip undone by another flip, a repeated gate. */
export function findWaste(d: Design): Hint | null {
  const name = (s: number) => signalName(s, d.nIn);

  const dead = deadGates(d);
  if (dead.length > 0) {
    const list = dead.map((k) => `g${k}`).join(', ');
    return {
      kind: 'dead',
      gates: dead,
      message: `${list} ${dead.length === 1 ? 'is' : 'are'} never used: nothing reads ${dead.length === 1 ? 'its' : 'their'} answer and ${dead.length === 1 ? 'it does' : 'they do'} not drive an output. Delete ${dead.length === 1 ? 'it' : 'them'} and the score gets better for free.`,
    };
  }

  // A flip is a gate with the same wire on both inputs. Flipping twice gets you back to the start.
  for (let b = 0; b < d.gates.length; b++) {
    const gb = d.gates[b];
    const a = gateIndex(d.nIn, gb.a);
    if (gb.a !== gb.b || a < 0 || a >= b) continue;
    const ga = d.gates[a];
    if (ga.a !== ga.b) continue;
    const y = ga.a;
    const onlyB = consumersOf(d, a).every((c) => c === b);
    const outputNote = b >= d.gates.length - d.nOut ? ' Keep the gate that gives the final answer last in the list.' : '';
    return onlyB
      ? {
          kind: 'double-flip',
          gates: [a, b],
          message: `g${a} flips the answer and g${b} flips it straight back, so the pair cancels out. Delete both and use ${name(y)} directly.${outputNote}`,
        }
      : {
          kind: 'double-flip',
          gates: [b],
          message: `g${b} flips back what g${a} flipped, so it is just ${name(y)} again. Delete g${b} and use ${name(y)} directly.${outputNote}`,
        };
  }

  for (let k = 1; k < d.gates.length; k++) {
    for (let j = 0; j < k; j++) {
      const x = d.gates[j];
      const y = d.gates[k];
      if ((x.a === y.a && x.b === y.b) || (x.a === y.b && x.b === y.a)) {
        return {
          kind: 'duplicate',
          gates: [j, k],
          message: `g${k} does exactly what g${j} does: same two inputs, same answer. Delete g${k} and point whatever used it at g${j}.`,
        };
      }
    }
  }
  return null;
}

/** One hint for the current design. `par` is the best known gate count, if there is one. */
export function hintFor(d: Design, expected: number[], par?: number): Hint {
  if (d.gates.length === 0) {
    return { kind: 'empty', gates: [], message: 'Start by clicking "Add gate". Then choose, for each of its two inputs, which switch or earlier gate feeds it.' };
  }
  const problem = validateDesign(d);
  if (problem) return { kind: 'invalid', gates: [], message: problem };

  const waste = findWaste(d);
  const wrong = expected.findIndex((want, v) => evalDesign(d, v) !== want);
  if (wrong >= 0) {
    const inputs = Array.from({ length: d.nIn }, (_, i) => `in${i}=${(wrong >> i) & 1}`).join(' ');
    const got = evalDesign(d, wrong);
    const message = `Not right yet. With ${inputs} your circuit gives ${got} but the answer sheet wants ${expected[wrong]}. Flip those switches in the picture and follow the lit wires to see where it goes wrong.`;
    return { kind: 'wrong', gates: waste?.gates ?? [], message: waste ? `${message} Also: ${waste.message}` : message };
  }
  if (waste) return waste;
  if (par !== undefined && d.gates.length > par) {
    return {
      kind: 'tight',
      gates: [],
      message: `Correct, and no gate is obviously wasted. The best known answer uses ${par}. Try letting one gate's answer feed two different gates instead of building it twice.`,
    };
  }
  return { kind: 'best', gates: [], message: par !== undefined ? 'This matches the best known score. Nicely done.' : 'Correct, and no gate is obviously wasted.' };
}
