# TapeGolf

Sponsor-funded circuit-design contests for the TapeOut protocol on X Layer. A sponsor posts a truth table and a prize. Designers seal a NAND circuit, tape it out, and reveal it. The contract grades every row itself and the circuit with the fewest gates wins (earliest commit breaks ties).

TapeGold's website is a static single-page app. It always shows the full site: with no contract configured it runs on demo data (an in-browser model with demo players and a demo clock), and once `public/config.json` holds a contract address it opens on live X Layer data. A switch in the header ("Demo data" / "Live · X Layer") changes between them. Anyone with a wallet can post a challenge from the live page (**Create a challenge**: pick a puzzle or draw an answer sheet, set a prize and the windows, allow the prize, create). The live part (`src/arena/`) talks to the Arena contract on X Layer: challenge list, challenge detail with a live leaderboard built from contract events, a commit flow with a forced salt backup, and a reveal flow. It needs no backend. It reads the chain through the public X Layer RPC and signs through OKX Wallet (or any EIP-1193 wallet). Until a contract address is configured it shows an empty state and no data.

For newcomers the first screen has a short "How to play" card, a **Practice** tab with three no-prize puzzles (NOT, AND, XOR) and a progress bar, a live picture of the circuit (flip the switches and the wires light up), and a **Hint** button that points at wasted gates. The live X Layer version stays locked until the three practice puzzles are solved (or the visitor chooses to skip them). All of this is on the same single page.

The demo mode (`src/mock/, `src/components/`, `src/DemoApp.tsx`) is the original TapeGolf mock-data app, now branded TapeGold.

Built with [Arc Studio](https://studio.arc.io)

## Tech stack

- React, Vite, TypeScript, Tailwind CSS
- Solidity 0.8.28 and Foundry (contract, unit and fuzz tests, fork tests)

## Development

Prerequisites: Bun and Foundry.

- Install: `bun install`
- Run the site locally: `bun run dev`
- Build the static site: `bun run build` (output in `dist/`)
- Check the hint logic and every practice puzzle: `bun scripts/verify-hints.ts`
- Check the practice pars, the daily puzzle pool and the streak rules: `bun scripts/verify-levels.ts`
- Check the live-page helpers against the real chain: `bun scripts/verify-live.ts`
- Check the challenge-creation helpers: `bun scripts/verify-create.ts`
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

## Playing and engagement

- **Practice:** ten puzzles in three worlds (Basics, Combine, Build), from NOT to a full adder. Matching the best known score ("par") earns three stars, one over earns two, any correct circuit earns one. NOT, AND and XOR open the live version.
- **Daily puzzle:** a new 3-switch puzzle every day, the same for everyone, with a streak. Every puzzle has a proven smallest circuit, found by exhaustive search.
- **Feel:** "Run all rows" steps through the answer sheet, short synthesised sounds (mute button in the header), confetti on a new best, and a "best known circuit" picture after you solve.
- **Share:** a picture of your result, a copy-able challenge link ("beat my 4 bricks"), and a Post on X button. Names are optional and stay in the browser.
- **Live page:** a featured challenge (the biggest open prize), a hall of fame built from the contract's own winners, the winning circuit drawn after a challenge ends, and an Add to the prize button for anyone.

## Link previews

Social networks need an absolute address for the preview picture, so `index.html` carries `__SITE_URL__` placeholders that `vite.config.ts` fills in at build time. The default is `https://tapegolf.vercel.app`, the address the site really serves from (the alias `arc-studio-...vercel.app` redirects there, and crawlers do not follow the redirect for the picture). Moving to a custom domain: set `SITE_URL=https://your.domain bun run build`, or change the default in `vite.config.ts`.

## Hero picture

The hero portrait and the small round picture beside the wordmark are drawn vector art. To use a real photo instead, save it as `public/hero.jpg` (portrait orientation, face in the upper half); the site shows it in both places automatically.

## Tab icon and link preview

The browser-tab icon is the round portrait (`public/favicon.svg`, `favicon.ico`, PNG sizes and the phone home-screen icon). The picture shown when the link is shared on social networks is `public/og.png` (1200 x 630). Social networks need absolute addresses, so the three `https://arc-studio-56440c88e91e4128bb73b6fa.vercel.app` lines in `index.html` must be changed to your real address if the site moves to another domain. After publishing, networks cache previews: re-scrape the link in their debugger tools to refresh it.

## Publishing the site

1. Deploy Arena and run `bun scripts/xlayer-record.ts`. It writes `public/config.json` (address and deploy block).
2. `bun run build`, then publish the `dist/` folder to any static host or decentralized storage. Asset URLs are relative and routes are hash routes (`#/c/3`), so it works from a gateway subpath or an ENS gateway with no server rewrites.
3. To point a published copy at another contract, edit `config.json` in the published folder. No rebuild needed.

The only network requests the page makes are `./config.json` and JSON-RPC calls to `https://rpc.xlayer.tech` (plus your wallet).
