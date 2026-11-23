import { useState, type ReactNode } from 'react';
import { ArrowRight, Check, Eye, HelpCircle, RotateCcw, Star } from 'lucide-react';
import type { Gate } from '@/mock/netlist';
import { play } from '@/lib/sound';
import { starsFor } from '@/practice';
import { useNickname } from '@/profile';
import { Confetti } from './Confetti';
import { DesignLab, evaluate } from './DesignLab';
import { GhostCircuit } from './GhostCircuit';
import { ShareButton, type ShareTarget } from './ShareButton';
import { TruthTable } from './TruthTable';

/** Everything the panel needs to run one puzzle, whether it is a practice level or the daily puzzle. */
export interface Puzzle {
  key: string;
  kicker: string;
  title: string;
  idea?: string;
  task: string;
  nIn: number;
  nOut: number;
  expected: number[];
  par: number;
  nudges: string[];
  solution: Gate[];
  /** Fewest bricks used so far in this browser. */
  best: number | undefined;
  shareTarget: ShareTarget;
  streak?: number;
}

interface Props {
  puzzle: Puzzle;
  /** Called with the brick count whenever the player's circuit is correct. */
  onSolved: (gates: number) => void;
  /** A friend's score to beat, from a challenge link. */
  friendBeat?: number;
  next?: { label: string; onClick: () => void };
  footer?: ReactNode;
}

export function Stars({ count, size = 16 }: { count: number; size?: number }) {
  return (
    <span className="inline-flex gap-0.5" role="img" aria-label={`${count} of 3 stars`}>
      {[0, 1, 2].map((i) => (
        <Star key={i} size={size} style={{ color: i < count ? '#d9b46a' : 'var(--border-strong)' }} fill={i < count ? '#d9b46a' : 'none'} />
      ))}
    </span>
  );
}

export function PuzzlePanel({ puzzle, onSolved, friendBeat, next, footer }: Props) {
  const name = useNickname();
  const [gates, setGates] = useState<Gate[]>([]);
  const [peeked, setPeeked] = useState(false);
  const [nudge, setNudge] = useState(0);
  const [ghost, setGhost] = useState(false);
  const [burst, setBurst] = useState(0);
  const [big, setBig] = useState(false);

  const solve = (g: Gate[]) => evaluate(puzzle.nIn, puzzle.nOut, puzzle.expected, g).passes;
  const passes = solve(gates);
  const stars = passes ? starsFor(puzzle.par, gates.length) : 0;

  // Progress and celebration happen when the player edits, not from an effect.
  const edit = (nextGates: Gate[]) => {
    const before = solve(gates) ? starsFor(puzzle.par, gates.length) : 0;
    setGates(nextGates);
    setPeeked(false);
    if (solve(nextGates)) {
      onSolved(nextGates.length);
      const after = starsFor(puzzle.par, nextGates.length);
      if (after > before) {
        play(after === 3 ? 'perfect' : 'solve');
        setBig(after === 3);
        setBurst((b) => b + 1);
      }
    }
  };

  const friend =
    friendBeat !== undefined && passes && !peeked
      ? gates.length < friendBeat
        ? `You beat your friend's ${friendBeat}.`
        : gates.length === friendBeat
          ? `You tied your friend's ${friendBeat}. One fewer beats them.`
          : `Your friend used ${friendBeat}. Find ${friendBeat - 1} or fewer to beat them.`
      : null;

  return (
    <section className="card space-y-5 p-5 sm:p-6" aria-label={puzzle.title}>
      <Confetti burst={burst} big={big} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="eyebrow">{puzzle.kicker}</span>
          <h3 className="display text-2xl text-balance">{puzzle.title}</h3>
        </div>
        {puzzle.best !== undefined && (
          <div className="text-right text-sm">
            <Stars count={starsFor(puzzle.par, puzzle.best)} />
            <div className="num" style={{ color: 'var(--muted)' }}>
              your best {puzzle.best}
            </div>
          </div>
        )}
      </div>

      {friendBeat !== undefined && !friend && (
        <p className="inset p-4 text-sm font-semibold" role="status">
          A friend solved this in {friendBeat} {friendBeat === 1 ? 'brick' : 'bricks'}. Can you beat it?
        </p>
      )}

      <div className="inset space-y-2 p-4 text-sm">
        {puzzle.idea && (
          <>
            <div className="eyebrow">The idea</div>
            <p className="text-pretty">{puzzle.idea}</p>
          </>
        )}
        <div className="eyebrow pt-1">Your task</div>
        <p className="font-semibold text-pretty">{puzzle.task}</p>
        <p style={{ color: 'var(--muted)' }}>
          Best known: <span className="num font-semibold">{puzzle.par}</span> {puzzle.par === 1 ? 'brick' : 'bricks'}. Three stars for matching it, two for one over.
        </p>
      </div>

      <div>
        <div className="eyebrow mb-2">The answer sheet</div>
        <TruthTable nIn={puzzle.nIn} nOut={puzzle.nOut} expected={puzzle.expected} compact />
      </div>

      <DesignLab nIn={puzzle.nIn} nOut={puzzle.nOut} expected={puzzle.expected} maxGates={14} gates={gates} onChange={edit} par={puzzle.par} />

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNudge((n) => Math.min(n + 1, puzzle.nudges.length))} disabled={puzzle.nudges.length === 0}>
          <HelpCircle size={14} /> Need a nudge?
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            setGates(puzzle.solution);
            setPeeked(true);
          }}
        >
          <Eye size={14} /> Show me a solution
        </button>
        {gates.length > 0 && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setGates([]);
              setPeeked(false);
            }}
          >
            <RotateCcw size={14} /> Start over
          </button>
        )}
      </div>

      {nudge > 0 && (
        <ol className="inset space-y-1.5 p-4 text-sm" aria-label="Nudges">
          {puzzle.nudges.slice(0, nudge).map((t, i) => (
            <li key={t} className="flex gap-2">
              <span className="num font-semibold" style={{ color: 'var(--subtle)' }}>
                {i + 1}.
              </span>
              <span className="text-pretty">{t}</span>
            </li>
          ))}
        </ol>
      )}

      {peeked && (
        <p className="inset p-4 text-sm" style={{ color: 'var(--muted)' }}>
          That is one answer. It does not count as solved. Press Start over and build it yourself, or change it a little, and it will.
        </p>
      )}

      {passes && !peeked && (
        <div className="space-y-4 rounded-2xl p-4" role="status" style={{ background: 'rgba(26,127,69,0.10)' }}>
          <div className="flex flex-wrap items-center gap-3">
            <p className="flex items-center gap-2 font-semibold" style={{ color: 'var(--success)' }}>
              <Check size={18} /> Solved with {gates.length} {gates.length === 1 ? 'brick' : 'bricks'}.
            </p>
            <Stars count={stars} size={20} />
          </div>
          <p className="text-sm text-pretty">
            {gates.length <= puzzle.par
              ? 'That matches the best known score. You cannot do better than this.'
              : `The best known score is ${puzzle.par}. Press Hint to find a wasted brick and see if you can match it.`}
            {puzzle.best !== undefined && puzzle.best < gates.length && ` Your best so far: ${puzzle.best}.`}
          </p>
          {friend && <p className="text-sm font-semibold">{friend}</p>}
          <ShareButton
            target={puzzle.shareTarget}
            card={{ title: puzzle.title.split(':')[0], gates: gates.length, par: puzzle.par, stars: stars as 1 | 2 | 3, name: name || undefined, streak: puzzle.streak }}
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setGhost((v) => !v)} aria-expanded={ghost}>
              {ghost ? 'Hide' : 'See'} the best known circuit
            </button>
            {next && (
              <button type="button" className="btn btn-primary btn-sm" onClick={next.onClick}>
                {next.label} <ArrowRight size={14} />
              </button>
            )}
          </div>
          {ghost && <GhostCircuit nIn={puzzle.nIn} nOut={puzzle.nOut} gates={puzzle.solution} expected={puzzle.expected} />}
          {footer}
        </div>
      )}
    </section>
  );
}
