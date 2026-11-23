import { useEffect, useRef, useState } from 'react';
import { Flame, LockOpen } from 'lucide-react';
import { completeDaily, dailyPuzzle, isDateKey, useDaily, type DailyPuzzle } from '@/daily';
import { LEVELS, LEVEL_BY_ID, REQUIRED, WORLDS, completeLevel, restartPractice, skipPractice, usePractice, type Level, type LevelId, type PracticeState } from '@/practice';
import { setNickname, useNickname } from '@/profile';
import { PracticeProgress } from './PracticeProgress';
import { PuzzlePanel, Stars, type Puzzle } from './PuzzlePanel';

interface Props {
  onOpenLive: () => void;
}

type Sel = { kind: 'level'; id: LevelId } | { kind: 'daily'; date: string };

/** What a friend's challenge link asked for: ?level=xor&beat=4 or ?daily=2026-11-24&beat=5. */
function readLink(): { sel: Sel | null; beat: number | undefined } {
  const q = new URLSearchParams(window.location.search);
  const level = q.get('level');
  const date = q.get('daily');
  const beat = Number(q.get('beat'));
  const sel: Sel | null = level && level in LEVEL_BY_ID ? { kind: 'level', id: level as LevelId } : isDateKey(date) ? { kind: 'daily', date } : null;
  return { sel, beat: Number.isInteger(beat) && beat >= 1 && beat <= 64 ? beat : undefined };
}

function startingPoint(p: PracticeState, todayDone: boolean, today: string): Sel {
  const firstRequired = REQUIRED.find((id) => p.solved[id] === undefined);
  if (firstRequired) return { kind: 'level', id: firstRequired };
  if (!todayDone) return { kind: 'daily', date: today };
  const firstOpen = LEVELS.find((l) => p.solved[l.id] === undefined);
  return { kind: 'level', id: (firstOpen ?? LEVELS[LEVELS.length - 1]).id };
}

function levelPuzzle(l: Level, p: PracticeState): Puzzle {
  const world = WORLDS.find((w) => w.id === l.world)?.title ?? '';
  return {
    key: l.id,
    kicker: `${world} · puzzle ${LEVELS.indexOf(l) + 1} of ${LEVELS.length}`,
    title: l.title,
    idea: l.idea,
    task: l.task,
    nIn: l.nIn,
    nOut: l.nOut,
    expected: l.expected,
    par: l.par,
    nudges: l.nudges,
    solution: l.solution,
    best: p.solved[l.id],
    shareTarget: { kind: 'level', id: l.id },
  };
}

function dailyView(d: DailyPuzzle, best: number | undefined, streak: number): Puzzle {
  return {
    key: `daily-${d.dateKey}`,
    kicker: `Daily puzzle · ${d.dateKey}`,
    title: `Daily puzzle ${d.number}`,
    task: 'Build the circuit for this answer sheet with as few bricks as you can. Everyone gets the same puzzle today.',
    nIn: d.nIn,
    nOut: d.nOut,
    expected: d.expected,
    par: d.par,
    nudges: [
      'Look at the answer sheet and find the rows where the lamp is on. Start by building a small piece that is on for some of them.',
      'Reuse bricks. The best circuits feed one brick into several others.',
      `The best known circuit uses ${d.par} bricks. Press Hint to find a wasted one.`,
    ],
    solution: d.solution,
    best,
    shareTarget: { kind: 'daily', id: d.dateKey },
    streak,
  };
}

export function Practice({ onOpenLive }: Props) {
  const p = usePractice();
  const daily = useDaily();
  const name = useNickname();
  const [link] = useState(readLink);
  const [sel, setSel] = useState<Sel>(() => link.sel ?? startingPoint(p, daily.solvedToday !== undefined, daily.today));
  const [confirmSkip, setConfirmSkip] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  /** Picking a puzzle must bring it into view, or the click looks like it did nothing. */
  const showPanel = () => {
    const calm = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    panelRef.current?.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
  };
  const pick = (next: Sel) => {
    setSel(next);
    requestAnimationFrame(showPanel);
  };
  // Arriving from a friend's link: land on the puzzle they sent.
  useEffect(() => {
    if (link.sel) requestAnimationFrame(showPanel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const level = sel.kind === 'level' ? LEVEL_BY_ID[sel.id] : null;
  const dailyForSel = sel.kind === 'daily' ? dailyPuzzle(sel.date) : null;
  const puzzle = level ? levelPuzzle(level, p) : dailyView(dailyForSel as DailyPuzzle, daily.days[(dailyForSel as DailyPuzzle).dateKey], daily.streak);
  const friendBeat = link.sel && JSON.stringify(link.sel) === JSON.stringify(sel) ? link.beat : undefined;
  const levelIndex = level ? LEVELS.indexOf(level) : -1;
  const hasNext = level !== null && levelIndex < LEVELS.length - 1;
  const lastRequiredAndDone = level !== null && p.done;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="eyebrow">Practice</span>
          <h2 className="display text-4xl text-balance">Learn by building</h2>
          <p className="mt-1.5 max-w-xl text-pretty" style={{ color: 'var(--muted)' }}>
            Ten puzzles in three worlds, plus a new one every day. No prize, no wallet. Earn stars by matching the best known score. The first three open the live version on X Layer.
          </p>
        </div>
        <div className="text-right">
          <div className="display num text-3xl">
            {p.stars}
            <span style={{ color: 'var(--subtle)' }}> / {p.maxStars}</span>
          </div>
          <div className="eyebrow">stars</div>
        </div>
      </div>

      <div className="card space-y-4 p-5">
        <PracticeProgress />
        <label className="block text-sm">
          <span className="eyebrow">Your name on share pictures (optional, stays in this browser)</span>
          <input className="field field-sm mt-1.5 max-w-xs" maxLength={24} value={name} onChange={(e) => setNickname(e.target.value)} placeholder="e.g. Ada" autoComplete="off" />
        </label>
      </div>

      <section aria-label="Daily puzzle" className="card flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full" style={{ background: daily.streak > 0 ? 'rgba(217,180,106,0.25)' : 'var(--surface-muted)' }}>
            <Flame size={20} style={{ color: daily.streak > 0 ? '#b8892f' : 'var(--subtle)' }} aria-hidden />
          </span>
          <div>
            <h3 className="display text-xl">Daily puzzle {daily.puzzle.number}</h3>
            <p className="text-sm text-pretty" style={{ color: 'var(--muted)' }}>
              {daily.solvedToday !== undefined
                ? `Solved in ${daily.solvedToday} (best known ${daily.puzzle.par}). Come back tomorrow for a new one.`
                : daily.atRisk
                  ? `Solve today's puzzle to keep your ${daily.streak}-day streak.`
                  : 'A new puzzle every day. The same one for everyone.'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="display num text-2xl">{daily.streak}</div>
            <div className="eyebrow">day streak</div>
          </div>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => pick({ kind: 'daily', date: daily.today })}>
            {daily.solvedToday !== undefined ? 'Play again' : "Play today's"}
          </button>
        </div>
      </section>

      <div ref={panelRef} className="scroll-mt-24">
        <PuzzlePanel
          key={puzzle.key}
          puzzle={puzzle}
          friendBeat={friendBeat}
          onSolved={(n) => (level ? completeLevel(level.id, n) : completeDaily((dailyForSel as DailyPuzzle).dateKey, n))}
          next={hasNext ? { label: 'Next puzzle', onClick: () => pick({ kind: 'level', id: LEVELS[levelIndex + 1].id }) } : undefined}
          footer={
            lastRequiredAndDone && REQUIRED.includes((level).id) ? (
              <button type="button" className="btn btn-sm" onClick={onOpenLive}>
                <LockOpen size={14} /> Open the live version
              </button>
            ) : undefined
          }
        />
      </div>

      {WORLDS.map((w) => (
        <section key={w.id} aria-label={`${w.title} puzzles`}>
          <div className="mb-3 flex items-baseline justify-between border-b pb-2" style={{ borderColor: 'var(--border)' }}>
            <h3 className="display text-xl">{w.title}</h3>
            <span className="eyebrow">{w.blurb}</span>
          </div>
          <ol className="grid gap-3 sm:grid-cols-2">
            {LEVELS.filter((l) => l.world === w.id).map((l) => {
              const picked = sel.kind === 'level' && sel.id === l.id;
              return (
                <li key={l.id}>
                  <button
                    type="button"
                    className="inset flex w-full flex-col gap-1.5 p-4 text-left transition-transform duration-200 hover:-translate-y-0.5"
                    aria-current={picked ? 'step' : undefined}
                    style={picked ? { outline: '2px solid var(--accent)' } : undefined}
                    onClick={() => pick({ kind: 'level', id: l.id })}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{l.title.split(':')[0]}</span>
                      <Stars count={p.starsOf(l.id)} size={14} />
                    </span>
                    <span className="text-sm" style={{ color: 'var(--muted)' }}>
                      {l.blurb}
                    </span>
                    <span className="eyebrow num">
                      par {l.par}
                      {p.solved[l.id] !== undefined && ` · yours ${p.solved[l.id]}`}
                      {REQUIRED.includes(l.id) && ' · opens live'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </section>
      ))}


      <div className="card space-y-3 p-5 text-sm">
        {p.done ? (
          <>
            <p className="flex items-center gap-2 font-semibold" style={{ color: 'var(--success)' }}>
              <LockOpen size={16} /> The live version is open.
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-primary btn-sm" onClick={onOpenLive}>
                Open the live version
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={restartPractice}>
                Reset my practice progress
              </button>
            </div>
          </>
        ) : (
          <>
            <p style={{ color: 'var(--muted)' }}>The live version uses real money on X Layer, so it stays locked until NOT, AND and XOR are solved.</p>
            {confirmSkip ? (
              <div className="flex flex-wrap items-center gap-2">
                <span>Unlock live without practising?</span>
                <button type="button" className="btn btn-primary btn-sm" onClick={skipPractice}>
                  Yes, unlock it
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmSkip(false)}>
                  Not now
                </button>
              </div>
            ) : (
              <button type="button" className="navlink text-sm" onClick={() => setConfirmSkip(true)}>
                I already know how this works
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
