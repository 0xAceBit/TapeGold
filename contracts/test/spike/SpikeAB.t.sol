// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {SpikeBase, console2} from "./SpikeBase.t.sol";
import {NL} from "./NL.sol";
import {ITapeOutCircuits, ITapeOutTransistors, ITapeOutFactory, ITapeOutEval, ITapeOutExtras} from "../../spike/SpikeInterfaces.sol";
import {BareDesigner, ReceiverDesigner, Erc1155OnlyDesigner} from "../../spike/SpikeContracts.sol";

/// @notice (a) find / tape out circuits and eval them from a contract, (b) input and output encoding.
contract SpikeABTest is SpikeBase {
    // ------------------------------------------------------------------ (a)

    function test_a_factoryRegistry() public view {
        assertTrue(FACTORY.isCPU(CEREBR), "Cerebr circuits is a registered CPU");
        address cerebrT = ITapeOutCircuits(CEREBR).transistors();
        assertFalse(FACTORY.isCPU(cerebrT), "isCPU is keyed by the circuits address, not transistors");
        assertFalse(FACTORY.isCPU(address(this)), "random address is not a CPU");
        console2.log("cpuCount", ITapeOutExtras(address(FACTORY)).cpuCount());
    }

    function test_a_findExistingCircuitAndEvalFromContract() public view {
        // Cerebr circuit #4 is a 6-NAND XOR. Truth table read through a contract (EvalCaller).
        (uint32 nIn, uint32 nOut, uint32 nState, uint32 gates) = _info(CEREBR, 4);
        assertEq(nIn, 2);
        assertEq(nOut, 1);
        assertEq(nState, 0);
        assertEq(gates, 6);
        for (uint256 v; v < 4; ++v) {
            (bytes memory out,) = caller.evalOnce(CEREBR, 4, abi.encodePacked(uint8(v)));
            assertEq(out.length, 1);
            assertEq(uint8(out[0]), (v ^ (v >> 1)) & 1, "XOR truth table");
        }
        // Also discover a circuit without hardcoding: CPU 0 from the factory, circuit 1.
        address cpu0 = ITapeOutExtras(address(FACTORY)).cpus(0);
        uint256 count = ITapeOutExtras(cpu0).nextId();
        console2.log("cpu0", cpu0);
        console2.log("cpu0 circuit count (nextId)", count);
        assertGt(count, 0);
        (uint32 a, uint32 b, uint32 s, uint32 g) = _info(cpu0, 1);
        console2.log("cpu0 #1 nIn/nOut/nState/gates", a, b);
        console2.log("  nState/gates", s, g);
    }

    function test_a_smallestTapeoutOnAnOpenCpu() public {
        (address c,) = _openCpu();
        assertTrue(FACTORY.isCPU(c));
        uint256 before = ITapeOutExtras(c).nextId();
        uint256 id = _tapeout(designer, c, NL.notGate(), 1, 1, 1);
        assertEq(id, before + 1, "ids are sequential");
        assertEq(ITapeOutExtras(c).nextId(), id, "nextId is the LAST assigned id");
        (uint32 nIn, uint32 nOut, uint32 nState, uint32 gates) = _info(c, id);
        assertEq(nIn, 1);
        assertEq(nOut, 1);
        assertEq(nState, 0);
        assertEq(gates, 1);
        (bytes memory o0,) = caller.evalOnce(c, id, hex"00");
        (bytes memory o1,) = caller.evalOnce(c, id, hex"01");
        assertEq(o0, hex"01");
        assertEq(o1, hex"00");
    }

    /// @dev createCPU reverted for every argument set tried (bare revert, no reason). Cause unknown. See SPIKE.md.
    function test_a_createCpuReverts() public {
        uint256 fee = FACTORY.deployFee();
        console2.log("deployFee", fee);
        console2.log("protocolFee", ITapeOutExtras(address(FACTORY)).protocolFee());
        uint256[2] memory supplies = [uint256(1_000_000), 10_000];
        uint256[2] memory prices = [uint256(1), 1e13];
        for (uint256 i; i < 2; ++i) {
            vm.prank(designer);
            (bool ok, string memory why) = _try(
                address(FACTORY),
                abi.encodeCall(ITapeOutFactory.createCPU, ("Spike", "SPK", "story", supplies[i], prices[i])),
                fee
            );
            console2.log("createCPU ok?", ok);
            console2.log("  supply/price", supplies[i], prices[i]);
            console2.log("  reason:", why);
            assertFalse(ok);
        }
    }

    function test_a_smallestPossibleBoundary() public {
        (address c,) = _openCpu();
        uint256 fee = ITapeOutCircuits(c).TAPEOUT_FEE();
        // zero gates
        (bool ok, string memory why) =
            _try(c, abi.encodeCall(ITapeOutCircuits.tapeout, (bytes(""), uint32(1), uint32(1))), fee);
        console2.log("empty netlist ok?", ok);
        console2.log("  reason:", why);
        assertFalse(ok);
        // wrong fee (too low, too high)
        (ok, why) = _try(c, abi.encodeCall(ITapeOutCircuits.tapeout, (NL.notGate(), uint32(1), uint32(1))), fee - 1);
        console2.log("fee-1 ok?", ok);
        console2.log("  reason:", why);
        assertFalse(ok);
        (ok, why) = _try(c, abi.encodeCall(ITapeOutCircuits.tapeout, (NL.notGate(), uint32(1), uint32(1))), fee + 1);
        console2.log("fee+1 ok?", ok);
        console2.log("  reason:", why);
        assertFalse(ok);
        // right fee but no transistors
        vm.prank(designer);
        (ok, why) = _try(c, abi.encodeCall(ITapeOutCircuits.tapeout, (NL.notGate(), uint32(1), uint32(1))), fee);
        // _try uses address(this) as sender (prank is consumed by the first external call); log both
        console2.log("no transistors ok?", ok);
        console2.log("  reason:", why);
        assertFalse(ok);
    }

    /// @dev Cerebr's transistors are fully minted at the pinned block (minted == supplyCap), so minting reverts.
    function test_a_cerebrSupplyIsExhausted() public {
        address t = ITapeOutCircuits(CEREBR).transistors();
        assertEq(ITapeOutTransistors(t).minted(), ITapeOutTransistors(t).supplyCap());
        uint256 value = ITapeOutTransistors(t).mintPrice() + ITapeOutTransistors(t).protocolFee();
        vm.prank(designer);
        (bool ok, string memory why) = _try(t, abi.encodeCall(ITapeOutTransistors.mint, (0, 1)), value);
        console2.log("mint on Cerebr ok?", ok);
        console2.log("  reason:", why);
        assertFalse(ok);
    }

    function test_a_contractAsDesigner() public {
        (address c,) = _openCpu();
        BareDesigner bare = new BareDesigner();
        vm.deal(address(bare), 1 ether);
        (bool ok, string memory why) = _try(
            address(bare), abi.encodeCall(BareDesigner.mintAndTapeout, (c, NL.notGate(), uint32(1), uint32(1), 1)), 0
        );
        console2.log("contract WITHOUT receiver hooks can mint+tapeout?", ok);
        console2.log("  reason:", why);

        ReceiverDesigner rec = new ReceiverDesigner();
        vm.deal(address(rec), 1 ether);
        uint256 id = rec.mintAndTapeout(c, NL.notGate(), 1, 1, 1);
        console2.log("contract WITH receiver hooks tapeout id", id);
        assertEq(ITapeOutExtras(c).ownerOf(id), address(rec));
    }

    function test_a_contractNeedsOnlyTheErc1155Hook() public {
        (address c,) = _openCpu();
        Erc1155OnlyDesigner d = new Erc1155OnlyDesigner();
        vm.deal(address(d), 1 ether);
        (bool ok, string memory why) =
            _try(address(d), abi.encodeCall(BareDesigner.mintAndTapeout, (c, NL.notGate(), uint32(1), uint32(1), 1)), 0);
        console2.log("contract with ERC-1155 hook only can mint+tapeout?", ok);
        console2.log("  reason:", why);
    }

    // ------------------------------------------------------------------ (b)

    function test_b_inputBitOrderIsLsbFirst() public {
        (address c,) = _openCpu();
        uint256 id = _tapeout(designer, c, NL.aAndNotB(), 2, 1, 3);
        // out = in0 AND NOT in1
        assertEq(_eval(c, id, hex"00"), hex"00");
        assertEq(_eval(c, id, hex"01"), hex"01", "in0 is bit 0 of byte 0");
        assertEq(_eval(c, id, hex"02"), hex"00", "in1 is bit 1 of byte 0");
        assertEq(_eval(c, id, hex"03"), hex"00");
    }

    function test_b_outputBitOrderAndHalfAdder() public {
        (address c,) = _openCpu();
        uint256 id = _tapeout(designer, c, NL.halfAdder(), 2, 2, 5);
        // out0 = sum (bit 0), out1 = carry (bit 1): last nOut signals in element order
        assertEq(_eval(c, id, hex"00"), hex"00");
        assertEq(_eval(c, id, hex"01"), hex"01");
        assertEq(_eval(c, id, hex"02"), hex"01");
        assertEq(_eval(c, id, hex"03"), hex"02");
    }

    function test_b_multiByteInputs() public {
        (address c,) = _openCpu();
        uint256 id = _tapeout(designer, c, NL.bufferInput8(), 9, 1, 2);
        // input 8 is bit 0 of byte 1
        assertEq(_eval(c, id, hex"0001"), hex"01");
        assertEq(_eval(c, id, hex"0100"), hex"00");
        assertEq(_eval(c, id, hex"00ff"), hex"01");
        assertEq(_eval(c, id, hex"ff00"), hex"00");
    }

    function test_b_missingAndExtraInputBytes() public {
        (address c,) = _openCpu();
        uint256 id = _tapeout(designer, c, NL.notGate(), 1, 1, 1);
        assertEq(_eval(c, id, hex""), hex"01", "missing input bytes read as 0");
        assertEq(_eval(c, id, hex"00ff"), hex"01", "extra bytes ignored");
        assertEq(_eval(c, id, hex"02"), hex"01", "bits above nIn in the last byte: observed result");
    }

    function test_b_outputLengthIsCeilNOutOver8() public {
        (address c,) = _openCpu();
        uint256 id = _tapeout(designer, c, NL.nineOutputs(), 1, 9, 9);
        bytes memory o0 = _eval(c, id, hex"00");
        bytes memory o1 = _eval(c, id, hex"01");
        assertEq(o0.length, 2, "9 outputs -> 2 bytes");
        assertEq(o0, hex"ff01", "bit i lives in byte i>>3, bit i&7");
        assertEq(o1, hex"0000");
        // single output circuits return exactly one byte
        assertEq(_eval(CEREBR, 4, hex"00").length, 1);
    }

    function test_b_latchCircuitsRevertOnEval() public {
        (bool ok, string memory why) = _try(CEREBR, abi.encodeCall(ITapeOutEval.eval, (14, hex"00")), 0);
        console2.log("eval on a LATCH circuit ok?", ok);
        console2.log("  reason:", why);
        assertFalse(ok);
        (uint32 nIn, uint32 nOut, uint32 nState, uint32 gates) = _info(CEREBR, 14);
        assertEq(nState, 2);
        console2.log("Cerebr #14 nIn/nOut", nIn, nOut);
        console2.log("  nState/gates", nState, gates);
    }

    function test_b_unknownCircuitReverts() public {
        (bool ok, string memory why) = _try(CEREBR, abi.encodeCall(ITapeOutEval.eval, (999_999, hex"00")), 0);
        console2.log("eval on unknown id ok?", ok);
        console2.log("  reason:", why);
        assertFalse(ok);
        (ok, why) = _try(CEREBR, abi.encodeCall(ITapeOutEval.eval, (0, hex"00")), 0);
        console2.log("eval on id 0 ok?", ok);
        console2.log("  reason:", why);
        assertFalse(ok);
    }
}
