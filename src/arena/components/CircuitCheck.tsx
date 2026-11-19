import { Check, X } from 'lucide-react';
import type { Challenge, Preflight } from '../arena';
import { describeSpec } from '../specs';
import { AddrLink } from './ui';
import { TruthTable } from './TruthTable';

function Line({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      {ok ? <Check size={14} className="ok mt-1 shrink-0" /> : <X size={14} className="bad mt-1 shrink-0" />}
      <span className={ok ? '' : 'bad'}>{children}</span>
    </li>
  );
}

/** Result of the read-only check that mirrors what the contract does at reveal. Nothing here costs gas. */
export function CircuitCheck({ pf, ch }: { pf: Preflight; ch: Challenge }) {
  if (!pf.exists) return <p className="bad" role="alert">{pf.problem}</p>;
  const failed = pf.rows.filter((r) => !r.ok).length;
  return (
    <div className="space-y-3">
      <ul className="space-y-1 text-[13px]">
        <Line ok={pf.ownerOk}>
          Owner: {pf.owner ? <AddrLink address={pf.owner} /> : 'unknown'} {pf.ownerOk ? '(you)' : '(not this wallet)'}
        </Line>
        <Line ok={pf.shapeOk}>Shape: {pf.shapeOk ? `${ch.nIn} inputs, ${ch.nOut} outputs` : 'does not match the challenge'}</Line>
        <Line ok={pf.statefulOk}>{pf.statefulOk ? 'Purely combinational (no latches)' : 'Has latches, which the contract rejects'}</Line>
        <Line ok={pf.budgetOk}>Size: {pf.gates} gates {pf.budgetOk ? '(within the grading budget)' : '(too large to grade)'}</Line>
        {pf.rows.length > 0 && (
          <Line ok={pf.rowsOk}>{pf.rowsOk ? `All ${pf.rows.length} truth-table rows correct` : `${failed} of ${pf.rows.length} rows wrong`}</Line>
        )}
      </ul>
      {pf.rows.length > 0 && (
        <details>
          <summary className="cursor-pointer text-[13px] text-[var(--muted)]">Row by row</summary>
          <div className="mt-2">
            <TruthTable nIn={ch.nIn} nOut={ch.nOut} table={ch.table} info={describeSpec(ch.nIn, ch.nOut, ch.table)} results={pf.rows} />
          </div>
        </details>
      )}
      {pf.problem && <p className="bad text-[13px]" role="alert">{pf.problem}</p>}
    </div>
  );
}
