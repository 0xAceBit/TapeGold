import type { Hex } from 'viem';

export interface SpecInfo { name: string; inputs: string[]; outputs: string[]; known: boolean }

// The three challenges seeded by the deploy scripts (table bytes are the ones the scripts send).
const KNOWN: Record<string, SpecInfo> = {
  '3:2:0x94e9': { name: 'Full adder', inputs: ['a', 'b', 'cin'], outputs: ['sum', 'cout'], known: true },
  '3:1:0xe8': { name: '3-input majority', inputs: ['a', 'b', 'c'], outputs: ['maj'], known: true },
  '4:1:0x9669': { name: '4-bit parity', inputs: ['a', 'b', 'c', 'd'], outputs: ['xor'], known: true },
};

export function describeSpec(nIn: number, nOut: number, table: Hex): SpecInfo {
  const hit = KNOWN[`${nIn}:${nOut}:${table.toLowerCase()}`];
  if (hit) return hit;
  return {
    name: `${nIn}-in, ${nOut}-out circuit`,
    inputs: Array.from({ length: nIn }, (_, i) => `in${i}`),
    outputs: Array.from({ length: nOut }, (_, i) => `out${i}`),
    known: false,
  };
}

/** Expected nOut-bit value for input vector v. Bit p = v * nOut + j of the table, LSB first (Arena's documented packing). */
export function expectedAt(table: Hex, nOut: number, v: number): number {
  const bytes = table.slice(2);
  let value = 0;
  for (let j = 0; j < nOut; j++) {
    const p = v * nOut + j;
    const byte = parseInt(bytes.slice((p >> 3) * 2, (p >> 3) * 2 + 2), 16);
    value |= ((byte >> (p & 7)) & 1) << j;
  }
  return value;
}

export const bitsOf = (value: number, width: number): string =>
  Array.from({ length: width }, (_, i) => String((value >> (width - 1 - i)) & 1)).join('');
