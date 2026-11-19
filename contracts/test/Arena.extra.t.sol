// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Arena} from "../Arena.sol";
import {IProcessorRegistry} from "../interfaces/ITapeOutLite.sol";
import {BlacklistERC20, HookERC20, HookRecipient} from "./Arena.Mocks.t.sol";
import {ArenaBase} from "./Arena.Base.t.sol";

/// Extra attacks and accepted limitations.
contract ArenaExtraTest is ArenaBase {
    // ------------------------------------------------------------ absurd durations

    /// SECURE behaviour: a sponsor must not be able to lock everyone's top-ups for centuries (no cancel / no rescue).
    function test_Extra_AbsurdDurationsAreRejected() public {
        CP memory p = _p();
        p.ce = uint64(block.timestamp + 500 * 365 days);
        p.re = p.ce + 500 * 365 days;
        vm.prank(sponsor);
        vm.expectRevert();
        arena.createChallenge(p.token, p.pot, p.nIn, p.nOut, p.table, p.ce, p.re, p.proc);
    }

    function test_Extra_AbsurdRevealWindowAloneIsRejected() public {
        CP memory p = _p();
        p.re = uint64(block.timestamp + 500 * 365 days); // commit window normal, reveal window 500 years
        vm.prank(sponsor);
        vm.expectRevert();
        arena.createChallenge(p.token, p.pot, p.nIn, p.nOut, p.table, p.ce, p.re, p.proc);
    }

    function test_Extra_AbsurdCommitWindowAloneIsRejected() public {
        CP memory p = _p();
        p.ce = uint64(block.timestamp + 500 * 365 days);
        p.re = p.ce + 1 days;
        vm.prank(sponsor);
        vm.expectRevert();
        arena.createChallenge(p.token, p.pot, p.nIn, p.nOut, p.table, p.ce, p.re, p.proc);
    }

    // ------------------------------------------------------------ sponsor / winner economics

    /// ACCEPTED LIMITATION: the sponsor may enter their own challenge; if they win they take the pot, including
    /// other people's top-ups (minus the fee). Funders are trusting the sponsor's challenge, not the contract.
    function test_Limitation_SponsorCanWinOwnPot() public {
        uint256 x = _enter(cid, sponsor, 3);
        vm.prank(bob);
        arena.topUp(cid, 200e6);
        vm.prank(carol);
        arena.topUp(cid, 100e6);
        _toReveal();
        _reveal(cid, sponsor, x);
        _toEnd();
        arena.finalize(cid);
        uint256 total = PRIZE + 300e6;
        uint256 fee = (total * FEE) / 10_000;
        assertEq(arena.pendingOf(token, sponsor), total - fee);
        // bob and carol lose their contributions: no refund when a winner exists
        vm.prank(bob);
        vm.expectRevert(Arena.RefundNotAvailable.selector);
        arena.claimRefund(cid);
    }

    function test_Extra_FeeRecipientIsWinner() public {
        arena = new Arena(IProcessorRegistry(address(reg)), alice, FEE);
        _fund(token, arena);
        uint256 id = _createAnd(token, PRIZE);
        uint256 x = _enter(id, alice, 3);
        _toReveal();
        _reveal(id, alice, x);
        _toEnd();
        uint256 fee = (PRIZE * FEE) / 10_000;
        vm.expectEmit(true, true, false, true, address(arena));
        emit Arena.Finalized(id, alice, x, 3, PRIZE - fee, fee);
        arena.finalize(id);
        assertEq(arena.pendingOf(token, alice), PRIZE, "both credits land on the same account");
        assertEq(_withdraw(alice, token), PRIZE);
        assertEq(token.balanceOf(address(arena)), 0);
    }

    function test_Extra_BlacklistedWinnerOnlyBlocksThemselves() public {
        BlacklistERC20 bl = new BlacklistERC20();
        _fund(bl, arena);
        uint256 id1 = _createAnd(bl, PRIZE);
        uint256 id2 = _createAnd(bl, PRIZE);
        uint256 xa = _enter(id1, alice, 3);
        uint256 xb = _enter(id2, bob, 3);
        _toReveal();
        _reveal(id1, alice, xa);
        _reveal(id2, bob, xb);
        _toEnd();
        arena.finalize(id1);
        arena.finalize(id2);
        bl.setBlocked(alice, true);
        uint256 payout = PRIZE - (PRIZE * FEE) / 10_000;

        vm.prank(alice);
        vm.expectRevert();
        arena.withdraw(bl);
        assertEq(arena.pendingOf(bl, alice), payout, "funds stay credited");
        assertEq(_withdraw(bob, bl), payout);
        assertEq(_withdraw(feeRecipient, bl), 2 * ((PRIZE * FEE) / 10_000));
        assertEq(bl.balanceOf(address(arena)), payout);

        bl.setBlocked(alice, false);
        assertEq(_withdraw(alice, bl), payout);
        assertEq(bl.balanceOf(address(arena)), 0);
    }

    function test_Extra_RevertingContractWinnerOnlyBlocksThemselves() public {
        HookERC20 ht = new HookERC20();
        _fund(ht, arena);
        uint256 id1 = _createAnd(ht, PRIZE);
        uint256 id2 = _createAnd(ht, PRIZE);
        HookRecipient r = new HookRecipient();
        uint256 xr = _mintAnd(address(r), 3);
        bytes32 salt = bytes32(uint256(5));
        r.exec(address(arena), abi.encodeCall(Arena.commit, (id1, arena.commitHashOf(xr, salt, address(r)))));
        uint256 xb = _enter(id2, bob, 3);
        _toReveal();
        r.exec(address(arena), abi.encodeCall(Arena.reveal, (id1, xr, salt)));
        _reveal(id2, bob, xb);
        _toEnd();
        arena.finalize(id1);
        arena.finalize(id2);
        ht.setHooked(address(r), true);
        r.configure(2, address(0), "");
        uint256 payout = PRIZE - (PRIZE * FEE) / 10_000;

        vm.expectRevert();
        r.exec(address(arena), abi.encodeCall(Arena.withdraw, (ht)));
        assertEq(arena.pendingOf(ht, address(r)), payout, "funds stay credited");
        assertEq(_withdraw(bob, ht), payout);
        assertEq(_withdraw(feeRecipient, ht), 2 * ((PRIZE * FEE) / 10_000));

        r.configure(0, address(0), "");
        r.exec(address(arena), abi.encodeCall(Arena.withdraw, (ht)));
        assertEq(ht.balanceOf(address(r)), payout);
        assertEq(ht.balanceOf(address(arena)), 0);
    }

    // ------------------------------------------------------------ cross-challenge behaviour

    /// ACCEPTED LIMITATION: the commit hash does not bind the challenge id, so one hash is valid in every challenge.
    /// It is still bound to the sender, so only the designer benefits.
    function test_Limitation_SameHashCommittedInTwoChallenges() public {
        uint256 id2 = _createAnd(token, PRIZE);
        uint256 x = _mintAnd(alice, 3);
        bytes32 h = arena.commitHashOf(x, bytes32(uint256(1)), alice);
        vm.startPrank(alice);
        arena.commit(cid, h);
        arena.commit(id2, h);
        vm.stopPrank();
        _toReveal();
        vm.startPrank(alice);
        arena.reveal(cid, x, bytes32(uint256(1)));
        arena.reveal(id2, x, bytes32(uint256(1)));
        vm.stopPrank();
        (address w1,,,) = arena.bestOf(cid);
        (address w2,,,) = arena.bestOf(id2);
        assertEq(w1, alice);
        assertEq(w2, alice);
    }

    function test_Extra_TwoChallengesMaySeparatelyUseOneCircuitId() public {
        uint256 id2 = _createAnd(token, PRIZE);
        uint256 x = _mintAnd(alice, 3);
        _commit(cid, alice, x, bytes32(uint256(1)));
        _commit(id2, alice, x, bytes32(uint256(2)));
        _toReveal();
        vm.startPrank(alice);
        arena.reveal(cid, x, bytes32(uint256(1)));
        arena.reveal(id2, x, bytes32(uint256(2)));
        vm.stopPrank();
        _toEnd();
        arena.finalize(cid);
        arena.finalize(id2);
        assertEq(arena.pendingOf(token, alice), 2 * (PRIZE - (PRIZE * FEE) / 10_000));
    }

    function test_Extra_DeregisteredProcessorStillWorksForExistingChallenge() public {
        uint256 x = _enter(cid, alice, 3);
        reg.setCpu(address(cpu), false);
        _toReveal();
        _reveal(cid, alice, x);
        _toEnd();
        arena.finalize(cid);
        assertEq(arena.pendingOf(token, alice), PRIZE - (PRIZE * FEE) / 10_000);
        // but new challenges on it are refused
        CP memory p = _p();
        p.ce = uint64(block.timestamp + 1 days);
        p.re = p.ce + 1 days;
        _createExpect(p, abi.encodeWithSelector(Arena.UnregisteredProcessor.selector, address(cpu)));
    }

    // ------------------------------------------------------------ dust and same-block top-ups

    function test_Extra_OneWeiTopUpsDoNotHinderSettlement() public {
        uint256 x = _enter(cid, alice, 3);
        for (uint256 i; i < 50; ++i) {
            address d = address(uint160(0xB000 + i));
            token.mint(d, 1);
            vm.startPrank(d);
            token.approve(address(arena), 1);
            arena.topUp(cid, 1);
            vm.stopPrank();
        }
        _toReveal();
        _reveal(cid, alice, x);
        _toEnd();
        uint256 g0 = gasleft();
        arena.finalize(cid);
        assertLt(g0 - gasleft(), 150_000, "finalize gas independent of number of top-ups");
        assertEq(arena.pendingOf(token, alice) + arena.pendingOf(token, feeRecipient), PRIZE + 50);
    }

    function test_Extra_DustTopUpsWithWinnerJoinThePot() public {
        uint256 x = _enter(cid, alice, 3);
        vm.prank(stranger);
        arena.topUp(cid, 1);
        _toReveal();
        _reveal(cid, alice, x);
        _toEnd();
        arena.finalize(cid);
        uint256 total = PRIZE + 1;
        assertEq(arena.pendingOf(token, alice) + arena.pendingOf(token, feeRecipient), total);
    }

    function test_Extra_DustTopUpWithoutWinnerIsRefundable() public {
        vm.prank(stranger);
        arena.topUp(cid, 1);
        _toEnd();
        arena.finalize(cid);
        vm.prank(stranger);
        arena.claimRefund(cid);
        assertEq(_withdraw(stranger, token), 1);
        assertEq(_withdraw(sponsor, token), PRIZE);
        assertEq(token.balanceOf(address(arena)), 0);
    }

    function test_Extra_TopUpBeforeFinalizeInSameBlockCounts() public {
        uint256 x = _enter(cid, alice, 3);
        _toReveal();
        _reveal(cid, alice, x);
        _toEnd();
        vm.prank(stranger);
        arena.topUp(cid, 40e6);
        arena.finalize(cid);
        uint256 total = PRIZE + 40e6;
        assertEq(arena.pendingOf(token, alice), total - (total * FEE) / 10_000);
        assertEq(token.balanceOf(address(arena)), total);
    }

    function test_Extra_TopUpAfterFinalizeInSameBlockReverts() public {
        _toEnd();
        arena.finalize(cid);
        vm.prank(stranger);
        vm.expectRevert(Arena.AlreadyFinalized.selector);
        arena.topUp(cid, 40e6);
        assertEq(token.balanceOf(address(arena)), PRIZE);
    }

    // ------------------------------------------------------------ timing boundaries

    function test_Extra_TimingBoundaries() public {
        uint256 a = _mintAnd(alice, 3);
        uint256 b = _mintAnd(bob, 4);
        uint256 c = _mintAnd(carol, 5);
        _commit(cid, bob, b, _salt(bob));
        _commit(cid, carol, c, _salt(carol));
        vm.warp(commitEnd - 1);
        _commit(cid, alice, a, _salt(alice)); // last commit second
        vm.warp(commitEnd);
        _reveal(cid, alice, a); // first reveal second
        vm.warp(revealEnd - 1);
        _reveal(cid, bob, b); // last reveal second
        vm.warp(revealEnd);
        _revealExpect(cid, carol, c, _err(Arena.NotRevealPhase.selector));
        arena.finalize(cid); // first finalize second
        (address w,,,) = arena.bestOf(cid);
        assertEq(w, alice);
    }
}
