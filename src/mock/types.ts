import type { Address, Hex } from 'viem';
import type { Gate } from './netlist';

export type PersonaId = 'ana' | 'bo' | 'cy' | 'di';

/** Demo identities. The addresses are made up for the mock and are not real wallets. */
export interface Persona {
  id: PersonaId;
  name: string;
  role: string;
  address: Address;
}

export type Phase = 'Commit' | 'Reveal' | 'Ended' | 'Settled';

export interface Commit {
  commitment: Hex;
  order: number;
  revealed: boolean;
}

export interface Reveal {
  designer: Address;
  circuitId: number;
  gateCount: number;
  order: number;
  at: number;
  becameLeader: boolean;
}

export interface Leader {
  designer: Address;
  gateCount: number;
  order: number;
  circuitId: number;
}

export interface Contest {
  id: number;
  title: string;
  blurb: string;
  sponsor: Address;
  prize: bigint;
  /** 'any' = any registered processor, otherwise the single allowed processor. */
  processor: 'any' | 'mock-processor';
  nIn: number;
  nOut: number;
  expected: number[];
  maxGates: number;
  maxNetlistBytes: number;
  commitDeadline: number;
  revealDeadline: number;
  commits: Record<Address, Commit>;
  commitCount: number;
  reveals: Reveal[];
  usedCircuits: number[];
  leader: Leader | null;
  settled: boolean;
  winnerPayout: bigint;
  fee: bigint;
}

/** A circuit NFT on the mock processor. */
export interface Circuit {
  id: number;
  owner: Address;
  gates: Gate[];
  nIn: number;
  nOut: number;
  tapedAt: number;
}

/** What a designer keeps in their own browser. Losing the salt means losing the right to reveal. */
export interface Draft {
  gates: Gate[];
  salt: Hex | null;
  circuitId: number | null;
}

export interface ChainState {
  version: 1;
  now: number;
  contests: Contest[];
  circuits: Circuit[];
  balances: Record<Address, bigint>;
  pending: Record<Address, bigint>;
  drafts: Record<string, Draft>;
  log: LogEntry[];
}

export interface LogEntry {
  at: number;
  who: Address;
  text: string;
}

export type ErrorName =
  | 'InvalidInputs'
  | 'InvalidOutputs'
  | 'InvalidExpectedLength'
  | 'InvalidExpectedByte'
  | 'ZeroPrize'
  | 'InvalidMaxGates'
  | 'InvalidMaxNetlistBytes'
  | 'EvaluationBudgetExceeded'
  | 'InvalidCommitDeadline'
  | 'InvalidRevealDeadline'
  | 'InsufficientBalance'
  | 'ContestNotFound'
  | 'CommitPhaseClosed'
  | 'AlreadyCommitted'
  | 'NotRevealPhase'
  | 'NoCommitment'
  | 'AlreadyRevealed'
  | 'NotCircuitOwner'
  | 'CircuitAlreadyUsed'
  | 'InputCountMismatch'
  | 'OutputCountMismatch'
  | 'TooManyGates'
  | 'NetlistTooLarge'
  | 'CommitmentMismatch'
  | 'TruthTableMismatch'
  | 'ContestNotEnded'
  | 'AlreadySettled'
  | 'NothingToClaim'
  | 'InvalidDesign'
  | 'CommitFirst'
  | 'NothingToTapeOut'
  | 'AlreadyTapedOut';

/** Mirrors a Solidity custom error: a name plus a plain sentence for the UI. */
export class ContractError extends Error {
  readonly errorName: ErrorName;
  constructor(errorName: ErrorName, message: string) {
    super(message);
    this.name = 'ContractError';
    this.errorName = errorName;
  }
}
