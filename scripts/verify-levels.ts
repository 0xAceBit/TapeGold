// Checks the practice puzzles, the daily pool and the streak rules.
// Run: bun scripts/verify-levels.ts   (about 5 seconds)
import assert from 'node:assert/strict';
import { DAILY_POOL } from '../src/lib/dailyData';
import { findWaste, hintFor } from '../src/lib/hints';
import { dailyPuzzle, dayNumber, streakFrom, todayKey } from '../src/daily';
import { evalDesign } from '../src/mock/netlist';
import { LEVELS, REQUIRED, starsFor } from '../src/practice';

// ---- exhaustive search: the fewest NAND gates for every function of up to 3 inputs, up to MAXK gates ----
const MAXK = 7;
const MASK = 0xff;
const minSize = new Map<number, number>();
const sig = new Int32Array(16);
function dfs(depth: number, limit: number) {
  const n = 3 + depth;
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      const f = ~(sig[i] & sig[j]) & MASK;
      let dup = false;
      for (let k = 0; k < n; k++) if (sig[k] === f) { dup = true; break; }
      if (dup) continue;
      if (depth + 1 === limit) {
        if (!minSize.has(f)) minSize.set(f, limit);
      } else {
        sig[n] = f;
        dfs(depth + 1, limit);
      }
    }
  }
}
sig[0] = 0xaa; sig[1] = 0xcc; sig[2] = 0xf0;
for (let k = 1; k <= MAXK; k++) dfs(0, k);

const tableOf = (nIn: number, expected: number[]) => {
  // A puzzle with fewer than 3 inputs is the same function with an unused third input.
  let t = 0;
  for (let v = 0; v < 8; v++) t |= (expected[v & ((1 << nIn) - 1)] & 1) << v;
  return t;
};

// ---- practice levels ----
const seen = new Set<string>();
for (const l of LEVELS) {
  assert.ok(!seen.has(l.id), `duplicate level ${l.id}`);
  seen.add(l.id);
  assert.equal(l.expected.length, 2 ** l.nIn, `${l.id} table size`);
  const d = { nIn: l.nIn, nOut: l.nOut, gates: l.solution };
  l.expected.forEach((want, v) => assert.equal(evalDesign(d, v), want, `${l.id} row ${v}`));
  assert.equal(l.solution.length, l.par, `${l.id} par equals its solution`);
  assert.equal(findWaste(d), null, `${l.id} solution has no waste`);
  assert.equal(hintFor(d, l.expected, l.par).kind, 'best', `${l.id} hint`);
  assert.ok(l.nudges.length >= 2, `${l.id} nudges`);
  if (l.nOut === 1) {
    const proven = minSize.get(tableOf(l.nIn, l.expected));
    assert.equal(proven, l.par, `${l.id}: par ${l.par} must be the proven minimum (search says ${proven})`);
  }
}
assert.deepEqual(REQUIRED, ['not', 'and', 'xor']);
assert.equal(starsFor(4, 4), 3);
assert.equal(starsFor(4, 3), 3);
assert.equal(starsFor(4, 5), 2);
assert.equal(starsFor(4, 6), 1);

// ---- daily pool: every entry is correct, minimal, and has nothing wasted ----
assert.ok(DAILY_POOL.length > 150, 'enough puzzles for months of days');
const tables = new Set<number>();
for (const e of DAILY_POOL) {
  assert.ok(!tables.has(e.table), `duplicate puzzle ${e.table}`);
  tables.add(e.table);
  const d = { nIn: 3, nOut: 1, gates: e.gates.map(([a, b]) => ({ a, b })) };
  for (let v = 0; v < 8; v++) assert.equal(evalDesign(d, v), (e.table >> v) & 1, `daily ${e.table} row ${v}`);
  assert.equal(e.gates.length, e.par, `daily ${e.table} witness size`);
  assert.equal(findWaste(d), null, `daily ${e.table} waste`);
  const proven = minSize.get(e.table);
  if (e.par <= MAXK) assert.equal(proven, e.par, `daily ${e.table}: par ${e.par}, search says ${proven}`);
  else assert.equal(proven, undefined, `daily ${e.table}: nothing smaller than ${MAXK + 1} exists`);
}

// ---- daily puzzle choice: stable, and the same for everyone on a given day ----
const a = dailyPuzzle('2026-11-23');
const b = dailyPuzzle('2026-11-23');
assert.deepEqual(a, b);
assert.equal(a.number, 1);
assert.equal(dailyPuzzle('2026-11-24').number, 2);
const sixMonths = new Set<number>();
for (let n = 0; n < DAILY_POOL.length; n++) sixMonths.add(dailyPuzzle(todayKey(new Date((dayNumber('2026-11-23') + n) * 86_400_000))).expected.reduce((t, e, v) => t | (e << v), 0));
assert.equal(sixMonths.size, DAILY_POOL.length, 'no repeats until the pool is used up');

// ---- streak rules ----
assert.equal(streakFrom({}, '2026-11-25'), 0);
assert.equal(streakFrom({ '2026-11-25': 5 }, '2026-11-25'), 1);
assert.equal(streakFrom({ '2026-11-23': 5, '2026-11-24': 4, '2026-11-25': 6 }, '2026-11-25'), 3);
assert.equal(streakFrom({ '2026-11-23': 5, '2026-11-24': 4 }, '2026-11-25'), 2, 'still alive before today is solved');
assert.equal(streakFrom({ '2026-11-23': 5 }, '2026-11-25'), 0, 'a missed day breaks it');
assert.equal(streakFrom({ '2026-11-20': 5, '2026-11-21': 5, '2026-11-23': 5, '2026-11-24': 5 }, '2026-11-24'), 2, 'a gap resets');
assert.equal(streakFrom({ '2026-12-31': 5, '2027-01-01': 5 }, '2027-01-01'), 2, 'across a year');
console.log(`levels: ${LEVELS.length} puzzles verified, daily: ${DAILY_POOL.length} puzzles verified, streak rules verified`);
