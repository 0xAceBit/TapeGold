import { useState } from 'react';
import { Blocks, ChevronDown, Flag, Lock, Puzzle } from 'lucide-react';
import { usePractice } from '@/practice';
import { Reveal } from './motion';
import { PracticeProgress } from './PracticeProgress';

const KEY = 'tapegold:howto:v1';

const STEPS = [
  { icon: Puzzle, title: 'The puzzle', text: 'A box has switches and a lamp. An answer sheet says exactly when the lamp should be on.' },
  { icon: Blocks, title: 'Your parts', text: 'You only get one kind of brick, a NAND. Its output is ON unless both of its inputs are ON. Wire bricks together to build the box.' },
  { icon: Flag, title: 'The score', text: 'Every brick costs one point. The fewest bricks wins, like golf, as long as every row of the answer sheet is right. In practice, matching the best known score earns three stars.' },
  { icon: Lock, title: 'The sealed entry', text: 'In a prize contest you lock your design in a sealed envelope, then open it when the entry window closes. The contract tests every row and the lowest score takes the pot.' },
] as const;

function readOpen(count: number): boolean {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'open') return true;
    if (v === 'closed') return false;
  } catch {
    // storage unavailable: fall through to the default
  }
  return count === 0;
}

/** Plain-language explainer at the top of the first screen. Open for newcomers, one line for everyone else. */
export function HowToPlay({ onStartPractice }: { onStartPractice: () => void }) {
  const p = usePractice();
  const [open, setOpen] = useState(() => readOpen(p.count));
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(KEY, next ? 'open' : 'closed');
    } catch {
      // ignore
    }
  };

  return (
    <section id="how" aria-label="How to play" className="scroll-mt-24">
      <div className="mb-6 flex items-baseline justify-between border-b pb-3" style={{ borderColor: 'var(--border)' }}>
        <h2 className="display text-2xl">How to play</h2>
        <button type="button" className="navlink text-sm" aria-expanded={open} onClick={toggle}>
          {open ? 'Hide' : 'Show'} <ChevronDown size={14} className="inline" style={{ transform: open ? 'rotate(180deg)' : undefined }} />
        </button>
      </div>

      {open && (
        <>
          <ol className="grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <li key={s.title} className="border-t pt-4" style={{ borderColor: 'var(--ink)' }}>
                <Reveal delay={i * 0.1} y={18}>
                  <span className="eyebrow num">{String(i + 1).padStart(2, '0')}</span>
                  <h3 className="display mt-3 flex items-center gap-2 text-xl">
                    <s.icon size={18} aria-hidden /> {s.title}
                  </h3>
                  <p className="mt-2 text-sm text-pretty" style={{ color: 'var(--muted)' }}>
                    {s.text}
                  </p>
                </Reveal>
              </li>
            ))}
          </ol>
          <div className="mt-10 grid items-center gap-4 sm:grid-cols-[1fr_auto]">
            <PracticeProgress />
            <button type="button" className="btn" onClick={onStartPractice}>
              {p.count === 0 ? 'Start the practice puzzles' : p.done ? 'Back to practice' : 'Continue practice'}
            </button>
          </div>
          <p className="mt-3 text-xs" style={{ color: 'var(--subtle)' }}>
            Practice has no prize and no wallet. Finishing it opens the live version on X Layer.
          </p>
        </>
      )}
    </section>
  );
}
