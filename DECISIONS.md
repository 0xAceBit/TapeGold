# DECISIONS

Running log. Newest at the bottom of each section. Facts about TapeOut are in `SPIKE.md`.

## Scope

- D1. **Mock first.** The app runs on demo data (an in-browser model of the contract) until live wiring is approved. No wallet, no chain, no deployment. Every screen says "Demo data".
- D2. **X Layer (chainId 196) is the target**, but nothing is deployed and nothing here touches mainnet.
- D3. **Fork tests are the evidence for TapeOut behaviour** (SPIKE.md). The `TapeGolf` unit tests use mock circuits, so they prove our logic only, not TapeOut's.

## Contract (`contracts/TapeGolf.sol`)

- D4. **Grading is done by the contract**: `reveal` calls `eval` for every input vector and compares the first output byte (masked to `nOut` bits) with the sponsor's table.
- D5. **Lowest gate count wins; ties go to the earliest commit.** Gate count comes from `circuitInfo(id).gateCount` (SPIKE C11). Earliest commit stays as the tie-break (SPIKE go/no-go).
- D6. **Commitments bind the netlist content**: `keccak256(abi.encode(contract, chainid, contestId, designer, keccak256(netlist), salt))`. Designers commit before they tape out. The contract cannot see the order of tape-out, so this is a documented rule and the app enforces it.
- D7. **Only flat, NAND-only circuits are accepted** (netlist length divisible by 7, every record tagged `00`, `gateCount == length / 7`, `nState == 0`). Reason: a zero-cost REF wrapper copies another circuit's gate count and results (SPIKE C14), and a REF can point at a circuit id that does not exist yet, so a copier could pre-commit a wrapper and win ties. The functional review found exactly that; this rule closes it. Cost: designers cannot reuse other circuits through REF.
- D8. **Any registered processor, or one named processor.** `processor = address(0)` accepts any address for which the factory says `isCPU` is true; otherwise the circuits address must match. A restricted contest does not re-check the registry at reveal time.
- D9. **Pull payments.** `settle` only credits balances; `claim(token, account)` is permissionless but always pays the account it belongs to. `settleAndPay` does both for the winner (or the sponsor on a refund). Plain `settle` never moves tokens, so a blacklisted winner cannot block settlement. This is how "paid automatically" is met under the pull-payment rule.
- D10. **Fee**: immutable `feeBps` capped at 500 (5%), immutable recipient, taken from the prize at settlement, never from a refund. No owner, no pause, no upgrade, no function that can reach a pot.
- D11. **ERC-20 prizes only**, with a balance-delta check that rejects fee-on-transfer tokens. The real X Layer prize token is not chosen yet (open question in TODO).
- D12. **Limits** (from SPIKE gas table): at most 8 inputs and 8 outputs, 4096 netlist bytes, and `2^nIn * (10,000 + 2,500 * maxGates) <= 60M` gas so that a reveal fits in one transaction. Each phase lasts at least one hour.
- D13. **One entry per account per contest**, and a circuit can only be used once per contest, even if it changes owner.
- D14. **A failed reveal reverts**, so a wrong circuit cannot win, and the commit stays unrevealed.
- D15. **Review outcome.** Round 1: one High (REF pre-commit), fixed by D7. Round 2: no findings from either review. Static analysis: one Medium (an intentionally zero local), made explicit; the rest are by design (bounded loop of external calls, time-based phases of at least an hour).

## App (`src/`)

- D16. **The mock engine mirrors the contract** (`src/mock/engine.ts`): same checks, same order, same error names. `scripts/verify-mock.ts` checks it. Swapping to live means replacing the engine calls with contract reads and writes behind the same screens.
- D17. **Demo identities** (Ana, Bo, Cy, Di) have made-up addresses. They are not wallets and nothing signs.
- D18. **The demo clock is manual** (+1h, +12h, +1d, next deadline) so a full contest can be played in a minute.
- D19. **The app only lets a designer commit a design that passes every row**, because the contract would reject the reveal anyway and a failed reveal cannot be retried with a different netlist.
- D20. **The demo token is "mUSDC"**, 6 decimals, labelled as demo money. It is not a claim about any real token.

## Arena (`contracts/Arena.sol`)

A second contract with the exact API you specified. It does not replace `TapeGolf.sol`. No tests are written for it yet. The only TapeOut source is `SPIKE.md`. Two independent reviews found nothing; static analysis found one intentional zero local (made explicit).

**Conflict with SPIKE.md (needs your decision).** You specified `h = keccak256(circuitId, salt, msg.sender)`. SPIKE C14 shows a zero-cost REF wrapper copies another circuit's gate count and results, and SPIKE go/no-go item 1 says commitments must bind the netlist hash. With your format, the earliest-commit tie-break can be gamed (see the contract header). It cannot beat a lower gate count, only tie. Built as specified; the fix is a one-line change (commit to `keccak256(netlist)` and check it at reveal) plus rejecting non-flat netlists, as `TapeGolf.sol` does.

Assumptions made where the spec was silent:

- A1. `h` is `keccak256(abi.encode(circuitId, salt, msg.sender))`. It has no challenge id, chain id or contract address in it, so the same hash is valid in any challenge.
- A2. The packed truth table: output bit `j` of input vector `v` is bit `v * nOut + j`, LSB first, length `ceil(2^nIn * nOut / 8)`, padding bits zero.
- A3. Inputs and outputs are capped at 8 each (SPIKE verified one input byte and byte-0 outputs; wider cases were not tested for contest use).
- A4. `processor` is required, must be non-zero and `registry.isCPU(processor)` must be true at creation. There is no "any processor" mode. It is not re-checked at reveal.
- A5. The registry is a constructor argument. No TapeOut address is hardcoded.
- A6. Fee: `feeBps` and `feeRecipient` are immutable constructor arguments; `MAX_FEE_BPS = 1000` is the constant cap. The fee comes out of the whole pot, including top-ups, and only when there is a winner.
- A7. Top-ups are allowed by anyone until the challenge is finalized (including after `revealEnd` and before `finalize`). They join the pot and go to the winner.
- A8. "Refund sponsor if no valid reveal" returns the sponsor's own contribution only. Other contributors claim theirs with `claimRefund`, because refunding everyone in a loop is unbounded. Without that, the sponsor would have taken other people's top-ups.
- A9. Pull payments: `finalize` and `claimRefund` only credit; `withdraw(token)` pays `msg.sender` only. There is no pay-to-another-account function.
- A10. Time uses `block.timestamp`. Commit allowed while `now < commitEnd`; reveal while `commitEnd <= now < revealEnd`; finalize when `now >= revealEnd`. Deadlines must be in the future and strictly increasing; there is no minimum phase length.
- A11. One commit per account per challenge. A failed reveal reverts, so the commit stays unrevealed, but the committed circuit cannot be changed.
- A12. A circuit can be revealed once per challenge, even if it changes owner.
- A13. Score is `circuitInfo(id).gateCount`. Circuits with latches (`nState > 0`) are rejected because `eval` reverts for them (SPIKE C9). `nIn` and `nOut` must match exactly.
- A14. Tie-break: compare commit block, then commit index. The index alone gives the same order; both are stored and emitted.
- A15. Gas guard at reveal: `2^nIn * (10,000 + 2,500 * gateCount) <= 60,000,000` (from the SPIKE gas fit). REF cost that gate count does not show is not bounded (SPIKE U3); it only costs the revealer's own transaction.
- A16. ERC-20 prizes only, with a balance-delta check that rejects fee-on-transfer tokens, on creation and on top-up. Token must have code. The real X Layer token is not chosen.
- A17. Every state-changing function is `nonReentrant`. `eval`, `circuitInfo` and `ownerOf` are called as views on a processor the factory vouches for. The factory (upgradeable, SPIKE C17) is a trusted dependency.
- A18. Events carry enough to rebuild a leaderboard from logs: `ChallengeCreated` includes the whole truth table; `Committed` and `Revealed` carry commit index and block, score and whether the reveal took the lead; `Finalized` carries the winner, score, payout and fee.
- A19. `getChallenge` returns the struct without the table; `truthTableOf` returns the table.
- A20. Pragma `^0.8.20`, built with the project's 0.8.28 / Cancun settings and OpenZeppelin 5.x.

### Arena: attack results and fixes

- Tests: 120 unit/attack/reentrancy/gas/invariant tests on mocks (`contracts/test/Arena*.t.sol`) and 8 fork tests on real X Layer TapeOut (`contracts/test/Arena.fork.t.sol`). All 249 contract tests in the project pass.
- F1 (fixed). Bug: `createChallenge` accepted deadlines centuries away, so a sponsor could lock everyone's top-ups with no way out. Fix: `MAX_COMMIT_WINDOW` and `MAX_REVEAL_WINDOW` (90 days each), error `DeadlineTooFar`. Three tests failed before the fix and pass after.
- F2 (fixed). Dead code: the creation-time gas check could never trigger (at most 2.56M of a 60M budget). Removed it and its error; the real check stays at reveal.
- Held under attack, no fix needed: reveal without commit, double reveal, wrong or changed owner, copying a revealed circuit, reveal outside the window, finalize twice or early, reentrancy through tokens, receivers and processors, fee dust, zero-entry challenges, never-revealing griefers (200 junk commits do not change finalize gas), gas-bomb truth tables and circuits.
- Accepted limitations, pinned by `test_Limitation_*` tests: early commit to a future circuit id wins ties (also proven on real TapeOut with a REF wrapper); the sponsor can win their own pot including top-ups; the same commit hash is valid in every challenge.
- Real-chain measurement: a full reveal of an 8-input, 28-gate circuit used 19.5M gas on the fork; Arena's estimate for it is 20.5M, so the estimate does not undershoot.

### Arena: what I would NOT trust this with

1. Real money on mainnet before a human audit. The reviews and tests here are automated and written by the same team that wrote the contract.
2. Any prize where ties matter. Earliest commit can be bought by committing early to a future circuit id and wrapping the honest circuit (proven on real TapeOut). Lower gate count cannot be beaten this way, only tied.
3. Topping up a pot you do not control. The sponsor can enter and win their own pot, including your top-up.
4. Processors you have not checked. Arena trusts the factory's `isCPU` and the processor's `eval`, `circuitInfo` and `ownerOf`. SPIKE only verified one circuits implementation (the Cerebr beacon), not that every registered processor runs the same code, and the factory is upgradeable and unsealed (SPIKE C17).
5. Big circuits. A reveal for 8 inputs and about 90 gates is near 56M gas in one transaction. Only the block limit (210M) is known; the per-transaction limit on X Layer is not (SPIKE U4). REF-heavy circuits cost more than their gate count shows (SPIKE U3), which only hurts their own revealer.
6. Unusual tokens. Tested with mocks only. Outbound fees, rebasing, pausing or blacklists will break or lock payouts for the affected account. The real prize token is not chosen.
7. Anything that needs an emergency exit. There is no cancel, pause or rescue. A pot stays locked until `revealEnd`, up to 180 days.
8. Short windows. There is no minimum phase length, so a sponsor can open a challenge with a window of seconds, and timestamps on a rollup are not exact.
9. A leaderboard built from logs on one RPC. Events are complete, but a reorg or a bad RPC changes what a frontend shows. Read `bestOf` before paying anyone.
10. Today's TapeOut. All facts are from one pinned block (76,080,000). `createChallenge` still works only while the factory keeps answering `isCPU` the same way.

## X Layer deploy scripts (`contracts/script/xlayer/`, `deployments/`)

Written for you to run yourself. Arc Studio never broadcast anything to mainnet. The only broadcasts were to a local anvil fork of X Layer to prove the live path.

- Safety gate: a script only calls a broadcast cheatcode when `CONFIRM_SPEND=YES` and `DEPLOYER` are set. Even then, nothing is sent without `--broadcast`. `--broadcast` alone sends nothing (checked on the local fork: "No transactions to broadcast", nonce unchanged). `Rehearsal` can never broadcast.
- Every script prints each transaction (target, value, calldata) before running it. The full dry run (20 transactions) is saved in `deployments/xlayer.dryrun.log.txt`.
- Caps: pot 1.000 token per challenge by default; hard caps 5 per pot and 10 in total; the scripts refuse more.
- Inputs not guessed: factory (SPIKE C1), fee recipient (yours), prize token (native USDC, from OKX docs and read onchain), processor (found by `FindProcessor` on the fork, not hardcoded). The shared platform wallet is rejected as deployer and fee recipient.
- Fee 2.5% (250 bps) is my default; you did not specify one. Arena caps it at 10%.
- Solution circuits: full adder 9 NAND, 3-input majority 6 NAND, 4-bit parity 12 NAND. Each is checked against its own truth table offline, again on the fork through the real TapeOut `eval`, and again right before any commit or reveal.
- Review fixes (second review round): `Play` validates ownership, shape and every row before a commit (commits cannot be undone), skips finished work, supports `ONLY`; `_authenticateArena` compares the Arena code hash before seeding or playing; the allowance must be zero after seeding; the recorder scopes everything to one Arena deployment and names circuits by gate count.
- Known gap: tape-out ids printed by a simulation are predictions. The recorder and `Play` use confirmed events and onchain checks instead.
- Your pots are at risk until finalized: anyone can win them (see the README runbook).

## Website (`src/arena/`, `public/config.json`)

Static Vite site for Arena on X Layer: hash routes (`#/`, `#/c/3`, `#/c/3/commit`, `#/c/3/reveal`), relative asset paths (`base: './'`), no backend, no web fonts, no analytics.

- Wallet: `window.okxwallet` first, then `window.ethereum` (EIP-1193). After connecting, and before every transaction, the site switches the wallet to chain 196 (adding X Layer first if the wallet does not know it). Reads use the public RPC and need no wallet.
- Contract address: read at runtime from `./config.json` (so a published copy can be repointed without a rebuild), then `VITE_ARENA_ADDRESS`, then a browser-only override. With none, the site shows an empty state. It never shows made-up data.
- Salt: generated in the browser with `crypto.getRandomValues`, never sent anywhere, never in a URL. The commit button stays locked until the user (1) generates the salt, (2) downloads the backup file or copies its text and ticks that it is saved, and (3) loads the saved backup back into the page and it matches exactly. Step 3 exists because downloads fail silently in some wallet browsers. A copy is also kept in the browser's storage, but that is not treated as a backup.
- Pre-flight: before a commit or a reveal the site runs the same checks Arena runs (owner, shape, no latches, size, every truth-table row) as free read calls, so a wrong circuit id is caught before a commit that cannot be undone.
- Leaderboard: built from `Revealed` events. The public RPC refuses `eth_getLogs` ranges above 100 blocks (observed: "block range greater than 100 max") and rate-limits requests, so the scan covers only the window where a reveal can exist (commit deadline to reveal deadline), starts from the block found by binary search on timestamps (never block 0), resumes from a browser cache, and shows how far it has got. A challenge with a long reveal window takes minutes to scan the first time. The contract's own `bestOf` is shown above the table and wins any disagreement.
- Not built: top-ups, creating challenges, and a mobile deep link into the OKX app (I could not confirm its exact format from the docs, so the site tells people to open it in the OKX Wallet browser instead).
- Tested without a browser: wallet logic with a fake OKX Wallet, the transaction pipeline, pre-flight, backup files, commit-hash equality with the contract, and the event scan, all against a local fork of X Layer with the real Arena. The screens themselves were checked by type-checking, a production build and server-side rendering of the main components, not by clicking through them in a browser.

## TapeGold: demo-first site, live mode kept (supersedes the earlier "empty state until configured")

- The site is called TapeGold. The contracts keep their names (`TapeGolf.sol`, `Arena.sol`).
- No address gate: with no contract configured the site opens on the full Arc Light demo (mock data, personas, demo clock). Once `public/config.json` has an address, it opens on live X Layer data instead. The header switch overrides either default and is remembered in the browser.
- Live mode (wallet, chain reads, commit with forced salt backup, reveal, event leaderboard) is unchanged in behaviour and now uses the same Arc Light look. With no contract configured it shows setup steps and the demo is one click away.
- Fonts (DM Sans, Space Grotesk, JetBrains Mono) are bundled with the site instead of loaded from Google, so the build makes no third-party requests.
- Backup files are now named `tapegold-xlayer-...json` with app tag `tapegold-x-layer`. Files with the old `arena-x-layer` tag still load.
