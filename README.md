# TapeGold

Circuit golf on X Layer. A sponsor posts a puzzle (a truth table) and a prize. Designers build the smallest NAND circuit that solves it, seal their entry, then reveal it. The contract checks every row itself, the circuit with the fewest gates wins, and the earliest entry breaks ties.

Built with [Arc Studio](https://studio.arc.io)

- **Website:** https://tapegolf.vercel.app
- **Contract:** `Arena` on X Layer mainnet (chain 196), [`0xf10a842037c61c894Febc5cE8FC97ffAd4531A68`](https://www.oklink.com/xlayer/address/0xf10a842037c61c894Febc5cE8FC97ffAd4531A68), deployed in block 76,327,695 and verified on Sourcify.
- **Status:** unaudited. Anyone can win a prize, and ties can be gamed by a copier (see [Risks](#risks)). Use tiny amounts.

## How it works

1. **Commit.** You lock your design in a sealed entry. Nobody can see or copy it.
2. **Reveal.** After the entry window closes you open it. The contract runs every input row through your circuit on TapeOut.
3. **Settle.** After the reveal window the lowest gate count wins the pot, minus a 2.5% fee. If nobody revealed a valid circuit, the sponsor gets the money back. Winners withdraw themselves; the contract never pushes funds.

The secret that opens your entry (the salt) is created in your browser. The site makes you save a backup file before it lets you commit, because a lost salt means a lost entry.

## What is in the app

- **Practice (no wallet, no money):** ten puzzles in three worlds, from NOT to a full adder. Matching the best known score earns three stars. A new daily puzzle with a streak. A live circuit picture, a "Run all rows" replay, a Hint button that finds wasted gates, optional sounds, and a share picture with friend-challenge links.
- **Live on X Layer:** the full scorecard of challenges, a live leaderboard built from contract events, Create a challenge (open to any wallet), Commit and Reveal flows, Add to the prize, a featured challenge, a hall of fame, and the winning circuit drawn after a challenge ends. It signs with OKX Wallet or any EIP-1193 wallet and switches the wallet to X Layer.
- **Demo data:** a full in-browser model with demo players and a demo clock, so the whole game can be tried with nothing connected.
- **Legal pages:** Terms of Service and Privacy Policy at `#/terms` and `#/privacy`.

New visitors start on practice. Live unlocks after the NOT, AND and XOR puzzles, or after choosing to skip. The site is a static single page with no backend.

## Tech stack

- React, Vite, TypeScript, Tailwind CSS, viem, framer-motion
- Solidity 0.8.28 and Foundry (OpenZeppelin 5)
- TapeOut protocol on X Layer for the circuits

## Repository

| Path | What it holds |
| --- | --- |
| `src/` | The website: demo mode, practice, and the live X Layer pages (`src/arena/`) |
| `contracts/Arena.sol` | The deployed contract |
| `contracts/TapeGolf.sol` | An earlier design that binds commits to the circuit's contents. Tested, not deployed |
| `contracts/test/` | Unit, fuzz, invariant, attack and fork tests |
| `contracts/script/xlayer/` | Foundry scripts for X Layer: deploy, seed challenges, tape out, play, rehearsal |
| `deployments/` | The X Layer runbook and the record of the real deployment |
| `scripts/` | Tooling and checks (`xlayer-record.ts`, `verify-*.ts`) |
| `public/config.json` | Which contract the live pages read |

## Development

Prerequisites: [Bun](https://bun.sh) and [Foundry](https://getfoundry.sh).

```
bun install
bun run dev        # run the site locally
bun run build      # static site in dist/
bun run check      # lint and types
forge build        # compile the contracts
```

Checks that need no network:

```
bun scripts/verify-hints.ts     # hints and every practice puzzle
bun scripts/verify-levels.ts    # practice pars, daily pool, streak rules
bun scripts/verify-create.ts    # challenge-creation helpers
bun scripts/verify-mock.ts      # demo engine
forge test --match-path "contracts/test/Arena*" --no-match-path "*fork*"
forge test --match-path "contracts/test/TapeGolf*"
```

Checks that read the live X Layer RPC: `bun scripts/verify-live.ts`, `forge test --match-path "contracts/test/Arena.fork.t.sol"` and `forge test --match-path "contracts/test/spike/*"`.

Optional environment variables (none holds a key):

- `VITE_ARENA_ADDRESS`: contract address, if you do not use `public/config.json`.
- `VITE_RPC_URL`: replace the X Layer RPC at build time, to test against a local fork.
- `SITE_URL`: the public address used in link previews at build time. Defaults to `https://tapegolf.vercel.app`; set it when you move to another domain.
- `XLAYER_FORK_BLOCK`: block the fork tests run at.
- The X Layer scripts read their own settings, documented in `deployments/README.md`.

## Deploying and publishing

- **Contract:** follow `deployments/README.md`. Every script dry-runs on a fork first and refuses to spend unless you set `CONFIRM_SPEND=YES` and pass `--broadcast` with your own key. Then run `bun scripts/xlayer-record.ts`, which writes `deployments/xlayer.json` and `public/config.json`.
- **Site:** `bun run build` and publish `dist/` to any static host or decentralized storage. Asset links are relative and routes use `#/...`, so no server rewrites are needed.

## Risks

- The contract is unaudited.
- A commit binds the circuit's id, not its contents, so a copier can tie your gate count and win on commit order. `contracts/TapeGolf.sol` shows a version that closes this; moving to it needs a new deployment.
- Anyone can win a pot, including the sponsor, and a top-up goes to the winner.
- TapeOut, X Layer, the prize token and your wallet are outside this project's control.

## More docs

- `SPIKE.md`: what was proven about calling TapeOut from a contract.
- `DECISIONS.md`: why the contracts and the app work the way they do.
- `TODO.md`: open questions and next steps.
- `deployments/README.md`: the X Layer runbook.

## License

MIT License

Copyright (c) 2026 0xAceBit

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
