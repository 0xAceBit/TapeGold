import { useCallback, useSyncExternalStore } from 'react';

export type Mode = 'demo' | 'live';

const KEY = 'tapegold:mode:v1';
const listeners = new Set<() => void>();

function read(): Mode | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'demo' || v === 'live' ? v : null;
  } catch {
    return null;
  }
}

let stored: Mode | null = read();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * Which data the site shows. Demo data (the in-browser model, no chain, no wallet) is the default, so the full site is
 * always visible. Once a contract address is configured, live X Layer data becomes the default instead. The visitor's own
 * choice, made with the switch in the header, wins over both.
 */
export function useMode(liveReady: boolean): [Mode, (m: Mode) => void] {
  const choice = useSyncExternalStore(subscribe, () => stored, () => stored);
  const set = useCallback((m: Mode) => {
    stored = m;
    try {
      localStorage.setItem(KEY, m);
    } catch {
      // storage unavailable: the choice lasts until the page is closed
    }
    // The two modes use different URL styles: start each one from its home screen.
    window.history.replaceState(null, '', window.location.pathname);
    window.scrollTo(0, 0);
    for (const l of listeners) l();
  }, []);
  return [choice ?? (liveReady ? 'live' : 'demo'), set];
}
