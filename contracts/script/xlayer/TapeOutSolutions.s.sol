// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {console2} from "forge-std/Script.sol";
import {XLayerBase} from "./XLayerBase.sol";

/// @notice Step 3: mint the NAND transistors and tape out the three solution circuits as the deployer.
/// @dev Env: PROCESSOR (required). Live mode also needs CONFIRM_SPEND=YES and DEPLOYER. The simulation tapes the circuits
///      out and grades every input vector through the real TapeOut `eval` before anything can be broadcast.
///      Costs are printed first: one mint call (mint price x 27 NAND + the processor's protocol fee) plus three tape-out
///      fees. The solution circuit ids are printed at the end; you need them to commit and reveal.
contract TapeOutSolutions is XLayerBase {
    function run() external {
        _requireChain();
        address processor = vm.envAddress("PROCESSOR");
        _begin(true);
        uint256[3] memory ids = _tapeOut(processor);
        _end();
        console2.log("");
        console2.log("Circuit ids (full adder, majority, parity):", ids[0], ids[1], ids[2]);
        console2.log(live
            ? "These ids are PREDICTIONS from the simulation. Confirm them from the TapedOut events: bun scripts/xlayer-record.ts"
            : "Dry run only. Ids shown are simulated.");
    }
}
