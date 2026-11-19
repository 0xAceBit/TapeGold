// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {TapeGolf} from "../TapeGolf.sol";
import {IProcessorRegistry} from "../interfaces/ITapeOutLite.sol";
import {MockCircuits} from "../mocks/MockCircuits.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {TapeGolfBase} from "./TapeGolf.Base.t.sol";

contract TapeGolfFuzzTest is TapeGolfBase {
    bytes32 internal constant SALT = keccak256("salt");

    // ------------------------------------------------------------ fee math

    function testFuzz_FeeSplitIsExactAndNeverLosesDust(uint256 prize, uint16 bps) public {
        prize = bound(prize, 1, 1e30);
        bps = uint16(bound(bps, 0, 500));
        golf = new TapeGolf(IProcessorRegistry(address(reg)), feeRecipient, bps);
        token.mint(sponsor, prize);
        vm.prank(sponsor);
        token.approve(address(golf), type(uint256).max);

        TapeGolf.CreateParams memory p = _params(token);
        p.prize = prize;
        uint256 c = _create(p);
        uint256 id = _enter(c, alice, 2, 0, SALT);
        _toReveal();
        _reveal(c, alice, address(cpu), id, SALT);
        _toEnd();

        uint256 fee = prize * bps / 10_000;
        vm.expectEmit(true, true, false, true, address(golf));
        emit TapeGolf.Settled(c, alice, prize - fee, fee);
        golf.settle(c);

        uint256 w = golf.pendingOf(token, alice);
        uint256 f = golf.pendingOf(token, feeRecipient);
        assertEq(f, fee);
        assertEq(w + f, prize, "fee + payout must equal prize");
        assertLe(fee, prize * 500 / 10_000);

        uint256 aliceBefore = token.balanceOf(alice);
        golf.claim(token, alice);
        if (f != 0) golf.claim(token, feeRecipient);
        assertEq(token.balanceOf(alice) - aliceBefore, w);
        assertEq(token.balanceOf(address(golf)), 0, "no dust left behind");
    }

    function testFuzz_NoWinnerRefundsExactPrizeNoFee(uint256 prize, uint16 bps) public {
        prize = bound(prize, 1, 1e30);
        bps = uint16(bound(bps, 0, 500));
        golf = new TapeGolf(IProcessorRegistry(address(reg)), feeRecipient, bps);
        token.mint(sponsor, prize);
        vm.prank(sponsor);
        token.approve(address(golf), type(uint256).max);
        TapeGolf.CreateParams memory p = _params(token);
        p.prize = prize;
        uint256 c = _create(p);
        _toEnd();
        golf.settle(c);
        assertEq(golf.pendingOf(token, sponsor), prize);
        assertEq(golf.pendingOf(token, feeRecipient), 0);
    }

    // ------------------------------------------------------------ leader selection

    function _perm(uint256 k) internal pure returns (uint256[3] memory r) {
        k %= 6;
        if (k == 0) r = [uint256(0), 1, 2];
        else if (k == 1) r = [uint256(0), 2, 1];
        else if (k == 2) r = [uint256(1), 0, 2];
        else if (k == 3) r = [uint256(1), 2, 0];
        else if (k == 4) r = [uint256(2), 0, 1];
        else r = [uint256(2), 1, 0];
    }

    function testFuzz_LeaderIsFewestGatesThenEarliestCommit(uint8 g0, uint8 g1, uint8 g2, uint256 permSeed) public {
        uint256[3] memory gates = [bound(g0, 2, 8), bound(g1, 2, 8), bound(g2, 2, 8)];
        address[3] memory who = [alice, bob, carol];
        uint256[3] memory ids;
        for (uint256 i; i < 3; ++i) ids[i] = _enter(cid, who[i], gates[i], uint24(i), SALT);

        _toReveal();
        uint256[3] memory order = _perm(permSeed);
        for (uint256 j; j < 3; ++j) {
            uint256 i = order[j];
            _reveal(cid, who[i], address(cpu), ids[i], SALT);
        }

        uint256 best;
        for (uint256 i = 1; i < 3; ++i) {
            if (gates[i] < gates[best]) best = i; // strict: ties keep the earlier committer
        }
        (address d, uint32 g, uint32 o,,) = golf.leaderOf(cid);
        assertEq(d, who[best]);
        assertEq(g, gates[best]);
        assertEq(o, best + 1);

        _toEnd();
        golf.settle(cid);
        assertEq(golf.pendingOf(token, who[best]), PRIZE - PRIZE * FEE / 10_000);
    }

    // ------------------------------------------------------------ commitment binding

    function testFuzz_WrongSaltNeverReveals(bytes32 s1, bytes32 s2) public {
        vm.assume(s1 != s2);
        uint256 id = _enter(cid, alice, 3, 0, s1);
        _toReveal();
        vm.prank(alice);
        vm.expectRevert(TapeGolf.CommitmentMismatch.selector);
        golf.reveal(cid, address(cpu), id, s2);
        _reveal(cid, alice, address(cpu), id, s1);
    }

    function testFuzz_DifferentNetlistNeverReveals(uint8 gates, uint24 v1, uint24 v2) public {
        uint256 n = bound(gates, 3, 10);
        // dead gates only reference variant%4 and (variant/4)%4, so compare effective content
        vm.assume(keccak256(_padded(n, v1)) != keccak256(_padded(n, v2)));
        _enter(cid, alice, n, v1, SALT);
        uint256 other = _mint(alice, _padded(n, v2), AND_TABLE);
        _toReveal();
        vm.prank(alice);
        vm.expectRevert(TapeGolf.CommitmentMismatch.selector);
        golf.reveal(cid, address(cpu), other, SALT);
    }

    // ------------------------------------------------------------ phases

    function testFuzz_PhaseWindows(uint256 t) public {
        t = bound(t, block.timestamp, uint256(revealDeadline) + 10 days);
        uint256 id = _enter(cid, alice, 2, 0, SALT); // committed at the start
        vm.warp(t);

        vm.prank(bob);
        try golf.commit(cid, bytes32(uint256(7))) {
            assertLt(t, commitDeadline, "commit succeeded after deadline");
        } catch {
            assertGe(t, commitDeadline, "commit failed inside commit window");
        }

        vm.prank(alice);
        try golf.reveal(cid, address(cpu), id, SALT) {
            assertTrue(t >= commitDeadline && t < revealDeadline, "reveal outside window");
        } catch {
            assertTrue(t < commitDeadline || t >= revealDeadline, "reveal failed inside window");
        }

        try golf.settle(cid) {
            assertGe(t, revealDeadline, "settled early");
        } catch {
            assertLt(t, revealDeadline, "settle failed after reveal deadline");
        }
    }

    // ------------------------------------------------------------ createContest validation

    function testFuzz_ExpectedByteMustFitNOut(uint8 nOut, uint8 value, uint8 pos) public {
        nOut = uint8(bound(nOut, 1, 8));
        TapeGolf.CreateParams memory p = _params(token);
        p.nOut = nOut;
        p.expected = new bytes(4);
        p.expected[bound(pos, 0, 3)] = bytes1(value);
        vm.prank(sponsor);
        try golf.createContest(p) {
            assertEq(uint256(value) >> nOut, 0);
        } catch {
            assertGt(uint256(value) >> nOut, 0);
        }
    }

    function testFuzz_EvaluationBudgetBoundary(uint8 nIn, uint32 maxGates) public {
        nIn = uint8(bound(nIn, 1, 8));
        maxGates = uint32(bound(maxGates, 1, 30_000));
        TapeGolf.CreateParams memory p = _params(token);
        p.nIn = nIn;
        p.expected = new bytes(uint256(1) << nIn);
        p.maxGates = maxGates;
        p.maxNetlistBytes = 4096;
        uint256 estimate = (uint256(1) << nIn) * (10_000 + 2_500 * uint256(maxGates));
        vm.prank(sponsor);
        try golf.createContest(p) {
            assertLe(estimate, 60_000_000);
        } catch (bytes memory err) {
            assertGt(estimate, 60_000_000);
            assertEq(bytes4(err), TapeGolf.EvaluationBudgetExceeded.selector);
        }
    }

    function testFuzz_DeadlinesNeedMinPhase(uint64 commitOffset, uint64 revealGap) public {
        commitOffset = uint64(bound(commitOffset, 0, 30 days));
        revealGap = uint64(bound(revealGap, 0, 30 days));
        TapeGolf.CreateParams memory p = _params(token);
        p.commitDeadline = uint64(block.timestamp) + commitOffset;
        p.revealDeadline = p.commitDeadline + revealGap;
        vm.prank(sponsor);
        try golf.createContest(p) {
            assertGe(commitOffset, 1 hours);
            assertGe(revealGap, 1 hours);
        } catch (bytes memory err) {
            if (commitOffset < 1 hours) assertEq(bytes4(err), TapeGolf.InvalidCommitDeadline.selector);
            else assertEq(bytes4(err), TapeGolf.InvalidRevealDeadline.selector);
        }
    }
}
