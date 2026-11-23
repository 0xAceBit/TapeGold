import { useEffect, useMemo, useState } from 'react';
import { Lightbulb, Play, Plus, Square, Trash2, X } from 'lucide-react';
import { hintFor, type Hint } from '@/lib/hints';
import { play } from '@/lib/sound';
import { signalName, truthTable, validateDesign, type Design, type Gate } from '@/mock/netlist';
import { CircuitView } from './CircuitView';
import { TruthTable } from './TruthTable';

interface Props {
  nIn: number;
  nOut: number;
  expected: number[];
  maxGates: number;
  gates: Gate[];
  onChange: (gates: Gate[]) => void;
  locked?: boolean;
  /** Best known gate count, used by the hint. Omit when unknown. */
  par?: number;
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

export function DesignLab({ nIn, nOut, expected, maxGates, gates, onChange: onChangeProp, locked, par }: Props) {
  const result = useMemo(() => evaluate(nIn, nOut, expected, gates), [nIn, nOut, expected, gates]);
  const [vector, setVector] = useState(0);
  const [hint, setHint] = useState<Hint | null>(null);
  // Any edit makes the old hint stale.
  const onChange = (next: Gate[]) => {
    setHint(null);
    onChangeProp(next);
  };
  const flagged = hint?.gates ?? [];
  // "Run all rows" walks the answer sheet one row at a time. While it runs, the shown row drives the picture.
  const [runRow, setRunRow] = useState<number | null>(null);
  const total = expected.length;
  const shownVector = runRow ?? vector;
  useEffect(() => {
    if (runRow === null) return;
    const row = runRow;
    play(result.got?.[row] === expected[row] ? 'rowOk' : 'rowBad');
    const t = setTimeout(() => {
      if (row + 1 < total) setRunRow(row + 1);
      else {
        setVector(row);
        setRunRow(null);
      }
    }, 850);
    return () => clearTimeout(t);
  }, [runRow, result.got, expected, total]);
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
        <span className="flex items-center gap-2">
          {!locked && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setHint(hintFor({ nIn, nOut, gates }, expected, par))}>
              <Lightbulb size={14} /> Hint
            </button>
          )}
          <span className="chip num" style={gates.length > maxGates ? { color: 'var(--danger)' } : undefined}>
            {gates.length} / {maxGates} gates
          </span>
        </span>
      </div>

      {hint && (
        <div className="flex items-start gap-3 rounded-2xl p-4 text-sm" role="status" style={{ background: 'rgba(154,106,0,0.10)', color: 'var(--ink)' }}>
          <Lightbulb size={16} className="mt-0.5 shrink-0" style={{ color: 'var(--warn)' }} />
          <p className="flex-1 text-pretty">{hint.message}</p>
          <button type="button" className="btn btn-ghost btn-sm" aria-label="Close hint" onClick={() => setHint(null)}>
            <X size={14} />
          </button>
        </div>
      )}

      <div className="card p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="eyebrow">Your circuit, live</span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={!!result.problem}
            onClick={() => (runRow === null ? setRunRow(0) : setRunRow(null))}
          >
            {runRow === null ? <Play size={14} /> : <Square size={14} />} {runRow === null ? 'Run all rows' : 'Stop'}
          </button>
        </div>
        <CircuitView
          nIn={nIn}
          nOut={nOut}
          gates={gates}
          vector={shownVector}
          onVector={runRow === null ? setVector : () => undefined}
          want={expected[shownVector]}
          highlight={flagged}
        />
      </div>

      <ol className="space-y-2">
        {gates.map((g, k) => {
          const own = 2 + nIn + k;
          const options = Array.from({ length: own }, (_, s) => s);
          const outIdx = own - firstOut;
          const isOut = outIdx >= 0 && gates.length >= nOut;
          return (
            <li key={k} className="inset flex flex-wrap items-center gap-2 p-2.5" style={flagged.includes(k) ? { outline: '2px dashed var(--warn)', outlineOffset: 2 } : undefined}>
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
          onClick={() => {
            play('tick');
            onChange([...gates, { a: 2, b: 2 }]);
          }}
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
          <TruthTable nIn={nIn} nOut={nOut} expected={expected} got={result.got ?? undefined} compact activeRow={runRow} />
        )}
      </div>
    </div>
  );
}


