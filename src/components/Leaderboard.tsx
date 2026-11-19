import { Crown, EyeOff } from 'lucide-react';
import { leaderboard, phaseOf } from '@/mock/engine';
import { personaName } from '@/mock/personas';
import type { Contest } from '@/mock/types';

export function Leaderboard({ contest, now }: { contest: Contest; now: number }) {
  const phase = phaseOf(contest, now);
  const rows = leaderboard(contest);
  const hidden = Object.entries(contest.commits).filter(([, c]) => !c.revealed);

  return (
    <section className="card p-5" aria-label="Leaderboard">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="display text-lg font-semibold">Leaderboard</h3>
        <span className="eyebrow num">{contest.commitCount} entered</span>
      </div>

      {phase === 'Commit' && (
        <p className="inset p-3 text-sm" style={{ color: 'var(--muted)' }}>
          <EyeOff size={14} className="mr-1.5 inline -mt-0.5" />
          Designs stay hidden until the reveal phase. {contest.commitCount === 0 ? 'No entries yet.' : `${contest.commitCount} sealed ${contest.commitCount === 1 ? 'entry' : 'entries'}.`}
        </p>
      )}

      {phase !== 'Commit' && rows.length === 0 && (
        <p className="inset p-3 text-sm" style={{ color: 'var(--muted)' }}>
          No valid reveal yet.
        </p>
      )}

      {phase !== 'Commit' && rows.length > 0 && (
        <ol className="space-y-2">
          {rows.map((r, i) => (
            <li key={r.designer} className="inset flex items-center gap-3 p-3">
              <span className="display num w-6 text-lg font-semibold" style={{ color: i === 0 ? 'var(--ink)' : 'var(--subtle)' }}>
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 font-semibold">
                  {personaName(r.designer)}
                  {i === 0 && <Crown size={14} aria-label="leading" />}
                </div>
                <div className="text-xs" style={{ color: 'var(--muted)' }}>
                  Entry {r.order} · circuit #{r.circuitId}
                </div>
              </div>
              <div className="text-right">
                <div className="display num text-xl font-semibold">{r.gateCount}</div>
                <div className="eyebrow">gates</div>
              </div>
            </li>
          ))}
        </ol>
      )}

      {phase !== 'Commit' && hidden.length > 0 && (
        <div className="mt-3">
          <div className="eyebrow mb-1.5">{phase === 'Reveal' ? 'Still to reveal' : 'Never revealed'}</div>
          <ul className="flex flex-wrap gap-2">
            {hidden.map(([who, c]) => (
              <li key={who} className="chip">
                {personaName(who)} · entry {c.order}
              </li>
            ))}
          </ul>
        </div>
      )}

      {phase !== 'Commit' && rows.length > 1 && rows[0].gateCount === rows[1].gateCount && (
        <p className="mt-3 text-xs" style={{ color: 'var(--muted)' }}>
          Equal gate counts: the earliest commit leads.
        </p>
      )}
    </section>
  );
}
