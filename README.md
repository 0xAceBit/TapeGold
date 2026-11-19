# TapeGolf

Sponsor-funded circuit-design contests for the TapeOut protocol on X Layer. A sponsor posts a truth table and a prize. Designers seal a NAND circuit, tape it out, and reveal it. The contract grades every row itself and the circuit with the fewest gates wins (earliest commit breaks ties).

TapeGold's website is a static single-page app. It always shows the full site: with no contract configured it runs on demo data (an in-browser model with demo players and a demo clock), and once `public/config.json` holds a contract address it opens on live X Layer data. A switch in the header ("Demo data" / "Live · X Layer") changes between them. The live part (`src/arena/`) talks to the Arena contract on X Layer: challenge list, challenge detail with a live leaderboard built from contract events, a commit flow with a forced salt backup, and a reveal flow. It needs no backend. It reads the chain through the public X Layer RPC and signs through OKX Wallet (or any EIP-1193 wallet). Until a contract address is configured it shows an empty state and no data.

The demo mode (`src/mock/`, `src/components/`, `src/DemoApp.tsx`) is the original TapeGolf mock-data app, now branded TapeGold.

Built with [Arc Studio](https://studio.arc.io)

## Tech stack

- React, Vite, TypeScript, Tailwind CSS
- Solidity 0.8.28 and Foundry (contract, unit and fuzz tests, fork tests)

## Development

Prerequisites: Bun and Foundry.

- Install: `bun install`
- Run the site locally: `bun run dev`
- Build the static site: `bun run build` (output in `dist/`)
- Check the data layer against a local fork: `scripts/verify-arena-app.ts`, `scripts/verify-wallet.ts` (instructions at the top of each file)
- Regenerate the contract ABI used by the site: `bun run arena:abi` (after `forge build`)
- Check the app (lint and types): `bun run check`
- Check the demo engine: `bun scripts/verify-mock.ts`
- Build contracts: `forge build`
- X Layer scripts (dry run on a fork, spends nothing): `forge script contracts/script/xlayer/Rehearsal.s.sol --fork-url https://rpc.xlayer.tech`
- Record a finished run into `deployments/xlayer.json`: `bun scripts/xlayer-record.ts`
- Script tests: `forge test --match-path "contracts/test/XLayerScripts*"`
- TapeGolf tests (no network): `forge test --match-path "contracts/test/TapeGolf*"`
- Arena tests (no network): `forge test --match-path "contracts/test/Arena*" --no-match-path "*fork*"`
- Arena fork tests (need network): `forge test --match-path "contracts/test/Arena.fork.t.sol" -vv`
- TapeOut fork tests (need network): `forge test --match-path "contracts/test/spike/*" -vv`

Environment variables:

- `VITE_ARENA_ADDRESS` (optional, build time): Arena address, if you do not use `public/config.json`.
- `VITE_RPC_URL` (optional, build time): replaces the X Layer RPC, for testing against a local fork. Leave unset for a real build.
- `XLAYER_FORK_BLOCK` (optional): block the fork tests run at. Defaults to 76,080,000.
- X Layer scripts: `CONFIRM_SPEND`, `DEPLOYER`, `PROCESSOR`, `ARENA`, `FIRST_CHALLENGE`, `CIRCUIT_IDS`, `SALT_SECRET`, `STAGE`, `ONLY` and the optional `PRIZE_TOKEN`, `FEE_RECIPIENT`, `FEE_BPS`, `POT_MILLI`, `COMMIT_HOURS`, `REVEAL_HOURS`, `SCAN`, `SKIP_ARENA_BYTECODE_CHECK`, `BROADCAST_DIR`, `XLAYER_RECORD_OUT`. None holds a key. See `deployments/README.md`.

## Docs

- `SPIKE.md`: what was proven about calling TapeOut from a contract.
- `DECISIONS.md`: why the contract and app work the way they do.
- `TODO.md`: open questions and next steps.
- `deployments/README.md`: the X Layer runbook (dry run, live run, verification).

## Publishing the site

1. Deploy Arena and run `bun scripts/xlayer-record.ts`. It writes `public/config.json` (address and deploy block).
2. `bun run build`, then publish the `dist/` folder to any static host or decentralized storage. Asset URLs are relative and routes are hash routes (`#/c/3`), so it works from a gateway subpath or an ENS gateway with no server rewrites.
3. To point a published copy at another contract, edit `config.json` in the published folder. No rebuild needed.

The only network requests the page makes are `./config.json` and JSON-RPC calls to `https://rpc.xlayer.tech` (plus your wallet).
