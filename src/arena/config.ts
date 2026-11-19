import { getAddress, isAddress, type Address } from 'viem';

export interface ArenaConfig {
  arena: Address | null;
  /** Block the Arena was deployed in. Used for reference only: the app never scans from block 0. */
  deployBlock: number | null;
  source: 'config.json' | 'build' | 'browser' | 'none';
}

const OVERRIDE_KEY = 'arena:v1:override';

function clean(v: unknown): Address | null {
  return typeof v === 'string' && isAddress(v) ? getAddress(v) : null;
}

/** Browser-only override, for pointing a copy of the site at a contract without rebuilding. Never leaves the device. */
export function saveOverride(address: string): boolean {
  const a = clean(address.trim());
  if (!a) return false;
  localStorage.setItem(OVERRIDE_KEY, a);
  return true;
}
export function clearOverride(): void {
  localStorage.removeItem(OVERRIDE_KEY);
}

/**
 * Resolution order: a config.json next to index.html (relative URL, so it works under any gateway path), then a
 * build-time VITE_ARENA_ADDRESS, then a browser override. Edit config.json and republish to change the contract.
 */
export async function loadConfig(): Promise<ArenaConfig> {
  try {
    const res = await fetch('./config.json', { cache: 'no-store' });
    if (res.ok) {
      const j = (await res.json()) as { arena?: unknown; deployBlock?: unknown };
      const a = clean(j.arena);
      if (a) return { arena: a, deployBlock: typeof j.deployBlock === 'number' ? j.deployBlock : null, source: 'config.json' };
    }
  } catch {
    // no config.json, or not JSON: fall through
  }
  const env = clean(import.meta.env.VITE_ARENA_ADDRESS);
  if (env) return { arena: env, deployBlock: null, source: 'build' };
  const stored = clean(localStorage.getItem(OVERRIDE_KEY));
  if (stored) return { arena: stored, deployBlock: null, source: 'browser' };
  return { arena: null, deployBlock: null, source: 'none' };
}
