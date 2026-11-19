// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TapeGolf} from "../TapeGolf.sol";
import {IProcessorRegistry} from "../interfaces/ITapeOutLite.sol";
import {TapeGolfBase, BlacklistERC20} from "./TapeGolf.Base.t.sol";

/// Leader selection, settle / settleAndPay, fee math, claim, and non-blocking settlement.
contract TapeGolfSettleTest is TapeGolfBase {
    bytes32 internal constant SALT = keccak256("salt");
    uint256 internal constant FEE_AMT = PRIZE * 250 / 10_000; // 25e6
    uint256 internal constant WIN_AMT = PRIZE - FEE_AMT;

    uint256 internal idA;
    uint256 internal idB;
    uint256 internal idC;

    function _freshGolf(address recipient, uint16 bps) internal {
        golf = new TapeGolf(IProcessorRegistry(address(reg)), recipient, bps);
        _fund(token, golf);
        cid = _create(_params(token));
    }

    function _revealAll3() internal {
        _toReveal();
        _reveal(cid, alice, address(cpu), idA, SALT);
        _reveal(cid, bob, address(cpu), idB, SALT);
        _reveal(cid, carol, address(cpu), idC, SALT);
    }

    function _winnerIs(address who, uint32 gates) internal view {
        (address d, uint32 g,,,) = golf.leaderOf(cid);
        assertEq(d, who);
        assertEq(g, gates);
    }

    // ------------------------------------------------------------ leader selection

    function test_Leader_LowestGateCountWins() public {
        idA = _enter(cid, alice, 6, 0, SALT);
        idB = _enter(cid, bob, 4, 1, SALT);
        idC = _enter(cid, carol, 5, 2, SALT);
        _revealAll3();
        _winnerIs(bob, 4);
    }

    function test_Leader_FewerGatesBeatsEarlierCommit() public {
        idA = _enter(cid, alice, 5, 0, SALT);
        idB = _enter(cid, bob, 3, 1, SALT);
        _toReveal();
        _reveal(cid, alice, address(cpu), idA, SALT);
        vm.expectEmit(true, true, true, true, address(golf));
        emit TapeGolf.Revealed(cid, bob, address(cpu), idB, 3, true);
        _reveal(cid, bob, address(cpu), idB, SALT);
        _winnerIs(bob, 3);
    }

    function test_Leader_MoreGatesDoesNotDisplace() public {
        idA = _enter(cid, alice, 4, 0, SALT);
        idB = _enter(cid, bob, 7, 1, SALT);
        _toReveal();
        _reveal(cid, alice, address(cpu), idA, SALT);
        vm.expectEmit(true, true, true, true, address(golf));
        emit TapeGolf.Revealed(cid, bob, address(cpu), idB, 7, false);
        _reveal(cid, bob, address(cpu), idB, SALT);
        _winnerIs(alice, 4);
    }

    function test_Leader_TieGoesToEarliestCommit_EarlyRevealsFirst() public {
        idA = _enter(cid, alice, 4, 0, SALT);
        idB = _enter(cid, bob, 4, 1, SALT);
        _toReveal();
        _reveal(cid, alice, address(cpu), idA, SALT);
        vm.expectEmit(true, true, true, true, address(golf));
        emit TapeGolf.Revealed(cid, bob, address(cpu), idB, 4, false);
        _reveal(cid, bob, address(cpu), idB, SALT);
        _winnerIs(alice, 4);
        (,, uint32 order,,) = golf.leaderOf(cid);
        assertEq(order, 1);
    }

    function test_Leader_RevealOrderDoesNotMatter_LaterCommitterRevealsFirst() public {
        idA = _enter(cid, alice, 4, 0, SALT); // commit order 1
        idB = _enter(cid, bob, 4, 1, SALT); // commit order 2
        _toReveal();
        _reveal(cid, bob, address(cpu), idB, SALT);
        _winnerIs(bob, 4);
        vm.expectEmit(true, true, true, true, address(golf));
        emit TapeGolf.Revealed(cid, alice, address(cpu), idA, 4, true);
        _reveal(cid, alice, address(cpu), idA, SALT);
        _winnerIs(alice, 4);
        (,, uint32 order,,) = golf.leaderOf(cid);
        assertEq(order, 1);
    }

    function test_Leader_ThreeWayTieEarliestCommitWinsAnyRevealOrder() public {
        idA = _enter(cid, alice, 3, 0, SALT);
        idB = _enter(cid, bob, 3, 1, SALT);
        idC = _enter(cid, carol, 3, 2, SALT);
        _toReveal();
        _reveal(cid, carol, address(cpu), idC, SALT);
        _reveal(cid, alice, address(cpu), idA, SALT);
        _reveal(cid, bob, address(cpu), idB, SALT);
        _winnerIs(alice, 3);
    }

    function test_Leader_UnrevealedCommitIsIgnored() public {
        idA = _enter(cid, alice, 2, 0, SALT); // best, but never reveals
        idB = _enter(cid, bob, 5, 1, SALT);
        _toReveal();
        _reveal(cid, bob, address(cpu), idB, SALT);
        _winnerIs(bob, 5);
    }

    // ------------------------------------------------------------ settle

    function test_Settle_RevertsBeforeRevealDeadline() public {
        vm.expectRevert(TapeGolf.ContestNotEnded.selector);
        golf.settle(cid);
        vm.warp(revealDeadline - 1);
        vm.expectRevert(TapeGolf.ContestNotEnded.selector);
        golf.settle(cid);
        vm.expectRevert(TapeGolf.ContestNotEnded.selector);
        golf.settleAndPay(cid);
    }

    function test_Settle_UnknownContestReverts() public {
        vm.expectRevert(abi.encodeWithSelector(TapeGolf.ContestNotFound.selector, 9));
        golf.settle(9);
    }

    function test_Settle_CreditsWinnerAndFeeRecipient() public {
        idA = _enter(cid, alice, 3, 0, SALT);
        _toReveal();
        _reveal(cid, alice, address(cpu), idA, SALT);
        _toEnd();
        vm.expectEmit(true, true, false, true, address(golf));
        emit TapeGolf.Settled(cid, alice, WIN_AMT, FEE_AMT);
        vm.prank(stranger); // anyone may settle
        golf.settle(cid);

        assertEq(golf.pendingOf(token, alice), WIN_AMT);
        assertEq(golf.pendingOf(token, feeRecipient), FEE_AMT);
        assertEq(golf.pendingOf(token, sponsor), 0);
        assertTrue(golf.getContest(cid).settled);
        assertEq(uint8(golf.phaseOf(cid)), uint8(TapeGolf.Phase.Settled));
        assertEq(token.balanceOf(alice), 0, "settle must not transfer tokens");
        assertEq(token.balanceOf(address(golf)), 2 * 0 + PRIZE);
    }

    function test_Settle_DoubleSettleReverts() public {
        _toEnd();
        golf.settle(cid);
        vm.expectRevert(TapeGolf.AlreadySettled.selector);
        golf.settle(cid);
        vm.expectRevert(TapeGolf.AlreadySettled.selector);
        golf.settleAndPay(cid);
    }

    function test_Settle_NoRevealRefundsSponsor() public {
        _enter(cid, alice, 3, 0, SALT); // committed but never revealed
        _toEnd();
        vm.expectEmit(true, true, false, true, address(golf));
        emit TapeGolf.Settled(cid, address(0), PRIZE, 0);
        golf.settle(cid);
        assertEq(golf.pendingOf(token, sponsor), PRIZE);
        assertEq(golf.pendingOf(token, feeRecipient), 0, "no fee on a refund");
        assertEq(golf.pendingOf(token, alice), 0);
    }

    function test_Settle_OnlyFailedRevealsRefundsSponsor() public {
        bytes memory nl = _padded(2, 0);
        uint256 bad = _mint(alice, nl, hex"00010101");
        _commit(cid, alice, nl, SALT);
        _toReveal();
        vm.prank(alice);
        vm.expectRevert();
        golf.reveal(cid, address(cpu), bad, SALT);
        _toEnd();
        golf.settle(cid);
        assertEq(golf.pendingOf(token, sponsor), PRIZE);
    }

    function test_Settle_NoCommitsRefundsSponsorAndClaimPaysSponsor() public {
        uint256 before = token.balanceOf(sponsor);
        _toEnd();
        golf.settleAndPay(cid);
        assertEq(token.balanceOf(sponsor), before + PRIZE);
        assertEq(golf.pendingOf(token, sponsor), 0);
    }

    // ------------------------------------------------------------ fee math

    function _winAndSettle(uint256 prize) internal {
        TapeGolf.CreateParams memory p = _params(token);
        p.prize = prize;
        cid = _create(p);
        idA = _enter(cid, alice, 2, 0, SALT);
        _toReveal();
        _reveal(cid, alice, address(cpu), idA, SALT);
        _toEnd();
        golf.settle(cid);
    }

    function test_Fee_ZeroBps() public {
        _freshGolf(feeRecipient, 0);
        _winAndSettle(PRIZE);
        assertEq(golf.pendingOf(token, alice), PRIZE);
        assertEq(golf.pendingOf(token, feeRecipient), 0);
    }

    function test_Fee_MaxBps() public {
        _freshGolf(feeRecipient, 500);
        _winAndSettle(PRIZE);
        assertEq(golf.pendingOf(token, feeRecipient), 50e6);
        assertEq(golf.pendingOf(token, alice), 950e6);
    }

    function test_Fee_250Bps() public {
        _winAndSettle(PRIZE);
        assertEq(golf.pendingOf(token, feeRecipient), 25e6);
        assertEq(golf.pendingOf(token, alice), 975e6);
    }

    function test_Fee_RoundsDownInWinnersFavourNoDust() public {
        _winAndSettle(999); // 999 * 250 / 10000 = 24.975 -> 24
        assertEq(golf.pendingOf(token, feeRecipient), 24);
        assertEq(golf.pendingOf(token, alice), 975);
        assertEq(golf.pendingOf(token, alice) + golf.pendingOf(token, feeRecipient), 999);
    }

    function test_Fee_TinyPrizeHasZeroFee() public {
        _winAndSettle(1);
        assertEq(golf.pendingOf(token, feeRecipient), 0);
        assertEq(golf.pendingOf(token, alice), 1);
    }

    // ------------------------------------------------------------ settleAndPay

    function test_SettleAndPay_PaysWinnerKeepsFeePending() public {
        idA = _enter(cid, alice, 3, 0, SALT);
        _toReveal();
        _reveal(cid, alice, address(cpu), idA, SALT);
        _toEnd();
        vm.expectEmit(true, true, false, true, address(token));
        emit IERC20.Transfer(address(golf), alice, WIN_AMT);
        vm.expectEmit(true, true, false, true, address(golf));
        emit TapeGolf.Claimed(token, alice, WIN_AMT);
        vm.prank(stranger);
        golf.settleAndPay(cid);

        assertEq(token.balanceOf(alice), WIN_AMT);
        assertEq(golf.pendingOf(token, alice), 0);
        assertEq(golf.pendingOf(token, feeRecipient), FEE_AMT);
        assertEq(token.balanceOf(address(golf)), FEE_AMT);
        assertEq(uint8(golf.phaseOf(cid)), uint8(TapeGolf.Phase.Settled));
    }

    function test_SettleAndPay_FeeRecipientWinnerReceivesEverything() public {
        _freshGolf(alice, 250);
        idA = _enter(cid, alice, 2, 0, SALT);
        _toReveal();
        _reveal(cid, alice, address(cpu), idA, SALT);
        _toEnd();
        golf.settleAndPay(cid);
        assertEq(token.balanceOf(alice), PRIZE);
        assertEq(golf.pendingOf(token, alice), 0);
        assertEq(token.balanceOf(address(golf)), 0);
    }

    function test_SettleAndPay_RefundsSponsorWhenNoWinner() public {
        uint256 before = token.balanceOf(sponsor);
        _toEnd();
        golf.settleAndPay(cid);
        assertEq(token.balanceOf(sponsor), before + PRIZE);
    }

    // ------------------------------------------------------------ claim

    function _settledWithWinner() internal {
        idA = _enter(cid, alice, 2, 0, SALT);
        _toReveal();
        _reveal(cid, alice, address(cpu), idA, SALT);
        _toEnd();
        golf.settle(cid);
    }

    function test_Claim_PaysAccountNotCaller() public {
        _settledWithWinner();
        vm.expectEmit(true, true, false, true, address(golf));
        emit TapeGolf.Claimed(token, alice, WIN_AMT);
        vm.prank(stranger);
        golf.claim(token, alice);
        assertEq(token.balanceOf(alice), WIN_AMT);
        assertEq(token.balanceOf(stranger), 0);
        assertEq(golf.pendingOf(token, alice), 0);
    }

    function test_Claim_ThirdPartyCanTriggerFeeRecipient() public {
        _settledWithWinner();
        vm.prank(bob);
        golf.claim(token, feeRecipient);
        assertEq(token.balanceOf(feeRecipient), FEE_AMT);
        assertEq(token.balanceOf(bob), 0);
    }

    function test_Claim_RepeatReverts() public {
        _settledWithWinner();
        golf.claim(token, alice);
        vm.expectRevert(TapeGolf.NothingToClaim.selector);
        golf.claim(token, alice);
    }

    function test_Claim_NothingPendingReverts() public {
        vm.expectRevert(TapeGolf.NothingToClaim.selector);
        golf.claim(token, stranger);
        vm.expectRevert(TapeGolf.NothingToClaim.selector);
        golf.claim(token, address(0));
    }

    function test_Claim_BalancesAccumulateAcrossContests() public {
        uint256 c2 = _create(_params(token));
        idA = _enter(cid, alice, 2, 0, SALT);
        uint256 id2 = _enter(c2, alice, 2, 1, keccak256("s2"));
        _toReveal();
        _reveal(cid, alice, address(cpu), idA, SALT);
        _reveal(c2, alice, address(cpu), id2, keccak256("s2"));
        _toEnd();
        golf.settle(cid);
        golf.settle(c2);
        assertEq(golf.pendingOf(token, alice), 2 * WIN_AMT);
        golf.claim(token, alice);
        assertEq(token.balanceOf(alice), 2 * WIN_AMT);
    }

    // ------------------------------------------------------------ settlement cannot be blocked by the token

    function _blacklistContest() internal returns (BlacklistERC20 bl, uint256 c2) {
        bl = new BlacklistERC20();
        _fund(bl, golf);
        c2 = _create(_params(bl));
    }

    function test_Settle_SucceedsEvenIfWinnerIsBlacklisted() public {
        (BlacklistERC20 bl, uint256 c2) = _blacklistContest();
        uint256 id = _enter(c2, alice, 2, 0, SALT);
        _toReveal();
        _reveal(c2, alice, address(cpu), id, SALT);
        _toEnd();
        bl.setBlocked(alice, true);

        golf.settle(c2); // credits only: must not revert
        assertEq(golf.pendingOf(bl, alice), WIN_AMT);

        vm.expectRevert(bytes("blacklisted"));
        golf.claim(bl, alice);
        assertEq(golf.pendingOf(bl, alice), WIN_AMT, "failed claim must not burn the credit");

        golf.claim(bl, feeRecipient); // the fee recipient is unaffected
        assertEq(bl.balanceOf(feeRecipient), FEE_AMT);

        bl.setBlocked(alice, false);
        golf.claim(bl, alice);
        assertEq(bl.balanceOf(alice), WIN_AMT);
    }

    function test_SettleAndPay_RollsBackWhenWinnerBlacklistedPlainSettleStillWorks() public {
        (BlacklistERC20 bl, uint256 c2) = _blacklistContest();
        uint256 id = _enter(c2, alice, 2, 0, SALT);
        _toReveal();
        _reveal(c2, alice, address(cpu), id, SALT);
        _toEnd();
        bl.setBlocked(alice, true);

        vm.expectRevert(bytes("blacklisted"));
        golf.settleAndPay(c2);
        assertFalse(golf.getContest(c2).settled, "settleAndPay must roll back fully");

        golf.settle(c2);
        assertEq(golf.pendingOf(bl, alice), WIN_AMT);
    }

    function test_Settle_SucceedsEvenIfSponsorBlacklistedOnRefund() public {
        (BlacklistERC20 bl, uint256 c2) = _blacklistContest();
        _toEnd();
        bl.setBlocked(sponsor, true);
        golf.settle(c2);
        assertEq(golf.pendingOf(bl, sponsor), PRIZE);
    }
}
