import type { Address } from 'viem';
import { advance, commitDesign, createContest, reveal, settle, tapeOut } from './engine';
import { evalDesign, type Gate } from './netlist';
import { PERSONA_BY_ID } from './personas';
import type { ChainState } from './types';

export const usdc = (n: number): bigint => BigInt(Math.round(n * 1_000_000));

const g = (a: number, b: number): Gate => ({ a, b });
const HOUR = 3600;

// Reference designs. Signals: 0/1 constants, inputs from 2, gate k outputs signal 2+nIn+k.
export const DESIGNS = {
  and: [g(2, 3), g(4, 4)],
  xor4: [g(2, 3), g(2, 4), g(3, 4), g(5, 6)],
  halfAdder5: [g(2, 3), g(2, 4), g(3, 4), g(5, 6), g(4, 4)],
  halfAdder7: [g(2, 3), g(2, 4), g(3, 4), g(5, 6), g(7, 7), g(8, 8), g(4, 4)],
  maj6: [g(2, 3), g(3, 4), g(2, 4), g(5, 6), g(8, 8), g(9, 7)],
  maj8: [g(2, 3), g(3, 4), g(2, 4), g(5, 6), g(8, 8), g(9, 7), g(10, 10), g(11, 11)],
} as const;

export const SPECS = {
  and: { nIn: 2, nOut: 1, expected: [0, 0, 0, 1] },
  xor: { nIn: 2, nOut: 1, expected: [0, 1, 1, 0] },
  halfAdder: { nIn: 2, nOut: 2, expected: [0, 1, 1, 2] },
  maj3: { nIn: 3, nOut: 1, expected: [0, 0, 0, 1, 0, 1, 1, 1] },
} as const;

function selfCheck() {
  const ok = (spec: { nIn: number; nOut: number; expected: readonly number[] }, gates: readonly Gate[]) =>
    spec.expected.every((e, v) => evalDesign({ nIn: spec.nIn, nOut: spec.nOut, gates: [...gates] }, v) === e);
  const checks: Array<[string, boolean]> = [
    ['and', ok(SPECS.and, DESIGNS.and)],
    ['xor4', ok(SPECS.xor, DESIGNS.xor4)],
    ['halfAdder5', ok(SPECS.halfAdder, DESIGNS.halfAdder5)],
    ['halfAdder7', ok(SPECS.halfAdder, DESIGNS.halfAdder7)],
    ['maj6', ok(SPECS.maj3, DESIGNS.maj6)],
    ['maj8', ok(SPECS.maj3, DESIGNS.maj8)],
  ];
  const bad = checks.filter(([, pass]) => !pass).map(([name]) => name);
  if (bad.length) throw new Error(`Seed designs do not match their specs: ${bad.join(', ')}`);
}

/** Builds the demo world by replaying real actions through the engine, so every number on screen is consistent. */
export function seedState(): ChainState {
  selfCheck();
  const ana = PERSONA_BY_ID.ana.address;
  const bo = PERSONA_BY_ID.bo.address;
  const cy = PERSONA_BY_ID.cy.address;
  const di = PERSONA_BY_ID.di.address;
  const t0 = Math.floor(Date.now() / 1000);

  let s: ChainState = {
    version: 1,
    now: t0,
    contests: [],
    circuits: [],
    balances: { [ana]: usdc(10_000), [bo]: usdc(1_000), [cy]: usdc(1_000), [di]: usdc(1_000) },
    pending: {},
    drafts: {},
    log: [],
  };

  const open = (title: string, blurb: string, prize: number, spec: { nIn: number; nOut: number; expected: readonly number[] }, maxGates: number, commitH: number, revealH: number) => {
    s = createContest(s, ana, {
      title,
      blurb,
      prize: usdc(prize),
      processor: 'any',
      nIn: spec.nIn,
      nOut: spec.nOut,
      expected: [...spec.expected],
      maxGates,
      maxNetlistBytes: maxGates * 7,
      commitDeadline: s.now + commitH * HOUR,
      revealDeadline: s.now + revealH * HOUR,
    });
  };
  const enter = (who: Address, id: number, gates: readonly Gate[]) => {
    s = commitDesign(s, who, id, [...gates]);
    s = tapeOut(s, who, id);
  };

  // t+0h: two contests open. AND ends first, then Majority-3.
  open('AND Golf', 'Build AND from NAND gates. Fewest gates wins.', 200, SPECS.and, 8, 2, 4);
  open('Majority-3 Golf', 'Output 1 when at least two of three inputs are 1.', 400, SPECS.maj3, 16, 3, 6);
  enter(bo, 1, DESIGNS.and);
  enter(cy, 1, DESIGNS.and);
  enter(cy, 2, DESIGNS.maj6);
  enter(bo, 2, DESIGNS.maj8);
  enter(di, 2, DESIGNS.maj6);

  s = advance(s, 3 * HOUR);
  s = reveal(s, bo, 1);
  s = reveal(s, cy, 1);
  s = reveal(s, cy, 2);
  s = reveal(s, bo, 2);

  s = advance(s, 1 * HOUR);
  s = settle(s, di, 1, false);

  // t+4h: Half Adder opens; its commit phase closes an hour later.
  open('Half Adder Golf', 'Two outputs: sum on output 0, carry on output 1.', 600, SPECS.halfAdder, 12, 1, 8);
  enter(bo, 3, DESIGNS.halfAdder5);
  enter(cy, 3, DESIGNS.halfAdder5);
  enter(di, 3, DESIGNS.halfAdder7);
  s = advance(s, 1 * HOUR);
  s = reveal(s, bo, 3);
  s = reveal(s, cy, 3);

  s = advance(s, 2 * HOUR);

  // t+7h: a fresh contest for the full flow.
  open('XOR Golf', 'Output 1 when exactly one input is 1.', 250, SPECS.xor, 12, 48, 96);

  s.log = [];
  return s;
}

/** Starter designs that are correct but not minimal, so there is something to golf. Returns null for custom specs. */
export function exampleFor(nIn: number, nOut: number, expected: number[]): Gate[] | null {
  const same = (spec: { nIn: number; nOut: number; expected: readonly number[] }) =>
    spec.nIn === nIn && spec.nOut === nOut && spec.expected.length === expected.length && spec.expected.every((e, i) => e === expected[i]);
  if (same(SPECS.xor)) return [...DESIGNS.xor4, g(7, 7), g(8, 8)];
  if (same(SPECS.and)) return [...DESIGNS.and, g(5, 5), g(6, 6)];
  if (same(SPECS.halfAdder)) return [...DESIGNS.halfAdder7];
  if (same(SPECS.maj3)) return [...DESIGNS.maj8];
  return null;
}
