// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {SpikeBase, console2} from "./SpikeBase.t.sol";
import {Vm} from "forge-std/Vm.sol";
import {NL} from "./NL.sol";
import {ITapeOutCircuits, ITapeOutTransistors, ITapeOutEval, ITapeOutExtras} from "../../spike/SpikeInterfaces.sol";

/// @notice (c) is gate count / netlist size readable onchain, (d) ownerOf for a circuit NFT.
contract SpikeCDTest is SpikeBase {
    // ------------------------------------------------------------------ (c)

    function test_c_gateCountAndNetlistReadableByContract() public {
        (address c,) = _openCpu();
        uint256 idNot = _tapeout(designer, c, NL.notGate(), 1, 1, 1);
        uint256 idX4 = _tapeout(designer, c, NL.xor4Circuit(), 2, 1, 4);
        uint256 idX6 = _tapeout(designer, c, NL.xor6Circuit(), 2, 1, 6);

        uint256[3] memory ids = [idNot, idX4, idX6];
        bytes[3] memory nls = [NL.notGate(), NL.xor4Circuit(), NL.xor6Circuit()];
        uint32[3] memory expectGates = [uint32(1), 4, 6];
        for (uint256 i; i < 3; ++i) {
            (,,, uint32 gc, uint256 gasInfo) = caller.infoGas(c, ids[i]);
            (uint256 len, bytes32 h, uint256 gasNl) = caller.netlistGas(c, ids[i]);
            assertEq(gc, expectGates[i], "gateCount");
            assertEq(len, uint256(expectGates[i]) * 7, "NAND-only netlist = 7 bytes per gate");
            assertEq(h, keccak256(nls[i]), "netlist(id) returns the submitted bytes exactly");
            console2.log("gates", gc, "circuitInfo gas", gasInfo);
            console2.log("  netlist bytes", len, "netlist() gas", gasNl);
        }
    }

    function test_c_tapedOutEventCarriesGateCount() public {
        (address c,) = _openCpu();
        vm.recordLogs();
        uint256 id = _tapeout(designer, c, NL.xor4Circuit(), 2, 1, 4);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 sig = keccak256("TapedOut(uint256,address,uint32,uint32)");
        bool found;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != c) continue;
            console2.log("circuits event topic0");
            console2.logBytes32(logs[i].topics[0]);
            if (logs[i].topics[0] == sig) {
                found = true;
                assertEq(uint256(logs[i].topics[1]), id);
                assertEq(address(uint160(uint256(logs[i].topics[2]))), designer);
                (uint32 gc, uint32 ns) = abi.decode(logs[i].data, (uint32, uint32));
                assertEq(gc, 4);
                assertEq(ns, 0);
            }
        }
        assertTrue(found, "TapedOut(uint256,address,uint32,uint32) emitted by the circuits contract");
    }

    function test_c_refIsFlattenedAndBurnsNothing() public {
        (address c, address t) = _openCpu();
        uint256 base = _tapeout(designer, c, NL.xor4Circuit(), 2, 1, 4);
        uint256 nandBefore = ITapeOutTransistors(t).balanceOf(copier, 0);
        assertEq(nandBefore, 0);
        // copier holds zero transistors and still tapes out a REF wrapper
        uint256 w = _tapeout(copier, c, NL.wrapper(c, uint64(base), 2, 1), 2, 1, 0);
        (uint32 nIn, uint32 nOut, uint32 nState, uint32 gates) = _info(c, w);
        assertEq(nIn, 2);
        assertEq(nOut, 1);
        assertEq(nState, 0);
        assertEq(gates, 4, "gateCount is flattened through REF");
        (uint256 len,,) = caller.netlistGas(c, w);
        assertEq(len, 37, "REF record: 1 + 20 + 8 + 1 + 1 + 3 per input");
        assertEq(ITapeOutTransistors(t).balanceOf(copier, 0), 0);
        console2.log("wrapper gates", gates);
        console2.log("  wrapper netlist bytes", len);
    }

    /// @dev The copy problem for a contest: a pure-REF wrapper has the same circuitInfo and the same eval
    ///      results as the circuit it wraps, costs no transistors, and is owned by someone else.
    function test_c_wrapperIsIndistinguishableByInfoAndEval() public {
        (address c,) = _openCpu();
        uint256 orig = _tapeout(designer, c, NL.xor4Circuit(), 2, 1, 4);
        uint256 wrap = _tapeout(copier, c, NL.wrapper(c, uint64(orig), 2, 1), 2, 1, 0);
        (uint32 a1, uint32 b1, uint32 s1, uint32 g1) = _info(c, orig);
        (uint32 a2, uint32 b2, uint32 s2, uint32 g2) = _info(c, wrap);
        assertEq(a1, a2);
        assertEq(b1, b2);
        assertEq(s1, s2);
        assertEq(g1, g2, "same gate count");
        for (uint256 v; v < 4; ++v) {
            assertEq(_eval(c, orig, abi.encodePacked(uint8(v))), _eval(c, wrap, abi.encodePacked(uint8(v))));
        }
        assertTrue(ITapeOutExtras(c).ownerOf(orig) != ITapeOutExtras(c).ownerOf(wrap));
        assertTrue(keccak256(ITapeOutCircuits(c).netlist(orig)) != keccak256(ITapeOutCircuits(c).netlist(wrap)));
    }

    function test_c_refToAnotherCpuAndExistingRefCircuit() public {
        // existing: Cerebr #5 is a REF-composed XOR (3 REFs) that flattens to 6 gates
        (uint32 nIn, uint32 nOut, uint32 nState, uint32 gates) = _info(CEREBR, 5);
        (uint256 len,,) = caller.netlistGas(CEREBR, 5);
        assertEq(gates, 6);
        assertEq(len, 111, "3 REF records of 37 bytes each: longer than the 42 flat bytes");
        console2.log("Cerebr #5 nIn/nOut", nIn, nOut);
        console2.log("  nState/gates/netlist bytes", nState, gates);
        console2.log("  netlist bytes", len);

        // cross-CPU: wrap a circuit that lives on a different processor, from my own processor
        (address mine,) = _openCpu();
        uint256 w = _tapeout(copier, mine, NL.wrapper(CEREBR, 4, 2, 1), 2, 1, 0);
        (,,, uint32 g) = _info(mine, w);
        assertEq(g, 6);
        assertEq(_eval(mine, w, hex"01"), hex"01");
    }

    function test_c_latchCountsAsAGate() public view {
        (,, uint32 nState, uint32 gates) = _info(CEREBR, 14);
        assertEq(nState, 2);
        assertEq(gates, 19, "17 NAND + 2 LATCH");
    }

    function test_c_infoAndNetlistRevertForMissingId() public {
        (bool ok, string memory why) = _try(CEREBR, abi.encodeCall(ITapeOutCircuits.circuitInfo, (999_999)), 0);
        console2.log("circuitInfo(missing) ok?", ok);
        console2.log("  reason:", why);
        assertFalse(ok);
        (ok, why) = _try(CEREBR, abi.encodeCall(ITapeOutCircuits.netlist, (999_999)), 0);
        console2.log("netlist(missing) ok?", ok);
        console2.log("  reason:", why);
        assertFalse(ok);
    }

    // ------------------------------------------------------------------ (d)

    function test_d_ownerOfAfterTapeoutAndTransfer() public {
        (address c,) = _openCpu();
        uint256 id = _tapeout(designer, c, NL.notGate(), 1, 1, 1);
        (address o, uint256 gasUsed) = caller.ownerGas(c, id);
        assertEq(o, designer);
        console2.log("ownerOf gas from a contract", gasUsed);

        vm.prank(designer);
        ITapeOutCircuits(c).transferFrom(designer, copier, id);
        (o,) = caller.ownerGas(c, id);
        assertEq(o, copier, "ownerOf follows transfers (ERC-721)");
    }

    function test_d_ownerOfExistingAndMissing() public {
        (address o,) = caller.ownerGas(CEREBR, 4);
        assertTrue(o != address(0));
        console2.log("Cerebr #4 owner", o);
        (bool ok, string memory why) = _try(CEREBR, abi.encodeCall(ITapeOutExtras.ownerOf, (999_999)), 0);
        console2.log("ownerOf(missing) ok?", ok);
        console2.log("  reason:", why);
        assertFalse(ok);
        (ok, why) = _try(CEREBR, abi.encodeCall(ITapeOutExtras.ownerOf, (0)), 0);
        console2.log("ownerOf(0) ok?", ok);
        console2.log("  reason:", why);
        assertFalse(ok);
    }
}
