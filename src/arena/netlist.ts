import type { Address, Hex } from 'viem';
import { evalDesign, type Gate } from '@/mock/netlist';
import { publicClient } from './chain';
import { circuitsAbi } from './tapeout';
import { expectedAt } from './specs';

/**
 * Turns a TapeOut netlist into gates. Only the plain kind is understood: a run of 7-byte NAND records
 * (tag 0x00, then two 24-bit signal numbers). Signals 0 and 1 are the constants, inputs start at 2, gate k is signal 2 + nIn + k.
 * Anything else (parts that call other circuits, latches) returns null: the site then says so instead of drawing it wrongly.
 */
export function decodeFlatNand(netlist: Hex): Gate[] | null {
  const hex = netlist.slice(2);
  if (hex.length === 0 || hex.length % 14 !== 0) return null;
  const gates: Gate[] = [];
  for (let i = 0; i < hex.length; i += 14) {
    if (hex.slice(i, i + 2) !== '00') return null;
    gates.push({ a: parseInt(hex.slice(i + 2, i + 8), 16), b: parseInt(hex.slice(i + 8, i + 14), 16) });
  }
  return gates;
}

export interface WinningCircuit {
  /** null when the circuit uses parts the picture cannot show. */
  gates: Gate[] | null;
  bytes: number;
  /** True when the drawn circuit gives exactly the challenge's answers, so the picture can be trusted. */
  matches: boolean;
}

/** Reads the winning circuit from the chain and checks that the drawing really reproduces the challenge's truth table. */
export async function readWinningCircuit(processor: Address, circuitId: bigint, nIn: number, nOut: number, table: Hex): Promise<WinningCircuit> {
  const netlist = await publicClient().readContract({ address: processor, abi: circuitsAbi, functionName: 'netlist', args: [circuitId] });
  const gates = decodeFlatNand(netlist);
  if (!gates) return { gates: null, bytes: (netlist.length - 2) / 2, matches: false };
  const design = { nIn, nOut, gates };
  let matches = gates.length >= nOut;
  for (let v = 0; matches && v < 1 << nIn; v++) if (evalDesign(design, v) !== expectedAt(table, nOut, v)) matches = false;
  return { gates, bytes: (netlist.length - 2) / 2, matches };
}
