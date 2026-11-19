// Builds deployments/xlayer.json from Foundry's broadcast files after you have run the X Layer scripts yourself.
// Read-only apart from writing that one file. It never signs or sends anything and reads no keys.
//
//   bun scripts/xlayer-record.ts
//
// Reads broadcast/{DeployArena,SeedChallenges,TapeOutSolutions,Play}.s.sol/196/run-*.json, takes addresses, hashes and
// receipt data from them, and decodes the confirmed logs (ChallengeCreated, TapedOut) so circuit and challenge ids come
// from confirmed transactions, not from simulations.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodeAbiParameters, getAddress, hexToBigInt, parseAbi, parseEventLogs, type Hex } from 'viem';

const CHAIN_ID = 196;
const ROOT = process.cwd();
const BROADCAST_DIR = process.env.BROADCAST_DIR ?? join(ROOT, 'broadcast');
const OUT_FILE = process.env.XLAYER_RECORD_OUT ?? join(ROOT, 'deployments', 'xlayer.json');
const EXPLORER = 'https://www.oklink.com/xlayer';
const OKLINK_VERIFIER_URL = 'https://www.oklink.com/api/v5/explorer/contract/verify-source-code-plugin/XLAYER';
const COMPILER = 'v0.8.28+commit.7893614a';

const arenaAbi = parseAbi([
  'event ChallengeCreated(uint256 indexed challengeId, address indexed sponsor, address indexed token, uint256 pot, uint8 nIn, uint8 nOut, address processor, uint64 commitEnd, uint64 revealEnd, bytes packedTruthTable)',
  'event Committed(uint256 indexed challengeId, address indexed committer, bytes32 hash, uint32 commitIndex, uint64 commitBlock)',
  'event Revealed(uint256 indexed challengeId, address indexed revealer, uint256 indexed circuitId, uint32 score, uint32 commitIndex, uint64 commitBlock, bool becameBest)',
  'event Finalized(uint256 indexed challengeId, address indexed winner, uint256 circuitId, uint32 score, uint256 payout, uint256 fee)',
]);
const tapeOutAbi = parseAbi(['event TapedOut(uint256 indexed circuitId, address indexed author, uint32 gateCount, uint32 nState)']);

type Tx = {
  hash: Hex;
  transactionType: string;
  contractName?: string | null;
  contractAddress?: string | null;
  function?: string | null;
  arguments?: string[] | null;
  transaction: { from: string; to?: string | null; value?: string; input?: string };
};
type Receipt = {
  transactionHash: Hex;
  blockNumber: string;
  gasUsed: string;
  effectiveGasPrice?: string;
  status: string;
  logs: { address: string; topics: Hex[]; data: Hex }[];
};
type Run = { script: string; file: string; transactions: Tx[]; receipts: Receipt[]; timestamp?: number };

function loadRuns(script: string): Run[] {
  const dir = join(BROADCAST_DIR, `${script}.s.sol`, String(CHAIN_ID));
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^run-\d+\.json$/.test(f))
    .sort()
    .map((f) => {
      const j = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { transactions?: Tx[]; receipts?: Receipt[]; timestamp?: number };
      return { script, file: `broadcast/${script}.s.sol/${CHAIN_ID}/${f}`, transactions: j.transactions ?? [], receipts: j.receipts ?? [], timestamp: j.timestamp };
    });
}

const receiptOf = (run: Run, hash: Hex) => run.receipts.find((r) => r.transactionHash.toLowerCase() === hash.toLowerCase());
const toNum = (h: string | undefined) => (h ? Number(hexToBigInt(h as Hex)) : null);

function main() {
  const deploy = loadRuns('DeployArena');
  const seed = loadRuns('SeedChallenges');
  const tape = loadRuns('TapeOutSolutions');
  const play = loadRuns('Play');
  if (deploy.length === 0) {
    console.log('No broadcast files found under broadcast/DeployArena.s.sol/196/. Nothing was deployed from this machine yet.');
    console.log('deployments/xlayer.json is left untouched. Run the scripts with --broadcast first (see deployments/README.md).');
    return;
  }

  const txs: object[] = [];
  const addTxs = (runs: Run[]) => {
    for (const run of runs) {
      for (const t of run.transactions) {
        const r = receiptOf(run, t.hash);
        txs.push({
          script: run.script,
          hash: t.hash,
          explorer: `${EXPLORER}/tx/${t.hash}`,
          type: t.transactionType,
          function: t.function ?? null,
          to: t.transaction.to ?? t.contractAddress ?? null,
          valueWei: t.transaction.value ? hexToBigInt(t.transaction.value as Hex).toString() : '0',
          blockNumber: toNum(r?.blockNumber),
          gasUsed: toNum(r?.gasUsed),
          status: r ? (r.status === '0x1' ? 'success' : 'FAILED') : 'no receipt',
          file: run.file,
        });
      }
    }
  };
  [deploy, seed, tape, play].forEach(addTxs);

  // --- Arena (latest deployment)
  const dRun = deploy[deploy.length - 1];
  const dTx = dRun.transactions.find((t) => t.transactionType === 'CREATE' && t.contractName === 'Arena') ?? dRun.transactions[0];
  const arena = dTx.contractAddress ? getAddress(dTx.contractAddress) : '';
  const args = dTx.arguments ?? [];
  const [registry, feeRecipient, feeBps] = [args[0], args[1], args[2]];
  const encodedArgs =
    registry && feeRecipient && feeBps
      ? encodeAbiParameters(
          [{ type: 'address' }, { type: 'address' }, { type: 'uint16' }],
          [registry as Hex, feeRecipient as Hex, Number(feeBps)],
        )
      : null;
  const dReceipt = receiptOf(dRun, dTx.hash);

  // Everything below is scoped to THIS Arena deployment: runs older than the deployment are ignored, challenge and play
  // events must be emitted by this Arena, and each circuit is identified by its gate count, not by its position in history.
  const deployTs = dRun.timestamp ?? 0;
  const sinceDeploy = (runs: Run[]) => runs.filter((r) => (r.timestamp ?? 0) >= deployTs);
  const seen = new Set<string>();
  const fresh = (hash: string) => (seen.has(hash.toLowerCase()) ? false : (seen.add(hash.toLowerCase()), true));
  const isArena = (a: string) => a.toLowerCase() === arena.toLowerCase();
  const warnings: string[] = [];

  // --- challenges (from confirmed ChallengeCreated logs emitted by this Arena)
  const challenges: object[] = [];
  for (const run of sinceDeploy(seed)) {
    for (const r of run.receipts) {
      if (!fresh(r.transactionHash)) continue;
      const events = parseEventLogs({ abi: arenaAbi, eventName: 'ChallengeCreated', logs: r.logs as never });
      for (const e of events) {
        if (!isArena(e.address)) continue;
        challenges.push({
          challengeId: Number(e.args.challengeId),
          sponsor: e.args.sponsor,
          prizeToken: e.args.token,
          potBaseUnits: e.args.pot.toString(),
          nIn: e.args.nIn,
          nOut: e.args.nOut,
          processor: e.args.processor,
          commitEnd: Number(e.args.commitEnd),
          commitEndIso: new Date(Number(e.args.commitEnd) * 1000).toISOString(),
          revealEnd: Number(e.args.revealEnd),
          revealEndIso: new Date(Number(e.args.revealEnd) * 1000).toISOString(),
          createTx: r.transactionHash,
          explorer: `${EXPLORER}/tx/${r.transactionHash}`,
        });
      }
    }
  }

  // --- solution circuits (confirmed TapedOut logs authored by the deployer after the deployment; named by gate count)
  const byGates: Record<number, string> = { 9: 'Full adder', 6: '3-input majority', 12: '4-bit parity' };
  const found = new Map<string, Record<string, unknown>>();
  for (const run of sinceDeploy(tape)) {
    for (const r of run.receipts) {
      const events = parseEventLogs({ abi: tapeOutAbi, eventName: 'TapedOut', logs: r.logs as never });
      for (const e of events) {
        const name = byGates[Number(e.args.gateCount)];
        if (!name || e.args.author.toLowerCase() !== dTx.transaction.from.toLowerCase()) continue;
        if (found.has(name)) warnings.push(`More than one ${name} tape-out found after this deployment; using the latest (circuit ${e.args.circuitId}).`);
        found.set(name, {
          name,
          circuitId: Number(e.args.circuitId),
          author: e.args.author,
          gateCount: e.args.gateCount,
          processor: getAddress(e.address), // the contract that emitted TapedOut is the processor
          tapeoutTx: r.transactionHash,
          explorer: `${EXPLORER}/tx/${r.transactionHash}`,
        });
      }
    }
  }
  const solutions = ['Full adder', '3-input majority', '4-bit parity'].map((n) => found.get(n)).filter((x): x is Record<string, unknown> => !!x);

  // --- play stages that were broadcast against this Arena
  const stages: object[] = [];
  for (const run of sinceDeploy(play)) {
    for (const r of run.receipts) {
      for (const kind of ['Committed', 'Revealed', 'Finalized'] as const) {
        for (const e of parseEventLogs({ abi: arenaAbi, eventName: kind, logs: r.logs as never })) {
          if (!isArena(e.address)) continue;
          stages.push({ event: kind, challengeId: Number(e.args.challengeId), tx: r.transactionHash, explorer: `${EXPLORER}/tx/${r.transactionHash}` });
        }
      }
    }
  }

  const verify = arena
    ? {
        note: 'Wait at least one minute after deployment. OKLink needs your OKLink API key in $OKLINK_API_KEY. Sourcify needs no key.',
        sourcify: `forge verify-contract ${arena} contracts/Arena.sol:Arena --chain ${CHAIN_ID} --verifier sourcify --watch`,
        oklink: [
          `forge verify-contract ${arena} contracts/Arena.sol:Arena`,
          `--chain ${CHAIN_ID}`,
          '--verifier oklink',
          `--verifier-url ${OKLINK_VERIFIER_URL}`,
          '--etherscan-api-key $OKLINK_API_KEY',
          `--compiler-version ${COMPILER}`,
          '--num-of-optimizations 200',
          '--evm-version cancun',
          encodedArgs ? `--constructor-args ${encodedArgs}` : '--guess-constructor-args',
          '--watch',
        ].join(' \\\n  '),
        check: `forge verify-check --chain ${CHAIN_ID} --verifier oklink --verifier-url ${OKLINK_VERIFIER_URL} <GUID>`,
      }
    : null;

  const out = {
    status: 'RECORDED_FROM_BROADCAST',
    network: 'X Layer mainnet',
    chainId: CHAIN_ID,
    generatedAt: new Date().toISOString(),
    explorer: EXPLORER,
    config: { factory: registry ?? null, feeRecipient: feeRecipient ?? null, feeBps: feeBps ? Number(feeBps) : null },
    arena: {
      address: arena,
      explorer: `${EXPLORER}/address/${arena}`,
      deployer: dTx.transaction.from,
      deployTx: dTx.hash,
      deployBlock: toNum(dReceipt?.blockNumber),
      constructorArgs: { registry, feeRecipient, feeBps },
      encodedConstructorArgs: encodedArgs,
    },
    challenges,
    solutionCircuits: solutions,
    playStages: stages,
    transactions: txs,
    verify,
    warnings: [
      ...warnings,
      dReceipt?.status === '0x1' ? null : 'The Arena deployment has no successful receipt.',
      challenges.length !== 3 ? `Expected 3 challenges from confirmed logs, found ${challenges.length}.` : null,
      solutions.length !== 3 ? `Expected 3 tape-outs from confirmed logs, found ${solutions.length}.` : null,
      txs.some((t) => (t as { status: string }).status !== 'success') ? 'At least one transaction has no successful receipt. Check the transactions list.' : null,
    ].filter(Boolean),
  };

  writeFileSync(OUT_FILE, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`Wrote ${OUT_FILE} (${txs.length} transactions).`);
  // Point the website at this deployment (runtime config, read by the site from ./config.json).
  if (arena && !process.env.XLAYER_RECORD_OUT) {
    writeFileSync(join(ROOT, 'public', 'config.json'), `${JSON.stringify({ arena, deployBlock: toNum(dReceipt?.blockNumber), chainId: CHAIN_ID }, null, 2)}\n`);
    console.log('Wrote public/config.json for the website.');
  }
  console.log(`Arena: ${arena}`);
  console.log(`Challenges: ${challenges.map((c) => (c as { challengeId: number }).challengeId).join(', ') || 'none yet'}`);
  console.log(`Solution circuit ids: ${solutions.map((s) => (s as { circuitId: number }).circuitId).join(', ') || 'none yet'}`);
  if (out.warnings.length) console.log(`Warnings:\n- ${out.warnings.join('\n- ')}`);
}

main();
