// Checks the challenge-creation helpers. Run: bun scripts/verify-create.ts
import assert from 'node:assert/strict';
import { PRESETS, packTable, parsePot, tableProblem, windowProblem } from '../src/arena/create';

const byId = Object.fromEntries(PRESETS.map((p) => [p.id, p]));
const hex = (id: string) => packTable(byId[id].nIn, byId[id].nOut, byId[id].expected);

// The packing must equal the bytes the deploy scripts send (they are what Arena's tests and the real chain accepted).
assert.equal(hex('full'), '0x94e9');
assert.equal(hex('maj'), '0xe8');
assert.equal(hex('par4'), '0x9669');
assert.equal(hex('xor'), '0x06');
assert.equal(hex('and'), '0x08');
for (const p of PRESETS) assert.equal(tableProblem(p.nIn, p.nOut, p.expected), null, p.id);

// A puzzle with a constant lamp is rejected, as are sizes outside the form.
assert.match(tableProblem(2, 1, [0, 0, 0, 0]) ?? '', /never changes/);
assert.match(tableProblem(7, 1, new Array<number>(128).fill(0)) ?? '', /1 to 6/);
assert.match(tableProblem(2, 1, [0, 1]) ?? '', /wrong size/);

assert.equal(parsePot('1', 6), 1_000_000n);
assert.equal(parsePot('0.1', 6), 100_000n);
assert.equal(parsePot('0', 6), null);
assert.equal(parsePot('1.1234567', 6), null);
assert.equal(parsePot('-1', 6), null);
assert.equal(parsePot('abc', 6), null);
assert.equal(windowProblem(48, 48), null);
assert.match(windowProblem(0, 48) ?? '', /at least 1 hour/);
assert.match(windowProblem(48, 24 * 91) ?? '', /at most/);
console.log('challenge creation helpers: all checks passed');
