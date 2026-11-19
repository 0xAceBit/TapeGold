import { ChevronRight, Plus } from 'lucide-react';
import { phaseOf } from '@/mock/engine';
import { personaName } from '@/mock/personas';
import type { ChainState, Contest } from '@/mock/types';
import { formatDuration, formatToken } from '@/lib/format';
import { PhaseChip } from './PhaseChip';

interface Props {
  chain: ChainState;
  onOpen: (id: number) => void;
  onCreate: () => void;
}

function Card({ c, now, onOpen }: { c: Contest; now: number; onOpen: () => void }) {
  const phase = phaseOf(c, now);
  const deadline = phase === 'Commit' ? c.commitDeadline : c.revealDeadline;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="card group flex w-full flex-col gap-4 p-5 text-left transition-transform hover:-translate-y-0.5 focus-visible:outline-2"
      style={{ outlineColor: 'var(--focus)' }}
    >
      <div className="flex items-center justify-between">
        <PhaseChip phase={phase} />
        <span className="eyebrow">#{c.id}</span>
      </div>
      <div>
        <h3 className="display text-xl font-semibold text-balance">{c.title}</h3>
        <p className="mt-1 text-sm text-pretty" style={{ color: 'var(--muted)' }}>
          {c.blurb}
        </p>
      </div>
      <div className="flex items-end justify-between">
        <div>
          <div className="eyebrow">Prize</div>
          <div className="display num text-2xl font-semibold">{formatToken(c.prize, false)}</div>
        </div>
        <div className="text-right text-sm">
          {phase === 'Commit' || phase === 'Reveal' ? (
            <>
              <div className="eyebrow">{phase === 'Commit' ? 'Commit closes' : 'Reveal closes'}</div>
              <div className="num font-semibold">{formatDuration(deadline - now)}</div>
            </>
          ) : c.leader ? (
            <>
              <div className="eyebrow">{phase === 'Settled' ? 'Won by' : 'Leading'}</div>
              <div className="font-semibold">
                {personaName(c.leader.designer)} · <span className="num">{c.leader.gateCount}</span> gates
              </div>
            </>
          ) : (
            <div className="eyebrow">No valid entry</div>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between border-t pt-3 text-xs" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
        <span className="num">
          {c.commitCount} {c.commitCount === 1 ? 'entry' : 'entries'} · limit {c.maxGates} gates
        </span>
        <ChevronRight size={16} className="transition-transform group-hover:translate-x-0.5" />
      </div>
    </button>
  );
}

export function ContestList({ chain, onOpen, onCreate }: Props) {
  const order = (c: Contest) => ({ Commit: 0, Reveal: 1, Ended: 2, Settled: 3 })[phaseOf(c, chain.now)];
  const sorted = [...chain.contests].sort((a, b) => order(a) - order(b) || b.id - a.id);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="display text-4xl font-semibold text-balance">Golf a circuit. Win the pot.</h2>
          <p className="mt-1.5 max-w-xl text-pretty" style={{ color: 'var(--muted)' }}>
            Sponsors post a truth table and a prize. Designers seal a NAND circuit, tape it out, and reveal it. The contract grades every row itself. Fewest gates wins.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={onCreate}>
          <Plus size={16} /> New contest
        </button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {sorted.map((c) => (
          <Card key={c.id} c={c} now={chain.now} onOpen={() => onOpen(c.id)} />
        ))}
      </div>
    </div>
  );
}
