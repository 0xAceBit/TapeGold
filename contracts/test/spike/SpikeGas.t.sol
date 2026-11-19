// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {SpikeBase, console2} from "./SpikeBase.t.sol";
import {NL} from "./NL.sol";

/// @notice (e) gas per eval as seen by a calling contract. Numbers are printed, not asserted, apart from sanity bounds.
contract SpikeGasTest is SpikeBase {
    function _row(string memory label, address c, uint256 id, bytes memory input) internal view {
        (uint32 nIn,, , uint32 gates) = _info(c, id);
        (, uint256 first) = caller.evalOnce(c, id, input);
        (, uint256 second) = caller.evalOnce(c, id, input);
        console2.log(label);
        console2.log("  nIn / gates", nIn, gates);
        console2.log("  eval gas first call / second call", first, second);
    }

    function test_e_gasByGateCount_ownCircuits() public {
        (address c,) = _openCpu();
        uint256 not1 = _tapeout(designer, c, NL.notGate(), 1, 1, 1);
        uint256 and3 = _tapeout(designer, c, NL.aAndNotB(), 2, 1, 3);
        uint256 x4 = _tapeout(designer, c, NL.xor4Circuit(), 2, 1, 4);
        uint256 x6 = _tapeout(designer, c, NL.xor6Circuit(), 2, 1, 6);
        uint256 p28 = _tapeout(designer, c, NL.parity8(), 8, 1, 28);
        uint256 wrap = _tapeout(copier, c, NL.wrapper(c, uint64(x4), 2, 1), 2, 1, 0);
        _row("own NOT (1 gate)", c, not1, hex"01");
        _row("own A&!B (3 gates)", c, and3, hex"01");
        _row("own XOR4 (4 gates)", c, x4, hex"01");
        _row("own XOR6 (6 gates)", c, x6, hex"01");
        _row("own parity8 (28 gates)", c, p28, hex"ff");
        _row("own REF wrapper of XOR4 (4 flat gates)", c, wrap, hex"01");
    }

    function test_e_gasByGateCount_existingCircuits() public view {
        _row("Cerebr #4 XOR (6 gates)", CEREBR, 4, hex"01");
        _row("Cerebr #5 REF XOR (6 flat gates, 3 REFs)", CEREBR, 5, hex"01");
        _row("Cerebr #8 (19 gates)", CEREBR, 8, hex"00");
        _row("Cerebr #12 REF line detector (47 flat gates, 11 REFs)", CEREBR, 12, hex"0000");
        _row("Cerebr #16 (590 gates, 18 inputs)", CEREBR, 16, hex"000000");
    }

    /// @dev Same call is re-estimated with eth_estimateGas on the real chain (see SPIKE.md) to cross-check forge's gas.
    function test_e_crossCheckSweepOnExistingCircuit() public view {
        console2.log("block.gaslimit", block.gaslimit);
        (, uint256 g) = caller.sweep(CEREBR, 8, 32);
        console2.log("Cerebr #8 (5 inputs, 19 gates): 32-vector sweep gas", g);
    }

    function test_e_fullTruthTableSweep() public {
        (address c,) = _openCpu();
        uint256 x4 = _tapeout(designer, c, NL.xor4Circuit(), 2, 1, 4);
        uint256 p28 = _tapeout(designer, c, NL.parity8(), 8, 1, 28);

        (bytes memory outs4, uint256 gas4) = caller.sweep(c, x4, 4);
        console2.log("XOR4 sweep 4 vectors, total gas", gas4);
        assertEq(outs4, hex"00010100");

        (bytes memory outs, uint256 gas256) = caller.sweep(c, p28, 256);
        console2.log("parity8 sweep 256 vectors x 28 gates, total gas", gas256);
        console2.log("  per vector", gas256 / 256);
        for (uint256 v; v < 256; ++v) {
            uint256 bits;
            for (uint256 k; k < 8; ++k) {
                bits += (v >> k) & 1;
            }
            assertEq(uint8(outs[v]), bits & 1, "parity8 truth table");
        }
        assertLt(gas256, block.gaslimit);
    }

    function test_e_sweepFromAFreshReveal_includingChecks() public {
        // A reveal-shaped call: ownerOf + circuitInfo + 256 evals, all from the contract
        (address c,) = _openCpu();
        uint256 p28 = _tapeout(designer, c, NL.parity8(), 8, 1, 28);
        uint256 g = gasleft();
        (address o,) = caller.ownerGas(c, p28);
        (,,, uint32 gates,) = caller.infoGas(c, p28);
        caller.sweep(c, p28, 256);
        uint256 used = g - gasleft();
        console2.log("ownerOf + circuitInfo + 256 evals of a 28-gate circuit, gas", used);
        assertEq(o, designer);
        assertEq(gates, 28);
    }
}
