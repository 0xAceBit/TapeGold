// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Arena} from "../../Arena.sol";
import {XLayerBase} from "./XLayerBase.sol";
import {XLayerConfig} from "./XLayerConfig.sol";

/// @notice Step 2: approve the pots and create the three challenges (full adder, 3-input majority, 4-bit parity).
/// @dev Env: ARENA (required), PROCESSOR (required, a registered TapeOut circuits contract), PRIZE_TOKEN (default: native
///      USDC on X Layer), POT_MILLI (default 1000 = 1.000 token per challenge, hard cap 5000), COMMIT_HOURS and
///      REVEAL_HOURS (default 48 each). Live mode also needs CONFIRM_SPEND=YES and DEPLOYER.
contract SeedChallenges is XLayerBase {
    function run() external {
        _requireChain();
        SeedParams memory p;
        p.arena = Arena(vm.envAddress("ARENA"));
        p.token = IERC20(vm.envOr("PRIZE_TOKEN", XLayerConfig.DEFAULT_PRIZE_TOKEN));
        p.processor = vm.envAddress("PROCESSOR");
        p.potMilli = vm.envOr("POT_MILLI", XLayerConfig.DEFAULT_POT_MILLI);
        p.commitHours = vm.envOr("COMMIT_HOURS", XLayerConfig.DEFAULT_COMMIT_HOURS);
        p.revealHours = vm.envOr("REVEAL_HOURS", XLayerConfig.DEFAULT_REVEAL_HOURS);
        _authenticateArena(p.arena);
        _begin(true);
        (uint256 firstId, uint256 pot) = _seed(p);
        _end();
        console2.log("");
        console2.log("DONE. First challenge id:", firstId);
        console2.log("pot each (base units):", pot);
    }
}
