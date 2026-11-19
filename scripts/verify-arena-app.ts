// Checks the site's data layer against a LOCAL FORK of X Layer that already has Arena deployed and seeded
// (see deployments/README.md and the steps in DECISIONS.md). It never touches mainnet unless VITE_RPC_URL is unset.
//   VITE_RPC_URL=http://127.0.0.1:8546 ARENA=0x... ACCOUNT=0x... STAGE=pre|post bun scripts/verify-arena-app.ts
import { getAddress } from 'viem';

// Minimal browser shims so the same modules the site uses can run under bun.
const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
});

const { readAll, readChallenge, readMine, preflight } = await import('../src/arena/arena');
const { commitHash, makeBackup, parseBackup, serializeBackup, generateSalt } = await import('../src/arena/backup');
const { runScan, ranked } = await import('../src/arena/reveals');
const { describeSpec } = await import('../src/arena/specs');
const { publicClient, RPC_URL } = await import('../src/arena/chain');
const { arenaAbi } = await import('../src/arena/abi');

const arena = getAddress(process.env.ARENA ?? '');
const account = getAddress(process.env.ACCOUNT ?? '');
const stage = process.env.STAGE ?? 'pre';
let failures = 0;
const check = (name: string, ok: boolean, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`);
  if (!ok) failures++;
};
console.log(`rpc ${RPC_URL}  arena ${arena}  stage ${stage}`);

const all = await readAll(arena);
check('lists 3 challenges, newest first', all.length === 3 && all[0]?.id === 3);
const names = all.map((c) => describeSpec(c.nIn, c.nOut, c.table).name).reverse();
check('recognises the three seeded specs', names.join('|') === 'Full adder|3-input majority|4-bit parity', names.join(', '));
check('token metadata read from the token', all[0]?.tokenSymbol === 'USDC' && all[0]?.tokenDecimals === 6);

// A backup file round-trips and matches the contract's own hash.
const salt = generateSalt();
check('salt is 32 random bytes', /^0x[0-9a-f]{64}$/.test(salt) && salt !== generateSalt());
const backup = makeBackup({ arena, challengeId: 1, circuitId: 8n, salt, account });
const parsed = parseBackup(serializeBackup(backup));
check('backup file survives a save and reload', parsed.commitHash === backup.commitHash && parsed.salt === salt);
let corrupt = false;
try {
  parseBackup(serializeBackup({ ...backup, salt: generateSalt() }));
} catch {
  corrupt = true;
}
check('a corrupted backup is refused', corrupt);
const onchain = await publicClient().readContract({ address: arena, abi: arenaAbi, functionName: 'commitHashOf', args: [8n, salt, account] });
check('browser commit hash equals the contract\'s commitHashOf', onchain.toLowerCase() === commitHash(8n, salt, account).toLowerCase());

if (stage === 'pre') {
  const ch1 = await readChallenge(arena, 1);
  check('challenge 1 is in the commit phase', ch1.phase === 0);
  const good = await preflight(arena, ch1, 8n, account);
  check('pre-flight passes for the real full adder (circuit 8)', good.ok && good.rows.length === 8 && good.gates === 9, `gates ${good.gates}`);
  const wrong = await preflight(arena, ch1, 9n, account);
  check('pre-flight rejects the majority circuit for the adder challenge', !wrong.ok && wrong.problem !== null, wrong.problem ?? '');
  const missing = await preflight(arena, ch1, 999999n, account);
  check('pre-flight reports a circuit that does not exist', !missing.exists && missing.problem !== null);
  const stranger = await preflight(arena, ch1, 8n, getAddress('0x00000000000000000000000000000000000000AA'));
  check('pre-flight refuses a circuit this wallet does not own', !stranger.ownerOk && !stranger.ok);
  const mine = await readMine(arena, ch1, account);
  check('no commit yet for this wallet', mine.commit === null);
} else {
  const ch1 = await readChallenge(arena, 1);
  const mine = await readMine(arena, ch1, account);
  const salt1 = process.env.SALT1 as `0x${string}`;
  check('commit recorded', mine.commit !== null);
  check('browser hash equals the committed hash', mine.commit?.hash.toLowerCase() === commitHash(8n, salt1, account).toLowerCase());
  const ctl = { cancelled: false };
  const rows: Record<number, number> = {};
  for (const id of [1, 2, 3]) {
    const ch = await readChallenge(arena, id);
    let final: { rows: ReturnType<typeof ranked>; done: boolean; scanned: number; from: number } | null = null;
    await runScan(arena, id, ch.commitEnd, ch.revealEnd, ctl, (s) => {
      final = { rows: ranked(s.rows), done: s.done, scanned: s.scanned, from: s.from };
    }, 200).catch(() => undefined);
    rows[id] = final ? (final as { rows: unknown[] }).rows.length : -1;
  }
  check('scan found one reveal in each challenge', rows[1] === 1 && rows[2] === 1 && rows[3] === 1, JSON.stringify(rows));
}
console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
