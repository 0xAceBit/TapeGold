import { useEffect, useState } from 'react';
import { getAbiItem, type Address, type Hex } from 'viem';
import { arenaAbi } from './abi';
import { publicClient } from './chain';
import type { Challenge } from './arena';

/**
 * Live leaderboard from `Revealed` events.
 *
 * The public RPC refuses eth_getLogs ranges above 100 blocks (observed: "block range greater than 100 max"), so the scan is
 * bounded to the only window in which a reveal can exist: from the commit deadline to the reveal deadline. It never starts
 * at block 0, resumes from a browser cache, and reports exactly how far it has got.
 */

const revealed = getAbiItem({ abi: arenaAbi, name: 'Revealed' });
const SPAN = 99; // eth_getLogs ranges of 100 blocks or fewer are accepted
const MARGIN = 200; // blocks of slack around the two deadlines

export interface RevealRow {
  revealer: Address;
  circuitId: string;
  score: number;
  commitIndex: number;
  becameBest: boolean;
  block: number;
  tx: Hex;
  logIndex: number;
}

export interface ScanState {
  rows: RevealRow[];
  from: number;
  scanned: number;
  end: number | null;
  head: number;
  done: boolean;
  error: string | null;
  active: boolean;
}

const IDLE: ScanState = { rows: [], from: 0, scanned: 0, end: null, head: 0, done: false, error: null, active: false };

/** First block whose timestamp is at or after `ts` (binary search over block headers: about 27 requests, exact on any block cadence). */
async function blockAtTime(ts: number): Promise<number> {
  const c = publicClient();
  const head = await c.getBlock();
  if (ts >= Number(head.timestamp)) return Number(head.number);
  let lo = 0;
  let hi = Number(head.number);
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const b = await c.getBlock({ blockNumber: BigInt(mid) });
    if (Number(b.timestamp) >= ts) hi = mid;
    else lo = mid + 1;
  }
  return hi;
}

const cacheKey = (arena: Address, id: number) => `arena:v1:reveals:${arena.toLowerCase()}:${id}`;
interface Cache { from: number; scanned: number; rows: RevealRow[]; end?: number | null }
function loadCache(arena: Address, id: number): Cache | null {
  try {
    return JSON.parse(localStorage.getItem(cacheKey(arena, id)) ?? 'null') as Cache | null;
  } catch {
    return null;
  }
}
function saveCache(arena: Address, id: number, c: Cache): void {
  try {
    localStorage.setItem(cacheKey(arena, id), JSON.stringify(c));
  } catch {
    // storage full or unavailable: the scan still works, it just will not resume
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The scan itself, separate from React so it can be tested against a local fork. `ctl.cancelled` stops it.
 * Calls `emit` after every batch with how far it has got.
 */
export async function runScan(
  arena: Address,
  id: number,
  commitEnd: number,
  revealEnd: number,
  ctl: { cancelled: boolean },
  emit: (s: ScanState) => void,
  pollMs = 6000,
): Promise<void> {
  const client = publicClient();
  const cached = loadCache(arena, id);
  const from = cached?.from ?? Math.max(0, (await blockAtTime(commitEnd)) - MARGIN);
  let rows: RevealRow[] = cached?.rows ?? [];
  let cursor = cached ? cached.scanned + 1 : from;
  let end: number | null = cached?.end ?? null;
  let batches = 0;
  emit({ ...IDLE, rows, from, scanned: cursor - 1, active: true });

  while (!ctl.cancelled) {
    const latest = await client.getBlock();
    const head = Number(latest.number);
    if (end === null && Number(latest.timestamp) >= revealEnd) end = (await blockAtTime(revealEnd)) + MARGIN;
    const stop = end === null ? head : Math.min(end, head);
    while (cursor <= stop && !ctl.cancelled) {
      const spans: [number, number][] = [];
      for (let k = 0; k < 3; k++) {
        const a = cursor + k * (SPAN + 1);
        if (a > stop) break;
        spans.push([a, Math.min(a + SPAN, stop)]);
      }
      const results = await Promise.all(
        spans.map(([a, b]) => client.getLogs({ address: arena, event: revealed, args: { challengeId: BigInt(id) }, fromBlock: BigInt(a), toBlock: BigInt(b) })),
      );
      const found: RevealRow[] = results.flat().map((l) => ({
        revealer: l.args.revealer as Address,
        circuitId: (l.args.circuitId ?? 0n).toString(),
        score: Number(l.args.score),
        commitIndex: Number(l.args.commitIndex),
        becameBest: Boolean(l.args.becameBest),
        block: Number(l.blockNumber),
        tx: l.transactionHash,
        logIndex: Number(l.logIndex),
      }));
      if (found.length) rows = [...rows, ...found];
      cursor = (spans[spans.length - 1]?.[1] ?? cursor) + 1;
      if (++batches % 10 === 0) saveCache(arena, id, { from, scanned: cursor - 1, rows, end });
      if (!ctl.cancelled) emit({ rows, from, scanned: cursor - 1, end, head, done: false, error: null, active: true });
    }
    saveCache(arena, id, { from, scanned: cursor - 1, rows, end });
    if (end !== null && cursor > end) {
      if (!ctl.cancelled) emit({ rows, from, scanned: cursor - 1, end, head, done: true, error: null, active: false });
      return;
    }
    if (!ctl.cancelled) emit({ rows, from, scanned: cursor - 1, end, head, done: false, error: null, active: true });
    await sleep(pollMs);
  }
}

export function useReveals(arena: Address | null, ch: Challenge | null): ScanState {
  const [held, setHeld] = useState<{ key: string; scan: ScanState } | null>(null);
  const id = ch?.id;
  const inCommit = ch?.phase === 0;
  const commitEnd = ch?.commitEnd;
  const revealEnd = ch?.revealEnd;

  useEffect(() => {
    if (!arena || id === undefined || commitEnd === undefined || revealEnd === undefined || inCommit) return;
    const key = `${arena}:${id}`;
    const ctl = { cancelled: false };
    runScan(arena, id, commitEnd, revealEnd, ctl, (scan) => setHeld({ key, scan })).catch((e: unknown) => {
      if (!ctl.cancelled) setHeld((h) => ({ key, scan: { ...(h?.key === key ? h.scan : IDLE), error: e instanceof Error ? e.message : 'Scan failed', active: false } }));
    });
    return () => {
      ctl.cancelled = true;
    };
  }, [arena, id, inCommit, commitEnd, revealEnd]);

  return held !== null && arena !== null && held.key === `${arena}:${id}` && !inCommit ? held.scan : IDLE;
}

export function ranked(rows: RevealRow[]): RevealRow[] {
  const seen = new Set<string>();
  return rows
    .filter((r) => (seen.has(`${r.tx}:${r.logIndex}`) ? false : (seen.add(`${r.tx}:${r.logIndex}`), true)))
    .sort((a, b) => a.score - b.score || a.commitIndex - b.commitIndex);
}
