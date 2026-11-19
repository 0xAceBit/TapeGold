import { useState } from 'react';
import { createContest } from '@/mock/engine';
import { evalGasEstimate, RULES } from '@/mock/rules';
import { run } from '@/mock/store';
import type { ChainState, Persona } from '@/mock/types';
import { formatToken } from '@/lib/format';
import { TruthTable } from './TruthTable';

interface Props {
  chain: ChainState;
  persona: Persona;
  onCreated: (id: number) => void;
}

export function CreateContest({ chain, persona, onCreated }: Props) {
  const [title, setTitle] = useState('NOR Golf');
  const [blurb, setBlurb] = useState('Output 1 only when both inputs are 0.');
  const [prize, setPrize] = useState(300);
  const [nIn, setNIn] = useState(2);
  const [nOut, setNOut] = useState(1);
  const [rows, setRows] = useState<number[]>([1, 0, 0, 0]);
  const [maxGates, setMaxGates] = useState(10);
  const [commitH, setCommitH] = useState(24);
  const [revealH, setRevealH] = useState(24);
  const [processor, setProcessor] = useState<'any' | 'mock-processor'>('any');

  const resize = (newIn: number, newOut: number) => {
    setNIn(newIn);
    setNOut(newOut);
    setRows(Array.from({ length: 2 ** newIn }, (_, i) => (rows[i] ?? 0) & (2 ** newOut - 1)));
  };
  const toggle = (row: number, bit: number) => setRows(rows.map((v, i) => (i === row ? v ^ (1 << bit) : v)));
  const gas = evalGasEstimate(nIn, maxGates);
  const balance = chain.balances[persona.address] ?? 0n;

  const submit = () => {
    const id = chain.contests.length + 1;
    const ok = run('Contest opened. The prize is now escrowed.', (s) =>
      createContest(s, persona.address, {
        title: title.trim() || 'Untitled contest',
        blurb: blurb.trim(),
        prize: BigInt(Math.round(prize * 1_000_000)),
        processor,
        nIn,
        nOut,
        expected: rows,
        maxGates,
        maxNetlistBytes: maxGates * RULES.BYTES_PER_GATE,
        commitDeadline: s.now + commitH * 3600,
        revealDeadline: s.now + (commitH + revealH) * 3600,
      }),
    );
    if (ok) onCreated(id);
  };

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <h2 className="display text-3xl font-semibold">New contest</h2>
        <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
          Opening as {persona.name}. Balance {formatToken(balance)}. The prize moves into the contract the moment you open it.
        </p>
      </div>

      <section className="card space-y-4 p-6">
        <label className="block space-y-1.5">
          <span className="eyebrow">Name</span>
          <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={40} />
        </label>
        <label className="block space-y-1.5">
          <span className="eyebrow">One-line brief</span>
          <input className="field" value={blurb} onChange={(e) => setBlurb(e.target.value)} maxLength={100} />
        </label>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="block space-y-1.5">
            <span className="eyebrow">Prize (mUSDC)</span>
            <input className="field num" type="number" min={1} value={prize} onChange={(e) => setPrize(Number(e.target.value))} />
          </label>
          <label className="block space-y-1.5">
            <span className="eyebrow">Inputs</span>
            <select className="field" value={nIn} onChange={(e) => resize(Number(e.target.value), nOut)}>
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1.5">
            <span className="eyebrow">Outputs</span>
            <select className="field" value={nOut} onChange={(e) => resize(nIn, Number(e.target.value))}>
              {[1, 2, 3].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1.5">
            <span className="eyebrow">Gate limit</span>
            <input className="field num" type="number" min={1} max={64} value={maxGates} onChange={(e) => setMaxGates(Number(e.target.value))} />
          </label>
        </div>
      </section>

      <section className="card p-6">
        <h3 className="display mb-1 text-lg font-semibold">Truth table</h3>
        <p className="mb-3 text-sm" style={{ color: 'var(--muted)' }}>
          Tap an output bit to flip it. Designers must match every row.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm num">
            <thead>
              <tr className="text-left">
                {Array.from({ length: nIn }, (_, i) => (
                  <th key={i} className="eyebrow px-2 pb-2">
                    in{i}
                  </th>
                ))}
                {Array.from({ length: nOut }, (_, j) => (
                  <th key={j} className="eyebrow px-2 pb-2">
                    out{j}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((v, row) => (
                <tr key={row} className="border-t" style={{ borderColor: 'var(--border)' }}>
                  {Array.from({ length: nIn }, (_, i) => (
                    <td key={i} className="mono px-2 py-1.5">
                      {(row >> i) & 1}
                    </td>
                  ))}
                  {Array.from({ length: nOut }, (_, j) => (
                    <td key={j} className="px-2 py-1">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm mono w-11"
                        aria-label={`row ${row} out${j}: ${(v >> j) & 1}`}
                        aria-pressed={((v >> j) & 1) === 1}
                        onClick={() => toggle(row, j)}
                        style={((v >> j) & 1) === 1 ? { background: 'var(--accent)', color: '#fff' } : undefined}
                      >
                        {(v >> j) & 1}
                      </button>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card space-y-4 p-6">
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1.5">
            <span className="eyebrow">Commit phase (hours)</span>
            <input className="field num" type="number" min={1} value={commitH} onChange={(e) => setCommitH(Number(e.target.value))} />
          </label>
          <label className="block space-y-1.5">
            <span className="eyebrow">Reveal phase (hours)</span>
            <input className="field num" type="number" min={1} value={revealH} onChange={(e) => setRevealH(Number(e.target.value))} />
          </label>
        </div>
        <label className="block space-y-1.5">
          <span className="eyebrow">Accepted processors</span>
          <select className="field" value={processor} onChange={(e) => setProcessor(e.target.value as 'any' | 'mock-processor')}>
            <option value="any">Any registered processor</option>
            <option value="mock-processor">One named processor</option>
          </select>
        </label>
        <p className="text-xs" style={{ color: gas > RULES.EVAL_GAS_BUDGET ? 'var(--danger)' : 'var(--muted)' }}>
          Grading estimate: {(gas / 1e6).toFixed(2)}M gas of {(RULES.EVAL_GAS_BUDGET / 1e6).toFixed(0)}M allowed. Each phase must last at least one hour.
        </p>
        <button type="button" className="btn btn-primary w-full" onClick={submit} disabled={prize <= 0}>
          Open contest and escrow {formatToken(BigInt(Math.max(0, Math.round(prize * 1_000_000))))}
        </button>
      </section>

      <section className="card p-6">
        <h3 className="display mb-2 text-lg font-semibold">Preview</h3>
        <TruthTable nIn={nIn} nOut={nOut} expected={rows} compact />
      </section>
    </div>
  );
}
