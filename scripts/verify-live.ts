// Checks the live-page helpers: hall of fame, featured challenge, and reading a real circuit from X Layer.
// Run: bun scripts/verify-live.ts   (reads the public RPC, spends nothing)
import assert from 'node:assert/strict';
import type { Address } from 'viem';
import type { Challenge } from '../src/arena/arena';
import { NATIVE_USDC } from '../src/arena/create';
import { decodeFlatNand, readWinningCircuit } from '../src/arena/netlist';
import { featured, hallOfFame } from '../src/arena/stats';
import { evalDesign } from '../src/mock/netlist';

const store = new Map<string, string>();
Object.assign(globalThis, { window: globalThis, localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) } });

const A = '0x1111111111111111111111111111111111111111' as Address;
const B = '0x2222222222222222222222222222222222222222' as Address;
const OTHER = '0x3333333333333333333333333333333333333333' as Address;
const mk = (id: number, phase: 0 | 1 | 2 | 3, pot: bigint, winner: Address | null, score = 4, token: Address = NATIVE_USDC): Challenge => ({
  id, sponsor: A, token, processor: A, pot, nIn: 2, nOut: 1, commitEnd: 0, revealEnd: 0, commitCount: 1, finalized: phase === 3, refundable: false, table: '0x06', phase,
  best: winner ? { winner, circuitId: 1n, score, commitIndex: 1 } : null, tokenSymbol: 'USDC', tokenDecimals: 6,
});

// hall of fame: only finished challenges count as wins; open leaders are counted separately
const list = [mk(1, 3, 1_000_000n, A, 6), mk(2, 3, 2_000_000n, A, 4), mk(3, 2, 500_000n, B, 5), mk(4, 0, 9_000_000n, B), mk(5, 3, 700_000n, OTHER, 3, OTHER), mk(6, 3, 100n, null)];
const hof = hallOfFame(list);
assert.equal(hof[0].player, A);
assert.equal(hof[0].wins, 2);
assert.equal(hof[0].usdcWon, 3_000_000n);
assert.equal(hof[0].bestScore, 4);
const b = hof.find((r) => r.player === B)!;
assert.equal(b.wins, 1);
assert.equal(b.leading, 1);
const o = hof.find((r) => r.player === OTHER)!;
assert.equal(o.usdcWon, 0n, 'a custom token is not added to the USDC total');
assert.equal(hallOfFame([]).length, 0);

// featured: the biggest open standard-USDC pot, never a finished one
assert.equal(featured(list)?.id, 4);
assert.equal(featured([mk(1, 3, 5n, A), mk(2, 2, 5n, A)]), null);
assert.equal(featured([mk(1, 0, 5n, null), mk(2, 1, 5n, null)])?.id, 2, 'ties go to the newest');
assert.equal(featured([mk(1, 0, 1n, null), mk(2, 0, 99n, null, 4, OTHER)])?.id, 1, 'standard USDC is preferred over a custom token');

// netlist decoding
assert.equal(decodeFlatNand('0x'), null);
assert.equal(decodeFlatNand('0x0000000200000300'), null, 'wrong length');
assert.equal(decodeFlatNand('0x02000000020000030000'), null, 'only NAND records are drawn');
assert.deepEqual(decodeFlatNand('0x0000000200000300000004000004'), [{ a: 2, b: 3 }, { a: 4, b: 4 }]);

// a real circuit on X Layer: Cerebr's XOR (#4) on its processor, read from the chain and redrawn
const CEREBR = '0xB04EB79D1A5EECaabAAfF7B77d7c27578EE693FF' as Address;
const xor = await readWinningCircuit(CEREBR, 4n, 2, 1, '0x06');
assert.ok(xor.gates, 'circuit 4 is plain NAND gates');
assert.equal(xor.matches, true, 'the redrawn circuit reproduces the XOR table');
assert.equal(xor.gates.length * 7, xor.bytes);
[0, 1, 1, 0].forEach((want, v) => assert.equal(evalDesign({ nIn: 2, nOut: 1, gates: xor.gates as never }, v), want));
const withParts = await readWinningCircuit(CEREBR, 5n, 2, 1, '0x06');
assert.equal(withParts.gates, null, 'circuit 5 calls other circuits, so it is not drawn');
const wrongTable = await readWinningCircuit(CEREBR, 4n, 2, 1, '0x08');
assert.equal(wrongTable.matches, false, 'a drawing that does not match the challenge is not trusted');
console.log(`live helpers verified (circuit 4 on X Layer: ${xor.gates.length} gates redrawn)`);
