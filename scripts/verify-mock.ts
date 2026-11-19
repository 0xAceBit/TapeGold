// Checks the demo engine against the rules the contract enforces. Run with: bun run scripts/verify-mock.ts
import assert from 'node:assert/strict';
import { advance, claim, commitDesign, phaseOf, reveal, settle, tapeOut } from '../src/mock/engine';
import { PERSONA_BY_ID, FEE_RECIPIENT } from '../src/mock/personas';
import { DESIGNS, seedState, usdc } from '../src/mock/seed';
import { ContractError } from '../src/mock/types';

const bo = PERSONA_BY_ID.bo.address;
const cy = PERSONA_BY_ID.cy.address;
const di = PERSONA_BY_ID.di.address;

function expectError(name: string, fn: () => unknown) {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof ContractError, `expected ContractError, got ${String(e)}`);
    assert.equal(e.errorName, name);
    return;
  }
  assert.fail(`expected ${name}`);
}

// 1. Seed world is consistent.
const s0 = seedState();
const phases = s0.contests.map((c) => `${c.title}:${phaseOf(c, s0.now)}`);
assert.deepEqual(phases, ['AND Golf:Settled', 'Majority-3 Golf:Ended', 'Half Adder Golf:Reveal', 'XOR Golf:Commit']);
assert.equal(s0.contests[0].leader?.designer, bo, 'AND tie goes to the earlier commit');
assert.equal(s0.contests[0].leader?.gateCount, 2);
assert.equal(s0.contests[1].leader?.designer, cy);
assert.equal(s0.contests[1].leader?.gateCount, 6);
assert.equal(s0.contests[2].leader?.gateCount, 5);
assert.equal(s0.contests[2].commits[di].revealed, false);
assert.equal(s0.pending[bo], usdc(195), 'winner payout = prize minus 2.5% fee');
assert.equal(s0.pending[FEE_RECIPIENT.address], usdc(5));

// 2. Full flow on the XOR contest, reveal order must not matter.
let s = s0;
const xorId = 4;
s = commitDesign(s, bo, xorId, [...DESIGNS.xor4, { a: 7, b: 7 }, { a: 8, b: 8 }]);
s = commitDesign(s, cy, xorId, [...DESIGNS.xor4]);
expectError('AlreadyCommitted', () => commitDesign(s, bo, xorId, [...DESIGNS.xor4]));
expectError('CommitFirst', () => tapeOut(s, di, xorId));
s = tapeOut(s, bo, xorId);
s = tapeOut(s, cy, xorId);
expectError('NotRevealPhase', () => reveal(s, bo, xorId));
s = advance(s, 48 * 3600);
expectError('CommitPhaseClosed', () => commitDesign(s, di, xorId, [...DESIGNS.xor4]));
s = reveal(s, cy, xorId);
s = reveal(s, bo, xorId);
assert.equal(s.contests[3].leader?.designer, cy, 'fewer gates wins even though Bo committed first');
expectError('AlreadyRevealed', () => reveal(s, bo, xorId));
expectError('ContestNotEnded', () => settle(s, bo, xorId, true));
s = advance(s, 48 * 3600);
const before = s.balances[cy] ?? 0n;
s = settle(s, di, xorId, true);
assert.equal((s.balances[cy] ?? 0n) - before, usdc(250) - usdc(6.25));
expectError('AlreadySettled', () => settle(s, di, xorId, true));
s = claim(s, di, FEE_RECIPIENT.address);
expectError('NothingToClaim', () => claim(s, di, FEE_RECIPIENT.address));

// 3. A circuit that does not match the spec can be committed to, but cannot be revealed.
let w = seedState();
w = commitDesign(w, di, 4, [{ a: 2, b: 3 }]);
w = tapeOut(w, di, 4);
w = advance(w, 48 * 3600);
expectError('TruthTableMismatch', () => reveal(w, di, 4));

// 4. No reveal at all: the sponsor is refunded without a fee.
let r = seedState();
r = advance(r, 100 * 3600);
r = settle(r, bo, 4, false);
assert.equal(r.contests[3].fee, 0n);
assert.equal(r.pending[PERSONA_BY_ID.ana.address], usdc(250));

console.log('mock engine: all checks passed');
