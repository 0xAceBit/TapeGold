import { encodeAbiParameters, keccak256, type Address, type Hex } from 'viem';
import { CHAIN_ID_FOR_COMMITMENTS, MOCK_CONTRACT } from './rules';

/**
 * A flat NAND-only design in TapeOut's wire format.
 * Signals: 0 = const 0, 1 = const 1, inputs = 2..1+nIn, gate k outputs signal 2+nIn+k.
 * A gate may only read signals that already exist (strictly before its own output).
 * The circuit outputs are the last nOut signals, in order (output 0 first).
 */
export interface Gate {
  a: number;
  b: number;
}

export interface Design {
  nIn: number;
  nOut: number;
  gates: Gate[];
}

export function signalName(sig: number, nIn: number): string {
  if (sig === 0) return '0';
  if (sig === 1) return '1';
  if (sig < 2 + nIn) return `in${sig - 2}`;
  return `g${sig - 2 - nIn}`;
}

/** Returns a human readable problem, or null when the design is well formed. */
export function validateDesign(d: Design): string | null {
  if (d.gates.length === 0) return 'Add at least one gate.';
  if (d.gates.length < d.nOut) return `Need at least ${d.nOut} gate${d.nOut === 1 ? '' : 's'} to drive ${d.nOut} output${d.nOut === 1 ? '' : 's'}.`;
  for (let k = 0; k < d.gates.length; k++) {
    const own = 2 + d.nIn + k;
    const g = d.gates[k];
    if (g.a < 0 || g.a >= own || g.b < 0 || g.b >= own) return `Gate g${k} reads a signal that does not exist yet.`;
  }
  return null;
}

/** NAND = 00 a:u24 b:u24 (7 bytes). */
export function encodeNetlist(gates: Gate[]): Hex {
  let hex = '0x';
  for (const g of gates) {
    hex += '00' + g.a.toString(16).padStart(6, '0') + g.b.toString(16).padStart(6, '0');
  }
  return hex as Hex;
}

export function netlistHash(gates: Gate[]): Hex {
  return keccak256(encodeNetlist(gates));
}

/** Every wire value for one input vector: index 0 and 1 are the constants, inputs start at 2, then one entry per gate. */
export function evalSignals(d: Design, vector: number): number[] {
  const total = 2 + d.nIn + d.gates.length;
  const sig = new Array<number>(total).fill(0);
  sig[1] = 1;
  for (let i = 0; i < d.nIn; i++) sig[2 + i] = (vector >> i) & 1;
  d.gates.forEach((g, k) => {
    sig[2 + d.nIn + k] = sig[g.a] & sig[g.b] ? 0 : 1;
  });
  return sig;
}

/** Same bit packing as eval: input i is bit i of the vector, output j is bit j of the result. */
export function evalDesign(d: Design, vector: number): number {
  const sig = evalSignals(d, vector);
  let out = 0;
  const first = sig.length - d.nOut;
  for (let j = 0; j < d.nOut; j++) out |= sig[first + j] << j;
  return out;
}

export function truthTable(d: Design): number[] {
  return Array.from({ length: 2 ** d.nIn }, (_, v) => evalDesign(d, v));
}

/** Mirrors TapeGolf.commitmentOf: keccak256(abi.encode(contract, chainid, contestId, designer, netlistHash, salt)). */
export function commitmentOf(contestId: number, designer: Address, hash: Hex, salt: Hex): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: 'address' },
        { type: 'uint256' },
        { type: 'uint256' },
        { type: 'address' },
        { type: 'bytes32' },
        { type: 'bytes32' },
      ],
      [MOCK_CONTRACT, BigInt(CHAIN_ID_FOR_COMMITMENTS), BigInt(contestId), designer, hash, salt],
    ),
  );
}

export function randomSalt(): Hex {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return ('0x' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')) as Hex;
}

export function short(hex: string, head = 6, tail = 4): string {
  return hex.length <= head + tail + 2 ? hex : `${hex.slice(0, head)}…${hex.slice(-tail)}`;
}

/** Number of fixed bits shown as 0/1 strings, LSB first, e.g. outputs for a table row. */
export function bits(value: number, width: number): string {
  let s = '';
  for (let i = width - 1; i >= 0; i--) s += (value >> i) & 1;
  return s;
}
