import { MOCK_TOKEN } from '@/mock/rules';

/** Formats a mock-token amount (6 decimals) without floats. */
export function formatToken(v: bigint, withSymbol = true): string {
  const whole = v / 1_000_000n;
  const frac = (v % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  const w = whole.toLocaleString('en-US');
  const text = frac ? `${w}.${frac.slice(0, 2).padEnd(2, '0')}` : w;
  return withSymbol ? `${text} ${MOCK_TOKEN.symbol}` : text;
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function formatClock(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
