import type { Address, Hex } from 'viem';
import { commitmentOf, evalDesign, netlistHash, randomSalt, validateDesign, type Design, type Gate } from './netlist';
import { evalGasEstimate, MOCK_FEE_BPS, RULES } from './rules';
import { FEE_RECIPIENT } from './personas';
import {
  ContractError,
  type ChainState,
  type Contest,
  type Draft,
  type Phase,
} from './types';

/**
 * Pure state transitions that mirror contracts/TapeGolf.sol. Every function takes the current state and returns a new
 * one, or throws a ContractError named after the Solidity custom error it stands for.
 */

// A plain JSON round trip (bigint-aware) instead of structuredClone: the state only holds JSON-safe data and bigints, and this behaves
// identically in every runtime, including the one the checks run in.
const toJson = (_k: string, v: unknown) => (typeof v === 'bigint' ? { __bigint: v.toString() } : v);
const fromJson = (_k: string, v: unknown) =>
  v && typeof v === 'object' && '__bigint' in v ? BigInt((v as { __bigint: string }).__bigint) : v;
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v, toJson), fromJson) as T;

export const draftKey = (who: Address, contestId: number) => `${who}:${contestId}`;

export function phaseOf(c: Contest, now: number): Phase {
  if (c.settled) return 'Settled';
  if (now < c.commitDeadline) return 'Commit';
  if (now < c.revealDeadline) return 'Reveal';
  return 'Ended';
}

function find(s: ChainState, contestId: number): Contest {
  const c = s.contests.find((x) => x.id === contestId);
  if (!c) throw new ContractError('ContestNotFound', 'That contest does not exist.');
  return c;
}

function log(s: ChainState, who: Address, text: string) {
  s.log.unshift({ at: s.now, who, text });
  if (s.log.length > 60) s.log.length = 60;
}

export interface CreateParams {
  title: string;
  blurb: string;
  prize: bigint;
  processor: 'any' | 'mock-processor';
  nIn: number;
  nOut: number;
  expected: number[];
  maxGates: number;
  maxNetlistBytes: number;
  commitDeadline: number;
  revealDeadline: number;
}

export function createContest(s0: ChainState, sponsor: Address, p: CreateParams): ChainState {
  const s = clone(s0);
  if (p.nIn < 1 || p.nIn > RULES.MAX_INPUTS) throw new ContractError('InvalidInputs', `Inputs must be 1 to ${RULES.MAX_INPUTS}.`);
  if (p.nOut < 1 || p.nOut > RULES.MAX_OUTPUTS) throw new ContractError('InvalidOutputs', `Outputs must be 1 to ${RULES.MAX_OUTPUTS}.`);
  if (p.expected.length !== 2 ** p.nIn) throw new ContractError('InvalidExpectedLength', `The truth table needs ${2 ** p.nIn} rows.`);
  p.expected.forEach((v, i) => {
    if (v < 0 || v >= 2 ** p.nOut) throw new ContractError('InvalidExpectedByte', `Row ${i} has more output bits than the circuit has outputs.`);
  });
  if (p.prize <= 0n) throw new ContractError('ZeroPrize', 'The prize must be more than zero.');
  if (p.maxGates < 1) throw new ContractError('InvalidMaxGates', 'The gate limit must be at least 1.');
  if (p.maxNetlistBytes < RULES.BYTES_PER_GATE || p.maxNetlistBytes > RULES.MAX_NETLIST_BYTES) {
    throw new ContractError('InvalidMaxNetlistBytes', `Netlist limit must be ${RULES.BYTES_PER_GATE} to ${RULES.MAX_NETLIST_BYTES} bytes.`);
  }
  if (evalGasEstimate(p.nIn, p.maxGates) > RULES.EVAL_GAS_BUDGET) {
    throw new ContractError('EvaluationBudgetExceeded', 'Too many inputs and gates: grading would not fit in one transaction.');
  }
  if (p.commitDeadline < s.now + RULES.MIN_PHASE_SECONDS) throw new ContractError('InvalidCommitDeadline', 'Commit phase must last at least one hour.');
  if (p.revealDeadline < p.commitDeadline + RULES.MIN_PHASE_SECONDS) throw new ContractError('InvalidRevealDeadline', 'Reveal phase must last at least one hour.');
  if ((s.balances[sponsor] ?? 0n) < p.prize) throw new ContractError('InsufficientBalance', 'The sponsor does not hold enough mUSDC for this prize.');

  s.balances[sponsor] -= p.prize;
  const id = s.contests.length + 1;
  s.contests.push({
    id,
    ...p,
    sponsor,
    commits: {},
    commitCount: 0,
    reveals: [],
    usedCircuits: [],
    leader: null,
    settled: false,
    winnerPayout: 0n,
    fee: 0n,
  });
  log(s, sponsor, `Opened contest #${id}: ${p.title}`);
  return s;
}

export function saveDraft(s0: ChainState, who: Address, contestId: number, draft: Draft): ChainState {
  const s = clone(s0);
  s.drafts[draftKey(who, contestId)] = draft;
  return s;
}

export function commit(s0: ChainState, who: Address, contestId: number, commitment: Hex): ChainState {
  const s = clone(s0);
  const c = find(s, contestId);
  if (s.now >= c.commitDeadline) throw new ContractError('CommitPhaseClosed', 'The commit phase is over.');
  if (c.commits[who]) throw new ContractError('AlreadyCommitted', 'You already committed to this contest.');
  c.commitCount += 1;
  c.commits[who] = { commitment, order: c.commitCount, revealed: false };
  log(s, who, `Committed to #${c.id} (entry ${c.commitCount})`);
  return s;
}

/** Designer-side step: lock a design, make a salt, and commit to its netlist hash. */
export function commitDesign(s: ChainState, who: Address, contestId: number, gates: Gate[]): ChainState {
  const c = find(s, contestId);
  const design: Design = { nIn: c.nIn, nOut: c.nOut, gates };
  const problem = validateDesign(design);
  if (problem) throw new ContractError('InvalidDesign', problem);
  const salt = randomSalt();
  const commitment = commitmentOf(contestId, who, netlistHash(gates), salt);
  const next = commit(s, who, contestId, commitment);
  return saveDraft(next, who, contestId, { gates, salt, circuitId: null });
}

/** Tape out the committed design on the mock processor. The contract cannot see this order; the app enforces it. */
export function tapeOut(s0: ChainState, who: Address, contestId: number): ChainState {
  const s = clone(s0);
  const c = find(s, contestId);
  const d = s.drafts[draftKey(who, contestId)];
  if (!d || !d.salt || !c.commits[who]) throw new ContractError('CommitFirst', 'Commit your design before you tape it out.');
  if (d.circuitId !== null) throw new ContractError('AlreadyTapedOut', 'This design is already taped out.');
  const id = s.circuits.length + 1;
  s.circuits.push({ id, owner: who, gates: d.gates, nIn: c.nIn, nOut: c.nOut, tapedAt: s.now });
  d.circuitId = id;
  log(s, who, `Taped out circuit #${id} (${d.gates.length} gates)`);
  return s;
}

export function reveal(s0: ChainState, who: Address, contestId: number): ChainState {
  const s = clone(s0);
  const c = find(s, contestId);
  if (s.now < c.commitDeadline || s.now >= c.revealDeadline) throw new ContractError('NotRevealPhase', 'Reveals are only accepted between the commit deadline and the reveal deadline.');
  const cm = c.commits[who];
  if (!cm) throw new ContractError('NoCommitment', 'You have no commitment in this contest.');
  if (cm.revealed) throw new ContractError('AlreadyRevealed', 'You already revealed.');
  const d = s.drafts[draftKey(who, contestId)];
  if (!d || !d.salt || d.circuitId === null) throw new ContractError('NothingToTapeOut', 'Tape out your circuit before you reveal it.');
  const circuit = s.circuits.find((x) => x.id === d.circuitId);
  if (!circuit) throw new ContractError('NotCircuitOwner', 'That circuit does not exist.');
  if (circuit.owner !== who) throw new ContractError('NotCircuitOwner', 'You no longer own that circuit.');
  if (c.usedCircuits.includes(circuit.id)) throw new ContractError('CircuitAlreadyUsed', 'That circuit was already used in this contest.');
  if (circuit.nIn !== c.nIn) throw new ContractError('InputCountMismatch', 'The circuit has the wrong number of inputs.');
  if (circuit.nOut !== c.nOut) throw new ContractError('OutputCountMismatch', 'The circuit has the wrong number of outputs.');
  const gateCount = circuit.gates.length;
  if (gateCount > c.maxGates) throw new ContractError('TooManyGates', `The circuit uses ${gateCount} gates, the limit is ${c.maxGates}.`);
  if (gateCount * RULES.BYTES_PER_GATE > c.maxNetlistBytes) throw new ContractError('NetlistTooLarge', 'The netlist is larger than this contest allows.');
  if (commitmentOf(contestId, who, netlistHash(circuit.gates), d.salt) !== cm.commitment) {
    throw new ContractError('CommitmentMismatch', 'The circuit does not match what you committed to.');
  }
  const design: Design = { nIn: c.nIn, nOut: c.nOut, gates: circuit.gates };
  for (let v = 0; v < c.expected.length; v++) {
    const got = evalDesign(design, v);
    if (got !== c.expected[v]) {
      throw new ContractError('TruthTableMismatch', `Input ${v}: the circuit returned ${got}, the spec wants ${c.expected[v]}.`);
    }
  }

  cm.revealed = true;
  c.usedCircuits.push(circuit.id);
  const l = c.leader;
  const becameLeader = !l || gateCount < l.gateCount || (gateCount === l.gateCount && cm.order < l.order);
  if (becameLeader) c.leader = { designer: who, gateCount, order: cm.order, circuitId: circuit.id };
  c.reveals.push({ designer: who, circuitId: circuit.id, gateCount, order: cm.order, at: s.now, becameLeader });
  log(s, who, `Revealed circuit #${circuit.id} in #${c.id}: ${gateCount} gates${becameLeader ? ' (new leader)' : ''}`);
  return s;
}

export function settle(s0: ChainState, who: Address, contestId: number, pay: boolean): ChainState {
  const s = clone(s0);
  const c = find(s, contestId);
  if (c.settled) throw new ContractError('AlreadySettled', 'This contest is already settled.');
  if (s.now < c.revealDeadline) throw new ContractError('ContestNotEnded', 'The reveal phase is still running.');
  c.settled = true;
  let payee: Address;
  if (!c.leader) {
    payee = c.sponsor;
    c.winnerPayout = c.prize;
    c.fee = 0n;
    s.pending[payee] = (s.pending[payee] ?? 0n) + c.prize;
    log(s, who, `Settled #${c.id}: no valid entry, prize refunded to the sponsor`);
  } else {
    payee = c.leader.designer;
    c.fee = (c.prize * BigInt(MOCK_FEE_BPS)) / 10_000n;
    c.winnerPayout = c.prize - c.fee;
    if (c.fee > 0n) s.pending[FEE_RECIPIENT.address] = (s.pending[FEE_RECIPIENT.address] ?? 0n) + c.fee;
    s.pending[payee] = (s.pending[payee] ?? 0n) + c.winnerPayout;
    log(s, who, `Settled #${c.id}: ${c.leader.gateCount}-gate circuit wins`);
  }
  return pay ? claim(s, who, payee) : s;
}

/** Anyone may call; funds always go to `account`. */
export function claim(s0: ChainState, caller: Address, account: Address): ChainState {
  const s = clone(s0);
  const amount = s.pending[account] ?? 0n;
  if (amount === 0n) throw new ContractError('NothingToClaim', 'Nothing to claim.');
  s.pending[account] = 0n;
  s.balances[account] = (s.balances[account] ?? 0n) + amount;
  log(s, caller, `Paid out to ${account === caller ? 'self' : 'account'}`);
  return s;
}

export function advance(s0: ChainState, seconds: number): ChainState {
  const s = clone(s0);
  s.now += seconds;
  return s;
}

export function leaderboard(c: Contest) {
  return [...c.reveals].sort((a, b) => a.gateCount - b.gateCount || a.order - b.order);
}
