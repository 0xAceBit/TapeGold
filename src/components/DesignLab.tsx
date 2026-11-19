import { useMemo } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { signalName, truthTable, validateDesign, type Design, type Gate } from '@/mock/netlist';
import { TruthTable } from './TruthTable';

interface Props {
  nIn: number;
  nOut: number;
  expected: number[];
  maxGates: number;
  gates: Gate[];
  onChange: (gates: Gate[]) => void;
  locked?: boolean;
}

/** Removes gate k and rewires later gates so nothing points at a signal that no longer exists. */
function removeGate(gates: Gate[], nIn: number, k: number): Gate[] {
  const gone = 2 + nIn + k;
  const fix = (s: number) => (s === gone ? 2 : s > gone ? s - 1 : s);
  return gates.filter((_, i) => i !== k).map((g) => ({ a: fix(g.a), b: fix(g.b) }));
}

export function evaluate(nIn: number, nOut: number, expected: number[], gates: Gate[]) {
  const design: Design = { nIn, nOut, gates };
  const problem = validateDesign(design);
  const got = problem ? null : truthTable(design);
  const correct = got ? got.filter((g, v) => g === expected[v]).length : 0;
  return { problem, got, correct, total: expected.length, passes: !!got && correct === expected.length };
}

export function DesignLab({ nIn, nOut, expected, maxGates, gates, onChange, locked }: Props) {
  const result = useMemo(() => evaluate(nIn, nOut, expected, gates), [nIn, nOut, expected, gates]);
  const firstOut = 2 + nIn + gates.length - nOut;
  const set = (k: number, patch: Partial<Gate>) =>
    onChange(gates.map((g, i) => (i === k ? { ...g, ...patch } : g)));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          Each gate is a NAND of two earlier signals. The last {nOut} gate{nOut === 1 ? '' : 's'} drive{nOut === 1 ? 's' : ''} the output
          {nOut === 1 ? '' : 's'}.
        </p>
        <span className="chip num" style={gates.length > maxGates ? { color: 'var(--danger)' } : undefined}>
          {gates.length} / {maxGates} gates
        </span>
      </div>

      <ol className="space-y-2">
        {gates.map((g, k) => {
          const own = 2 + nIn + k;
          const options = Array.from({ length: own }, (_, s) => s);
          const outIdx = own - firstOut;
          const isOut = outIdx >= 0 && gates.length >= nOut;
          return (
            <li key={k} className="inset flex flex-wrap items-center gap-2 p-2.5">
              <span className="mono w-9 text-sm font-medium">g{k}</span>
              <span className="mono text-sm" style={{ color: 'var(--muted)' }}>
                = NAND(
              </span>
              {(['a', 'b'] as const).map((side) => (
                <select
                  key={side}
                  aria-label={`gate ${k} input ${side}`}
                  className="field field-sm mono w-[84px]"
                  value={g[side]}
                  disabled={locked}
                  onChange={(e) => set(k, { [side]: Number(e.target.value) })}
                >
                  {options.map((s) => (
                    <option key={s} value={s}>
                      {signalName(s, nIn)}
                    </option>
                  ))}
                </select>
              ))}
              <span className="mono text-sm" style={{ color: 'var(--muted)' }}>
                )
              </span>
              {isOut && <span className="chip">drives out{outIdx}</span>}
              {!locked && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm ml-auto"
                  aria-label={`Remove gate ${k}`}
                  onClick={() => onChange(removeGate(gates, nIn, k))}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </li>
          );
        })}
      </ol>

      {!locked && (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => onChange([...gates, { a: 2, b: 2 }])}
          disabled={gates.length >= 64}
        >
          <Plus size={14} /> Add gate
        </button>
      )}

      <div className="card p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="eyebrow">Live check against the spec</span>
          <span
            className="num text-sm font-semibold"
            style={{ color: result.passes ? 'var(--success)' : 'var(--ink-2)' }}
          >
            {result.problem ? 'Not valid yet' : `${result.correct} / ${result.total} rows correct`}
          </span>
        </div>
        {result.problem ? (
          <p className="text-sm" style={{ color: 'var(--danger)' }}>
            {result.problem}
          </p>
        ) : (
          <TruthTable nIn={nIn} nOut={nOut} expected={expected} got={result.got ?? undefined} compact />
        )}
      </div>
    </div>
  );
}


