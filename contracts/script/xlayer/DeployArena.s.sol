// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {console2} from "forge-std/Script.sol";
import {Arena} from "../../Arena.sol";
import {XLayerBase} from "./XLayerBase.sol";
import {XLayerConfig} from "./XLayerConfig.sol";

/// @notice Step 1: deploy Arena on X Layer. One transaction.
/// @dev Dry run:  forge script contracts/script/xlayer/DeployArena.s.sol --fork-url https://rpc.xlayer.tech
///      Live:      CONFIRM_SPEND=YES DEPLOYER=0x... forge script contracts/script/xlayer/DeployArena.s.sol \
///                   --rpc-url https://rpc.xlayer.tech --account <keystore> --sender 0x... --broadcast
///      Env (all optional): FEE_RECIPIENT (default: the address you gave), FEE_BPS (default 250, Arena caps it at 1000).
contract DeployArena is XLayerBase {
    function run() external {
        _requireChain();
        address feeRecipient = vm.envOr("FEE_RECIPIENT", XLayerConfig.FEE_RECIPIENT);
        uint16 feeBps = uint16(vm.envOr("FEE_BPS", uint256(XLayerConfig.DEFAULT_FEE_BPS)));
        _begin(true);
        Arena arena = _deployArena(feeRecipient, feeBps);
        _end();
        console2.log("");
        console2.log("DONE. Arena:", address(arena));
        console2.log(live ? "Next: record the result with `bun scripts/xlayer-record.ts`." : "Dry run only. Re-run with CONFIRM_SPEND=YES and --broadcast after you approve.");
    }
}
