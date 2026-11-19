// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Arena} from "../Arena.sol";
import {IProcessorRegistry} from "../interfaces/ITapeOutLite.sol";
import {MockCircuits} from "../mocks/MockCircuits.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {FeeOnTransferERC20} from "../mocks/FeeOnTransferERC20.sol";
import {ToggleFeeERC20} from "./Arena.Mocks.t.sol";
import {ArenaBase} from "./Arena.Base.t.sol";

/// Unit tests: constructor, createChallenge, topUp, commit, phases and views.
contract ArenaTest is ArenaBase {
    // ------------------------------------------------------------ constructor

    function test_Constructor_StoresConfig() public view {
        assertEq(address(arena.registry()), address(reg));
        assertEq(arena.feeRecipient(), feeRecipient);
        assertEq(arena.feeBps(), FEE);
    }

    function test_Constructor_FeeBpsZeroAndMaxAccepted() public {
        Arena a = new Arena(IProcessorRegistry(address(reg)), feeRecipient, 0);
        assertEq(a.feeBps(), 0);
        Arena b = new Arena(IProcessorRegistry(address(reg)), feeRecipient, 1000);
        assertEq(b.feeBps(), 1000);
    }

    function test_Constructor_RevertsFeeTooHigh() public {
        vm.expectRevert(abi.encodeWithSelector(Arena.FeeTooHigh.selector, uint16(1001)));
        new Arena(IProcessorRegistry(address(reg)), feeRecipient, 1001);
    }

    function test_Constructor_RevertsZeroRegistry() public {
        vm.expectRevert(Arena.ZeroRegistry.selector);
        new Arena(IProcessorRegistry(address(0)), feeRecipient, 100);
    }

    function test_Constructor_RevertsZeroFeeRecipient() public {
        vm.expectRevert(Arena.ZeroFeeRecipient.selector);
        new Arena(IProcessorRegistry(address(reg)), address(0), 100);
    }

    // ------------------------------------------------------------ createChallenge

    function test_Create_EscrowsAndStores() public view {
        assertEq(cid, 1);
        assertEq(arena.challengeCount(), 1);
        Arena.Challenge memory c = arena.getChallenge(cid);
        assertEq(c.sponsor, sponsor);
        assertEq(c.commitEnd, commitEnd);
        assertEq(c.revealEnd, revealEnd);
        assertEq(address(c.token), address(token));
        assertEq(c.processor, address(cpu));
        assertEq(c.pot, PRIZE);
        assertEq(c.nIn, 2);
        assertEq(c.nOut, 1);
        assertEq(c.commitCount, 0);
        assertFalse(c.finalized);
        assertFalse(c.refundable);
        assertEq(token.balanceOf(address(arena)), PRIZE);
        assertEq(token.balanceOf(sponsor), 1e15 - PRIZE);
        assertEq(arena.contributionOf(cid, sponsor), PRIZE);
        assertEq(arena.truthTableOf(cid), hex"08");
        assertEq(uint8(arena.phaseOf(cid)), uint8(Arena.Phase.Commit));
    }

    function test_Create_EmitsChallengeCreated() public {
        vm.expectEmit(true, true, true, true, address(arena));
        emit Arena.ChallengeCreated(2, sponsor, token, 5e6, 2, 1, address(cpu), commitEnd, revealEnd, hex"08");
        uint256 id = _createAnd(token, 5e6);
        assertEq(id, 2);
        assertEq(token.balanceOf(address(arena)), PRIZE + 5e6);
    }

    function test_Create_RevertsZeroPot() public {
        CP memory p = _p();
        p.pot = 0;
        _createExpect(p, _err(Arena.ZeroAmount.selector));
    }

    function test_Create_RevertsTokenWithoutCode() public {
        CP memory p = _p();
        address eoa = makeAddr("eoa");
        p.token = IERC20(eoa);
        _createExpect(p, abi.encodeWithSelector(Arena.TokenHasNoCode.selector, eoa));
    }

    function test_Create_RevertsInputBounds() public {
        CP memory p = _p();
        p.nIn = 0;
        _createExpect(p, abi.encodeWithSelector(Arena.InvalidInputs.selector, uint8(0)));
        p.nIn = 9;
        _createExpect(p, abi.encodeWithSelector(Arena.InvalidInputs.selector, uint8(9)));
    }

    function test_Create_RevertsOutputBounds() public {
        CP memory p = _p();
        p.nOut = 0;
        _createExpect(p, abi.encodeWithSelector(Arena.InvalidOutputs.selector, uint8(0)));
        p.nOut = 9;
        _createExpect(p, abi.encodeWithSelector(Arena.InvalidOutputs.selector, uint8(9)));
    }

    function test_Create_RevertsZeroProcessor() public {
        CP memory p = _p();
        p.proc = address(0);
        _createExpect(p, abi.encodeWithSelector(Arena.UnregisteredProcessor.selector, address(0)));
    }

    function test_Create_RevertsUnregisteredProcessor() public {
        CP memory p = _p();
        address rogue = address(new MockCircuits());
        p.proc = rogue;
        _createExpect(p, abi.encodeWithSelector(Arena.UnregisteredProcessor.selector, rogue));
    }

    function test_Create_RevertsInvalidDeadlines() public {
        CP memory p = _p();
        p.ce = T0; // commitEnd == now
        _createExpect(p, _err(Arena.InvalidDeadlines.selector));
        p.ce = T0 - 1;
        _createExpect(p, _err(Arena.InvalidDeadlines.selector));
        p = _p();
        p.re = p.ce; // revealEnd == commitEnd
        _createExpect(p, _err(Arena.InvalidDeadlines.selector));
        p.re = p.ce - 1;
        _createExpect(p, _err(Arena.InvalidDeadlines.selector));
    }

    function test_Create_AcceptsMinimalDeadlines() public {
        CP memory p = _p();
        p.ce = T0 + 1;
        p.re = T0 + 2;
        assertEq(_createP(p), 2);
    }

    function test_Create_RevertsTableLength() public {
        CP memory p = _p();
        p.table = hex"0800";
        _createExpect(p, abi.encodeWithSelector(Arena.InvalidTableLength.selector, 2, 1));
        p.table = hex"";
        _createExpect(p, abi.encodeWithSelector(Arena.InvalidTableLength.selector, 0, 1));
    }

    function test_Create_RevertsTablePaddingBits() public {
        CP memory p = _p(); // 2x1 -> 4 bits used
        p.table = hex"18";
        _createExpect(p, _err(Arena.InvalidTablePadding.selector));
        p.table = hex"88";
        _createExpect(p, _err(Arena.InvalidTablePadding.selector));
        p.table = hex"0f"; // all four used bits set is fine
        assertEq(_createP(p), 2);
        // 1x1: 2 bits used
        p = _p();
        p.nIn = 1;
        p.nOut = 1;
        p.table = hex"04";
        _createExpect(p, _err(Arena.InvalidTablePadding.selector));
        p.table = hex"03";
        _createP(p);
        // 1x3: 6 bits used
        p.nOut = 3;
        p.table = hex"40";
        _createExpect(p, _err(Arena.InvalidTablePadding.selector));
        p.table = hex"3f";
        _createP(p);
    }

    function test_Create_ByteAlignedTableHasNoPaddingCheck() public {
        CP memory p = _p();
        p.nIn = 3;
        p.nOut = 1; // exactly 8 bits
        p.table = hex"ff";
        assertEq(_createP(p), 2);
    }

    function test_Create_RevertsFeeOnTransferToken() public {
        FeeOnTransferERC20 f = new FeeOnTransferERC20();
        f.mint(sponsor, 1e15);
        vm.prank(sponsor);
        f.approve(address(arena), type(uint256).max);
        CP memory p = _p();
        p.token = f;
        _createExpect(p, abi.encodeWithSelector(Arena.IncorrectAmountReceived.selector, PRIZE, PRIZE - PRIZE / 100));
        assertEq(arena.challengeCount(), 1);
    }

    // ------------------------------------------------------------ topUp

    function test_TopUp_AnyoneTracksContributionsAndEmits() public {
        vm.expectEmit(true, true, false, true, address(arena));
        emit Arena.ToppedUp(cid, stranger, 7e6, PRIZE + 7e6);
        vm.prank(stranger);
        arena.topUp(cid, 7e6);
        vm.prank(stranger);
        arena.topUp(cid, 3e6);
        vm.prank(alice);
        arena.topUp(cid, 5e6);
        vm.prank(sponsor);
        arena.topUp(cid, 1e6);

        assertEq(arena.getChallenge(cid).pot, PRIZE + 16e6);
        assertEq(arena.contributionOf(cid, stranger), 10e6);
        assertEq(arena.contributionOf(cid, alice), 5e6);
        assertEq(arena.contributionOf(cid, sponsor), PRIZE + 1e6);
        assertEq(token.balanceOf(address(arena)), PRIZE + 16e6);
    }

    function test_TopUp_RevertsZero() public {
        vm.expectRevert(Arena.ZeroAmount.selector);
        arena.topUp(cid, 0);
    }

    function test_TopUp_RevertsAfterFinalize() public {
        _toEnd();
        arena.finalize(cid);
        vm.prank(alice);
        vm.expectRevert(Arena.AlreadyFinalized.selector);
        arena.topUp(cid, 1);
    }

    function test_TopUp_AfterRevealEndBeforeFinalizeIsAccepted() public {
        _enter(cid, alice, 3);
        _toReveal();
        _reveal(cid, alice, 1);
        _toEnd();
        vm.prank(stranger);
        arena.topUp(cid, 10e6);
        arena.finalize(cid);
        uint256 pot = PRIZE + 10e6;
        assertEq(arena.pendingOf(token, alice), pot - (pot * FEE) / 10_000);
    }

    function test_TopUp_RevertsFeeOnTransferAfterCreation() public {
        ToggleFeeERC20 t = new ToggleFeeERC20();
        t.mint(sponsor, 1e15);
        t.mint(alice, 1e15);
        vm.prank(sponsor);
        t.approve(address(arena), type(uint256).max);
        vm.prank(alice);
        t.approve(address(arena), type(uint256).max);
        uint256 id = _createAnd(t, 100e6);
        t.setFeeOn(true);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Arena.IncorrectAmountReceived.selector, 100e6, 99e6));
        arena.topUp(id, 100e6);
        assertEq(arena.getChallenge(id).pot, 100e6);
        assertEq(arena.contributionOf(id, alice), 0);
    }

    // ------------------------------------------------------------ commit

    function test_CommitHashOf_MatchesAbiEncode() public view {
        bytes32 salt = bytes32(uint256(0xBEEF));
        assertEq(arena.commitHashOf(42, salt, alice), keccak256(abi.encode(uint256(42), salt, alice)));
        assertNotEq(arena.commitHashOf(42, salt, alice), arena.commitHashOf(42, salt, bob));
        assertNotEq(arena.commitHashOf(42, salt, alice), arena.commitHashOf(43, salt, alice));
    }

    function test_Commit_RecordsIndexBlockAndEmits() public {
        bytes32 h = bytes32(uint256(1));
        vm.roll(500);
        vm.expectEmit(true, true, false, true, address(arena));
        emit Arena.Committed(cid, alice, h, 1, 500);
        vm.prank(alice);
        arena.commit(cid, h);
        vm.prank(bob);
        arena.commit(cid, bytes32(uint256(2)));
        vm.roll(777);
        vm.prank(carol);
        arena.commit(cid, bytes32(uint256(3)));

        (bytes32 ha, uint32 ia, uint64 ba, bool ra) = arena.commitOf(cid, alice);
        assertEq(ha, h);
        assertEq(ia, 1);
        assertEq(ba, 500);
        assertFalse(ra);
        (, uint32 ib, uint64 bb,) = arena.commitOf(cid, bob);
        assertEq(ib, 2);
        assertEq(bb, 500);
        (, uint32 ic, uint64 bc,) = arena.commitOf(cid, carol);
        assertEq(ic, 3);
        assertEq(bc, 777);
        assertEq(arena.getChallenge(cid).commitCount, 3);
        (, uint32 none,,) = arena.commitOf(cid, dave);
        assertEq(none, 0);
    }

    function test_Commit_OnePerAccount() public {
        vm.prank(alice);
        arena.commit(cid, bytes32(uint256(1)));
        vm.prank(alice);
        vm.expectRevert(Arena.AlreadyCommitted.selector);
        arena.commit(cid, bytes32(uint256(2)));
        (bytes32 h,,,) = arena.commitOf(cid, alice);
        assertEq(h, bytes32(uint256(1)));
    }

    function test_Commit_WindowBoundaries() public {
        vm.warp(commitEnd - 1);
        vm.prank(alice);
        arena.commit(cid, bytes32(uint256(1)));
        vm.warp(commitEnd);
        vm.prank(bob);
        vm.expectRevert(Arena.CommitPhaseClosed.selector);
        arena.commit(cid, bytes32(uint256(2)));
    }

    function test_Commit_RevertsAfterReveal() public {
        vm.warp(revealEnd + 5);
        vm.prank(bob);
        vm.expectRevert(Arena.CommitPhaseClosed.selector);
        arena.commit(cid, bytes32(uint256(2)));
    }

    // ------------------------------------------------------------ phases and views

    function test_PhaseOf_Timeline() public {
        assertEq(uint8(arena.phaseOf(cid)), uint8(Arena.Phase.Commit));
        vm.warp(commitEnd - 1);
        assertEq(uint8(arena.phaseOf(cid)), uint8(Arena.Phase.Commit));
        vm.warp(commitEnd);
        assertEq(uint8(arena.phaseOf(cid)), uint8(Arena.Phase.Reveal));
        vm.warp(revealEnd - 1);
        assertEq(uint8(arena.phaseOf(cid)), uint8(Arena.Phase.Reveal));
        vm.warp(revealEnd);
        assertEq(uint8(arena.phaseOf(cid)), uint8(Arena.Phase.Ended));
        vm.warp(revealEnd + 365 days);
        assertEq(uint8(arena.phaseOf(cid)), uint8(Arena.Phase.Ended));
        arena.finalize(cid);
        assertEq(uint8(arena.phaseOf(cid)), uint8(Arena.Phase.Finalized));
    }

    function test_UnknownIds_EveryEntryPointReverts() public {
        uint256[2] memory ids = [uint256(0), 99];
        for (uint256 i; i < ids.length; ++i) {
            bytes memory e = abi.encodeWithSelector(Arena.ChallengeNotFound.selector, ids[i]);
            vm.expectRevert(e);
            arena.getChallenge(ids[i]);
            vm.expectRevert(e);
            arena.truthTableOf(ids[i]);
            vm.expectRevert(e);
            arena.commitOf(ids[i], alice);
            vm.expectRevert(e);
            arena.bestOf(ids[i]);
            vm.expectRevert(e);
            arena.contributionOf(ids[i], alice);
            vm.expectRevert(e);
            arena.phaseOf(ids[i]);
            vm.expectRevert(e);
            arena.topUp(ids[i], 1);
            vm.expectRevert(e);
            arena.commit(ids[i], bytes32(0));
            vm.expectRevert(e);
            arena.reveal(ids[i], 1, bytes32(0));
            vm.expectRevert(e);
            arena.finalize(ids[i]);
            vm.expectRevert(e);
            arena.claimRefund(ids[i]);
        }
    }

    function test_Withdraw_RevertsWhenNothingPending() public {
        vm.prank(alice);
        vm.expectRevert(Arena.NothingToWithdraw.selector);
        arena.withdraw(token);
    }

    function test_Constants() public view {
        assertEq(arena.MAX_FEE_BPS(), 1000);
        assertEq(arena.MAX_INPUTS(), 8);
        assertEq(arena.MAX_OUTPUTS(), 8);
        assertEq(arena.EVAL_GAS_BUDGET(), 60_000_000);
    }
}
