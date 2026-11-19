// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {TapeGolf} from "../TapeGolf.sol";
import {TapeGolfBase, ReentrantToken, ReentrantCircuits} from "./TapeGolf.Base.t.sol";

/// Reentrancy through a malicious token (during escrow and payout) and a malicious circuits contract.
contract TapeGolfSecurityTest is TapeGolfBase {
    bytes32 internal constant SALT = keccak256("salt");
    uint256 internal constant WIN_AMT = PRIZE - PRIZE * 250 / 10_000;

    uint256 internal constant COMMIT = 0;
    uint256 internal constant REVEAL = 1;
    uint256 internal constant SETTLE = 2;
    uint256 internal constant CLAIM = 3;
    uint256 internal constant SETTLE_AND_PAY = 4;
    uint256 internal constant CREATE = 5;

    ReentrantToken internal rt;
    uint256 internal c2;

    function _attack(uint256 kind, uint256 c, IERC20 t) internal view returns (bytes memory) {
        if (kind == COMMIT) return abi.encodeCall(TapeGolf.commit, (c, bytes32(uint256(1))));
        if (kind == REVEAL) return abi.encodeCall(TapeGolf.reveal, (c, address(cpu), 1, SALT));
        if (kind == SETTLE) return abi.encodeCall(TapeGolf.settle, (c));
        if (kind == CLAIM) return abi.encodeCall(TapeGolf.claim, (t, alice));
        if (kind == SETTLE_AND_PAY) return abi.encodeCall(TapeGolf.settleAndPay, (c));
        return abi.encodeCall(TapeGolf.createContest, (_params(t)));
    }

    function _assertBlocked(ReentrantToken t) internal view {
        assertTrue(t.attempted(), "token hook never ran");
        assertFalse(t.lastOk(), "re-entrant call succeeded");
        assertEq(bytes4(t.lastRet()), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
    }

    /// Contest on the re-entrant token, alice wins and the contest is settled (credits only).
    function _settledOnReentrantToken() internal {
        rt = new ReentrantToken();
        _fund(rt, golf);
        c2 = _create(_params(rt));
        uint256 id = _enter(c2, alice, 2, 0, SALT);
        _toReveal();
        _reveal(c2, alice, address(cpu), id, SALT);
        _toEnd();
        golf.settle(c2);
    }

    function _payoutReentry(uint256 kind) internal {
        _settledOnReentrantToken();
        rt.arm(address(golf), _attack(kind, c2, rt));
        golf.claim(rt, alice);
        _assertBlocked(rt);
        assertEq(rt.balanceOf(alice), WIN_AMT, "outer claim still pays exactly once");
        assertEq(golf.pendingOf(rt, alice), 0);
    }

    function test_Reentrancy_ClaimPayoutCannotReenterCommit() public { _payoutReentry(COMMIT); }
    function test_Reentrancy_ClaimPayoutCannotReenterReveal() public { _payoutReentry(REVEAL); }
    function test_Reentrancy_ClaimPayoutCannotReenterSettle() public { _payoutReentry(SETTLE); }
    function test_Reentrancy_ClaimPayoutCannotReenterClaim() public { _payoutReentry(CLAIM); }
    function test_Reentrancy_ClaimPayoutCannotReenterSettleAndPay() public { _payoutReentry(SETTLE_AND_PAY); }
    function test_Reentrancy_ClaimPayoutCannotReenterCreate() public { _payoutReentry(CREATE); }

    function test_Reentrancy_SettleAndPayPayoutCannotReenterClaim() public {
        rt = new ReentrantToken();
        _fund(rt, golf);
        c2 = _create(_params(rt));
        uint256 id = _enter(c2, alice, 2, 0, SALT);
        _toReveal();
        _reveal(c2, alice, address(cpu), id, SALT);
        _toEnd();
        rt.arm(address(golf), _attack(CLAIM, c2, rt));
        golf.settleAndPay(c2);
        _assertBlocked(rt);
        assertEq(rt.balanceOf(alice), WIN_AMT);
        assertEq(golf.pendingOf(rt, alice), 0);
    }

    function _escrowReentry(uint256 kind) internal {
        rt = new ReentrantToken();
        _fund(rt, golf);
        // contest 2 exists so id-based attacks target something real
        c2 = _create(_params(rt));
        rt.arm(address(golf), _attack(kind, c2, rt));
        uint256 c3 = _create(_params(rt)); // transferFrom into the escrow triggers the hook
        _assertBlocked(rt);
        assertEq(c3, 3);
        assertEq(rt.balanceOf(address(golf)), 2 * PRIZE);
    }

    function test_Reentrancy_EscrowTransferCannotReenterCommit() public { _escrowReentry(COMMIT); }
    function test_Reentrancy_EscrowTransferCannotReenterCreate() public { _escrowReentry(CREATE); }
    function test_Reentrancy_EscrowTransferCannotReenterSettle() public { _escrowReentry(SETTLE); }
    function test_Reentrancy_EscrowTransferCannotReenterClaim() public { _escrowReentry(CLAIM); }

    // ------------------------------------------------------------ malicious circuits

    function _circuitsReentry(uint256 kind) internal {
        ReentrantCircuits rc = new ReentrantCircuits();
        reg.setCpu(address(rc), true);
        bytes memory nl = _padded(2, 0);
        uint256 id = rc.tapeout(alice, nl, 2, 1, 0, 2, AND_TABLE);
        _commit(cid, alice, nl, SALT);
        bytes memory data = _attack(kind, cid, token);
        rc.setAttack(address(golf), data);
        _toReveal();
        vm.expectCall(address(golf), data);
        _reveal(cid, alice, address(rc), id, SALT); // reverts "reentered" if any re-entry had succeeded
        (address d,,,,) = golf.leaderOf(cid);
        assertEq(d, alice);
    }

    function test_Reentrancy_CircuitsCannotReenterCommit() public { _circuitsReentry(COMMIT); }
    function test_Reentrancy_CircuitsCannotReenterReveal() public { _circuitsReentry(REVEAL); }
    function test_Reentrancy_CircuitsCannotReenterSettle() public { _circuitsReentry(SETTLE); }
    function test_Reentrancy_CircuitsCannotReenterClaim() public { _circuitsReentry(CLAIM); }
    function test_Reentrancy_CircuitsCannotReenterSettleAndPay() public { _circuitsReentry(SETTLE_AND_PAY); }
    function test_Reentrancy_CircuitsCannotReenterCreate() public { _circuitsReentry(CREATE); }
}
