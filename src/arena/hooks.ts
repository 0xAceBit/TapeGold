import { useCallback, useEffect, useRef, useState } from 'react';
import type { Address } from 'viem';
import { readAll, readChallenge, readMine, type Challenge, type Mine } from './arena';

export interface Poll<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/** Runs `load` now and every `ms` while the tab is visible. Keeps the last good value when a refresh fails. */
export function usePoll<T>(load: () => Promise<T>, key: string, ms: number, enabled = true): Poll<T> {
  const [res, setRes] = useState<{ key: string; data: T | null; error: string | null } | null>(null);
  const fn = useRef(load);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    fn.current = load;
  });

  useEffect(() => {
    if (!enabled) return;
    const ctl = { cancelled: false };
    const run = async () => {
      try {
        const v = await fn.current();
        if (!ctl.cancelled) setRes({ key, data: v, error: null });
      } catch (e) {
        if (!ctl.cancelled) setRes((r) => ({ key, data: r?.key === key ? r.data : null, error: e instanceof Error ? e.message : 'Could not read the chain.' }));
      }
    };
    void run();
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void run();
    }, ms);
    return () => {
      ctl.cancelled = true;
      clearInterval(t);
    };
  }, [key, ms, enabled, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  const current = res !== null && res.key === key ? res : null;
  return { data: current?.data ?? null, error: current?.error ?? null, loading: enabled && current === null, reload };
}

export const useChallenges = (arena: Address | null): Poll<Challenge[]> =>
  usePoll(() => readAll(arena as Address), `all:${arena}`, 20_000, arena !== null);

export const useChallenge = (arena: Address | null, id: number): Poll<Challenge> =>
  usePoll(() => readChallenge(arena as Address, id), `one:${arena}:${id}`, 10_000, arena !== null && id > 0);

export const useMine = (arena: Address | null, ch: Challenge | null, account: Address | null): Poll<Mine> =>
  usePoll(() => readMine(arena as Address, ch as Challenge, account as Address), `mine:${arena}:${ch?.id}:${account}:${ch?.phase}`, 10_000, arena !== null && ch !== null && account !== null);

/** Seconds since epoch, ticking once a second (device clock; the contract's own phase is read from the chain). */
export function useNow(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}
