import { motion, useReducedMotion } from 'framer-motion';
import { Flame, Plus } from 'lucide-react';
import { phaseOf } from '@/mock/engine';
import { personaName } from '@/mock/personas';
import type { ChainState, Contest } from '@/mock/types';
import { formatDuration, formatToken } from '@/lib/format';
import { useDaily } from '@/daily';
import { usePractice } from '@/practice';
import { HeroVisual } from './HeroVisual';
import { HowToPlay } from './HowToPlay';
import { Marquee, Reveal, RiseWords } from './motion';
import { PhaseChip } from './PhaseChip';

interface Props {
  chain: ChainState;
  onOpen: (id: number) => void;
  onCreate: () => void;
  onStartPractice: () => void;
  onOpenDaily: () => void;
}

/** A strip of dots, one per row of the answer sheet: filled where the lamp should be on. Real data, used as the "product photo". */
function AnswerStrip({ c }: { c: Contest }) {
  const rows = c.expected.length;
  const cols = Math.min(rows, 16);
  return (
    <div className="grid w-full max-w-[220px] gap-2" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }} aria-hidden>
      {c.expected.flatMap((want, v) =>
        Array.from({ length: c.nOut }, (_, j) => (
          <span
            key={`${v}-${j}`}
            className="aspect-square rounded-full"
            style={((want >> j) & 1) === 1 ? { background: 'var(--ink)' } : { border: '1.5px solid var(--border-strong)' }}
          />
        )),
      )}
    </div>
  );
}

function Card({ c, now, onOpen }: { c: Contest; now: number; onOpen: () => void }) {
  const phase = phaseOf(c, now);
  const deadline = phase === 'Commit' ? c.commitDeadline : c.revealDeadline;
  return (
    <button type="button" onClick={onOpen} className="group flex w-full flex-col gap-3 text-left" aria-label={`${c.title}, prize ${formatToken(c.prize, false)}`}>
      <div className="tile relative flex aspect-[4/3] items-center justify-center p-6 transition-all duration-300 group-hover:-translate-y-1 group-hover:bg-[#ececea]">
        <div className="absolute left-3 top-3">
          <PhaseChip phase={phase} />
        </div>
        <span className="eyebrow absolute right-4 top-4">#{c.id}</span>
        <AnswerStrip c={c} />
      </div>
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="display text-xl text-balance">{c.title}</h3>
        <span className="display num text-xl">{formatToken(c.prize, false)}</span>
      </div>
      <p className="-mt-1 text-sm text-pretty" style={{ color: 'var(--muted)' }}>
        {c.blurb}
      </p>
      <p className="eyebrow -mt-1">
        {phase === 'Commit' || phase === 'Reveal'
          ? `${phase === 'Commit' ? 'Commit closes' : 'Reveal closes'} in ${formatDuration(deadline - now)}`
          : c.leader
            ? `${phase === 'Settled' ? 'Won by' : 'Leading'} ${personaName(c.leader.designer)} · ${c.leader.gateCount} gates`
            : 'No valid entry'}
        {' · '}
        {c.commitCount} {c.commitCount === 1 ? 'entry' : 'entries'}
      </p>
    </button>
  );
}

const TICKER = ['NOT', 'AND', 'XOR', 'Half adder', 'Majority', 'Full adder', 'Parity'];

export function ContestList({ chain, onOpen, onCreate, onStartPractice, onOpenDaily }: Props) {
  const daily = useDaily();
  const order = (c: Contest) => ({ Commit: 0, Reveal: 1, Ended: 2, Settled: 3 })[phaseOf(c, chain.now)];
  const sorted = [...chain.contests].sort((a, b) => order(a) - order(b) || b.id - a.id);
  const practice = usePractice();
  const reduce = useReducedMotion();
  const rise = (delay: number) => ({
    initial: reduce ? false : { opacity: 0, y: 18 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] as const },
  });
  return (
    <div className="space-y-20">
      <section className="grid items-center gap-14 pt-6 sm:pt-12 lg:grid-cols-[1.15fr_0.85fr] lg:gap-10" aria-label="Introduction">
        <div>
          <motion.span className="eyebrow" {...rise(0)}>
            Circuit golf on X Layer
          </motion.span>
          <RiseWords
            className="hero-title mt-4 max-w-4xl"
            words={[{ text: 'Golf' }, { text: 'a' }, { text: 'circuit.', br: true }, { text: 'Win' }, { text: 'the' }, { text: 'pot', accent: true }]}
          />
          <motion.p className="mt-6 max-w-xl text-pretty text-lg" style={{ color: 'var(--muted)' }} {...rise(0.55)}>
            Sponsors post a puzzle and a prize. Designers build the smallest circuit that solves it. The contract checks every row itself, and the fewest parts wins.
          </motion.p>
          <motion.div className="mt-8 flex flex-wrap items-center gap-3" {...rise(0.7)}>
            <button type="button" className="btn btn-primary" onClick={onStartPractice}>
              {practice.count === 0 ? 'Start practice' : practice.done ? 'Back to practice' : 'Continue practice'}
            </button>
            <button type="button" className="btn" onClick={onCreate}>
              <Plus size={16} /> New contest
            </button>
            <button type="button" className="navlink px-2" onClick={() => document.getElementById('how')?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })}>
              How it works ↓
            </button>
          </motion.div>
          <motion.div className="mt-4" {...rise(0.8)}>
            <button type="button" className="chip transition-colors hover:bg-[var(--border)]" onClick={onOpenDaily} aria-label="Open today's daily puzzle">
              <Flame size={14} style={{ color: daily.streak > 0 ? '#b8892f' : 'var(--subtle)' }} aria-hidden />
              {daily.solvedToday !== undefined ? `Daily puzzle ${daily.puzzle.number} done` : `Today's daily puzzle ${daily.puzzle.number}`}
              {daily.streak > 0 && ` · ${daily.streak}-day streak`}
              {daily.atRisk && ' · solve it to keep it'}
            </button>
          </motion.div>
        </div>
        <HeroVisual />
      </section>

      <Reveal>
        <Marquee items={TICKER} />
      </Reveal>

      <section aria-label="Contests">
        <Reveal>
          <div className="mb-6 flex items-baseline justify-between border-b pb-3" style={{ borderColor: 'var(--border)' }}>
            <h2 className="display text-2xl">Contests</h2>
            <span className="eyebrow">{sorted.length} total</span>
          </div>
        </Reveal>
        <div className="grid gap-x-5 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((c, i) => (
            <Reveal key={c.id} delay={(i % 3) * 0.08}>
              <Card c={c} now={chain.now} onOpen={() => onOpen(c.id)} />
            </Reveal>
          ))}
        </div>
      </section>

      <HowToPlay onStartPractice={onStartPractice} />
    </div>
  );
}
