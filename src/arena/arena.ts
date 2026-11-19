import { type Address, type Hex } from 'viem';
import { arenaAbi } from './abi';
import { publicClient } from './chain';
import { circuitsAbi, erc20Abi } from './tapeout';
import { expectedAt } from './specs';

export type Phase = 0 | 1 | 2 | 3; // Commit, Reveal, Ended, Finalized

export interface Challenge {
  id: number;
  sponsor: Address;
  token: Address;
  processor: Address;
  pot: bigint;
  nIn: number;
  nOut: number;
  commitEnd: number;
  revealEnd: number;
  commitCount: number;
  finalized: boolean;
  refundable: boolean;
  table: Hex;
  phase: Phase;
  best: { winner: Address; circuitId: bigint; score: number; commitIndex: number } | null;
  tokenSymbol: string;
  tokenDecimals: number;
}

const ZERO = '0x0000000000000000000000000000000000000000';
const tokens = new Map<string, { symbol: string; decimals: number }>();

async function tokenMeta(token: Address): Promise<{ symbol: string; decimals: number }> {
  const key = token.toLowerCase();
  const hit = tokens.get(key);
  if (hit) return hit;
  const c = publicClient();
  try {
    const [symbol, decimals] = await Promise.all([
      c.readContract({ address: token, abi: erc20Abi, functionName: 'symbol' }),
      c.readContract({ address: token, abi: erc20Abi, functionName: 'decimals' }),
    ]);
    const meta = { symbol, decimals };
    tokens.set(key, meta);
    return meta;
  } catch {
    return { symbol: 'TOKEN', decimals: 18 };
  }
}

export async function readCount(arena: Address): Promise<number> {
  return Number(await publicClient().readContract({ address: arena, abi: arenaAbi, functionName: 'challengeCount' }));
}

export async function readChallenge(arena: Address, id: number): Promise<Challenge> {
  const c = publicClient();
  const args = [BigInt(id)] as const;
  // Calls made in the same tick are merged into one Multicall3 request by the client.
  const [ch, table, phase, best] = await Promise.all([
    c.readContract({ address: arena, abi: arenaAbi, functionName: 'getChallenge', args }),
    c.readContract({ address: arena, abi: arenaAbi, functionName: 'truthTableOf', args }),
    c.readContract({ address: arena, abi: arenaAbi, functionName: 'phaseOf', args }),
    c.readContract({ address: arena, abi: arenaAbi, functionName: 'bestOf', args }),
  ]);
  const meta = await tokenMeta(ch.token);
  const [winner, circuitId, score, commitIndex] = best;
  return {
    id,
    sponsor: ch.sponsor,
    token: ch.token,
    processor: ch.processor,
    pot: ch.pot,
    nIn: ch.nIn,
    nOut: ch.nOut,
    commitEnd: Number(ch.commitEnd),
    revealEnd: Number(ch.revealEnd),
    commitCount: ch.commitCount,
    finalized: ch.finalized,
    refundable: ch.refundable,
    table,
    phase: phase as Phase,
    best: winner.toLowerCase() === ZERO ? null : { winner, circuitId, score, commitIndex },
    tokenSymbol: meta.symbol,
    tokenDecimals: meta.decimals,
  };
}

export async function readAll(arena: Address): Promise<Challenge[]> {
  const n = await readCount(arena);
  const ids = Array.from({ length: n }, (_, i) => n - i); // newest first
  return Promise.all(ids.map((id) => readChallenge(arena, id)));
}

export interface Mine {
  commit: { hash: Hex; index: number; blockNumber: number; revealed: boolean } | null;
  pending: bigint;
  contribution: bigint;
}

export async function readMine(arena: Address, ch: Challenge, account: Address): Promise<Mine> {
  const c = publicClient();
  const [commit, pending, contribution] = await Promise.all([
    c.readContract({ address: arena, abi: arenaAbi, functionName: 'commitOf', args: [BigInt(ch.id), account] }),
    c.readContract({ address: arena, abi: arenaAbi, functionName: 'pendingOf', args: [ch.token, account] }),
    c.readContract({ address: arena, abi: arenaAbi, functionName: 'contributionOf', args: [BigInt(ch.id), account] }),
  ]);
  const [hash, index, blockNumber, revealed] = commit;
  return { commit: index === 0 ? null : { hash, index, blockNumber: Number(blockNumber), revealed }, pending, contribution };
}

export async function chainNow(): Promise<number> {
  return Number((await publicClient().getBlock()).timestamp);
}

// ---- pre-flight: the same checks Arena runs at reveal, as free read calls --------------------------------------------------

export interface Row { vector: number; got: number | null; want: number; ok: boolean }
export interface Preflight {
  owner: Address | null;
  ownerOk: boolean;
  exists: boolean;
  shapeOk: boolean;
  statefulOk: boolean;
  gates: number;
  budgetOk: boolean;
  rows: Row[];
  rowsOk: boolean;
  ok: boolean;
  problem: string | null;
}

export async function preflight(arena: Address, ch: Challenge, circuitId: bigint, account: Address): Promise<Preflight> {
  const c = publicClient();
  const empty: Preflight = { owner: null, ownerOk: false, exists: false, shapeOk: false, statefulOk: false, gates: 0, budgetOk: false, rows: [], rowsOk: false, ok: false, problem: null };
  let owner: Address;
  let info: readonly [number, number, number, number];
  try {
    [owner, info] = await Promise.all([
      c.readContract({ address: ch.processor, abi: circuitsAbi, functionName: 'ownerOf', args: [circuitId] }),
      c.readContract({ address: ch.processor, abi: circuitsAbi, functionName: 'circuitInfo', args: [circuitId] }),
    ]);
  } catch {
    return { ...empty, problem: `Circuit ${circuitId} does not exist on this challenge's processor.` };
  }
  const [nIn, nOut, nState, gates] = info;
  const [base, perGate, budget] = await Promise.all([
    c.readContract({ address: arena, abi: arenaAbi, functionName: 'GAS_PER_EVAL_BASE' }),
    c.readContract({ address: arena, abi: arenaAbi, functionName: 'GAS_PER_GATE' }),
    c.readContract({ address: arena, abi: arenaAbi, functionName: 'EVAL_GAS_BUDGET' }),
  ]);
  const ownerOk = owner.toLowerCase() === account.toLowerCase();
  const shapeOk = nIn === ch.nIn && nOut === ch.nOut;
  const statefulOk = nState === 0;
  const budgetOk = (1n << BigInt(ch.nIn)) * (base + perGate * BigInt(gates)) <= budget;
  const base0: Preflight = { owner, ownerOk, exists: true, shapeOk, statefulOk, gates, budgetOk, rows: [], rowsOk: false, ok: false, problem: null };
  if (!shapeOk || !statefulOk || !budgetOk) return { ...base0, problem: !shapeOk ? 'This circuit has the wrong number of inputs or outputs for the challenge.' : !statefulOk ? 'Circuits with latches are not accepted.' : 'This circuit is too large to be graded within the gas budget.' };

  const mask = (1 << ch.nOut) - 1;
  const vectors = 1 << ch.nIn;
  const rows = await Promise.all(
    Array.from({ length: vectors }, async (_, v): Promise<Row> => {
      const want = expectedAt(ch.table, ch.nOut, v);
      try {
        const out = await c.readContract({ address: ch.processor, abi: circuitsAbi, functionName: 'eval', args: [circuitId, `0x${v.toString(16).padStart(2, '0')}`] });
        const got = parseInt(out.slice(2, 4) || '0', 16) & mask;
        return { vector: v, got, want, ok: got === want };
      } catch {
        return { vector: v, got: null, want, ok: false };
      }
    }),
  );
  const rowsOk = rows.every((r) => r.ok);
  return { ...base0, rows, rowsOk, ok: ownerOk && rowsOk, problem: !ownerOk ? 'This wallet does not own that circuit.' : !rowsOk ? 'The circuit gives a wrong answer for at least one input row.' : null };
}
