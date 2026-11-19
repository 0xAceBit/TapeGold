// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Arena} from "../Arena.sol";
import {IProcessorRegistry, ICircuitsLite} from "../interfaces/ITapeOutLite.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {ITapeOutCircuits} from "../spike/SpikeInterfaces.sol";
import {SpikeBase, console2} from "./spike/SpikeBase.t.sol";
import {NL} from "./spike/NL.sol";

/// @notice Arena against the REAL TapeOut contracts on an X Layer fork (chainId 196, pinned block in SpikeBase).
///         The prize token is a mock; everything TapeOut-related (factory registry, circuits, eval, gate count,
///         ownerOf, ERC-721 transfers) is the live deployment.
contract ArenaForkTest is SpikeBase {
    Arena internal arena;
    MockERC20 internal token;
    address internal sponsor = makeAddr("sponsor");
    address internal fees = makeAddr("fees");
    uint256 internal constant POT = 1_000e6;
    bytes internal constant XOR_TABLE = hex"06"; // vectors 0..3 -> 0,1,1,0 packed LSB first

    function setUp() public override {
        super.setUp();
        arena = new Arena(IProcessorRegistry(address(FACTORY)), fees, 250);
        token = new MockERC20();
        token.mint(sponsor, 10_000e6);
        vm.prank(sponsor);
        token.approve(address(arena), type(uint256).max);
    }

    // ------------------------------------------------------------------ helpers

    function _create(address processor, uint8 nIn, uint8 nOut, bytes memory table) internal returns (uint256 id) {
        uint64 ce = uint64(block.timestamp + 1 hours);
        uint64 re = uint64(block.timestamp + 2 hours);
        vm.prank(sponsor);
        id = arena.createChallenge(token, POT, nIn, nOut, table, ce, re, processor);
    }

    function _commit(uint256 cid, address who, uint256 circuitId, bytes32 salt) internal {
        bytes32 h = arena.commitHashOf(circuitId, salt, who);
        vm.prank(who);
        arena.commit(cid, h);
    }

    function _reveal(uint256 cid, address who, uint256 circuitId, bytes32 salt) internal {
        vm.prank(who);
        arena.reveal(cid, circuitId, salt);
    }

    function _toRevealPhase() internal {
        vm.warp(block.timestamp + 1 hours);
    }

    function _toEnded() internal {
        vm.warp(block.timestamp + 1 hours);
    }

    function _parity8Table() internal pure returns (bytes memory t) {
        t = new bytes(32);
        for (uint256 v; v < 256; ++v) {
            uint256 ones;
            for (uint256 k; k < 8; ++k) {
                ones += (v >> k) & 1;
            }
            if (ones & 1 == 1) t[v >> 3] = bytes1(uint8(t[v >> 3]) | uint8(1 << (v & 7)));
        }
    }

    // ------------------------------------------------------------------ registry (SPIKE C1)

    function test_fork_onlyRegisteredProcessorsAreAccepted() public {
        (address c,) = _openCpu();
        _create(c, 2, 1, XOR_TABLE);

        vm.expectRevert(abi.encodeWithSelector(Arena.UnregisteredProcessor.selector, address(0xdead)));
        _create(address(0xdead), 2, 1, XOR_TABLE);

        // isCPU is keyed by the circuits address, not the transistors address
        address t = ITapeOutCircuits(c).transistors();
        vm.expectRevert(abi.encodeWithSelector(Arena.UnregisteredProcessor.selector, t));
        _create(t, 2, 1, XOR_TABLE);
    }

    // ------------------------------------------------------------------ full flow on real circuits

    function test_fork_fewestGatesWinsWithRealGateCounts() public {
        (address c,) = _openCpu();
        uint256 cid = _create(c, 2, 1, XOR_TABLE);
        uint256 id6 = _tapeout(designer, c, NL.xor6Circuit(), 2, 1, 6);
        uint256 id4 = _tapeout(copier, c, NL.xor4Circuit(), 2, 1, 4);
        _commit(cid, designer, id6, bytes32(uint256(1))); // committed first
        _commit(cid, copier, id4, bytes32(uint256(2)));
        _toRevealPhase();
        _reveal(cid, designer, id6, bytes32(uint256(1)));
        _reveal(cid, copier, id4, bytes32(uint256(2)));

        (address winner, uint256 circuitId, uint32 score,) = arena.bestOf(cid);
        assertEq(winner, copier, "4 gates beats 6 gates even though the 6-gate entry committed first");
        assertEq(circuitId, id4);
        assertEq(score, 4, "score is the real circuitInfo.gateCount");

        _toEnded();
        arena.finalize(cid);
        assertEq(arena.pendingOf(token, copier), POT - POT * 250 / 10_000);
        assertEq(arena.pendingOf(token, fees), POT * 250 / 10_000);
        vm.prank(copier);
        arena.withdraw(token);
        assertEq(token.balanceOf(copier), POT - POT * 250 / 10_000);
    }

    function test_fork_wrongCircuitIsRejectedByRealEval() public {
        (address c,) = _openCpu();
        uint256 cid = _create(c, 2, 1, XOR_TABLE);
        uint256 id = _tapeout(designer, c, NL.aAndNotB(), 2, 1, 3); // not XOR
        _commit(cid, designer, id, bytes32(uint256(7)));
        _toRevealPhase();
        // in0 AND NOT in1 first differs from XOR at vector 2 (in0=0, in1=1): the circuit gives 0, the spec wants 1
        vm.expectRevert(abi.encodeWithSelector(Arena.TruthTableMismatch.selector, 2, 0, 1));
        _reveal(cid, designer, id, bytes32(uint256(7)));
        (address winner,,,) = arena.bestOf(cid);
        assertEq(winner, address(0));
    }

    // ------------------------------------------------------------------ real ERC-721 ownership

    function test_fork_transferAfterCommitMovesTheRightToTheNewOwner() public {
        (address c,) = _openCpu();
        uint256 cid = _create(c, 2, 1, XOR_TABLE);
        uint256 id = _tapeout(designer, c, NL.xor4Circuit(), 2, 1, 4);
        _commit(cid, designer, id, bytes32(uint256(3)));
        vm.prank(designer);
        ITapeOutCircuits(c).transferFrom(designer, copier, id);
        _toRevealPhase();

        vm.expectRevert(abi.encodeWithSelector(Arena.NotCircuitOwner.selector, copier));
        _reveal(cid, designer, id, bytes32(uint256(3)));
        vm.expectRevert(Arena.NoCommit.selector);
        _reveal(cid, copier, id, bytes32(uint256(3)));
    }

    // ------------------------------------------------------------------ pre-existing circuits (real owners, impersonated)

    function test_fork_existingCerebrCircuitAndLatchRejection() public {
        assertTrue(FACTORY.isCPU(CEREBR));
        uint256 cid = _create(CEREBR, 2, 1, XOR_TABLE);
        address owner4 = ICircuitsLite(CEREBR).ownerOf(4);
        _commit(cid, owner4, 4, bytes32(uint256(11)));
        _toRevealPhase();
        _reveal(cid, owner4, 4, bytes32(uint256(11)));
        (address winner,, uint32 score,) = arena.bestOf(cid);
        assertEq(winner, owner4);
        assertEq(score, 6, "Cerebr #4 reports 6 gates");
    }

    function test_fork_latchCircuitIsRejectedBeforeEval() public {
        uint256 cid = _create(CEREBR, 2, 1, XOR_TABLE);
        address owner14 = ICircuitsLite(CEREBR).ownerOf(14);
        _commit(cid, owner14, 14, bytes32(uint256(12)));
        _toRevealPhase();
        // Cerebr #14 has two LATCH elements (nState 2): eval would revert, so Arena refuses it first
        vm.expectRevert(abi.encodeWithSelector(Arena.StatefulCircuit.selector, 2));
        _reveal(cid, owner14, 14, bytes32(uint256(12)));
    }

    // ------------------------------------------------------------------ gas with real eval

    function test_fork_gasOfAFullEightInputReveal() public {
        (address c,) = _openCpu();
        uint256 cid = _create(c, 8, 1, _parity8Table());
        uint256 id = _tapeout(designer, c, NL.parity8(), 8, 1, 28);
        _commit(cid, designer, id, bytes32(uint256(5)));
        _toRevealPhase();
        uint256 g = gasleft();
        _reveal(cid, designer, id, bytes32(uint256(5)));
        uint256 used = g - gasleft();
        console2.log("reveal gas: 256 vectors x 28 gates (real eval)", used);
        console2.log("Arena estimate for the same circuit", 256 * (arena.GAS_PER_EVAL_BASE() + arena.GAS_PER_GATE() * 28));
        assertLt(used, arena.EVAL_GAS_BUDGET());
        // the estimate must not undershoot reality, or the budget check would not protect anything
        assertLe(used, 256 * (arena.GAS_PER_EVAL_BASE() + arena.GAS_PER_GATE() * 28) + 300_000);
    }

    // ------------------------------------------------------------------ the disclosed weakness, proven on real TapeOut

    /// ACCEPTED LIMITATION (Arena header, SPIKE C14): the commit binds only (circuitId, salt, sender). A copier commits
    /// first to the id their wrapper will get, then tapes out a zero-cost REF wrapper of the honest circuit. Same gate
    /// count, same results, earlier commit: the copier wins the tie.
    function test_fork_Limitation_refWrapperStealsTheTieWithRealTapeOut() public {
        (address c,) = _openCpu();
        uint256 cid = _create(c, 2, 1, XOR_TABLE);
        uint256 base = _nextId(c);

        _commit(cid, copier, base + 2, bytes32(uint256(99))); // predicts the id the wrapper will receive
        uint256 honestId = _tapeout(designer, c, NL.xor4Circuit(), 2, 1, 4);
        assertEq(honestId, base + 1);
        _commit(cid, designer, honestId, bytes32(uint256(98)));
        uint256 wrapperId = _tapeout(copier, c, NL.wrapper(c, uint64(honestId), 2, 1), 2, 1, 0);
        assertEq(wrapperId, base + 2, "the copier predicted the wrapper's id");

        _toRevealPhase();
        _reveal(cid, designer, honestId, bytes32(uint256(98)));
        _reveal(cid, copier, wrapperId, bytes32(uint256(99)));

        (address winner,, uint32 score,) = arena.bestOf(cid);
        assertEq(score, 4, "the wrapper has the honest circuit's gate count");
        assertEq(winner, copier, "documented limitation: the earlier commit wins the tie");
    }

    function _nextId(address c) internal view returns (uint256) {
        (bool ok, bytes memory ret) = c.staticcall(abi.encodeWithSignature("nextId()"));
        require(ok, "nextId failed");
        return abi.decode(ret, (uint256));
    }
}
