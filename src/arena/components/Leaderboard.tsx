import { ChevronRight } from 'lucide-react';
import type { Address } from 'viem';
import type { Challenge } from '../arena';
import { shortAddr } from '../format';
import { ranked, type ScanState } from '../reveals';
import { AddrLink, Spinner, TxLink } from './ui';

interface Props { ch: Challenge; scan: ScanState; me: Address | null }

export function Leaderboard({ ch, scan, me }: Props) {
  const rows = ranked(scan.rows);
  const total = scan.end !== null ? Math.max(1, scan.end - scan.from) : Math.max(1, scan.head - scan.from);
  const pct = Math.min(100, Math.round(((scan.scanned - scan.from) / total) * 100));
  const mismatch =
    scan.done && ch.best && rows[0] && (rows[0].revealer.toLowerCase() !== ch.best.winner.toLowerCase() || rows[0].score !== ch.best.score);

  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between">
        <h2 className="text-base font-bold tracking-wide">LEADERBOARD</h2>
        <span className="label">gates, then earliest commit</span>
      </div>

      <div className="sheet sheet-pad flex flex-wrap items-center justify-between gap-2 text-[13px]">
        <span className="label">Leader per contract</span>
        {ch.best ? (
          <span className="num">
            <AddrLink address={ch.best.winner} /> · {ch.best.score} gates · circuit {ch.best.circuitId.toString()}
          </span>
        ) : (
          <span className="text-[var(--muted)]">no valid reveal yet</span>
        )}
      </div>

      {ch.phase === 0 ? (
        <p className="text-[var(--muted)]">
          Entries are sealed until the commit deadline. {ch.commitCount} {ch.commitCount === 1 ? 'entry has' : 'entries have'} committed so far.
        </p>
      ) : (
        <>
          <div className="text-[12px] text-[var(--muted)]" role="status">
            {scan.error ? (
              <span className="bad">Scan stopped: {scan.error}</span>
            ) : scan.done ? (
              <span className="ok">Scan complete: blocks {scan.from.toLocaleString()} to {scan.scanned.toLocaleString()}.</span>
            ) : scan.active ? (
              <Spinner label={`Reading reveals from the chain: ${pct}% (block ${scan.scanned.toLocaleString()} of ${(scan.end ?? scan.head).toLocaleString()}). Results appear as they arrive.`} />
            ) : null}
          </div>
          {mismatch && <p className="warn text-[13px]" role="alert">The scanned leader differs from the contract's leader. Trust the contract line above.</p>}
          {rows.length === 0 ? (
            <p className="text-[var(--muted)]">{scan.done ? 'Nobody revealed a valid circuit.' : 'No reveals found yet.'}</p>
          ) : (
            <div className="sheet overflow-x-auto">
              <table className="num w-full border-collapse text-[13px]">
                <thead>
                  <tr className="label">
                    <th className="px-3 py-2 text-left font-normal">#</th>
                    <th className="px-3 py-2 text-left font-normal">Player</th>
                    <th className="px-3 py-2 text-right font-normal">Gates</th>
                    <th className="px-3 py-2 text-right font-normal">Circuit</th>
                    <th className="px-3 py-2 text-right font-normal">Commit</th>
                    <th className="px-3 py-2 text-right font-normal">Tx</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const mine = me && r.revealer.toLowerCase() === me.toLowerCase();
                    return (
                      <tr key={`${r.tx}:${r.logIndex}`} className={`rule ${mine ? 'bg-[var(--panel-2)]' : ''}`}>
                        <td className="px-3 py-2">{i === 0 ? <ChevronRight size={14} className="ok" aria-label="leader" /> : i + 1}</td>
                        <td className="px-3 py-2">
                          <span className={i === 0 ? 'ok' : ''}>{shortAddr(r.revealer)}</span>
                          {mine && <span className="ml-2 text-[var(--dim)]">you</span>}
                        </td>
                        <td className={`px-3 py-2 text-right font-bold ${i === 0 ? 'ok' : ''}`}>{r.score}</td>
                        <td className="px-3 py-2 text-right">{r.circuitId}</td>
                        <td className="px-3 py-2 text-right">#{r.commitIndex}</td>
                        <td className="px-3 py-2 text-right"><TxLink hash={r.tx} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
