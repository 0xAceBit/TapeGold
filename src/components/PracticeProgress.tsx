import { Lock, LockOpen } from 'lucide-react';
import { LEVEL_BY_ID, REQUIRED, usePractice } from '@/practice';

/** Three segments, one per practice puzzle. Also says whether the live version is open. */
export function PracticeProgress({ showLock = true }: { showLock?: boolean }) {
  const p = usePractice();
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-semibold num">
          {p.count} of {p.total} required puzzles solved
        </span>
        {showLock && (
          <span className="chip" style={p.done ? { background: 'rgba(26,128,71,0.12)', color: 'var(--success)' } : undefined}>
            {p.done ? <LockOpen size={12} /> : <Lock size={12} />} Live {p.done ? 'unlocked' : 'locked'}
          </span>
        )}
      </div>
      <div
        className="grid grid-cols-3 gap-1.5"
        role="progressbar"
        aria-label="Practice progress"
        aria-valuemin={0}
        aria-valuemax={p.total}
        aria-valuenow={p.count}
      >
        {REQUIRED.map((id) => LEVEL_BY_ID[id]).map((l) => (
          <div
            key={l.id}
            className="h-2 rounded-full"
            title={l.title}
            style={{ background: p.solved[l.id] !== undefined ? 'var(--success)' : 'var(--border)' }}
          />
        ))}
      </div>
    </div>
  );
}
