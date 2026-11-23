import { useSyncExternalStore } from 'react';

const KEY = 'tapegold:name:v1';
const listeners = new Set<() => void>();

function read(): string {
  try {
    return (localStorage.getItem(KEY) ?? '').slice(0, 24);
  } catch {
    return '';
  }
}

let name = read();

/** A nickname for share cards. Kept in this browser only: it is never sent anywhere. */
export function setNickname(value: string): void {
  name = value.replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 24);
  try {
    localStorage.setItem(KEY, name);
  } catch {
    // storage unavailable: the name lasts until the page closes
  }
  for (const l of listeners) l();
}

export function useNickname(): string {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => name,
    () => name,
  );
}
