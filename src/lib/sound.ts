import { useSyncExternalStore } from 'react';

export type Sfx = 'tick' | 'rowOk' | 'rowBad' | 'solve' | 'perfect';

const KEY = 'tapegold:sound:v1';
const listeners = new Set<() => void>();

function readMuted(): boolean {
  try {
    return localStorage.getItem(KEY) === 'off';
  } catch {
    return false;
  }
}

let muted = readMuted();
let ctx: AudioContext | null = null;

export function setMuted(value: boolean): void {
  muted = value;
  try {
    localStorage.setItem(KEY, value ? 'off' : 'on');
  } catch {
    // storage unavailable: the choice lasts until the page closes
  }
  for (const l of listeners) l();
}

export function useMuted(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => muted,
    () => muted,
  );
}

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx ??= new Ctor();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(c: AudioContext, freq: number, at: number, length: number, type: OscillatorType, peak: number): void {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  osc.connect(gain).connect(c.destination);
  osc.start(at);
  osc.stop(at + length + 0.02);
}

/**
 * Short, quiet sounds made with the browser's own synthesiser, so there are no audio files to download.
 * Must be called from a click or key press the first time (browsers block sound before that). Does nothing when muted.
 */
export function play(sfx: Sfx): void {
  if (muted) return;
  const c = audio();
  if (!c) return;
  const t = c.currentTime;
  switch (sfx) {
    case 'tick':
      tone(c, 660, t, 0.06, 'sine', 0.05);
      break;
    case 'rowOk':
      tone(c, 880, t, 0.07, 'sine', 0.04);
      break;
    case 'rowBad':
      tone(c, 196, t, 0.16, 'triangle', 0.06);
      break;
    case 'solve':
      tone(c, 523.25, t, 0.16, 'sine', 0.06);
      tone(c, 659.25, t + 0.09, 0.24, 'sine', 0.06);
      break;
    case 'perfect':
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(c, f, t + i * 0.085, 0.28, 'sine', 0.06));
      break;
  }
}
