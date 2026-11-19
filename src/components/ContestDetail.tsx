import { ArrowLeft, Coins, Gavel } from 'lucide-react';
import { phaseOf, settle } from '@/mock/engine';
import { personaName } from '@/mock/personas';
import { evalGasEstimate, MOCK_FEE_BPS } from '@/mock/rules';
import { run } from '@/mock/store';
import type { ChainState, Persona } from '@/mock/types';
import { formatClock, formatDuration, formatToken } from '@/lib/format';
import { DesignerPanel } from './DesignerPanel';
import { Leaderboard } from './Leaderboard';
import { PhaseChip } from './PhaseChip';
import { TruthTable } from './TruthTable';

interface Props {
  chain: ChainState;
  contestId: number;
  persona: Persona;
  onBack: () => void;
}

export function ContestDetail({ chain, contestId, persona, onBack }: Props) {
  const contest = chain.contests.find((c) => c.id === contestId);
  if (!contest) {
    return (
      <div className="card p-6">
        <p>That contest does not exist.</p>
        <button type="button" className="btn btn-ghost mt-3" onClick={onBack}>
          Back to contests
        </button>
      </div>
    );
  }
  const phase = phaseOf(contest, chain.now);
  const nextDeadline = phase === 'Commit' ? contest.commitDeadline : contest.revealDeadline;
  const leader = contest.leader;

  return (
    <div className="space-y-5">
      <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>
        <ArrowLeft size={14} /> All contests
      </button>

      <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
        <aside className="space-y-5 lg:sticky lg:top-24 lg:self-start">
          <section className="card p-6">
            <div className="mb-3 flex items-center justify-between gap-2">
              <PhaseChip phase={phase} />
              <span className="eyebrow">Contest #{contest.id}</span>
            </div>
            <h2 className="display text-3xl font-semibold text-balance">{contest.title}</h2>
            <p className="mt-1.5 text-sm text-pretty" style={{ color: 'var(--muted)' }}>
              {contest.blurb}
            </p>

            <div className="mt-5 flex items-end justify-between">
              <div>
                <div className="eyebrow">Prize pot</div>
                <div className="display num text-3xl font-semibold">{formatToken(contest.prize, false)}</div>
                <div className="text-xs" style={{ color: 'var(--muted)' }}>
                  mUSDC, held by the contract
                </div>
              </div>
              {phase !== 'Settled' && phase !== 'Ended' && (
                <div className="text-right">
                  <div className="eyebrow">{phase === 'Commit' ? 'Commits close in' : 'Reveals close in'}</div>
                  <div className="display num text-xl font-semibold">{formatDuration(nextDeadline - chain.now)}</div>
                </div>
              )}
            </div>

            <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
              <div className="inset p-3">
                <dt className="eyebrow">Gate limit</dt>
                <dd className="num font-semibold">{contest.maxGates}</dd>
              </div>
              <div className="inset p-3">
                <dt className="eyebrow">Sponsor</dt>
                <dd className="font-semibold">{personaName(contest.sponsor)}</dd>
              </div>
              <div className="inset p-3">
                <dt className="eyebrow">Commit by</dt>
                <dd className="num text-xs font-semibold">{formatClock(contest.commitDeadline)}</dd>
              </div>
              <div className="inset p-3">
                <dt className="eyebrow">Reveal by</dt>
                <dd className="num text-xs font-semibold">{formatClock(contest.revealDeadline)}</dd>
              </div>
            </dl>
            <p className="mt-3 text-xs" style={{ color: 'var(--muted)' }}>
              Grading runs {2 ** contest.nIn} rows on-chain, at most ~{(evalGasEstimate(contest.nIn, contest.maxGates) / 1e6).toFixed(1)}M gas. Only flat NAND circuits are accepted. Processor:{' '}
              {contest.processor === 'any' ? 'any registered' : 'one named processor'}. Fee {(MOCK_FEE_BPS / 100).toFixed(2)}% of the prize.
            </p>
          </section>

          <section className="card p-6">
            <h3 className="display mb-3 text-lg font-semibold">The spec</h3>
            <TruthTable nIn={contest.nIn} nOut={contest.nOut} expected={contest.expected} />
          </section>
        </aside>

        <div className="space-y-5">
          {(phase === 'Ended' || phase === 'Settled') && (
            <section className="card p-6" aria-label="Settlement">
              <h3 className="display mb-1 text-lg font-semibold">
                {phase === 'Settled' ? 'Settled' : 'Contest over'}
              </h3>
              {phase === 'Ended' && (
                <>
                  <p className="text-sm" style={{ color: 'var(--muted)' }}>
                    {leader
                      ? `${personaName(leader.designer)} leads with ${leader.gateCount} gates. Anyone can settle: the prize goes to the leader, minus the fee.`
                      : 'Nobody revealed a valid circuit. Settling returns the full prize to the sponsor.'}
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary mt-4 w-full"
                    onClick={() => run('Settled and paid out.', (s) => settle(s, persona.address, contest.id, true))}
                  >
                    <Gavel size={16} /> Settle and pay {leader ? personaName(leader.designer) : personaName(contest.sponsor)}
                  </button>
                </>
              )}
              {phase === 'Settled' && (
                <p className="text-sm" style={{ color: 'var(--ink-2)' }}>
                  <Coins size={14} className="mr-1.5 inline -mt-0.5" />
                  {leader
                    ? `${personaName(leader.designer)} won with ${leader.gateCount} gates and receives ${formatToken(contest.winnerPayout)}. Fee: ${formatToken(contest.fee)}.`
                    : `No valid entry. ${formatToken(contest.winnerPayout)} refunded to ${personaName(contest.sponsor)}.`}{' '}
                  Unclaimed payouts are on the Wallet tab.
                </p>
              )}
            </section>
          )}

          {phase !== 'Settled' && <DesignerPanel key={`${persona.id}-${contest.id}`} chain={chain} contest={contest} persona={persona} />}
          <Leaderboard contest={contest} now={chain.now} />
        </div>
      </div>
    </div>
  );
}
