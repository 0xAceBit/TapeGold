// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Arena} from "../Arena.sol";
import {ReentrantToken, HookERC20, HookRecipient, WrapProcessor} from "./Arena.Mocks.t.sol";
import {ArenaBase} from "./Arena.Base.t.sol";

/// Attack 8: reentrancy through a malicious token, a malicious receiver and a malicious processor.
contract ArenaReentrancyTest is ArenaBase {
    ReentrantToken internal rt;
    uint256 internal rid;

    function setUp() public override {
        super.setUp();
        rt = new ReentrantToken();
        _fund(rt, arena);
        rid = _createAnd(rt, PRIZE);
    }

    bytes4 internal immutable GUARD = ReentrancyGuard.ReentrancyGuardReentrantCall.selector;

    function _attacks(IERC20 t, uint256 id) internal view returns (bytes[] memory a) {
        a = new bytes[](7);
        a[0] = abi.encodeCall(Arena.createChallenge, (t, 1e6, 2, 1, hex"08", commitEnd, revealEnd, address(cpu)));
        a[1] = abi.encodeCall(Arena.topUp, (id, 1));
        a[2] = abi.encodeCall(Arena.commit, (id, bytes32(uint256(1))));
        a[3] = abi.encodeCall(Arena.reveal, (id, 1, bytes32(0)));
        a[4] = abi.encodeCall(Arena.finalize, (id));
        a[5] = abi.encodeCall(Arena.claimRefund, (id));
        a[6] = abi.encodeCall(Arena.withdraw, (t));
    }

    function _assertGuarded() internal view {
        assertTrue(rt.attempted(), "token did not attempt the attack");
        assertFalse(rt.lastOk(), "reentrant call succeeded");
        assertEq(bytes4(rt.lastRet()), GUARD);
    }

    // ------------------------------------------------------------ malicious token: from transferFrom

    function test_Reentrancy_FromTransferFrom_InCreateChallenge() public {
        bytes[] memory a = _attacks(rt, rid);
        for (uint256 i; i < a.length; ++i) {
            uint256 snap = vm.snapshotState();
            rt.arm(address(arena), a[i]);
            vm.prank(sponsor);
            uint256 id = arena.createChallenge(rt, 10e6, 2, 1, hex"08", commitEnd, revealEnd, address(cpu));
            _assertGuarded();
            assertEq(id, 3, "exactly one challenge was created");
            assertEq(arena.challengeCount(), 3);
            assertEq(rt.balanceOf(address(arena)), PRIZE + 10e6);
            assertEq(arena.getChallenge(id).pot, 10e6);
            assertEq(arena.getChallenge(rid).pot, PRIZE);
            vm.revertToState(snap);
        }
    }

    function test_Reentrancy_FromTransferFrom_InTopUp() public {
        bytes[] memory a = _attacks(rt, rid);
        for (uint256 i; i < a.length; ++i) {
            uint256 snap = vm.snapshotState();
            rt.arm(address(arena), a[i]);
            vm.prank(alice);
            arena.topUp(rid, 10e6);
            _assertGuarded();
            assertEq(arena.getChallenge(rid).pot, PRIZE + 10e6);
            assertEq(arena.contributionOf(rid, alice), 10e6);
            assertEq(rt.balanceOf(address(arena)), PRIZE + 10e6);
            vm.revertToState(snap);
        }
    }

    // ------------------------------------------------------------ malicious token: from transfer (withdraw)

    function test_Reentrancy_FromTransfer_InWithdraw() public {
        uint256 x = _enter(rid, alice, 3);
        _toReveal();
        _reveal(rid, alice, x);
        _toEnd();
        arena.finalize(rid);
        uint256 fee = (PRIZE * FEE) / 10_000;
        bytes[] memory a = _attacks(rt, rid);
        for (uint256 i; i < a.length; ++i) {
            uint256 snap = vm.snapshotState();
            rt.arm(address(arena), a[i]);
            vm.prank(alice);
            arena.withdraw(rt);
            _assertGuarded();
            assertEq(rt.balanceOf(alice), 1e15 + PRIZE - fee, "alice paid exactly once");
            assertEq(rt.balanceOf(address(arena)), fee, "only the fee is left");
            assertEq(arena.pendingOf(rt, alice), 0);
            assertEq(arena.pendingOf(rt, feeRecipient), fee);
            vm.revertToState(snap);
        }
    }

    // ------------------------------------------------------------ malicious receiver (token hook -> recipient)

    function test_Reentrancy_MaliciousReceiverHookReentersEveryEntryPoint() public {
        HookERC20 ht = new HookERC20();
        _fund(ht, arena);
        uint256 id = _createAnd(ht, PRIZE);
        HookRecipient r = new HookRecipient();
        uint256 x = _mintAnd(address(r), 3);
        bytes32 salt = bytes32(uint256(9));
        r.exec(address(arena), abi.encodeCall(Arena.commit, (id, arena.commitHashOf(x, salt, address(r)))));
        _toReveal();
        r.exec(address(arena), abi.encodeCall(Arena.reveal, (id, x, salt)));
        _toEnd();
        arena.finalize(id);
        ht.setHooked(address(r), true);
        uint256 fee = (PRIZE * FEE) / 10_000;
        uint256 payout = PRIZE - fee;

        bytes[] memory a = _attacks(ht, id);
        for (uint256 i; i < a.length; ++i) {
            uint256 snap = vm.snapshotState();
            r.configure(1, address(arena), a[i]);
            r.exec(address(arena), abi.encodeCall(Arena.withdraw, (ht)));
            assertTrue(r.attempted(), "hook did not run");
            assertFalse(r.lastOk(), "reentrant call succeeded");
            assertEq(bytes4(r.lastRet()), GUARD);
            assertEq(ht.balanceOf(address(r)), payout);
            assertEq(ht.balanceOf(address(arena)), fee, "only the fee is left");
            assertEq(arena.pendingOf(ht, address(r)), 0);
            vm.revertToState(snap);
        }
    }

    function test_Reentrancy_ReentersWithdrawFromOwnHookCannotDoubleSpend() public {
        // Other users' funds sit in the same token; a re-entrant withdraw must not reach them.
        HookERC20 ht = new HookERC20();
        _fund(ht, arena);
        uint256 id = _createAnd(ht, PRIZE);
        uint256 id2 = _createAnd(ht, PRIZE);
        HookRecipient r = new HookRecipient();
        uint256 x = _mintAnd(address(r), 3);
        bytes32 salt = bytes32(uint256(9));
        r.exec(address(arena), abi.encodeCall(Arena.commit, (id, arena.commitHashOf(x, salt, address(r)))));
        _toReveal();
        r.exec(address(arena), abi.encodeCall(Arena.reveal, (id, x, salt)));
        _toEnd();
        arena.finalize(id);
        arena.finalize(id2);
        ht.setHooked(address(r), true);
        r.configure(1, address(arena), abi.encodeCall(Arena.withdraw, (ht)));
        r.exec(address(arena), abi.encodeCall(Arena.withdraw, (ht)));
        assertEq(ht.balanceOf(address(r)), PRIZE - (PRIZE * FEE) / 10_000);
        assertEq(ht.balanceOf(address(arena)), PRIZE + (PRIZE * FEE) / 10_000, "sponsor refund + fee untouched");
    }

    // ------------------------------------------------------------ malicious processor

    function _wrapChallenge() internal returns (WrapProcessor wp, uint256 id, uint256 x) {
        wp = new WrapProcessor();
        reg.setCpu(address(wp), true);
        CP memory p = _p();
        p.proc = address(wp);
        id = _createP(p);
        x = wp.tapeout(alice, hex"01", 2, 1, 0, 3, _bytesOf(_andOuts()));
        _commit(id, alice, x, _salt(alice));
        _toReveal();
    }

    function test_Reentrancy_MaliciousProcessorReadsReenterEveryEntryPoint() public {
        (WrapProcessor wp, uint256 id, uint256 x) = _wrapChallenge();
        bytes[] memory a = _attacks(token, id);
        uint8[3] memory masks = [1, 2, 4]; // eval, ownerOf, circuitInfo
        uint256 bal = token.balanceOf(address(arena));
        for (uint256 i; i < a.length; ++i) {
            for (uint256 k; k < masks.length; ++k) {
                uint256 snap = vm.snapshotState();
                wp.setAttack(address(arena), a[i], masks[k], true);
                vm.prank(alice);
                vm.expectRevert(GUARD);
                arena.reveal(id, x, _salt(alice));
                (,,, bool revealed) = arena.commitOf(id, alice);
                assertFalse(revealed);
                assertEq(token.balanceOf(address(arena)), bal);
                vm.revertToState(snap);
            }
        }
    }

    function test_Reentrancy_MaliciousProcessorSwallowedAttemptChangesNothing() public {
        (WrapProcessor wp, uint256 id, uint256 x) = _wrapChallenge();
        bytes[] memory a = _attacks(token, id);
        for (uint256 i; i < a.length; ++i) {
            uint256 snap = vm.snapshotState();
            wp.setAttack(address(arena), a[i], 7, false); // attempts, swallows the failure, answers honestly
            vm.expectCall(address(arena), a[i]);
            _reveal(id, alice, x);
            (address w,, uint32 s,) = arena.bestOf(id);
            assertEq(w, alice);
            assertEq(s, 3);
            assertEq(arena.getChallenge(id).pot, PRIZE);
            assertEq(arena.challengeCount(), 3);
            vm.revertToState(snap);
        }
    }
}
