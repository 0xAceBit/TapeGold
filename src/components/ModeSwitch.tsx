import type { Mode } from '@/mode';

interface Props {
  mode: Mode;
  liveReady: boolean;
  onChange: (m: Mode) => void;
}

/** Demo data vs live X Layer data. Live is always selectable: until a contract is configured it explains how to set one up. */
export function ModeSwitch({ mode, liveReady, onChange }: Props) {
  const item = (id: Mode, label: string, title: string) => (
    <button
      type="button"
      className="btn btn-sm"
      aria-pressed={mode === id}
      title={title}
      style={mode === id ? { background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' } : { color: 'var(--ink-2)', background: 'transparent', borderColor: 'transparent' }}
      onClick={() => onChange(id)}
    >
      {label}
    </button>
  );
  return (
    <div className="flex rounded-xl p-0.5" style={{ background: 'var(--surface-muted)' }} role="group" aria-label="Data source">
      {item('demo', 'Demo data', 'In-browser demo with made-up players and a demo clock. No chain, no wallet.')}
      {item('live', 'Live · X Layer', liveReady ? 'Real contract on X Layer mainnet (chain 196).' : 'Not deployed yet. Shows how to connect a contract.')}
    </div>
  );
}
