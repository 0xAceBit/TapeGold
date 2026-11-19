// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Arena} from "../Arena.sol";
import {IProcessorRegistry} from "../interfaces/ITapeOutLite.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {ArenaBase} from "./Arena.Base.t.sol";

/// Attacks 1-7, fee dust (9), zero-entry refunds (10) and griefing (11).
contract ArenaAttackTest is ArenaBase {
    // ------------------------------------------------------------ (1) reveal without commit

    function test_Attack_RevealWithoutAnyCommit() public {
        uint256 victim = _enter(cid, alice, 3);
        uint256 mine = _mintAnd(bob, 1); // better circuit, but bob never committed
        _toReveal();
        _revealExpect(cid, bob, mine, _err(Arena.NoCommit.selector));
        // replaying the victim's circuit id and salt as a non-committer fails the same way
        vm.prank(bob);
        vm.expectRevert(Arena.NoCommit.selector);
        arena.reveal(cid, victim, _salt(alice));
        (address w,,,) = arena.bestOf(cid);
        assertEq(w, address(0));
    }

    // ------------------------------------------------------------ (2) double reveal

    function test_Attack_DoubleReveal() public {
        uint256 first = _enter(cid, alice, 4);
        uint256 better = _mintAnd(alice, 1);
        _toReveal();
        _reveal(cid, alice, first);
        _revealExpect(cid, alice, first, _err(Arena.AlreadyRevealed.selector));
        // a second, better circuit cannot be slipped in either
        vm.prank(alice);
        vm.expectRevert(Arena.AlreadyRevealed.selector);
        arena.reveal(cid, better, bytes32(uint256(5)));
        (address w, uint256 c, uint32 s,) = arena.bestOf(cid);
        assertEq(w, alice);
        assertEq(c, first);
        assertEq(s, 4);
    }

    // ------------------------------------------------------------ (3) wrong owner

    function test_Attack_RevealCircuitOwnedByVictim() public {
        uint256 victim = _mintAnd(alice, 2);
        _commit(cid, bob, victim, _salt(bob));
        _toReveal();
        _revealExpect(cid, bob, victim, abi.encodeWithSelector(Arena.NotCircuitOwner.selector, alice));
        (,,, bool revealed) = arena.commitOf(cid, bob);
        assertFalse(revealed);
    }

    function test_Attack_OwnerChangedAfterCommit() public {
        uint256 x = _enter(cid, alice, 3);
        vm.prank(alice);
        cpu.transferOwner(x, bob);
        _toReveal();
        _revealExpect(cid, alice, x, abi.encodeWithSelector(Arena.NotCircuitOwner.selector, bob));
        _revealExpect(cid, bob, x, _err(Arena.NoCommit.selector)); // bob has no commit
    }

    function test_Attack_TransferredCircuitCannotBeRevealedTwice() public {
        uint256 x = _enter(cid, alice, 3);
        _commit(cid, bob, x, _salt(bob)); // bob also committed to alice's circuit id
        _toReveal();
        _reveal(cid, alice, x);
        vm.prank(alice);
        cpu.transferOwner(x, bob);
        _revealExpect(cid, bob, x, abi.encodeWithSelector(Arena.CircuitAlreadyUsed.selector, x));
        (address w,,,) = arena.bestOf(cid);
        assertEq(w, alice);
    }

    function test_Attack_TransferBeforeRevealMovesRightToNewOwner() public {
        // The owner at reveal time is the only one who may reveal; alice cannot keep the right.
        uint256 x = _enter(cid, alice, 3);
        _commit(cid, bob, x, _salt(bob));
        vm.prank(alice);
        cpu.transferOwner(x, bob);
        _toReveal();
        _revealExpect(cid, alice, x, abi.encodeWithSelector(Arena.NotCircuitOwner.selector, bob));
        _reveal(cid, bob, x);
        (address w,,,) = arena.bestOf(cid);
        assertEq(w, bob);
    }

    // ------------------------------------------------------------ (4) copying a revealed circuit

    function test_Attack_ReplayVictimCommitHash() public {
        uint256 x = _enter(cid, alice, 3);
        (bytes32 h,,,) = arena.commitOf(cid, alice);
        vm.prank(bob);
        arena.commit(cid, h); // identical hash as own commit
        _toReveal();
        _reveal(cid, alice, x);
        // bob now knows circuit id and salt; the hash binds the sender so it cannot be reused
        vm.prank(bob);
        vm.expectRevert(Arena.CommitMismatch.selector);
        arena.reveal(cid, x, _salt(alice));
    }

    function test_Attack_CommitVictimsCircuitIdThenReveal() public {
        uint256 x = _enter(cid, alice, 3);
        _commit(cid, bob, x, bytes32(uint256(77)));
        _toReveal();
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(Arena.NotCircuitOwner.selector, alice));
        arena.reveal(cid, x, bytes32(uint256(77)));
        _reveal(cid, alice, x);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(Arena.NotCircuitOwner.selector, alice));
        arena.reveal(cid, x, bytes32(uint256(77)));
    }

    function test_Attack_CannotCommitOnceVictimRevealed() public {
        uint256 x = _enter(cid, alice, 3);
        _toReveal();
        _reveal(cid, alice, x);
        uint256 copy = _mintAnd(bob, 3); // exact functional copy, minted after seeing the reveal
        bytes32 h = arena.commitHashOf(copy, bytes32(uint256(1)), bob);
        vm.prank(bob);
        vm.expectRevert(Arena.CommitPhaseClosed.selector);
        arena.commit(cid, h);
        _revealExpect(cid, bob, copy, _err(Arena.NoCommit.selector));
    }

    /// ACCEPTED LIMITATION (contract header): the commit hash binds only (circuitId, salt, sender), not the netlist.
    /// Circuit ids are sequential, so an attacker can commit EARLY to an id they will mint later as a copy of the
    /// honest design. They can only tie, never beat, the gate count; the tie goes to the earlier commit.
    function test_Limitation_EarlyCommitToFutureIdWinsTie() public {
        uint256 futureId = 2; // the id the attacker will mint after alice minted id 1
        _commit(cid, bob, futureId, _salt(bob));
        uint256 honest = _enter(cid, alice, 4); // alice commits later, id 1
        assertEq(honest, 1);
        uint256 copy = _mintAnd(bob, 4);
        assertEq(copy, futureId);
        _toReveal();
        _reveal(cid, alice, honest);
        _reveal(cid, bob, copy);
        (address w,,,) = arena.bestOf(cid);
        assertEq(w, bob, "tie goes to the earlier (attacker) commit");
    }

    // ------------------------------------------------------------ (5) reveal outside the window

    function test_Attack_RevealBeforeCommitEnd() public {
        uint256 x = _enter(cid, alice, 3);
        _revealExpect(cid, alice, x, _err(Arena.NotRevealPhase.selector));
        vm.warp(commitEnd - 1);
        _revealExpect(cid, alice, x, _err(Arena.NotRevealPhase.selector));
        (,,, bool revealed) = arena.commitOf(cid, alice);
        assertFalse(revealed);
    }

    function test_Attack_RevealAfterDeadline() public {
        uint256 x = _enter(cid, alice, 3);
        _toEnd();
        _revealExpect(cid, alice, x, _err(Arena.NotRevealPhase.selector));
        vm.warp(revealEnd + 30 days);
        _revealExpect(cid, alice, x, _err(Arena.NotRevealPhase.selector));
        arena.finalize(cid);
        _revealExpect(cid, alice, x, _err(Arena.NotRevealPhase.selector));
        (address w,,,) = arena.bestOf(cid);
        assertEq(w, address(0));
    }

    // ------------------------------------------------------------ (6) finalize twice, (7) finalize early

    function test_Attack_FinalizeTwice_WithWinner() public {
        uint256 x = _enter(cid, alice, 3);
        _toReveal();
        _reveal(cid, alice, x);
        _toEnd();
        arena.finalize(cid);
        uint256 payout = arena.pendingOf(token, alice);
        uint256 fee = arena.pendingOf(token, feeRecipient);
        vm.prank(bob);
        vm.expectRevert(Arena.AlreadyFinalized.selector);
        arena.finalize(cid);
        assertEq(arena.pendingOf(token, alice), payout);
        assertEq(arena.pendingOf(token, feeRecipient), fee);
        assertEq(payout + fee, PRIZE);
    }

    function test_Attack_FinalizeTwice_NoWinner() public {
        _toEnd();
        arena.finalize(cid);
        vm.expectRevert(Arena.AlreadyFinalized.selector);
        arena.finalize(cid);
        assertEq(arena.pendingOf(token, sponsor), PRIZE);
    }

    function test_Attack_FinalizeEarly() public {
        uint256 x = _enter(cid, alice, 3);
        vm.expectRevert(Arena.ChallengeNotEnded.selector);
        arena.finalize(cid);
        _toReveal();
        _reveal(cid, alice, x);
        vm.warp(revealEnd - 1);
        vm.expectRevert(Arena.ChallengeNotEnded.selector);
        arena.finalize(cid);
        assertEq(uint8(arena.phaseOf(cid)), uint8(Arena.Phase.Reveal));
        assertEq(arena.pendingOf(token, alice), 0);
        vm.warp(revealEnd);
        arena.finalize(cid);
    }

    // ------------------------------------------------------------ (9) fee rounding dust

    function testFuzz_FeeRoundingLeavesNoDust(uint256 pot, uint16 bps, uint256 extra) public {
        pot = bound(pot, 1, 1e30);
        extra = bound(extra, 0, 1e30);
        bps = uint16(bound(bps, 0, 1000));
        arena = new Arena(IProcessorRegistry(address(reg)), feeRecipient, bps);
        MockERC20 t = new MockERC20();
        t.mint(sponsor, pot);
        t.mint(stranger, extra);
        vm.prank(sponsor);
        t.approve(address(arena), type(uint256).max);
        vm.prank(stranger);
        t.approve(address(arena), type(uint256).max);
        uint256 id = _createAnd(t, pot);
        if (extra != 0) {
            vm.prank(stranger);
            arena.topUp(id, extra);
        }
        uint256 x = _enter(id, alice, 3);
        _toReveal();
        _reveal(id, alice, x);
        _toEnd();
        arena.finalize(id);

        uint256 total = pot + extra;
        uint256 fee = (total * bps) / 10_000; // floor
        assertEq(arena.pendingOf(t, feeRecipient), fee);
        assertEq(arena.pendingOf(t, alice), total - fee);
        assertEq(arena.pendingOf(t, alice) + arena.pendingOf(t, feeRecipient), total);
        assertEq(t.balanceOf(address(arena)), total);

        _withdraw(alice, t);
        if (fee != 0) _withdraw(feeRecipient, t);
        assertEq(t.balanceOf(address(arena)), 0, "contract must hold no dust");
        assertEq(t.balanceOf(alice) + t.balanceOf(feeRecipient), total);
    }

    function test_FeeRounding_PotOneAtMaxFeeChargesNothing() public {
        arena = new Arena(IProcessorRegistry(address(reg)), feeRecipient, 1000);
        _fund(token, arena);
        uint256 id = _createAnd(token, 1);
        uint256 x = _enter(id, alice, 3);
        _toReveal();
        _reveal(id, alice, x);
        _toEnd();
        vm.expectEmit(true, true, false, true, address(arena));
        emit Arena.Finalized(id, alice, x, 3, 1, 0);
        arena.finalize(id);
        assertEq(arena.pendingOf(token, feeRecipient), 0);
        assertEq(arena.pendingOf(token, alice), 1);
        assertEq(_withdraw(alice, token), 1);
        assertEq(token.balanceOf(address(arena)), 0);
    }

    // ------------------------------------------------------------ (10) zero-entry challenge

    function test_ZeroEntry_RefundsEveryContributorExactlyOnce() public {
        vm.prank(alice);
        arena.topUp(cid, 50e6);
        vm.prank(bob);
        arena.topUp(cid, 30e6);
        vm.prank(alice);
        arena.topUp(cid, 20e6);
        vm.prank(sponsor);
        arena.topUp(cid, 10e6); // the sponsor's own top-up is part of their contribution
        uint256 total = PRIZE + 110e6;
        assertEq(token.balanceOf(address(arena)), total);

        vm.prank(alice);
        vm.expectRevert(Arena.RefundNotAvailable.selector);
        arena.claimRefund(cid); // not finalized yet

        _toEnd();
        vm.expectEmit(true, true, false, true, address(arena));
        emit Arena.Finalized(cid, address(0), 0, 0, PRIZE + 10e6, 0);
        arena.finalize(cid);
        assertTrue(arena.getChallenge(cid).refundable);
        assertEq(arena.pendingOf(token, sponsor), PRIZE + 10e6);
        assertEq(arena.pendingOf(token, feeRecipient), 0, "no fee on a refunded pot");
        assertEq(arena.contributionOf(cid, sponsor), 0);

        // the sponsor cannot claim twice
        vm.prank(sponsor);
        vm.expectRevert(Arena.NothingToRefund.selector);
        arena.claimRefund(cid);

        vm.expectEmit(true, true, false, true, address(arena));
        emit Arena.RefundClaimed(cid, alice, 70e6);
        vm.prank(alice);
        arena.claimRefund(cid);
        vm.prank(alice);
        vm.expectRevert(Arena.NothingToRefund.selector);
        arena.claimRefund(cid);
        vm.prank(bob);
        arena.claimRefund(cid);
        assertEq(arena.pendingOf(token, alice), 70e6);
        assertEq(arena.pendingOf(token, bob), 30e6);

        // strangers (never contributed) get nothing
        vm.prank(stranger);
        vm.expectRevert(Arena.NothingToRefund.selector);
        arena.claimRefund(cid);

        assertEq(_withdraw(sponsor, token), PRIZE + 10e6);
        assertEq(_withdraw(alice, token), 70e6);
        assertEq(_withdraw(bob, token), 30e6);
        assertEq(token.balanceOf(address(arena)), 0);
    }

    function test_ZeroEntry_CommittersWhoNeverRevealStillRefund() public {
        _enter(cid, alice, 3);
        vm.prank(bob);
        arena.topUp(cid, 5e6);
        _toEnd();
        arena.finalize(cid);
        vm.prank(bob);
        arena.claimRefund(cid);
        assertEq(arena.pendingOf(token, bob), 5e6);
        assertEq(arena.pendingOf(token, sponsor), PRIZE);
    }

    function test_ZeroEntry_NobodyCanClaimWhenWinnerExists() public {
        uint256 x = _enter(cid, alice, 3);
        vm.prank(bob);
        arena.topUp(cid, 5e6);
        _toReveal();
        _reveal(cid, alice, x);
        _toEnd();
        arena.finalize(cid);
        address[3] memory who = [sponsor, bob, alice];
        for (uint256 i; i < who.length; ++i) {
            vm.prank(who[i]);
            vm.expectRevert(Arena.RefundNotAvailable.selector);
            arena.claimRefund(cid);
        }
    }

    function test_ZeroEntry_UnknownOrZeroContributionReverts() public {
        _toEnd();
        arena.finalize(cid);
        vm.prank(stranger);
        vm.expectRevert(Arena.NothingToRefund.selector);
        arena.claimRefund(cid);
        vm.expectRevert(abi.encodeWithSelector(Arena.ChallengeNotFound.selector, 5));
        arena.claimRefund(5);
    }

    // ------------------------------------------------------------ (11) griefing by never revealing

    function test_Griefing_NonRevealerCannotBlockFinalizeOrOthers() public {
        uint256 a = _enter(cid, alice, 5);
        _enter(cid, bob, 1); // best circuit, but bob never reveals
        uint256 c = _enter(cid, carol, 4);
        _toReveal();
        _reveal(cid, alice, a);
        _reveal(cid, carol, c);
        _toEnd();
        arena.finalize(cid);
        assertEq(arena.pendingOf(token, carol), PRIZE - (PRIZE * FEE) / 10_000);
        assertEq(arena.pendingOf(token, bob), 0);
    }

    function test_Griefing_200JunkCommitsDoNotChangeFinalizeOrRevealGas() public {
        uint256 idA = cid;
        uint256 idB = _createAnd(token, PRIZE);
        uint256 xa = _enter(idA, alice, 3);
        for (uint256 i; i < 200; ++i) {
            vm.prank(address(uint160(0xA000 + i)));
            arena.commit(idB, bytes32(i + 1));
        }
        uint256 xb = _enter(idB, alice, 3);
        assertEq(arena.getChallenge(idB).commitCount, 201);
        _toReveal();

        // A is measured first, so it pays the cold-slot costs; B can only be more expensive if it scales with commits.
        vm.prank(alice);
        uint256 g0 = gasleft();
        arena.reveal(idA, xa, _salt(alice));
        uint256 revealA = g0 - gasleft();
        vm.prank(alice);
        g0 = gasleft();
        arena.reveal(idB, xb, _salt(alice));
        uint256 revealB = g0 - gasleft();
        assertLe(revealB, revealA + 60_000, "reveal gas must not grow with commit count");

        _toEnd();
        g0 = gasleft();
        arena.finalize(idA);
        uint256 finA = g0 - gasleft();
        g0 = gasleft();
        arena.finalize(idB);
        uint256 finB = g0 - gasleft();
        assertLe(finB, finA + 60_000, "finalize gas must not grow with commit count");
        assertLt(finB, 150_000);
    }

    function test_Griefing_WrongCircuitRevealCannotBurnOthersCommit() public {
        uint256 x = _enter(cid, alice, 3);
        _commit(cid, bob, x, _salt(bob)); // bob tries to burn alice's circuit id
        uint256 bad = cpu.tapeout(carol, hex"01", 2, 1, 0, 1, _bytesOf(_parityOuts(2))); // wrong function
        _commit(cid, carol, bad, _salt(carol));
        _toReveal();
        _revealExpect(cid, bob, x, abi.encodeWithSelector(Arena.NotCircuitOwner.selector, alice));
        _revealExpect(cid, carol, bad, abi.encodeWithSelector(Arena.TruthTableMismatch.selector, 1, 1, 0));
        _reveal(cid, alice, x); // alice's circuit id is not marked as used, her commit is intact
        (address w,,,) = arena.bestOf(cid);
        assertEq(w, alice);
    }
}
