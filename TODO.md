# TODO

## Done
- [x] Spike: TapeOut calls proven on an X Layer fork (SPIKE.md, 29 fork tests)
- [x] `TapeGolf` contract, mocks, two review rounds, static analysis
- [x] 121 Foundry unit, fuzz and invariant tests on the mock TapeOut
- [x] Demo engine and checks (`bun scripts/verify-mock.ts`)
- [x] App on demo data: contest list, detail, design lab, commit / tape out / reveal, settle, wallet, create contest

## Before wiring live data (needs your decision)
- [ ] **`createCPU` reverts** on X Layer with an empty reason (SPIKE U1). Needed only if contests should create their own processor. Get a current example transaction or ABI.
- [ ] Pick the real prize token on X Layer (address and decimals). Not guessed.
- [ ] Pick the fee recipient address and fee (contract caps it at 5%).
- [ ] Decide whether the contest set accepts any registered processor or one named processor by default (both are built).
- [ ] Re-run the fork tests against the live head before relying on any fee or address in SPIKE.md (the factory is upgradeable and was already upgraded once).

- [ ] Decide on the commit format for `Arena.sol`: bind the netlist hash (closes the tie-break weakness proven on real TapeOut) or keep `keccak256(circuitId, salt, sender)`
- [ ] Human audit of `Arena.sol` and `TapeGolf.sol` before any mainnet use (see DECISIONS.md, "what I would NOT trust this with")

## X Layer mainnet run (yours to run, see deployments/README.md)
- [ ] Confirm the four addresses in the runbook (factory, fee recipient, prize token, processor)
- [ ] Fund the deployer: at least 3 USDC and about 0.01 OKB (the fee recipient wallet held only ~0.0019 OKB)
- [ ] Re-run the dry run right before spending (the processor's creator can restrict tape-outs at any time)
- [ ] Run steps 1-4, then `bun scripts/xlayer-record.ts` and the verification commands
- [ ] Decide the fee: scripts default to 2.5%

## Live wiring (after the above)
- [ ] Fork tests for `TapeGolf` against real TapeOut circuits (the unit tests use mock circuits)
- [ ] Replace the demo engine with wagmi/viem reads and writes behind the same screens
- [ ] Wallet connect and X Layer chain config; real token approval before `createContest`
- [ ] Event-based indexing for the leaderboard (start from the deploy block, never block 0)
- [ ] Independent third-party audit before any mainnet use

## Known limits (by design, revisit if wanted)
- [ ] No don't-care rows in the truth table
- [ ] Inputs and outputs capped at 8 each; the demo UI offers up to 4 inputs and 3 outputs
- [ ] Only flat NAND circuits (no REF, no latches)
- [ ] The contract cannot prove tape-out happened after the commit

## Website
- [ ] Click through commit, reveal and finalize in a real browser with OKX Wallet (desktop extension and the mobile app browser) before publishing
- [ ] Publish `dist/` after the Arena is deployed and `public/config.json` is filled in
- [ ] Decide whether to add top-up and create-challenge screens
- [ ] A faster leaderboard needs an indexer or an RPC that allows wider `eth_getLogs` ranges

## Engagement
- [ ] Try the practice, daily puzzle, share picture and sounds in a real browser (desktop and phone) and tune the pace of "Run all rows"
- [ ] Decide on the netlist-bound commit contract before any large prize (see DECISIONS.md)
- [ ] After the first real challenges finish, check the hall of fame and the winning-circuit picture on the live page
