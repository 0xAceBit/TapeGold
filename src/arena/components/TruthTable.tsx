import { expectedAt, bitsOf, type SpecInfo } from '../specs';
import type { Row } from '../arena';
import type { Hex } from 'viem';

interface Props {
  nIn: number;
  nOut: number;
  table: Hex;
  info: SpecInfo;
  /** Optional pre-flight results to show next to each row. */
  results?: Row[];
}

/** The challenge's truth table as a scorecard: one row per input vector. */
export function TruthTable({ nIn, nOut, table, info, results }: Props) {
  const rows = Array.from({ length: 1 << nIn }, (_, v) => v);
  return (
    <div className="max-h-72 overflow-auto border border-[var(--line)]">
      <table className="num w-full border-collapse text-[13px]">
        <thead className="sticky top-0 bg-[var(--panel-2)]">
          <tr className="label">
            <th className="px-3 py-2 text-left font-normal">in ({info.inputs.join(' ')})</th>
            <th className="px-3 py-2 text-left font-normal">out ({info.outputs.join(' ')})</th>
            {results && <th className="px-3 py-2 text-left font-normal">yours</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((v) => {
            const r = results?.find((x) => x.vector === v);
            return (
              <tr key={v} className="rule">
                <td className="px-3 py-1">{bitsOf(v, nIn).split('').reverse().join('')}</td>
                <td className="px-3 py-1">{bitsOf(expectedAt(table, nOut, v), nOut).split('').reverse().join('')}</td>
                {results && (
                  <td className={`px-3 py-1 ${r?.ok ? 'ok' : 'bad'}`}>
                    {r ? (r.got === null ? 'error' : bitsOf(r.got, nOut).split('').reverse().join('')) : '-'} {r?.ok ? 'ok' : 'x'}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
