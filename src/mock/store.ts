import { useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { PERSONAS } from './personas';
import { seedState } from './seed';
import { ContractError, type ChainState, type Persona, type PersonaId } from './types';

const STATE_KEY = 'tapegolf-mock-v1';
const PERSONA_KEY = 'tapegolf-mock-persona';

const replacer = (_k: string, v: unknown) => (typeof v === 'bigint' ? { __bigint: v.toString() } : v);
const reviver = (_k: string, v: unknown) =>
  v && typeof v === 'object' && '__bigint' in v ? BigInt((v as { __bigint: string }).__bigint) : v;

function load(): ChainState | null {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw, reviver) as ChainState;
    return parsed.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}

let state: ChainState = load() ?? seedState();
let personaId: PersonaId = (localStorage.getItem(PERSONA_KEY) as PersonaId | null) ?? 'bo';
const listeners = new Set<() => void>();

const persist = () => localStorage.setItem(STATE_KEY, JSON.stringify(state, replacer));
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const useChain = (): ChainState => useSyncExternalStore(subscribe, () => state);
export const usePersona = (): Persona => {
  const id = useSyncExternalStore(subscribe, () => personaId);
  return PERSONAS.find((p) => p.id === id) ?? PERSONAS[1];
};

export function setPersona(id: PersonaId) {
  personaId = id;
  localStorage.setItem(PERSONA_KEY, id);
  emit();
}

/**
 * Runs a transition. Returns true on success. A ContractError becomes a toast that names the Solidity error,
 * which is what the live app will show when a transaction reverts.
 */
export function run(label: string, step: (s: ChainState) => ChainState): boolean {
  try {
    state = step(state);
    persist();
    emit();
    toast.success(label);
    return true;
  } catch (e) {
    if (e instanceof ContractError) {
      toast.error(`${e.errorName}: ${e.message}`);
      return false;
    }
    throw e;
  }
}

export function resetDemo() {
  state = seedState();
  persist();
  emit();
  toast.success('Demo data reset');
}
