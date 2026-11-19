// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {console2} from "forge-std/Script.sol";
import {XLayerBase, IXCpus, IXCircuits, IXTransistors} from "./XLayerBase.sol";
import {XLayerConfig} from "./XLayerConfig.sol";

/// @notice Read-only: lists the newest TapeOut processors and whether a throwaway wallet can tape out on each.
/// @dev forge script contracts/script/xlayer/FindProcessor.s.sol --fork-url https://rpc.xlayer.tech
///      Env: SCAN (how many of the newest processors to check, default 30).
contract FindProcessor is XLayerBase {
    function run() external {
        _requireChain();
        uint256 scan = vm.envOr("SCAN", uint256(30));
        IXCpus f = IXCpus(XLayerConfig.FACTORY);
        uint256 n = f.cpuCount();
        console2.log("processors registered:", n);
        uint256 shown;
        for (uint256 k; k < scan && k < n; ++k) {
            address c = f.cpus(n - 1 - k);
            if (!_probe(c)) continue;
            address t = IXCircuits(c).transistors();
            console2.log("");
            console2.log("OPEN processor (circuits):", c);
            console2.log("  circuits created:", IXCircuits(c).nextId());
            console2.log("  supply left:", IXTransistors(t).supplyCap() - IXTransistors(t).minted());
            console2.log("  mint price (wei):", IXTransistors(t).mintPrice());
            console2.log("  mint protocol fee (wei):", IXTransistors(t).protocolFee());
            console2.log("  tape-out fee (wei):", IXCircuits(c).TAPEOUT_FEE());
            if (++shown == 5) break;
        }
        require(shown > 0, "none of the scanned processors accepts a tape-out");
    }
}
