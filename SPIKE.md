# SPIKE: calling TapeOut from your own contract (X Layer, chainId 196)

Everything below was observed, not assumed. Source: 29 Foundry fork tests (`contracts/test/spike/`) against
`https://rpc.xlayer.tech`, pinned at block **76,080,000** (override with `XLAYER_FORK_BLOCK`), plus read-only
`cast` calls at the same block. Run them with:

```
forge test --match-path "contracts/test/spike/*" -vv
```

Result: **29 passed, 0 failed.** One call you care about did NOT work (`createCPU`, see UNKNOWNS U1).

## Where the interfaces came from

- The repo is `gm-lsp/Tape-OCCC`, not `Tapeout-OCCC` (that name returns 404). Commit `bc0c64b`.
  `src/interfaces/ITapeOut.sol` is vendored unchanged in `contracts/spike/vendor/OCCC_ITapeOut.sol`.
- OCCC's file targets BNB Smart Chain and does **not** declare `eval` or `step`. Those two come from
  `NetLayerLabs/Cerebr` `TAPEOUT.md` and are re-proven by the tests below (`contracts/spike/SpikeInterfaces.sol`).
- Cerebr's doc is stale in places. Where it disagreed with the chain, the chain won (see C14, U1).

## CONFIRMED

### (a) Calling TapeOut from a contract

| # | Fact | Proof |
|---|------|-------|
| C1 | Factory `0x1f09DAeFA827f02CBb40967cc91b259763760761` is live on 196. `isCPU(circuits)` is true for a processor's **circuits** address and false for its transistors address or any random address. 425 processors at the pinned block. | `test_a_factoryRegistry` |
| C2 | A contract can call `eval(uint256,bytes)` (view) and `circuitInfo`, `netlist`, `ownerOf` on any taped-out circuit. Existing circuit used: Cerebr `0xB04EB79D1A5EECaabAAfF7B77d7c27578EE693FF` #4 (6-NAND XOR) returns the correct XOR table for all 4 inputs. Another processor found through `cpus(0)` also works (104 circuits, #1 = 4 gates). | `test_a_findExistingCircuitAndEvalFromContract` |
| C3 | Smallest valid tape-out is 1 NAND (nIn 1, nOut 1). Empty netlist reverts `too few signals for outputs`. Fee must be exact: `fee-1` and `fee+1` both revert `tapeout fee`. With the exact fee but no transistors it reverts `ERC1155InsufficientBalance` (`0x03dee4c5`). Tape-out fee is 0.0013 OKB (`1.3e15` wei). | `test_a_smallestTapeoutOnAnOpenCpu`, `test_a_smallestPossibleBoundary` |
| C4 | A contract can tape out (mint NAND, then `tapeout`). It must implement the **ERC-1155 receiver hook**: without it the mint reverts with `ERC1155InvalidReceiver(address)` (`0x57f447ce`). The ERC-721 hook is **not** required (an ERC-1155-only contract succeeded). | `test_a_contractAsDesigner`, `test_a_contractNeedsOnlyTheErc1155Hook` |
| C5 | Tape-out works for any wallet on someone else's processor (tested on "PULSE Financial Indicators", mint price 0). Circuit ids are sequential; `nextId()` is the **last assigned** id, not the next one. | `test_a_smallestTapeoutOnAnOpenCpu` |

### (b) Encoding

| # | Fact | Proof |
|---|------|-------|
| C6 | Inputs are bit-packed, LSB first. Input `i` is bit `i & 7` of byte `i >> 3`. Input 0 is bit 0 of byte 0; input 8 is bit 0 of byte 1. | `test_b_inputBitOrderIsLsbFirst`, `test_b_multiByteInputs` |
| C7 | Outputs use the same packing. Output 0 is the first of the last `nOut` signals made by elements. Output length is `ceil(nOut / 8)` bytes (1 byte for nOut 1; 2 bytes for nOut 9, value `0xff01`). Half adder: `eval(0x03)` returns `0x02`. | `test_b_outputBitOrderAndHalfAdder`, `test_b_outputLengthIsCeilNOutOver8` |
| C8 | Missing input bytes read as 0, extra bytes are ignored, and bits above `nIn` in the last byte are ignored. | `test_b_missingAndExtraInputBytes` |
| C9 | `eval` on a circuit with latches reverts `has latch: use step` (Cerebr #14). Unknown id and id 0 both revert `no circuit`. | `test_b_latchCircuitsRevertOnEval`, `test_b_unknownCircuitReverts` |
| C10 | Netlist wire format: NAND `00 a:u24 b:u24` (7 bytes), REF `02 cpu:20B id:u64 nIn:u8 nOut:u8 ins:u24*nIn` (37 bytes for 2 inputs). Built and taped out by the tests. | `contracts/test/spike/NL.sol` |

### (c) Is gate count readable onchain?  Yes.

| # | Fact | Proof |
|---|------|-------|
| C11 | `circuitInfo(id)` returns `(nIn, nOut, nState, gateCount)`. Callable from a contract in about 2.2k gas. Missing id reverts `no circuit`. | `test_c_gateCountAndNetlistReadableByContract` |
| C12 | `netlist(id)` returns exactly the submitted bytes (hash matched). For NAND-only circuits `netlist length = 7 * gateCount`. About 4.2k gas. | same |
| C13 | `gateCount` is **flattened through REFs**, and LATCH counts as a gate (Cerebr #14: 17 NAND + 2 LATCH = 19). A pure-REF wrapper of a 4-gate XOR reports `gateCount 4`, costs **0 transistors**, and can be taped out by a wallet holding none. Cerebr #5 (3 REFs) reports 6 and its netlist is 111 bytes. The `TapedOut(uint256,address,uint32,uint32)` event also carries `gateCount` and `nState`. | `test_c_refIsFlattenedAndBurnsNothing`, `test_c_latchCountsAsAGate`, `test_c_tapedOutEventCarriesGateCount` |
| C14 | A pure-REF wrapper has **identical** `circuitInfo` and identical `eval` results to the circuit it wraps, a different owner, and different netlist bytes. A wrapper can also point at a circuit on a different processor. OCCC's TAP draft describes the same thing. | `test_c_wrapperIsIndistinguishableByInfoAndEval`, `test_c_refToAnotherCpuAndExistingRefCircuit` |
| C15 | The circuits implementation (26 selectors enumerated) has **no function that changes a netlist** after tape-out. The circuits beacon `0xf70d1ed4f62CF3780157B0b421b7E2F45bD0991C` has owner `0x000...000` and implementation `0x977f217887E085D298Cb3819cDAD5A0ee35F29B2`, so that logic cannot be swapped by an owner. | `cast` at block 76,080,000 |

### (d) ownerOf

| # | Fact | Proof |
|---|------|-------|
| C16 | `ownerOf(id)` is the tape-out sender (EOA or contract), follows `transferFrom`, costs about 2.0k gas from a contract. Missing id and id 0 revert `ERC721NonexistentToken(uint256)` (`0x7e273289`). Cerebr #4 owner is `0xc742AdA2872a042dD36D2E706907b4036968960C`. | `test_d_ownerOfAfterTapeoutAndTransfer`, `test_d_ownerOfExistingAndMissing` |

### (e) Gas per eval (measured inside a calling contract, forge on the fork)

Own circuits (warm, already touched by the tape-out):

| Circuit | Flat gates | Gas per eval |
|---------|-----------:|-------------:|
| NOT | 1 | 11,600 |
| A and not B | 3 | 16,621 |
| XOR | 4 | 18,862 |
| XOR + double NOT | 6 | 23,402 |
| 8-input parity | 28 | 75,368 |
| REF wrapper of the XOR | 4 | 49,891 |

Existing circuits (cold first call / warm second call):

| Circuit | Flat gates | REFs | Cold | Warm |
|---------|-----------:|-----:|-----:|-----:|
| Cerebr #4 | 6 | 0 | 29,902 | 23,402 |
| Cerebr #5 | 6 | 3 | 148,836 | 116,836 |
| Cerebr #8 | 19 | 0 | 59,595 | 53,095 |
| Cerebr #12 | 47 | 11 | 484,203 | 460,703 |
| Cerebr #16 | 590 | 0 | 1,351,695 | 1,345,195 |

- Fit from the table: about **9k + 2.36k per flat gate**, plus about **31k per REF**.
- Full sweeps from a contract: all 4 vectors of the XOR = 76k; all **256 vectors of the 28-gate parity circuit = 19.27M gas** (about 75k each). `ownerOf` + `circuitInfo` + 256 evals = 19.28M.
- X Layer block gas limit at the fork: **210,000,000**.
- Cross-check against the real chain's gas rules (`eth_estimateGas` with `EvalCaller` injected through a state override, block 76,080,000): `sweep(#8, 32 vectors)` 1,778,280 (forge 1,740,576 internal); `eval #16` 1,431,394 (forge 1,351,695); `eval #12` 545,754 (forge 484,203). The chain's number is the forge number plus the 21k base cost and call overhead, so forge's gas is a fair guide.

### Other state facts that differ from the Cerebr doc (this matters for the build)

| # | Fact |
|---|------|
| C17 | The factory was upgraded: implementation is now `0x336e9F0F4c3fEe7C8c803377e4DEA00293f4ae2a` (Cerebr doc says `0x7495...`). Owner `0xB3D85b42A045c1A88D800CAD0F55d2566a4D3138`, `isSealed() = false`. TapeOut can still change what `isCPU` returns. |
| C18 | Factory fees are now `deployFee() = 10,000,000` wei and `protocolFee() = 1,000,000` wei (doc: 0.0066 and 0.00066 OKB). Existing processors keep their own fees (the one used by the tests still charges 0.00066 OKB per mint and 0.0013 OKB per tape-out). |
| C19 | Cerebr's transistors are fully minted (`minted == supplyCap == 1,000,000`), so nobody can mint NAND there any more (`supply cap`). |

## UNKNOWNS

- **U1. `createCPU` reverts and I do not know why.** Every attempt fails with an empty revert (`0x`, no reason string), in forge and with plain `eth_call` from a funded address, at the pinned block and at the live head. Tried: value = `deployFee()` (1e7), 0.0066 OKB, and 9,999,999 wei; supply 1,000,000 and 10,000; mint price 1 and 1e13. The selector `0x47f9b5fd` exists in the new implementation. Test: `test_a_createCpuReverts`. Nothing in this project depends on creating a processor, so the tests use existing processors instead. I need the real current signature or an example transaction before I can say how to create one.
- U2. Whether TapeOut will change `isCPU`, fees or the factory again (it is upgradeable and unsealed, C17). Treat the factory as a trusted dependency.
- U3. The REF depth limit and the worst-case `eval` cost of deeply nested REF chains. A chain can have a tiny `gateCount` but cost about 31k per level. Cerebr's doc says 40 levels worked (3.0M gas); I did not measure it.
- U4. Real transaction gas for a full reveal. Only `eth_estimateGas` on injected code was run; nothing was deployed or sent.
- U5. Whether `TapedOut` logs can be used to prove *when* a circuit was taped out from inside a contract. There is no onchain call I found that returns the tape-out block or time for an id.
- U6. Anything about other chains. This spike covers X Layer only.

## GO / NO-GO: "lowest gate count wins" vs "earliest valid commit"

**GO on lowest gate count.** It is readable by the contract (`circuitInfo(id).gateCount`, C11), it is flattened through REFs so REF tricks cannot hide gates (C13), the netlist cannot be changed after tape-out (C15), and the whole check is cheap enough to do inside a reveal (C11, C16, gas table).

Earliest valid commit is **not** a replacement. It stays as the tie-break, because identical gate counts are easy to reach (C14).

Conditions the contract must meet. These come from the facts above; items 1 and 2 are design consequences that I have **not** tested yet:

1. **A commit must bind to the netlist content, not just the circuit id.** C14 shows anyone can tape out a zero-cost REF wrapper with the same gate count and the same results as a circuit they saw onchain. If a commit only names an id, a copier can commit early and reveal a wrapper later and win the tie. Commit to `keccak256(netlist bytes)` before tape-out and check `keccak256(netlist(id))` at reveal. Designers must commit before they tape out.
2. **Cap the netlist length and the gate count per contest.** Cost is about 31k per REF that gate count does not show (C13, U3); netlist length (37 bytes per REF) does.
3. **Require `ownerOf(id) == msg.sender` at reveal** (C16), and `nState == 0` and `nIn`/`nOut` matching the spec (C9, C11), or `eval` reverts.
4. **Limit the spec size.** A 256-vector sweep of a 28-gate circuit is 19.3M gas (about 9% of the block). Pick the input and gate caps from the gas table, not from a guess.
5. **Check `FACTORY.isCPU(circuits)` before calling `eval`** on a submitted address (C1), and treat the factory owner as a trusted party (C17).

## Questions for you

1. `createCPU` (U1): do you have a current example transaction or ABI for it? I will not guess one.
2. Should the contest accept circuits from any registered processor, or only from one processor you name? The tests show both work.
