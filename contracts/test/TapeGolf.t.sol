// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TapeGolf} from "../TapeGolf.sol";
import {IProcessorRegistry} from "../interfaces/ITapeOutLite.sol";
import {FeeOnTransferERC20} from "../mocks/FeeOnTransferERC20.sol";
import {TapeGolfBase} from "./TapeGolf.Base.t.sol";

/// Deployment, createContest validation, commit and read-only getters.
contract TapeGolfCreateCommitTest is TapeGolfBase {
    bytes32 internal constant SALT = keccak256("salt");

    // ------------------------------------------------------------ constructor

    function test_Constructor_StoresConfig() public view {
        assertEq(address(golf.registry()), address(reg));
        assertEq(golf.feeRecipient(), feeRecipient);
        assertEq(golf.feeBps(), FEE);
    }

    function test_Constructor_AllowsFeeBounds() public {
        TapeGolf g0 = new TapeGolf(IProcessorRegistry(address(reg)), feeRecipient, 0);
        TapeGolf g5 = new TapeGolf(IProcessorRegistry(address(reg)), feeRecipient, 500);
        assertEq(g0.feeBps(), 0);
        assertEq(g5.feeBps(), 500);
    }

    function test_Constructor_RevertsFeeTooHigh() public {
        vm.expectRevert(abi.encodeWithSelector(TapeGolf.FeeTooHigh.selector, uint16(501)));
        new TapeGolf(IProcessorRegistry(address(reg)), feeRecipient, 501);
    }

    function test_Constructor_RevertsZeroRegistry() public {
        vm.expectRevert(TapeGolf.ZeroRegistry.selector);
        new TapeGolf(IProcessorRegistry(address(0)), feeRecipient, 0);
    }

    function test_Constructor_RevertsZeroFeeRecipient() public {
        vm.expectRevert(TapeGolf.ZeroFeeRecipient.selector);
        new TapeGolf(IProcessorRegistry(address(reg)), address(0), 0);
    }

    // ------------------------------------------------------------ createContest

    function test_Create_StoresContestAndEscrowsPrize() public {
        uint256 sponsorBefore = token.balanceOf(sponsor);
        TapeGolf.CreateParams memory p = _params(token);
        vm.expectEmit(true, true, true, true, address(golf));
        emit TapeGolf.ContestCreated(2, sponsor, token, PRIZE, address(0), commitDeadline, revealDeadline);
        uint256 id = _create(p);

        assertEq(id, 2);
        assertEq(golf.contestCount(), 2);
        TapeGolf.Contest memory c = golf.getContest(id);
        assertEq(c.sponsor, sponsor);
        assertEq(address(c.token), address(token));
        assertEq(c.prize, PRIZE);
        assertEq(c.processor, address(0));
        assertEq(c.nIn, 2);
        assertEq(c.nOut, 1);
        assertEq(c.maxGates, 20);
        assertEq(c.maxNetlistBytes, 512);
        assertEq(c.commitDeadline, commitDeadline);
        assertEq(c.revealDeadline, revealDeadline);
        assertEq(c.commitCount, 0);
        assertFalse(c.settled);
        assertEq(golf.expectedOf(id), AND_TABLE);
        assertEq(token.balanceOf(sponsor), sponsorBefore - PRIZE);
        assertEq(token.balanceOf(address(golf)), 2 * PRIZE);
        assertEq(uint8(golf.phaseOf(id)), uint8(TapeGolf.Phase.Commit));
    }

    function _expectCreateRevert(bytes memory err, TapeGolf.CreateParams memory p) internal {
        vm.prank(sponsor);
        vm.expectRevert(err);
        golf.createContest(p);
    }

    function test_Create_RevertsInvalidInputs() public {
        TapeGolf.CreateParams memory p = _params(token);
        p.nIn = 0;
        _expectCreateRevert(abi.encodeWithSelector(TapeGolf.InvalidInputs.selector, uint8(0)), p);
        p.nIn = 9;
        _expectCreateRevert(abi.encodeWithSelector(TapeGolf.InvalidInputs.selector, uint8(9)), p);
    }

    function test_Create_RevertsInvalidOutputs() public {
        TapeGolf.CreateParams memory p = _params(token);
        p.nOut = 0;
        _expectCreateRevert(abi.encodeWithSelector(TapeGolf.InvalidOutputs.selector, uint8(0)), p);
        p.nOut = 9;
        _expectCreateRevert(abi.encodeWithSelector(TapeGolf.InvalidOutputs.selector, uint8(9)), p);
    }

    function test_Create_RevertsInvalidExpectedLength() public {
        TapeGolf.CreateParams memory p = _params(token);
        p.expected = hex"000000";
        _expectCreateRevert(abi.encodeWithSelector(TapeGolf.InvalidExpectedLength.selector, 3, 4), p);
        p.expected = hex"0000000000";
        _expectCreateRevert(abi.encodeWithSelector(TapeGolf.InvalidExpectedLength.selector, 5, 4), p);
    }

    function test_Create_RevertsExpectedByteAboveNOut() public {
        TapeGolf.CreateParams memory p = _params(token);
        p.expected = hex"00000002"; // nOut = 1 -> only bit 0 allowed
        _expectCreateRevert(abi.encodeWithSelector(TapeGolf.InvalidExpectedByte.selector, 3, uint8(2)), p);
    }

    function test_Create_AllowsFullWidthOutputs() public {
        TapeGolf.CreateParams memory p = _params(token);
        p.nOut = 8;
        p.expected = hex"00ff0f80";
        uint256 id = _create(p);
        assertEq(golf.expectedOf(id), hex"00ff0f80");
    }

    function test_Create_RevertsZeroPrize() public {
        TapeGolf.CreateParams memory p = _params(token);
        p.prize = 0;
        _expectCreateRevert(abi.encodeWithSelector(TapeGolf.ZeroPrize.selector), p);
    }

    function test_Create_RevertsTokenHasNoCode() public {
        TapeGolf.CreateParams memory p = _params(IERC20(address(0xBEEF)));
        _expectCreateRevert(abi.encodeWithSelector(TapeGolf.TokenHasNoCode.selector, address(0xBEEF)), p);
    }

    function test_Create_RevertsInvalidMaxGates() public {
        TapeGolf.CreateParams memory p = _params(token);
        p.maxGates = 0;
        _expectCreateRevert(abi.encodeWithSelector(TapeGolf.InvalidMaxGates.selector), p);
    }

    function test_Create_MaxNetlistBytesBounds() public {
        TapeGolf.CreateParams memory p = _params(token);
        p.maxNetlistBytes = 6;
        _expectCreateRevert(abi.encodeWithSelector(TapeGolf.InvalidMaxNetlistBytes.selector, uint32(6)), p);
        p.maxNetlistBytes = 4097;
        _expectCreateRevert(abi.encodeWithSelector(TapeGolf.InvalidMaxNetlistBytes.selector, uint32(4097)), p);
        p.maxNetlistBytes = 7;
        _create(p);
        p.maxNetlistBytes = 4096;
        _create(p);
    }

    function test_Create_EvaluationBudgetBoundary_8Inputs() public {
        TapeGolf.CreateParams memory p = _params(token);
        p.nIn = 8;
        p.expected = new bytes(256);
        p.maxNetlistBytes = 4096;
        p.maxGates = 89; // 256 * (10_000 + 2_500 * 89) = 59_520_000 <= 60M
        _create(p);
        p.maxGates = 90; // 256 * 235_000 = 60_160_000 > 60M
        _expectCreateRevert(abi.encodeWithSelector(TapeGolf.EvaluationBudgetExceeded.selector, 60_160_000), p);
    }

    function test_Create_EvaluationBudgetExactlyAtLimitAccepted() public {
        TapeGolf.CreateParams memory p = _params(token);
        p.nIn = 1;
        p.expected = new bytes(2);
        p.maxGates = 11_996; // 2 * (10_000 + 2_500 * 11_996) == 60_000_000 exactly
        _create(p);
        p.maxGates = 11_997;
        _expectCreateRevert(abi.encodeWithSelector(TapeGolf.EvaluationBudgetExceeded.selector, 60_005_000), p);
    }

    function test_Create_CommitDeadlineBoundary() public {
        TapeGolf.CreateParams memory p = _params(token);
        p.commitDeadline = uint64(block.timestamp + 1 hours - 1);
        p.revealDeadline = p.commitDeadline + 1 days;
        _expectCreateRevert(abi.encodeWithSelector(TapeGolf.InvalidCommitDeadline.selector), p);
        p.commitDeadline = uint64(block.timestamp + 1 hours);
        p.revealDeadline = p.commitDeadline + 1 hours;
        _create(p);
    }

    function test_Create_RevealDeadlineBoundary() public {
        TapeGolf.CreateParams memory p = _params(token);
        p.revealDeadline = p.commitDeadline + 1 hours - 1;
        _expectCreateRevert(abi.encodeWithSelector(TapeGolf.InvalidRevealDeadline.selector), p);
        p.revealDeadline = p.commitDeadline + 1 hours;
        _create(p);
    }

    function test_Create_RevertsUnregisteredProcessor() public {
        TapeGolf.CreateParams memory p = _params(token);
        p.processor = address(evil);
        _expectCreateRevert(abi.encodeWithSelector(TapeGolf.UnregisteredProcessor.selector, address(evil)), p);
        p.processor = address(cpu);
        uint256 id = _create(p);
        assertEq(golf.getContest(id).processor, address(cpu));
    }

    function test_Create_RevertsFeeOnTransferPrize() public {
        FeeOnTransferERC20 fot = new FeeOnTransferERC20();
        _fund(fot, golf);
        TapeGolf.CreateParams memory p = _params(fot);
        _expectCreateRevert(
            abi.encodeWithSelector(TapeGolf.IncorrectPrizeReceived.selector, PRIZE, PRIZE - PRIZE / 100), p
        );
        assertEq(golf.contestCount(), 1);
    }

    function test_Create_RevertsWithoutAllowance() public {
        vm.prank(sponsor);
        token.approve(address(golf), 0);
        vm.prank(sponsor);
        vm.expectRevert();
        golf.createContest(_params(token));
    }

    // ------------------------------------------------------------ commit

    function test_Commit_RecordsOrderAndEmits() public {
        bytes32 h1 = keccak256("one");
        bytes32 h2 = keccak256("two");
        vm.expectEmit(true, true, false, true, address(golf));
        emit TapeGolf.Committed(cid, alice, h1, 1);
        vm.prank(alice);
        golf.commit(cid, h1);
        vm.prank(bob);
        golf.commit(cid, h2);

        (bytes32 c1, uint32 o1, bool r1) = golf.commitOf(cid, alice);
        (bytes32 c2, uint32 o2, bool r2) = golf.commitOf(cid, bob);
        assertEq(c1, h1);
        assertEq(o1, 1);
        assertFalse(r1);
        assertEq(c2, h2);
        assertEq(o2, 2);
        assertFalse(r2);
        assertEq(golf.getContest(cid).commitCount, 2);
    }

    function test_Commit_LastSecondOkThenClosed() public {
        vm.warp(commitDeadline - 1);
        vm.prank(alice);
        golf.commit(cid, bytes32(uint256(1)));
        vm.warp(commitDeadline);
        vm.prank(bob);
        vm.expectRevert(TapeGolf.CommitPhaseClosed.selector);
        golf.commit(cid, bytes32(uint256(2)));
    }

    function test_Commit_RevertsAlreadyCommitted() public {
        vm.prank(alice);
        golf.commit(cid, bytes32(uint256(1)));
        vm.prank(alice);
        vm.expectRevert(TapeGolf.AlreadyCommitted.selector);
        golf.commit(cid, bytes32(uint256(2)));
    }

    function test_Commit_RevertsUnknownContest() public {
        vm.expectRevert(abi.encodeWithSelector(TapeGolf.ContestNotFound.selector, 0));
        golf.commit(0, bytes32(0));
        vm.expectRevert(abi.encodeWithSelector(TapeGolf.ContestNotFound.selector, 99));
        golf.commit(99, bytes32(0));
    }

    function test_Views_RevertUnknownContest() public {
        vm.expectRevert(abi.encodeWithSelector(TapeGolf.ContestNotFound.selector, 5));
        golf.getContest(5);
        vm.expectRevert(abi.encodeWithSelector(TapeGolf.ContestNotFound.selector, 5));
        golf.expectedOf(5);
        vm.expectRevert(abi.encodeWithSelector(TapeGolf.ContestNotFound.selector, 5));
        golf.commitOf(5, alice);
        vm.expectRevert(abi.encodeWithSelector(TapeGolf.ContestNotFound.selector, 5));
        golf.leaderOf(5);
        vm.expectRevert(abi.encodeWithSelector(TapeGolf.ContestNotFound.selector, 5));
        golf.phaseOf(5);
    }

    function test_PhaseOf_FollowsTimeline() public {
        assertEq(uint8(golf.phaseOf(cid)), uint8(TapeGolf.Phase.Commit));
        vm.warp(commitDeadline - 1);
        assertEq(uint8(golf.phaseOf(cid)), uint8(TapeGolf.Phase.Commit));
        vm.warp(commitDeadline);
        assertEq(uint8(golf.phaseOf(cid)), uint8(TapeGolf.Phase.Reveal));
        vm.warp(revealDeadline - 1);
        assertEq(uint8(golf.phaseOf(cid)), uint8(TapeGolf.Phase.Reveal));
        vm.warp(revealDeadline);
        assertEq(uint8(golf.phaseOf(cid)), uint8(TapeGolf.Phase.Ended));
        golf.settle(cid);
        assertEq(uint8(golf.phaseOf(cid)), uint8(TapeGolf.Phase.Settled));
    }

    function test_CommitmentOf_BindsAllInputs() public view {
        bytes32 base = golf.commitmentOf(cid, alice, keccak256("n"), SALT);
        assertEq(base, keccak256(abi.encode(address(golf), block.chainid, cid, alice, keccak256("n"), SALT)));
        assertTrue(base != golf.commitmentOf(cid + 1, alice, keccak256("n"), SALT));
        assertTrue(base != golf.commitmentOf(cid, bob, keccak256("n"), SALT));
        assertTrue(base != golf.commitmentOf(cid, alice, keccak256("m"), SALT));
        assertTrue(base != golf.commitmentOf(cid, alice, keccak256("n"), bytes32(0)));
    }
}
