import type { ReactNode } from 'react';
import { Clock, FlaskConical, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import { play, setMuted, useMuted } from '@/lib/sound';
import { advance } from '@/mock/engine';
import { PERSONAS } from '@/mock/personas';
import { resetDemo, run, setPersona } from '@/mock/store';
import type { ChainState, Persona } from '@/mock/types';
import { formatClock } from '@/lib/format';
import { Brand } from './Brand';
import { useScrolled } from './motion';

export type View = 'practice' | 'list' | 'create' | 'wallet' | 'contest';

interface Props {
  modeSwitch?: ReactNode;
  chain: ChainState;
  persona: Persona;
  view: View;
  onView: (v: Exclude<View, 'contest'>) => void;
}

const TABS: Array<{ id: Exclude<View, 'contest'>; label: string }> = [
  { id: 'practice', label: 'Practice' },
  { id: 'list', label: 'Contests' },
  { id: 'create', label: 'New contest' },
  { id: 'wallet', label: 'Wallet' },
];

function nextDeadline(chain: ChainState): number | null {
  const ahead = chain.contests
    .filter((c) => !c.settled)
    .flatMap((c) => [c.commitDeadline, c.revealDeadline])
    .filter((t) => t > chain.now);
  return ahead.length ? Math.min(...ahead) : null;
}

export function Header({ modeSwitch, chain, persona, view, onView }: Props) {
  const scrolled = useScrolled();
  const muted = useMuted();
  const next = nextDeadline(chain);
  const skip = (seconds: number, label: string) => run(label, (s) => advance(s, seconds));

  return (
    <header
      className="sticky top-0 z-20 border-b backdrop-blur-xl transition-shadow duration-300"
      style={{ borderColor: 'var(--border)', background: 'rgba(255,255,255,0.92)', boxShadow: scrolled ? '0 8px 24px rgba(30,30,31,0.06)' : 'none' }}
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
        <button type="button" onClick={() => onView('list')} aria-label="TapeGold home">
          <Brand />
        </button>

        <nav className="flex flex-wrap gap-x-5 gap-y-1" aria-label="Main">
          {TABS.map((t) => (
            <button key={t.id} type="button" className="navlink" aria-current={view === t.id ? 'page' : undefined} onClick={() => onView(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {modeSwitch}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-pressed={!muted}
            aria-label={muted ? 'Turn sound on' : 'Turn sound off'}
            title={muted ? 'Sound is off' : 'Sound is on'}
            onClick={() => {
              setMuted(!muted);
              if (muted) play('tick');
            }}
          >
            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          <div className="flex rounded-full p-0.5" style={{ background: 'var(--surface-muted)' }} role="group" aria-label="Acting as">
            {PERSONAS.map((p) => (
              <button
                key={p.id}
                type="button"
                className="btn btn-sm"
                aria-pressed={p.id === persona.id}
                title={`${p.name} (${p.role})`}
                style={p.id === persona.id ? { background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' } : { color: 'var(--ink-2)', background: 'transparent', borderColor: 'transparent' }}
                onClick={() => setPersona(p.id)}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ background: 'var(--surface-muted)' }}>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 text-xs">
          <span className="chip" style={{ background: 'rgba(154,106,0,0.12)', color: 'var(--warn)' }}>
            <FlaskConical size={12} /> Demo data. No chain, no wallet.
          </span>
          <span className="num flex items-center gap-1.5" style={{ color: 'var(--ink-2)' }}>
            <Clock size={12} /> Demo clock {formatClock(chain.now)}
          </span>
          <span className="flex flex-wrap items-center gap-1.5">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => skip(3600, 'Skipped 1 hour')}>
              +1h
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => skip(12 * 3600, 'Skipped 12 hours')}>
              +12h
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => skip(24 * 3600, 'Skipped 1 day')}>
              +1d
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={next === null}
              title="Jumps the demo clock to the next deadline of any contest. To skip only one contest, use the buttons inside it."
              onClick={() => next !== null && skip(next - chain.now, 'Jumped to the next deadline')}
            >
              Next deadline
            </button>
          </span>
          <button type="button" className="btn btn-ghost btn-sm ml-auto" onClick={resetDemo}>
            <RotateCcw size={12} /> Reset demo
          </button>
        </div>
      </div>
    </header>
  );
}
