import type { Phase } from '@/mock/types';

const STYLE: Record<Phase, { label: string; color: string; bg: string }> = {
  Commit: { label: 'Commit phase', color: '#ffffff', bg: 'var(--accent)' },
  Reveal: { label: 'Reveal phase', color: 'var(--warn)', bg: 'rgba(138, 90, 0, 0.12)' },
  Ended: { label: 'Ready to settle', color: 'var(--ink-2)', bg: 'var(--surface-muted)' },
  Settled: { label: 'Settled', color: 'var(--success)', bg: 'rgba(26, 127, 69, 0.10)' },
};

export function PhaseChip({ phase }: { phase: Phase }) {
  const s = STYLE[phase];
  return (
    <span className="chip" style={{ color: s.color, background: s.bg }}>
      {s.label}
    </span>
  );
}
