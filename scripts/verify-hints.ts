// Checks the hint logic. Run: bun scripts/verify-hints.ts
import assert from 'node:assert/strict';
import { findWaste, hintFor } from '../src/lib/hints';
import { LEVELS } from '../src/practice';
import { evalDesign } from '../src/mock/netlist';

const g = (a: number, b: number) => ({ a, b });
const maj = [0, 0, 0, 1, 0, 1, 1, 1];

// The 8-gate majority circuit from a real screenshot: g6 and g7 are two flips in a row.
const eight = { nIn: 3, nOut: 1, gates: [g(2, 3), g(3, 4), g(2, 4), g(5, 6), g(8, 8), g(9, 7), g(10, 10), g(11, 11)] };
const h = hintFor(eight, maj, 6);
assert.equal(h.kind, 'double-flip');
assert.deepEqual(h.gates, [6, 7]);
assert.match(h.message, /g6 flips the answer and g7 flips it straight back/);
assert.equal(hintFor({ ...eight, gates: eight.gates.slice(0, 6) }, maj, 6).kind, 'best');

assert.equal(findWaste({ nIn: 2, nOut: 1, gates: [g(2, 3), g(2, 4), g(3, 4), g(2, 2), g(5, 6)] })?.kind, 'dead');
assert.equal(findWaste({ nIn: 2, nOut: 1, gates: [g(2, 3), g(2, 3), g(4, 5)] })?.kind, 'duplicate');
assert.equal(hintFor({ nIn: 2, nOut: 1, gates: [] }, [0, 1, 1, 0], 4).kind, 'empty');
assert.equal(hintFor({ nIn: 2, nOut: 1, gates: [g(2, 3)] }, [0, 1, 1, 0], 4).kind, 'wrong');
assert.equal(hintFor({ nIn: 2, nOut: 1, gates: [g(2, 9)] }, [0, 1, 1, 0], 4).kind, 'invalid');

// Every practice puzzle's stored solution is correct, has the stated par, and has nothing wasted.
for (const l of LEVELS) {
  const d = { nIn: l.nIn, nOut: l.nOut, gates: l.solution };
  l.expected.forEach((want, v) => assert.equal(evalDesign(d, v), want, `${l.id} row ${v}`));
  assert.equal(l.solution.length, l.par, `${l.id} par`);
  assert.equal(findWaste(d), null, `${l.id} waste`);
  assert.equal(hintFor(d, l.expected, l.par).kind, 'best');
}
console.log('hints and practice levels: all checks passed');
