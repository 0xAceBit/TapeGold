// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Arena} from "../Arena.sol";
import {WrapProcessor} from "./Arena.Mocks.t.sol";
import {ArenaBase} from "./Arena.Base.t.sol";

/// Attack 12: gas-bomb tables and circuits.
contract ArenaGasTest is ArenaBase {
    // ------------------------------------------------------------ tables

    function test_GasBomb_8x8TableWorks() public {
        uint8[] memory outs = _randOuts(1234, 8, 8);
        CP memory p = _p();
        p.nIn = 8;
        p.nOut = 8;
        p.table = packTruthTable(outs, 8, 8);
        assertEq(p.table.length, 256);
        uint256 id = _createP(p);
        uint256 x = _mintOn(cpu, alice, 28, outs, 8, 8); // a realistic 28-gate circuit
        _commit(id, alice, x, _salt(alice));
        _toReveal();
        uint256 g0 = gasleft();
        _reveal(id, alice, x);
        uint256 used = g0 - gasleft();
        assertLt(used, 60_000_000);
        (address w,,,) = arena.bestOf(id);
        assertEq(w, alice);
    }

    function test_GasBomb_TableOneByteTooLongOrShortRejected() public {
        CP memory p = _p();
        p.nIn = 8;
        p.nOut = 8;
        p.table = new bytes(257);
        _createExpect(p, abi.encodeWithSelector(Arena.InvalidTableLength.selector, 257, 256));
        p.table = new bytes(255);
        _createExpect(p, abi.encodeWithSelector(Arena.InvalidTableLength.selector, 255, 256));
        p.nIn = 5;
        p.nOut = 3; // 96 bits = 12 bytes
        p.table = new bytes(13);
        _createExpect(p, abi.encodeWithSelector(Arena.InvalidTableLength.selector, 13, 12));
        p.table = new bytes(11);
        _createExpect(p, abi.encodeWithSelector(Arena.InvalidTableLength.selector, 11, 12));
        p.table = new bytes(12);
        assertEq(_createP(p), 2);
    }

    // ------------------------------------------------------------ reported gate counts

    function _boundaryChallenge(uint8 nIn, uint32 gates) internal returns (uint256 id, uint256 x) {
        uint8[] memory outs = _parityOuts(nIn);
        CP memory p = _p();
        p.nIn = nIn;
        p.nOut = 1;
        p.table = packTruthTable(outs, nIn, 1);
        id = _createP(p);
        x = _mintOn(cpu, alice, gates, outs, nIn, 1);
        _commit(id, alice, x, _salt(alice));
    }

    function test_GasBomb_ExactBoundary_8Inputs() public {
        // 256 * (10_000 + 2_500 * g) <= 60_000_000  <=>  g <= 89
        (uint256 id1, uint256 ok) = _boundaryChallenge(8, 89);
        (uint256 id2, uint256 tooMuch) = _boundaryChallenge(8, 90);
        _toReveal();
        _reveal(id1, alice, ok);
        _revealExpect(
            id2, alice, tooMuch, abi.encodeWithSelector(Arena.CircuitTooExpensive.selector, uint32(90), 60_160_000)
        );
        (,,, bool revealed) = arena.commitOf(id2, alice);
        assertFalse(revealed);
    }

    function test_GasBomb_ExactBoundary_1Input() public {
        // 2 * (10_000 + 2_500 * g) <= 60_000_000  <=>  g <= 11_996 (equality allowed)
        (uint256 id1, uint256 ok) = _boundaryChallenge(1, 11_996);
        (uint256 id2, uint256 tooMuch) = _boundaryChallenge(1, 11_997);
        _toReveal();
        _reveal(id1, alice, ok);
        _revealExpect(
            id2, alice, tooMuch, abi.encodeWithSelector(Arena.CircuitTooExpensive.selector, uint32(11_997), 60_005_000)
        );
    }

    function test_GasBomb_HugeGateCountRejected() public {
        (uint256 id, uint256 x) = _boundaryChallenge(8, type(uint32).max);
        _toReveal();
        uint256 est = 256 * (10_000 + 2_500 * uint256(type(uint32).max));
        _revealExpect(id, alice, x, abi.encodeWithSelector(Arena.CircuitTooExpensive.selector, type(uint32).max, est));
    }

    // ------------------------------------------------------------ circuits that lie about their cost

    /// 4 inputs, parity. `bad` (bob, 3 gates, best score) misbehaves per `mode`; `good` (alice, 5 gates) is honest.
    function _bomb(uint8 mode) internal returns (WrapProcessor wp, uint256 id, uint256 bad, uint256 good) {
        wp = new WrapProcessor();
        reg.setCpu(address(wp), true);
        uint8[] memory outs = _parityOuts(4);
        CP memory p = _p();
        p.nIn = 4;
        p.table = packTruthTable(outs, 4, 1);
        p.proc = address(wp);
        id = _createP(p);
        bad = wp.tapeout(bob, hex"01", 4, 1, 0, 3, _bytesOf(outs));
        good = wp.tapeout(alice, hex"01", 4, 1, 0, 5, _bytesOf(outs));
        _commit(id, bob, bad, _salt(bob));
        _commit(id, alice, good, _salt(alice));
        wp.setEvalMode(bad, mode);
        _toReveal();
    }

    function _bombRound(uint8 mode) internal {
        (WrapProcessor wp, uint256 id, uint256 bad, uint256 good) = _bomb(mode);
        uint256 balBefore = token.balanceOf(address(arena));

        vm.prank(bob);
        (bool ok,) = address(arena).call{gas: 30_000_000}(abi.encodeCall(Arena.reveal, (id, bad, _salt(bob))));
        assertFalse(ok, "the bomb reveal must fail");

        // all state unchanged: commit still unrevealed, nothing recorded as best
        (, uint32 idx,, bool revealed) = arena.commitOf(id, bob);
        assertEq(idx, 1);
        assertFalse(revealed);
        (address w,,,) = arena.bestOf(id);
        assertEq(w, address(0));
        assertEq(token.balanceOf(address(arena)), balBefore);

        // honest reveal is unaffected
        _reveal(id, alice, good);
        (w,,,) = arena.bestOf(id);
        assertEq(w, alice);

        // the bad circuit was not marked used: once it behaves, the same commit can still be revealed
        wp.setEvalMode(bad, 0);
        _reveal(id, bob, bad);
        (w,,,) = arena.bestOf(id);
        assertEq(w, bob);

        _toEnd();
        arena.finalize(id);
        assertEq(arena.pendingOf(token, bob), PRIZE - (PRIZE * FEE) / 10_000);
    }

    function test_GasBomb_EvalThatSpinsForeverFailsOnlyForItsRevealer() public {
        _bombRound(1);
    }

    function test_GasBomb_EvalThatBurnsNearlyAllGasFailsOnlyForItsRevealer() public {
        _bombRound(2);
    }

    function test_GasBomb_EvalReturningHugeBlobFailsOnlyForItsRevealer() public {
        _bombRound(3);
    }

    function test_GasBomb_BombDoesNotBlockFinalize() public {
        (, uint256 id,, uint256 good) = _bomb(1);
        vm.prank(bob);
        (bool ok,) = address(arena).call{gas: 30_000_000}(abi.encodeCall(Arena.reveal, (id, 1, _salt(bob))));
        assertFalse(ok);
        _reveal(id, alice, good);
        _toEnd();
        arena.finalize(id);
        assertEq(arena.pendingOf(token, alice), PRIZE - (PRIZE * FEE) / 10_000);
    }
}
