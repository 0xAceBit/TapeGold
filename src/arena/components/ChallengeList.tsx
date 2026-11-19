import { ChevronRight, Flag } from 'lucide-react';
import type { Address } from 'viem';
import type { Challenge } from '../arena';
import { countdown, fmtToken, PHASES, shortAddr } from '../format';
import { useChallenges, useNow } from '../hooks';
import { describeSpec } from '../specs';
import { Spinner, Tag } from './ui';

export function PhaseTag({ ch }: { ch: Challenge }) {
  const tone = ch.phase === 0 ? 'ok' : ch.phase === 1 ? 'warn' : 'plain';
  return <Tag tone={tone}>{PHASES[ch.phase]}</Tag>;
}

export function timeLeft(ch: Challenge, now: number): string {
  if (ch.phase === 0) return `commit closes in ${countdown(ch.commitEnd - now)}`;
  if (ch.phase === 1) return `reveal closes in ${countdown(ch.revealEnd - now)}`;
  if (ch.phase === 2) return 'ready to finalize';
  return 'finalized';
}

export function ChallengeList({ arena }: { arena: Address }) {
  const { data, error, loading, reload } = useChallenges(arena);
  const now = useNow();
  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between">
        <h1 className="text-lg font-bold tracking-wide">SCORECARD</h1>
        <span className="label">fewest gates wins</span>
      </div>
      {loading && <Spinner label="Reading challenges from X Layer…" />}
      {error && (
        <div className="space-y-2">
          <p className="bad" role="alert">{error}</p>
          <button type="button" className="btn btn-sm" onClick={reload}>Retry</button>
        </div>
      )}
      {data && data.length === 0 && <p className="text-[var(--muted)]">No challenges yet on this contract.</p>}
      {data && data.length > 0 && (
        <div className="sheet">
          {data.map((ch, i) => {
            const info = describeSpec(ch.nIn, ch.nOut, ch.table);
            return (
              <a key={ch.id} href={`#/c/${ch.id}`} className={`row-hover block px-4 py-3 text-inherit no-underline ${i > 0 ? 'rule' : ''}`}>
                <div className="flex items-center gap-3">
                  <div className="flex w-12 shrink-0 flex-col items-center border-r border-[var(--line)] pr-3">
                    <Flag size={14} className="text-[var(--dim)]" />
                    <span className="num text-xl font-bold leading-none">{String(ch.id).padStart(2, '0')}</span>
                    <span className="label">hole</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-bold">{info.name}</span>
                      <PhaseTag ch={ch} />
                    </div>
                    <div className="num mt-1 flex flex-wrap gap-x-4 text-[12px] text-[var(--muted)]">
                      <span>{ch.nIn} in / {ch.nOut} out</span>
                      <span>pot {fmtToken(ch.pot, ch.tokenDecimals, ch.tokenSymbol)}</span>
                      <span>{ch.commitCount} {ch.commitCount === 1 ? 'entry' : 'entries'}</span>
                      <span>{ch.best ? `best ${ch.best.score} gates (${shortAddr(ch.best.winner)})` : 'no valid reveal yet'}</span>
                    </div>
                    <div className="mt-1 text-[12px] text-[var(--dim)]">{timeLeft(ch, now)}</div>
                  </div>
                  <ChevronRight size={16} className="shrink-0 text-[var(--dim)]" />
                </div>
              </a>
            );
          })}
        </div>
      )}
    </section>
  );
}
