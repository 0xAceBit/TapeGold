import type { Address } from 'viem';
import type { Challenge } from './arena';
import { NATIVE_USDC } from './create';

export interface Standing {
  player: Address;
  /** Challenges this wallet won (reveal window over, so the result is settled). */
  wins: number;
  /** Challenges this wallet is leading right now. */
  leading: number;
  /** Sum of the pots won, in standard USDC only (before the fee). */
  usdcWon: bigint;
  /** Fewest bricks in any of its wins. */
  bestScore: number | null;
}

/**
 * The hall of fame, from the contract's own answers: whoever `bestOf` names once a challenge's reveal window is over has won it.
 * Nothing here needs event logs, so it is instant and cannot disagree with the contract.
 */
export function hallOfFame(list: Challenge[]): Standing[] {
  const by = new Map<string, Standing>();
  const row = (p: Address): Standing => {
    const k = p.toLowerCase();
    let s = by.get(k);
    if (!s) {
      s = { player: p, wins: 0, leading: 0, usdcWon: 0n, bestScore: null };
      by.set(k, s);
    }
    return s;
  };
  for (const ch of list) {
    if (!ch.best) continue;
    const s = row(ch.best.winner);
    if (ch.phase >= 2) {
      s.wins += 1;
      if (ch.token.toLowerCase() === NATIVE_USDC.toLowerCase()) s.usdcWon += ch.pot;
      s.bestScore = s.bestScore === null ? ch.best.score : Math.min(s.bestScore, ch.best.score);
    } else {
      s.leading += 1;
    }
  }
  return [...by.values()].sort((a, b) => b.wins - a.wins || b.leading - a.leading || (a.bestScore ?? 99) - (b.bestScore ?? 99));
}

/** The open challenge worth showing first: the biggest standard-USDC pot, otherwise the newest. Null when nothing is open. */
export function featured(list: Challenge[]): Challenge | null {
  const open = list.filter((c) => c.phase === 0 || c.phase === 1);
  if (open.length === 0) return null;
  const usdc = open.filter((c) => c.token.toLowerCase() === NATIVE_USDC.toLowerCase());
  const pool = usdc.length ? usdc : open;
  return pool.reduce((best, c) => (c.pot > best.pot || (c.pot === best.pot && c.id > best.id) ? c : best));
}
