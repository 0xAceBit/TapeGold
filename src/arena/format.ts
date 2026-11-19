import { formatUnits } from 'viem';

export const shortAddr = (a: string): string => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function fmtToken(amount: bigint, decimals: number, symbol: string): string {
  const [whole = '0', frac = ''] = formatUnits(amount, decimals).split('.');
  const trimmed = frac.replace(/0+$/, '').slice(0, 4);
  return `${BigInt(whole).toLocaleString('en-US')}${trimmed ? `.${trimmed}` : ''} ${symbol}`;
}

export function countdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  const sec = s % 60;
  return `${m}m ${String(sec).padStart(2, '0')}s`;
}

export const utc = (ts: number): string => `${new Date(ts * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC`;

export type PhaseName = 'COMMIT' | 'REVEAL' | 'ENDED' | 'FINAL';
export const PHASES: PhaseName[] = ['COMMIT', 'REVEAL', 'ENDED', 'FINAL'];
