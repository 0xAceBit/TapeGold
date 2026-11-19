import { useState } from 'react';
import { Check, Lock, Sparkles } from 'lucide-react';
import { commitDesign, draftKey, phaseOf, reveal, tapeOut } from '@/mock/engine';
import { netlistHash, short, type Gate } from '@/mock/netlist';
import { exampleFor } from '@/mock/seed';
import { run } from '@/mock/store';
import type { ChainState, Contest, Persona } from '@/mock/types';
import { DesignLab, evaluate } from './DesignLab';

interface Props {
  chain: ChainState;
  contest: Contest;
  persona: Persona;
}

const STEPS = ['Design', 'Commit', 'Tape out', 'Reveal'] as const;

export function DesignerPanel({ chain, contest, persona }: Props) {
  const phase = phaseOf(contest, chain.now);
  const commit = contest.commits[persona.address];
  const draft = chain.drafts[draftKey(persona.address, contest.id)];
  const circuit = draft?.circuitId ? chain.circuits.find((c) => c.id === draft.circuitId) : undefined;
  const [work, setWork] = useState<Gate[]>([]);

  const gates = commit && draft ? draft.gates : work;
  const check = evaluate(contest.nIn, contest.nOut, contest.expected, gates);
  const example = exampleFor(contest.nIn, contest.nOut, contest.expected);

  // Where the designer is in the flow. -1 = locked out, 0 = designing, 2 = needs tape-out,
  // 2.5 = taped out and waiting for the reveal phase, 3 = can reveal, 4 = done.
  const stage = !commit
    ? phase === 'Commit'
      ? 0
      : -1
    : !circuit
      ? 2
      : commit.revealed
        ? 4
        : phase === 'Reveal'
          ? 3
          : 2.5;
  const stepDone = [!!commit, !!commit, !!circuit, !!commit?.revealed];
  const currentStep = stepDone.findIndex((d) => !d);

  const doCommit = () =>
    run('Committed. Your design is sealed.', (s) => commitDesign(s, persona.address, contest.id, work));
  const doTapeOut = () => run('Circuit taped out on the mock processor.', (s) => tapeOut(s, persona.address, contest.id));
  const doReveal = () => run('Revealed. The contract graded every row.', (s) => reveal(s, persona.address, contest.id));

  return (
    <section className="card p-5 sm:p-6" aria-label="Your entry">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="display text-lg font-semibold">Your entry as {persona.name}</h3>
        {commit && (
          <span className="chip num">
            <Lock size={12} /> Entry {commit.order}
          </span>
        )}
      </div>

      <ol className="mb-5 grid grid-cols-4 gap-2" aria-label="Progress">
        {STEPS.map((label, i) => {
          const done = stepDone[i];
          const current = stage >= 0 && i === currentStep;
          return (
            <li
              key={label}
              className="inset flex flex-col items-center gap-1 px-2 py-2.5 text-center"
              style={current ? { outline: '2px solid var(--accent)' } : undefined}
              aria-current={current ? 'step' : undefined}
            >
              <span
                className="num flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold"
                style={{ background: done ? 'var(--success)' : 'var(--border)', color: done ? '#fff' : 'var(--ink-2)' }}
              >
                {done ? <Check size={12} /> : i + 1}
              </span>
              <span className="text-xs font-semibold">{label}</span>
            </li>
          );
        })}
      </ol>

      {stage === -1 && (
        <p className="inset p-4 text-sm" style={{ color: 'var(--muted)' }}>
          The commit phase ended before {persona.name} entered. Switch to another demo identity, or open a new contest.
        </p>
      )}

      {stage === 0 && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm" style={{ color: 'var(--muted)' }}>
              Design your circuit, then commit. Commit before you tape out: the commitment locks in the exact netlist.
            </p>
            {example && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setWork(example)}>
                <Sparkles size={14} /> Load a working example
              </button>
            )}
          </div>
          <DesignLab nIn={contest.nIn} nOut={contest.nOut} expected={contest.expected} maxGates={contest.maxGates} gates={work} onChange={setWork} />
          <button
            type="button"
            className="btn btn-primary w-full"
            disabled={!check.passes || work.length > contest.maxGates}
            onClick={doCommit}
          >
            Commit design ({work.length} gates)
          </button>
          {!check.passes && (
            <p className="text-center text-xs" style={{ color: 'var(--muted)' }}>
              The app only lets you commit a design that matches every row. The contract would reject the reveal anyway.
            </p>
          )}
        </div>
      )}

      {commit && draft && (
        <div className="space-y-4">
          <dl className="inset grid grid-cols-2 gap-3 p-4 text-sm">
            <div>
              <dt className="eyebrow">Netlist hash</dt>
              <dd className="mono">{short(netlistHash(draft.gates), 8, 6)}</dd>
            </div>
            <div>
              <dt className="eyebrow">Commitment</dt>
              <dd className="mono">{short(commit.commitment, 8, 6)}</dd>
            </div>
            <div>
              <dt className="eyebrow">Gates</dt>
              <dd className="num font-semibold">{draft.gates.length}</dd>
            </div>
            <div>
              <dt className="eyebrow">Circuit NFT</dt>
              <dd className="num font-semibold">{circuit ? `#${circuit.id}` : 'Not taped out'}</dd>
            </div>
          </dl>

          <DesignLab nIn={contest.nIn} nOut={contest.nOut} expected={contest.expected} maxGates={contest.maxGates} gates={draft.gates} onChange={() => undefined} locked />

          {stage === 2 && (
            <button type="button" className="btn btn-primary w-full" onClick={doTapeOut}>
              Tape out circuit
            </button>
          )}
          {stage === 2.5 && (
            <p className="inset p-4 text-sm" style={{ color: 'var(--muted)' }}>
              Taped out and sealed. Reveal opens when the commit phase ends. Use the clock in the header to skip ahead.
            </p>
          )}
          {stage === 3 && (
            <button type="button" className="btn btn-primary w-full" onClick={doReveal}>
              Reveal and grade
            </button>
          )}
          {stage === 4 && (
            <p className="inset p-4 text-sm" style={{ color: 'var(--success)' }}>
              Revealed and graded on every row. Your {draft.gates.length}-gate circuit is on the leaderboard.
            </p>
          )}
          {!commit.revealed && (phase === 'Ended' || phase === 'Settled') && (
            <p className="inset p-4 text-sm" style={{ color: 'var(--danger)' }}>
              The reveal phase ended before this entry was revealed, so it cannot win.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
