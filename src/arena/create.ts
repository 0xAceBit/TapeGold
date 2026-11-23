import { parseUnits, type Address, type Hex } from 'viem';

/** Native USDC on X Layer (6 decimals). Source: OKX "Native USDC & CCTP are Now Live on X Layer"; symbol and decimals read onchain. */
export const NATIVE_USDC: Address = '0xB6CEceAB302E2E4948951eE7843FC24E92933061';

/**
 * The TapeOut processor the first challenges use (found with the FindProcessor script: free supply, mint price 0, open to any wallet).
 * It belongs to someone else, who decides who may tape out on it. Players build their circuit on the processor named in the challenge.
 */
export const DEFAULT_PROCESSOR: Address = '0x9e2849c04A513FE64db07521cBE52d078d905c0E';

/** Limits the form enforces. Arena itself allows up to 8 and 8; the form stays smaller so a reveal stays cheap to grade. */
export const MAX_FORM_INPUTS = 6;
export const MAX_FORM_OUTPUTS = 4;
/** Arena rejects commit or reveal windows longer than 90 days. */
export const MAX_WINDOW_HOURS = 24 * 90;

export interface Preset {
  id: string;
  name: string;
  blurb: string;
  nIn: number;
  nOut: number;
  expected: number[];
}

const popcount = (v: number) => v.toString(2).replace(/0/g, '').length;
const rows = (n: number, f: (v: number) => number) => Array.from({ length: 2 ** n }, (_, v) => f(v));

export const PRESETS: Preset[] = [
  { id: 'and', name: 'AND', blurb: 'The lamp is on only when both switches are on.', nIn: 2, nOut: 1, expected: rows(2, (v) => (v === 3 ? 1 : 0)) },
  { id: 'xor', name: 'XOR', blurb: 'The lamp is on when exactly one of two switches is on.', nIn: 2, nOut: 1, expected: rows(2, (v) => popcount(v) & 1) },
  { id: 'half', name: 'Half adder', blurb: 'Add two bits: sum on output 0, carry on output 1.', nIn: 2, nOut: 2, expected: rows(2, popcount) },
  { id: 'maj', name: '3-input majority', blurb: 'The lamp is on when at least two of three switches are on.', nIn: 3, nOut: 1, expected: rows(3, (v) => (popcount(v) >= 2 ? 1 : 0)) },
  { id: 'full', name: 'Full adder', blurb: 'Add three bits: sum on output 0, carry on output 1.', nIn: 3, nOut: 2, expected: rows(3, popcount) },
  { id: 'par4', name: '4-bit parity', blurb: 'The lamp is on when an odd number of four switches are on.', nIn: 4, nOut: 1, expected: rows(4, (v) => popcount(v) & 1) },
];

/** Arena's packing: output bit j of input vector v is bit v * nOut + j of the table, LSB first, zero padded to whole bytes. */
export function packTable(nIn: number, nOut: number, expected: number[]): Hex {
  const bits = 2 ** nIn * nOut;
  const bytes = new Uint8Array(Math.ceil(bits / 8));
  for (let v = 0; v < 2 ** nIn; v++) {
    for (let j = 0; j < nOut; j++) {
      if (((expected[v] ?? 0) >> j) & 1) {
        const p = v * nOut + j;
        bytes[p >> 3] |= 1 << (p & 7);
      }
    }
  }
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** Explains in words why a puzzle is not worth posting, or returns null. */
export function tableProblem(nIn: number, nOut: number, expected: number[]): string | null {
  if (nIn < 1 || nIn > MAX_FORM_INPUTS) return `Use 1 to ${MAX_FORM_INPUTS} switches.`;
  if (nOut < 1 || nOut > MAX_FORM_OUTPUTS) return `Use 1 to ${MAX_FORM_OUTPUTS} lamps.`;
  if (expected.length !== 2 ** nIn) return 'The answer sheet is the wrong size.';
  const mask = 2 ** nOut - 1;
  if (expected.some((e) => e < 0 || e > mask)) return 'The answer sheet has a value outside the lamps.';
  for (let j = 0; j < nOut; j++) {
    const column = expected.map((e) => (e >> j) & 1);
    if (column.every((b) => b === column[0])) return `Lamp ${j} never changes, so a single gate or a constant would solve it. Make it depend on the switches.`;
  }
  return null;
}

/** Parses "1.25" into base units. Returns null for anything that is not a plain positive amount. */
export function parsePot(text: string, decimals: number): bigint | null {
  const t = text.trim();
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const [, frac = ''] = t.split('.');
  if (frac.length > decimals) return null;
  const v = parseUnits(t, decimals);
  return v > 0n ? v : null;
}

export function windowProblem(commitHours: number, revealHours: number): string | null {
  for (const [label, h] of [['Entry window', commitHours], ['Reveal window', revealHours]] as const) {
    if (!Number.isFinite(h) || h < 1) return `${label} must be at least 1 hour.`;
    if (h > MAX_WINDOW_HOURS) return `${label} can be at most ${MAX_WINDOW_HOURS} hours (90 days).`;
  }
  return null;
}
