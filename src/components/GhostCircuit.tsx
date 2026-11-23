import { useState } from 'react';
import type { Gate } from '@/mock/netlist';
import { CircuitView } from './CircuitView';

/** A read-only picture of a circuit, with its own switches, so a player can study the best known answer after solving. */
export function GhostCircuit({ nIn, nOut, gates, expected }: { nIn: number; nOut: number; gates: Gate[]; expected: number[] }) {
  const [vector, setVector] = useState(0);
  return (
    <div className="card p-4">
      <div className="eyebrow mb-3">Best known circuit, {gates.length} {gates.length === 1 ? 'brick' : 'bricks'}</div>
      <CircuitView nIn={nIn} nOut={nOut} gates={gates} vector={vector} onVector={setVector} want={expected[vector]} />
    </div>
  );
}
