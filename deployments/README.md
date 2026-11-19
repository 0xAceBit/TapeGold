# X Layer runbook (mainnet, tiny pots)

Nothing in this repository has been sent to mainnet. Arc Studio does not deploy to, sign for or fund mainnet: you run
every spending step below yourself, from your own wallet, after reading the dry run.

## What gets created

| Step | Script | Transactions |
|---|---|---|
| 1 | `DeployArena` | 1 (deploy Arena, fee recipient `0x362f…86a3`, fee 2.5%) |
| 2 | `SeedChallenges` | 4 (approve 3.000 USDC, then 3 challenges of 1.000 USDC: full adder, 3-input majority, 4-bit parity) |
| 3 | `TapeOutSolutions` | 4 (mint 27 NAND, tape out 9 + 6 + 12 gate solution circuits) |
| 4 | `Play` commit / reveal / finalize / withdraw | 3 + 3 + 3 + 1 |

Costs on the suggested processor (checked on a fork of the current chain): tape-outs cost 0.00456 OKB in TapeOut fees
(one mint fee 0.00066 plus 3 x 0.0013), plus gas at about 0.02 gwei. The pots are 3 USDC in total and all of it is at risk:
the Arena fee (2.5%) only applies to a pot that has a winner, and the winner can be someone else. Hard caps in the scripts: 5 USDC per pot and 10 USDC in total.

The fee recipient `0x362f5b4391AC51a56b13F9A63E98bB95731E86a3` held about 0.0019 OKB when I checked, which is not enough for
step 3. If that wallet is also your deployer, add at least 0.01 OKB first. The deployer also needs at least 3 USDC.

## Addresses to confirm before you spend

| What | Address | Source |
|---|---|---|
| TapeOut factory (registry) | `0x1f09DAeFA827f02CBb40967cc91b259763760761` | SPIKE.md C1, re-read live |
| Fee recipient | `0x362f5b4391AC51a56b13F9A63E98bB95731E86a3` | you |
| Prize token (native USDC, 6 decimals) | `0xB6CEceAB302E2E4948951eE7843FC24E92933061` | OKX "Native USDC & CCTP are Now Live on X Layer"; symbol and decimals read onchain |
| Processor for tape-outs | `0x9e2849c04A513FE64db07521cBE52d078d905c0E` ("PULSE Financial Indicators") | found by `FindProcessor` on the fork: free supply, mint price 0, accepts any wallet |

The processor belongs to someone else. Its creator can restrict tape-outs at any time (TapeOut has an opt-in
`restrictTapeoutToCreator`), so re-run the dry run right before step 3. Never use the shared Arc Studio platform wallet
`0x5B12…Ef42` for anything here; the scripts refuse it.

## 0. Setup (once)

```bash
# import your key into an encrypted Foundry keystore; never paste a key into chat or a file
cast wallet import xlayer-deployer --interactive
export DEPLOYER=0xYourAddress
export PROCESSOR=0x9e2849c04A513FE64db07521cBE52d078d905c0E
export RPC=https://rpc.xlayer.tech
```

## 1. Dry run on the fork (spends nothing)

```bash
# list processors that accept a tape-out right now
forge script contracts/script/xlayer/FindProcessor.s.sol --fork-url $RPC

# full rehearsal: deploy, seed, tape out, commit, reveal, finalize, withdraw. Prints every transaction.
PROCESSOR=$PROCESSOR forge script contracts/script/xlayer/Rehearsal.s.sol --fork-url $RPC
```

The rehearsal never calls a broadcast cheatcode, so even `--broadcast` cannot send anything. It runs against the real
TapeOut `eval`. Read the printed list of 20 transactions before you continue.

You can also dry-run any single script with the same flags minus `CONFIRM_SPEND`; it prints its transactions and stops.

## 2. Live run (spends real funds)

A script only broadcasts when BOTH `CONFIRM_SPEND=YES` is set AND forge is run with `--broadcast`. Without
`CONFIRM_SPEND=YES` it is a dry run even with `--broadcast`.

```bash
export CONFIRM_SPEND=YES
F="--rpc-url $RPC --account xlayer-deployer --sender $DEPLOYER --broadcast --slow"

# 1. deploy Arena, then note the address from the output (or from the record step below)
forge script contracts/script/xlayer/DeployArena.s.sol $F
bun scripts/xlayer-record.ts          # writes deployments/xlayer.json with the confirmed address
export ARENA=0x...                     # the Arena address

# 2. create the three challenges (approves exactly 3 USDC; checks Arena's bytecode first)
forge script contracts/script/xlayer/SeedChallenges.s.sol $F

# 3. tape out the three solution circuits as yourself
forge script contracts/script/xlayer/TapeOutSolutions.s.sol $F
bun scripts/xlayer-record.ts          # read the CONFIRMED circuit ids from the TapedOut events
export CIRCUIT_IDS=8,9,10              # <- use the confirmed ids, in order: adder, majority, parity
export FIRST_CHALLENGE=1               # <- the confirmed id of the full adder challenge
export SALT_SECRET=0x...32 random bytes you keep private (losing it means losing the reveal)

# 4. play. Commit before the commit deadline (48 h by default), reveal after it, finalize and withdraw after the reveal deadline.
STAGE=commit   forge script contracts/script/xlayer/Play.s.sol $F
STAGE=reveal   forge script contracts/script/xlayer/Play.s.sol $F
STAGE=finalize forge script contracts/script/xlayer/Play.s.sol $F
STAGE=withdraw forge script contracts/script/xlayer/Play.s.sol $F
bun scripts/xlayer-record.ts
```

`Play` re-checks onchain, before every commit and reveal, that you own the circuit, that it fits the challenge and that it
passes every truth-table row, because a commit cannot be undone. It skips anything already done, so a half-finished run
can be repeated, and `ONLY=0|1|2` limits a run to one challenge.

**Your pots are at risk until each challenge is finalized.** The challenges are public and open to everyone. Anyone who
commits a correct circuit with fewer gates, or the same gate count and an earlier commit, wins that pot, and you then lose
the whole 1 USDC pot to them. The 2.5% fee is only what you pay if YOU win your own pot (then you get back 97.5% and the fee
recipient gets 2.5%). Tape out and commit early, and treat the full 3 USDC as spent. Because the commit does not bind the
circuit's content, a copier can also tie your gate count and win on commit order (see DECISIONS.md, Arena limitations).

## 2b. Point the website at it

`bun scripts/xlayer-record.ts` also writes `public/config.json` with the Arena address and deploy block. Run `bun run build` and publish `dist/`
(see the main README). The site shows the contract address and an OKLink link on every screen.

## 3. Verify the contract

Wait one minute after deployment. `deployments/xlayer.json` holds the exact commands once recorded. They look like this:

```bash
# Sourcify, no API key
forge verify-contract $ARENA contracts/Arena.sol:Arena --chain 196 --verifier sourcify --watch

# OKLink (needs OKLINK_API_KEY)
forge verify-contract $ARENA contracts/Arena.sol:Arena --chain 196 --verifier oklink \
  --verifier-url https://www.oklink.com/api/v5/explorer/contract/verify-source-code-plugin/XLAYER \
  --etherscan-api-key $OKLINK_API_KEY --compiler-version v0.8.28+commit.7893614a \
  --num-of-optimizations 200 --evm-version cancun \
  --constructor-args 0x0000000000000000000000001f09daefa827f02cbb40967cc91b259763760761000000000000000000000000362f5b4391ac51a56b13f9a63e98bb95731e86a300000000000000000000000000000000000000000000000000000000000000fa \
  --watch
```

## Environment variables the scripts read

`CONFIRM_SPEND`, `DEPLOYER`, `PROCESSOR`, `ARENA`, `FIRST_CHALLENGE`, `CIRCUIT_IDS`, `SALT_SECRET`, `STAGE`, `ONLY`, and the
optional `PRIZE_TOKEN`, `FEE_RECIPIENT`, `FEE_BPS`, `POT_MILLI`, `COMMIT_HOURS`, `REVEAL_HOURS`, `SCAN`,
`SKIP_ARENA_BYTECODE_CHECK`. None of them holds a key.
