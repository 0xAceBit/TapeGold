// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {TapeGolf} from "../TapeGolf.sol";
import {MockCircuits} from "../mocks/MockCircuits.sol";
import {TapeGolfBase} from "./TapeGolf.Base.t.sol";

/// reveal(): commitment binding, flat-NAND enforcement, circuit checks, grading, leader selection.
contract TapeGolfRevealTest is TapeGolfBase {
    bytes32 internal constant SALT = keccak256("salt");

    function _mintRaw(address owner, bytes memory nl, uint32 nIn, uint32 nOut, uint32 nState, uint32 gates, bytes memory table)
        internal returns (uint256)
    {
        return cpu.tapeout(owner, nl, nIn, nOut, nState, gates, table);
    }

    function _expectReveal(address who, address circuits, uint256 id, bytes32 salt, bytes memory err) internal {
        vm.prank(who);
        vm.expectRevert(err);
        golf.reveal(cid, circuits, id, salt);
    }

    // ------------------------------------------------------------ happy path

    function test_Reveal_HappyPathSetsLeaderAndEmits() public {
        uint256 id = _enter(cid, alice, 2, 0, SALT);
        _toReveal();
        vm.expectEmit(true, true, true, true, address(golf));
        emit TapeGolf.Revealed(cid, alice, address(cpu), id, 2, true);
        _reveal(cid, alice, address(cpu), id, SALT);

        (address d, uint32 gates, uint32 order, address circuits, uint256 cId) = golf.leaderOf(cid);
        assertEq(d, alice);
        assertEq(gates, 2);
        assertEq(order, 1);
        assertEq(circuits, address(cpu));
        assertEq(cId, id);
        (,, bool revealed) = golf.commitOf(cid, alice);
        assertTrue(revealed);
    }

    function test_Reveal_XorContestWithFourNandGates() public {
        TapeGolf.CreateParams memory p = _params(token);
        p.expected = hex"00010100"; // XOR
        uint256 c2 = _create(p);
        bytes memory nl = _xorNetlist();
        assertEq(nl.length, 28);
        uint256 id = _mint(alice, nl, hex"00010100");
        _commit(c2, alice, nl, SALT);
        _toReveal();
        _reveal(c2, alice, address(cpu), id, SALT);
        (address d, uint32 gates,,,) = golf.leaderOf(c2);
        assertEq(d, alice);
        assertEq(gates, 4);
    }

    function test_Reveal_CircuitReusableAcrossContests() public {
        uint256 c2 = _create(_params(token));
        bytes memory nl = _padded(3, 0);
        uint256 id = _mint(alice, nl, AND_TABLE);
        _commit(cid, alice, nl, SALT);
        _commit(c2, alice, nl, SALT);
        _toReveal();
        _reveal(cid, alice, address(cpu), id, SALT);
        _reveal(c2, alice, address(cpu), id, SALT);
        (address d,,,,) = golf.leaderOf(c2);
        assertEq(d, alice);
    }

    // ------------------------------------------------------------ phase boundaries

    function test_Reveal_RevertsBeforeCommitDeadline() public {
        uint256 id = _enter(cid, alice, 2, 0, SALT);
        vm.warp(commitDeadline - 1);
        _expectReveal(alice, address(cpu), id, SALT, abi.encodeWithSelector(TapeGolf.NotRevealPhase.selector));
    }

    function test_Reveal_OkAtCommitDeadlineAndLastSecond() public {
        uint256 ida = _enter(cid, alice, 2, 0, SALT);
        uint256 idb = _enter(cid, bob, 3, 1, SALT);
        vm.warp(commitDeadline);
        _reveal(cid, alice, address(cpu), ida, SALT);
        vm.warp(revealDeadline - 1);
        _reveal(cid, bob, address(cpu), idb, SALT);
        (,,, address circuits,) = golf.leaderOf(cid);
        assertEq(circuits, address(cpu));
    }

    function test_Reveal_RevertsAtRevealDeadline() public {
        uint256 id = _enter(cid, alice, 2, 0, SALT);
        vm.warp(revealDeadline);
        _expectReveal(alice, address(cpu), id, SALT, abi.encodeWithSelector(TapeGolf.NotRevealPhase.selector));
    }

    // ------------------------------------------------------------ commitment binding

    function test_Reveal_RevertsWithoutCommitment() public {
        uint256 id = _mint(alice, _padded(2, 0), AND_TABLE);
        _toReveal();
        _expectReveal(alice, address(cpu), id, SALT, abi.encodeWithSelector(TapeGolf.NoCommitment.selector));
    }

    function test_Reveal_RevertsAlreadyRevealed() public {
        uint256 id = _enter(cid, alice, 2, 0, SALT);
        _toReveal();
        _reveal(cid, alice, address(cpu), id, SALT);
        _expectReveal(alice, address(cpu), id, SALT, abi.encodeWithSelector(TapeGolf.AlreadyRevealed.selector));
    }

    function test_Reveal_WrongSaltFailsThenCorrectSaltSucceeds() public {
        uint256 id = _enter(cid, alice, 3, 0, SALT);
        _toReveal();
        _expectReveal(alice, address(cpu), id, keccak256("other"), abi.encodeWithSelector(TapeGolf.CommitmentMismatch.selector));
        (,, bool revealed) = golf.commitOf(cid, alice);
        assertFalse(revealed);
        _reveal(cid, alice, address(cpu), id, SALT);
        (,, revealed) = golf.commitOf(cid, alice);
        assertTrue(revealed);
    }

    function test_Reveal_DifferentNetlistFailsCommitment() public {
        _enter(cid, alice, 3, 0, SALT); // commits to _padded(3, 0)
        uint256 other = _mint(alice, _padded(3, 1), AND_TABLE); // different bytes, same gate count
        _toReveal();
        _expectReveal(alice, address(cpu), other, SALT, abi.encodeWithSelector(TapeGolf.CommitmentMismatch.selector));
    }

    function test_Reveal_DifferentGateCountNetlistFailsCommitment() public {
        _enter(cid, alice, 3, 0, SALT);
        uint256 other = _mint(alice, _padded(2, 0), AND_TABLE);
        _toReveal();
        _expectReveal(alice, address(cpu), other, SALT, abi.encodeWithSelector(TapeGolf.CommitmentMismatch.selector));
    }

    function test_Reveal_CopiedCommitmentCannotBeUsedByAnotherDesigner() public {
        bytes memory nl = _padded(2, 0);
        uint256 id = _mint(alice, nl, AND_TABLE);
        _commit(cid, alice, nl, SALT);
        (bytes32 aliceCommit,,) = golf.commitOf(cid, alice);
        vm.prank(bob); // front-runner copies the commitment hash verbatim
        golf.commit(cid, aliceCommit);
        vm.prank(alice);
        cpu.transferOwner(id, bob);
        _toReveal();
        _expectReveal(bob, address(cpu), id, SALT, abi.encodeWithSelector(TapeGolf.CommitmentMismatch.selector));
    }

    function test_Reveal_FailedGradingDoesNotConsumeCommitment() public {
        bytes memory nl = _padded(2, 0);
        uint256 bad = _mint(alice, nl, hex"00010101"); // same netlist bytes, wrong table
        uint256 good = _mint(alice, nl, AND_TABLE);
        _commit(cid, alice, nl, SALT);
        _toReveal();
        _expectReveal(alice, address(cpu), bad, SALT, abi.encodeWithSelector(TapeGolf.TruthTableMismatch.selector, 1, uint8(1), uint8(0)));
        (,, bool revealed) = golf.commitOf(cid, alice);
        assertFalse(revealed);
        _reveal(cid, alice, address(cpu), good, SALT);
        (address d,,,,) = golf.leaderOf(cid);
        assertEq(d, alice);
    }

    // ------------------------------------------------------------ flat NAND enforcement

    function _commitRawAndExpect(bytes memory nl, uint32 gates, bytes memory err) internal {
        uint256 id = _mintRaw(alice, nl, 2, 1, 0, gates, AND_TABLE);
        _commit(cid, alice, nl, SALT);
        _toReveal();
        _expectReveal(alice, address(cpu), id, SALT, err);
    }

    function test_Reveal_RejectsRefTagFirstRecord() public {
        bytes memory nl = bytes.concat(hex"02000000000001", _nand(2, 2));
        _commitRawAndExpect(nl, 2, abi.encodeWithSelector(TapeGolf.NonFlatNetlist.selector));
    }

    function test_Reveal_RejectsRefTagLaterRecord() public {
        bytes memory nl = bytes.concat(_nand(0, 1), _nand(2, 2), hex"02000002000003");
        _commitRawAndExpect(nl, 3, abi.encodeWithSelector(TapeGolf.NonFlatNetlist.selector));
    }

    function test_Reveal_RejectsLatchTag() public {
        bytes memory nl = bytes.concat(_nand(0, 1), hex"01000002000003");
        _commitRawAndExpect(nl, 2, abi.encodeWithSelector(TapeGolf.NonFlatNetlist.selector));
    }

    function test_Reveal_RejectsLengthNotMultipleOfSeven() public {
        bytes memory nl = bytes.concat(_andNetlist(), hex"00");
        bytes memory tiny = hex"000000"; // shorter than one record
        uint256 ida = _mintRaw(alice, nl, 2, 1, 0, 2, AND_TABLE);
        uint256 idb = _mintRaw(bob, tiny, 2, 1, 0, 0, AND_TABLE);
        _commit(cid, alice, nl, SALT);
        _commit(cid, bob, tiny, SALT);
        _toReveal();
        _expectReveal(alice, address(cpu), ida, SALT, abi.encodeWithSelector(TapeGolf.NonFlatNetlist.selector));
        _expectReveal(bob, address(cpu), idb, SALT, abi.encodeWithSelector(TapeGolf.NonFlatNetlist.selector));
    }

    function test_Reveal_RejectsGateCountMismatch() public {
        bytes memory nl = _andNetlist(); // 2 gates
        uint256 id = _mintRaw(alice, nl, 2, 1, 0, 3, AND_TABLE);
        _commit(cid, alice, nl, SALT);
        _toReveal();
        _expectReveal(alice, address(cpu), id, SALT, abi.encodeWithSelector(TapeGolf.GateCountMismatch.selector, uint32(3), 2));
        uint256 id2 = _mintRaw(bob, nl, 2, 1, 0, 1, AND_TABLE);
        vm.warp(commitDeadline - 1);
        _commit(cid, bob, nl, SALT);
        _toReveal();
        _expectReveal(bob, address(cpu), id2, SALT, abi.encodeWithSelector(TapeGolf.GateCountMismatch.selector, uint32(1), 2));
    }

    // ------------------------------------------------------------ circuit eligibility

    function test_Reveal_RejectsStatefulCircuit() public {
        bytes memory nl = _andNetlist();
        uint256 id = _mintRaw(alice, nl, 2, 1, 1, 2, AND_TABLE);
        _commit(cid, alice, nl, SALT);
        _toReveal();
        _expectReveal(alice, address(cpu), id, SALT, abi.encodeWithSelector(TapeGolf.StatefulCircuit.selector, uint32(1)));
    }

    function test_Reveal_RejectsInputCountMismatch() public {
        bytes memory nl = _andNetlist();
        uint256 id = _mintRaw(alice, nl, 3, 1, 0, 2, hex"0000000000000001");
        _commit(cid, alice, nl, SALT);
        _toReveal();
        _expectReveal(alice, address(cpu), id, SALT, abi.encodeWithSelector(TapeGolf.InputCountMismatch.selector, uint32(3), uint8(2)));
    }

    function test_Reveal_RejectsOutputCountMismatch() public {
        bytes memory nl = _andNetlist();
        uint256 id = _mintRaw(alice, nl, 2, 2, 0, 2, AND_TABLE);
        _commit(cid, alice, nl, SALT);
        _toReveal();
        _expectReveal(alice, address(cpu), id, SALT, abi.encodeWithSelector(TapeGolf.OutputCountMismatch.selector, uint32(2), uint8(1)));
    }

    function test_Reveal_RejectsTooManyGates() public {
        bytes memory nl = _andNetlist();
        uint256 id = _mintRaw(alice, nl, 2, 1, 0, 21, AND_TABLE); // maxGates is 20
        _commit(cid, alice, nl, SALT);
        _toReveal();
        _expectReveal(alice, address(cpu), id, SALT, abi.encodeWithSelector(TapeGolf.TooManyGates.selector, uint32(21), uint32(20)));
    }

    function test_Reveal_RejectsNetlistTooLarge() public {
        TapeGolf.CreateParams memory p = _params(token);
        p.maxNetlistBytes = 14;
        uint256 c2 = _create(p);
        bytes memory nl = _padded(3, 0); // 21 bytes
        uint256 id = _mint(alice, nl, AND_TABLE);
        _commit(c2, alice, nl, SALT);
        _toReveal();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(TapeGolf.NetlistTooLarge.selector, 21, uint32(14)));
        golf.reveal(c2, address(cpu), id, SALT);
    }

    function test_Reveal_RejectsNotCircuitOwner() public {
        bytes memory nl = _padded(2, 0);
        uint256 id = _mint(bob, nl, AND_TABLE);
        _commit(cid, alice, nl, SALT);
        _toReveal();
        _expectReveal(alice, address(cpu), id, SALT, abi.encodeWithSelector(TapeGolf.NotCircuitOwner.selector, bob));
    }

    function test_Reveal_CircuitCannotBeReusedAfterTransferOwner() public {
        bytes memory nl = _padded(2, 0);
        uint256 id = _mint(alice, nl, AND_TABLE);
        _commit(cid, alice, nl, SALT);
        _commit(cid, bob, nl, SALT);
        _toReveal();
        _reveal(cid, alice, address(cpu), id, SALT);
        vm.prank(alice);
        cpu.transferOwner(id, bob);
        _expectReveal(bob, address(cpu), id, SALT, abi.encodeWithSelector(TapeGolf.CircuitAlreadyUsed.selector, address(cpu), id));
        (address d,,,,) = golf.leaderOf(cid);
        assertEq(d, alice);
    }

    function test_Reveal_RejectsWrongTruthTable() public {
        bytes memory nl = _padded(2, 0);
        uint256 id = _mint(alice, nl, hex"00010101"); // OR, not AND
        _commit(cid, alice, nl, SALT);
        _toReveal();
        _expectReveal(alice, address(cpu), id, SALT, abi.encodeWithSelector(TapeGolf.TruthTableMismatch.selector, 1, uint8(1), uint8(0)));
        (address d,,,,) = golf.leaderOf(cid);
        assertEq(d, address(0));
    }

    function test_Reveal_WrongLastVectorReported() public {
        bytes memory nl = _padded(2, 0);
        uint256 id = _mint(alice, nl, hex"00000000"); // AND(1,1) wrong
        _commit(cid, alice, nl, SALT);
        _toReveal();
        _expectReveal(alice, address(cpu), id, SALT, abi.encodeWithSelector(TapeGolf.TruthTableMismatch.selector, 3, uint8(0), uint8(1)));
    }

    function test_Reveal_IgnoresOutputBitsAboveNOut() public {
        bytes memory nl = _padded(2, 0);
        uint256 id = _mint(alice, nl, hex"00000003"); // bit 1 is outside nOut=1 and masked off
        _commit(cid, alice, nl, SALT);
        _toReveal();
        _reveal(cid, alice, address(cpu), id, SALT);
        (address d,,,,) = golf.leaderOf(cid);
        assertEq(d, alice);
    }

    // ------------------------------------------------------------ processors

    function test_Reveal_RestrictedContestRejectsOtherProcessor() public {
        TapeGolf.CreateParams memory p = _params(token);
        p.processor = address(cpu);
        uint256 c2 = _create(p);
        bytes memory nl = _padded(2, 0);
        uint256 id = _mintOn(cpu2, alice, nl, AND_TABLE); // registered, but not the contest's processor
        _commit(c2, alice, nl, SALT);
        _toReveal();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(TapeGolf.ProcessorMismatch.selector, address(cpu2), address(cpu)));
        golf.reveal(c2, address(cpu2), id, SALT);

        uint256 ok = _mint(alice, nl, AND_TABLE);
        _reveal(c2, alice, address(cpu), ok, SALT);
        (address d,,,,) = golf.leaderOf(c2);
        assertEq(d, alice);
    }

    function test_Reveal_RestrictedContestRejectsUnregisteredProcessor() public {
        TapeGolf.CreateParams memory p = _params(token);
        p.processor = address(cpu);
        uint256 c2 = _create(p);
        bytes memory nl = _padded(2, 0);
        uint256 id = _mintOn(evil, alice, nl, AND_TABLE);
        _commit(c2, alice, nl, SALT);
        _toReveal();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(TapeGolf.ProcessorMismatch.selector, address(evil), address(cpu)));
        golf.reveal(c2, address(evil), id, SALT);
    }

    function test_Reveal_AnyProcessorContestAcceptsAnyRegistered() public {
        bytes memory nl = _padded(2, 0);
        uint256 id = _mintOn(cpu2, alice, nl, AND_TABLE);
        _commit(cid, alice, nl, SALT);
        _toReveal();
        _reveal(cid, alice, address(cpu2), id, SALT);
        (address d,,, address circuits,) = golf.leaderOf(cid);
        assertEq(d, alice);
        assertEq(circuits, address(cpu2));
    }

    function test_Reveal_AnyProcessorContestRejectsUnregistered() public {
        bytes memory nl = _padded(2, 0);
        uint256 id = _mintOn(evil, alice, nl, AND_TABLE); // returns a correct table, but is not registered
        _commit(cid, alice, nl, SALT);
        _toReveal();
        _expectReveal(alice, address(evil), id, SALT, abi.encodeWithSelector(TapeGolf.UnregisteredProcessor.selector, address(evil)));
    }

    function test_Reveal_RevertsUnknownContest() public {
        vm.expectRevert(abi.encodeWithSelector(TapeGolf.ContestNotFound.selector, 42));
        golf.reveal(42, address(cpu), 1, SALT);
    }
}
