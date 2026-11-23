import { useSyncExternalStore } from 'react';
import { DAILY_POOL } from '@/lib/dailyData';
import type { Gate } from '@/mock/netlist';

export interface DailyPuzzle {
  /** UTC date the puzzle belongs to, YYYY-MM-DD. */
  dateKey: string;
  /** 1 on launch day, then one more each day. */
  number: number;
  nIn: 3;
  nOut: 1;
  expected: number[];
  par: number;
  solution: Gate[];
}

const DAY_MS = 86_400_000;
const LAUNCH = '2026-11-23';

export const todayKey = (d: Date = new Date()): string => d.toISOString().slice(0, 10);
export const dayNumber = (key: string): number => Math.floor(Date.parse(`${key}T00:00:00Z`) / DAY_MS);
export const isDateKey = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

/** Small seeded generator, so every visitor gets the same shuffle and so the same puzzle on the same day. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let order: number[] | null = null;
function shuffled(): number[] {
  if (order) return order;
  const rand = mulberry32(0x7a9e1);
  const idx = DAILY_POOL.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  order = idx;
  return idx;
}

/** The puzzle for a date. Every puzzle has a proven smallest circuit, so "par" is exact. */
export function dailyPuzzle(dateKey: string): DailyPuzzle {
  const n = dayNumber(dateKey);
  const len = DAILY_POOL.length;
  const entry = DAILY_POOL[shuffled()[((n % len) + len) % len]];
  return {
    dateKey,
    number: Math.max(1, n - dayNumber(LAUNCH) + 1),
    nIn: 3,
    nOut: 1,
    expected: Array.from({ length: 8 }, (_, v) => (entry.table >> v) & 1),
    par: entry.par,
    solution: entry.gates.map(([a, b]) => ({ a, b })),
  };
}

export type Days = Record<string, number>;

/** Consecutive solved days ending today, or ending yesterday while today is still open. */
export function streakFrom(days: Days, today: string): number {
  let day = dayNumber(today);
  const key = (n: number) => todayKey(new Date(n * DAY_MS));
  if (days[key(day)] === undefined) day -= 1;
  let n = 0;
  while (days[key(day)] !== undefined) {
    n++;
    day -= 1;
  }
  return n;
}

const KEY = 'tapegold:daily:v1';
const listeners = new Set<() => void>();

function read(): Days {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const j = JSON.parse(raw) as { days?: Days };
      return j.days ?? {};
    }
  } catch {
    // unreadable or unavailable: start fresh
  }
  return {};
}

let days: Days = read();

export function completeDaily(dateKey: string, gates: number): void {
  const best = days[dateKey];
  if (best !== undefined && best <= gates) return;
  days = { ...days, [dateKey]: gates };
  try {
    localStorage.setItem(KEY, JSON.stringify({ days }));
  } catch {
    // storage unavailable: the streak lasts until the page closes
  }
  for (const l of listeners) l();
}

export interface DailyState {
  today: string;
  days: Days;
  streak: number;
  /** Fewest bricks used today, if solved. */
  solvedToday: number | undefined;
  /** Yesterday counted but today is still open: the streak is about to break. */
  atRisk: boolean;
  puzzle: DailyPuzzle;
}

let cached: DailyState | null = null;

function snapshot(): DailyState {
  const today = todayKey();
  if (!cached || cached.today !== today || cached.days !== days) {
    const streak = streakFrom(days, today);
    cached = { today, days, streak, solvedToday: days[today], atRisk: days[today] === undefined && streak > 0, puzzle: dailyPuzzle(today) };
  }
  return cached;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useDaily(): DailyState {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
