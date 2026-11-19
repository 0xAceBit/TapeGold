import { Check, X } from 'lucide-react';
import { bits } from '@/mock/netlist';

interface Props {
  nIn: number;
  nOut: number;
  expected: number[];
  /** Outputs produced by the design under test, same length as expected. Omit to show the spec only. */
  got?: number[];
  compact?: boolean;
}

export function TruthTable({ nIn, nOut, expected, got, compact }: Props) {
  const inLabels = Array.from({ length: nIn }, (_, i) => `in${i}`);
  const outLabels = Array.from({ length: nOut }, (_, i) => `out${i}`);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm num">
        <thead>
          <tr className="text-left">
            {inLabels.map((l) => (
              <th key={l} className="eyebrow px-2 pb-2 font-semibold">
                {l}
              </th>
            ))}
            {outLabels.map((l) => (
              <th key={l} className="eyebrow px-2 pb-2 font-semibold">
                want {l}
              </th>
            ))}
            {got && <th className="eyebrow px-2 pb-2 font-semibold">yours</th>}
            {got && <th className="w-8" />}
          </tr>
        </thead>
        <tbody>
          {expected.map((want, v) => {
            const ok = got ? got[v] === want : null;
            return (
              <tr key={v} className={compact ? '' : 'border-t'} style={{ borderColor: 'var(--border)' }}>
                {inLabels.map((l, i) => (
                  <td key={l} className="mono px-2 py-1.5">
                    {(v >> i) & 1}
                  </td>
                ))}
                {outLabels.map((l, j) => (
                  <td key={l} className="mono px-2 py-1.5">
                    {(want >> j) & 1}
                  </td>
                ))}
                {got && (
                  <td className="mono px-2 py-1.5" style={{ color: ok ? 'var(--success)' : 'var(--danger)' }}>
                    {bits(got[v], nOut).split('').reverse().join('')}
                  </td>
                )}
                {got && (
                  <td className="px-1">
                    {ok ? (
                      <Check size={16} aria-label="matches" style={{ color: 'var(--success)' }} />
                    ) : (
                      <X size={16} aria-label="does not match" style={{ color: 'var(--danger)' }} />
                    )}
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
