import { encodeAbiParameters, getAddress, isAddress, keccak256, parseAbiParameters, type Address, type Hex } from 'viem';
import { XLAYER_ID } from './chain';

/**
 * The salt is what turns a commit into a reveal. It is generated here, in the browser, and never sent anywhere.
 * Lose it and the entry is lost: the contract cannot recover it and neither can anyone else.
 */
export function generateSalt(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** Same encoding as Arena.commitHashOf: keccak256(abi.encode(circuitId, salt, account)). */
export function commitHash(circuitId: bigint, salt: Hex, account: Address): Hex {
  return keccak256(encodeAbiParameters(parseAbiParameters('uint256, bytes32, address'), [circuitId, salt, account]));
}

export interface Backup {
  app: 'tapegold-x-layer';
  version: 1;
  chainId: number;
  arena: Address;
  challengeId: string;
  circuitId: string;
  salt: Hex;
  account: Address;
  commitHash: Hex;
  createdAt: string;
  note: string;
}

export function makeBackup(p: { arena: Address; challengeId: number; circuitId: bigint; salt: Hex; account: Address }): Backup {
  return {
    app: 'tapegold-x-layer',
    version: 1,
    chainId: XLAYER_ID,
    arena: p.arena,
    challengeId: String(p.challengeId),
    circuitId: p.circuitId.toString(),
    salt: p.salt,
    account: p.account,
    commitHash: commitHash(p.circuitId, p.salt, p.account),
    createdAt: new Date().toISOString(),
    note: 'KEEP THIS FILE PRIVATE. Anyone with it can see your circuit choice before you reveal; without it you cannot reveal and the entry is lost.',
  };
}

export const serializeBackup = (b: Backup): string => `${JSON.stringify(b, null, 2)}\n`;

export function backupFileName(b: Backup): string {
  return `tapegold-xlayer-challenge-${b.challengeId}-circuit-${b.circuitId}-${b.commitHash.slice(2, 10)}.json`;
}

/** Starts a file download. Returns false when the browser cannot create one; the caller then falls back to copy. */
export function downloadBackup(b: Backup): boolean {
  try {
    const blob = new Blob([serializeBackup(b)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = backupFileName(b);
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return true;
  } catch {
    return false;
  }
}

const isHex32 = (v: unknown): v is Hex => typeof v === 'string' && /^0x[0-9a-fA-F]{64}$/.test(v);
const isDecimal = (v: unknown): v is string => typeof v === 'string' && /^\d+$/.test(v);

/** Parses and fully validates a backup. Throws a readable message when it is not a good one. */
export function parseBackup(text: string): Backup {
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(text.trim()) as Record<string, unknown>;
  } catch {
    throw new Error('That is not a backup file (it is not valid JSON).');
  }
  if ((j.app !== 'tapegold-x-layer' && j.app !== 'arena-x-layer') || j.version !== 1) throw new Error('That is not a TapeGold backup file.');
  if (j.chainId !== XLAYER_ID) throw new Error('That backup is for a different network.');
  const { arena, account, salt, challengeId, circuitId } = j;
  if (typeof arena !== 'string' || !isAddress(arena) || typeof account !== 'string' || !isAddress(account)) throw new Error('The backup has a bad address.');
  if (!isHex32(salt) || !isHex32(j.commitHash) || !isDecimal(challengeId) || !isDecimal(circuitId)) throw new Error('The backup is incomplete.');
  const expected = commitHash(BigInt(circuitId), salt, getAddress(account));
  if (expected.toLowerCase() !== j.commitHash.toLowerCase()) throw new Error('The backup is corrupted: its salt does not produce its own commit hash.');
  return {
    app: 'tapegold-x-layer',
    version: 1,
    chainId: XLAYER_ID,
    arena: getAddress(arena),
    challengeId,
    circuitId,
    salt,
    account: getAddress(account),
    commitHash: expected,
    createdAt: typeof j.createdAt === 'string' ? j.createdAt : '',
    note: typeof j.note === 'string' ? j.note : '',
  };
}

// ---- local copy (a convenience, NOT a backup: browsers clear storage) ---------------------------------------------------

export interface Entry {
  arena: Address;
  challengeId: number;
  circuitId: string;
  salt: Hex;
  account: Address;
  commitHash: Hex;
  status: 'pending' | 'committed' | 'revealed';
  createdAt: string;
  commitTx?: Hex;
  revealTx?: Hex;
}
const KEY = 'arena:v1:entries';

function all(): Entry[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Entry[];
  } catch {
    return [];
  }
}
const same = (e: Entry, arena: Address, challengeId: number, account: Address) =>
  e.arena.toLowerCase() === arena.toLowerCase() && e.challengeId === challengeId && e.account.toLowerCase() === account.toLowerCase();

export function findEntry(arena: Address, challengeId: number, account: Address): Entry | undefined {
  return all().find((e) => same(e, arena, challengeId, account));
}
export function saveEntry(entry: Entry): void {
  // Never let a fresh, unsent entry overwrite one that is already committed or revealed: it holds the salt that matters.
  const old = findEntry(entry.arena, entry.challengeId, entry.account);
  if (old && old.status !== 'pending' && entry.status === 'pending' && old.salt !== entry.salt) return;
  const rest = all().filter((e) => !same(e, entry.arena, entry.challengeId, entry.account));
  localStorage.setItem(KEY, JSON.stringify([...rest, entry]));
}
export function fromBackup(b: Backup, status: Entry['status']): Entry {
  return {
    arena: b.arena,
    challengeId: Number(b.challengeId),
    circuitId: b.circuitId,
    salt: b.salt,
    account: b.account,
    commitHash: b.commitHash,
    status,
    createdAt: b.createdAt || new Date().toISOString(),
  };
}
