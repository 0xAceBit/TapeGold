import { Lock } from 'lucide-react';
import type { Mode } from '@/mode';

interface Props {
  mode: Mode;
  liveReady: boolean;
  /** Live stays closed until the practice puzzles are solved. */
  liveLocked: boolean;
  onLockedClick: () => void;
  onChange: (m: Mode) => void;
}

/** Demo data vs live X Layer data. Live is always selectable: until a contract is configured it explains how to set one up. */
export function ModeSwitch({ mode, liveReady, liveLocked, onLockedClick, onChange }: Props) {
  const item = (id: Mode, label: string, title: string, locked = false) => (
    <button
      type="button"
      className="btn btn-sm"
      aria-pressed={mode === id}
      title={title}
      style={mode === id ? { background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' } : { color: 'var(--ink-2)', background: 'transparent', borderColor: 'transparent' }}
      onClick={() => (locked ? onLockedClick() : onChange(id))}
    >
      {locked && <Lock size={12} />}
      {label}
    </button>
  );
  return (
    <div className="flex rounded-full p-0.5" style={{ background: 'var(--surface-muted)' }} role="group" aria-label="Data source">
      {item('demo', 'Demo data', 'In-browser demo with made-up players and a demo clock. No chain, no wallet.')}
      {item(
        'live',
        'Live · X Layer',
        liveLocked ? 'Locked: solve the 3 practice puzzles first (or skip them on the Practice tab).' : liveReady ? 'Real contract on X Layer mainnet (chain 196).' : 'Not deployed yet. Shows how to connect a contract.',
        liveLocked,
      )}
    </div>
  );
}
