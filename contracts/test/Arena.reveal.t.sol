// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Arena} from "../Arena.sol";
import {IProcessorRegistry} from "../interfaces/ITapeOutLite.sol";
import {MockCircuits} from "../mocks/MockCircuits.sol";
import {WrapProcessor} from "./Arena.Mocks.t.sol";
import {ArenaBase} from "./Arena.Base.t.sol";

/// Unit tests: reveal, leader selection, finalize and withdraw.
contract ArenaRevealTest is ArenaBase {
    // ------------------------------------------------------------ reveal happy paths

    function test_Reveal_HappyPath() public {
        uint256 circuitId = _enter(cid, alice, 5);
        _toReveal();
        vm.expectEmit(true, true, true, true, address(arena));
        emit Arena.Revealed(cid, alice, circuitId, 5, 1, 100, true);
        _reveal(cid, alice, circuitId);

        (,,, bool revealed) = arena.commitOf(cid, alice);
        assertTrue(revealed);
        (address w, uint256 c, uint32 s, uint32 idx) = arena.bestOf(cid);
        assertEq(w, alice);
        assertEq(c, circuitId);
        assertEq(s, 5);
        assertEq(idx, 1);
    }

    function test_Reveal_EveryTableSize1x1To8x8() public {
        uint256[65] memory ids;
        uint256[65] memory circuits;
        for (uint8 nIn = 1; nIn <= 8; ++nIn) {
            for (uint8 nOut = 1; nOut <= 8; ++nOut) {
                uint8[] memory outs = _randOuts(uint256(nIn) * 16 + nOut, nIn, nOut);
                CP memory p = _p();
                p.nIn = nIn;
                p.nOut = nOut;
                p.table = packTruthTable(outs, nIn, nOut);
                uint256 k = uint256(nIn - 1) * 8 + nOut;
                ids[k] = _createP(p);
                assertEq(arena.truthTableOf(ids[k]), p.table);
                // the circuit also drives junk on bits above nOut; Arena must mask them away
                uint8 m = nOut == 8 ? 255 : uint8((1 << nOut) - 1);
                uint8[] memory circ = new uint8[](outs.length);
                for (uint256 v; v < outs.length; ++v) {
                    circ[v] = outs[v] | (uint8(uint256(keccak256(abi.encode("junk", v)))) & ~m);
                }
                circuits[k] = _mintOn(cpu, alice, 7, circ, nIn, nOut);
                _commit(ids[k], alice, circuits[k], _salt(alice));
            }
        }
        _toReveal();
        for (uint256 k = 1; k <= 64; ++k) {
            _reveal(ids[k], alice, circuits[k]);
            (address w,, uint32 s,) = arena.bestOf(ids[k]);
            assertEq(w, alice);
            assertEq(s, 7);
        }
    }

    function test_Reveal_MultiOutputPacking() public {
        uint8[] memory outs = new uint8[](4);
        outs[0] = 5; // 101
        outs[1] = 2; // 010
        outs[2] = 7; // 111
        outs[3] = 0;
        // p = v*3+j: set bits 0,2 | 4 | 6,7,8 -> byte0 = 0xD5, byte1 = 0x01
        assertEq(packTruthTable(outs, 2, 3), hex"d501");
        CP memory p = _p();
        p.nOut = 3;
        p.table = hex"d501";
        uint256 id = _createP(p);
        uint256 circuitId = _mintOn(cpu, alice, 4, outs, 2, 3);
        _commit(id, alice, circuitId, _salt(alice));
        _toReveal();
        _reveal(id, alice, circuitId);
        (address w,,,) = arena.bestOf(id);
        assertEq(w, alice);
    }

    function _copy(uint8[] memory a) internal pure returns (uint8[] memory b) {
        b = new uint8[](a.length);
        for (uint256 i; i < a.length; ++i) {
            b[i] = a[i];
        }
    }

    function test_Reveal_MismatchReportsVectorAndBits() public {
        uint8[] memory outs = new uint8[](4);
        outs[0] = 5;
        outs[1] = 2;
        outs[2] = 7;
        CP memory p = _p();
        p.nOut = 3;
        p.table = packTruthTable(outs, 2, 3);
        uint256 id = _createP(p);
        uint8[] memory bad = _copy(outs);
        bad[2] = 6;
        uint256 badId = _mintOn(cpu, bob, 4, bad, 2, 3);
        _commit(id, bob, badId, _salt(bob));
        _toReveal();
        _revealExpect(id, bob, badId, abi.encodeWithSelector(Arena.TruthTableMismatch.selector, 2, 6, 7));
        (,,, bool revealed) = arena.commitOf(id, bob);
        assertFalse(revealed);
    }

    function test_Reveal_Output8MaskPath() public {
        uint8[] memory outs = new uint8[](2);
        outs[0] = 0xFF;
        outs[1] = 0xA5;
        CP memory p = _p();
        p.nIn = 1;
        p.nOut = 8;
        p.table = hex"ffa5";
        uint256 id = _createP(p);
        uint256 good = _mintOn(cpu, alice, 2, outs, 1, 8);
        outs[1] = 0xA4; // high bit pattern differs only in bit 0
        uint256 bad = _mintOn(cpu, bob, 2, outs, 1, 8);
        _commit(id, alice, good, _salt(alice));
        _commit(id, bob, bad, _salt(bob));
        _toReveal();
        _revealExpect(id, bob, bad, abi.encodeWithSelector(Arena.TruthTableMismatch.selector, 1, 0xA4, 0xA5));
        _reveal(id, alice, good);
    }

    function testFuzz_Reveal_SingleBitFlipRejected(uint8 nIn, uint8 nOut, uint256 seed, uint256 row, uint8 bit) public {
        nIn = uint8(bound(nIn, 1, 8));
        nOut = uint8(bound(nOut, 1, 8));
        row = bound(row, 0, (uint256(1) << nIn) - 1);
        bit = uint8(bound(bit, 0, nOut - 1));
        uint8[] memory outs = _randOuts(seed, nIn, nOut);
        CP memory p = _p();
        p.nIn = nIn;
        p.nOut = nOut;
        p.table = packTruthTable(outs, nIn, nOut);
        uint256 id = _createP(p);
        uint8 want = outs[row];
        outs[row] = want ^ uint8(1 << bit);
        uint256 circuitId = _mintOn(cpu, alice, 3, outs, nIn, nOut);
        _commit(id, alice, circuitId, _salt(alice));
        _toReveal();
        _revealExpect(id, alice, circuitId, abi.encodeWithSelector(Arena.TruthTableMismatch.selector, row, outs[row], want));
    }

    // ------------------------------------------------------------ reveal reverts

    function test_Reveal_RevertsOutsideWindow() public {
        uint256 circuitId = _enter(cid, alice, 3);
        vm.warp(commitEnd - 1);
        _revealExpect(cid, alice, circuitId, _err(Arena.NotRevealPhase.selector));
        vm.warp(commitEnd);
        _reveal(cid, alice, circuitId);
    }

    function test_Reveal_BoundaryAtRevealEnd() public {
        uint256 a = _enter(cid, alice, 3);
        uint256 b = _enter(cid, bob, 3);
        vm.warp(revealEnd - 1);
        _reveal(cid, alice, a); // last valid second
        vm.warp(revealEnd);
        _revealExpect(cid, bob, b, _err(Arena.NotRevealPhase.selector));
        vm.warp(revealEnd + 1);
        _revealExpect(cid, bob, b, _err(Arena.NotRevealPhase.selector));
    }

    function test_Reveal_RevertsNoCommit() public {
        uint256 circuitId = _mintAnd(alice, 3);
        _toReveal();
        _revealExpect(cid, alice, circuitId, _err(Arena.NoCommit.selector));
    }

    function test_Reveal_RevertsAlreadyRevealed() public {
        uint256 circuitId = _enter(cid, alice, 3);
        _toReveal();
        _reveal(cid, alice, circuitId);
        _revealExpect(cid, alice, circuitId, _err(Arena.AlreadyRevealed.selector));
    }

    function test_Reveal_RevertsCommitMismatch() public {
        uint256 circuitId = _enter(cid, alice, 3);
        _toReveal();
        vm.prank(alice);
        vm.expectRevert(Arena.CommitMismatch.selector);
        arena.reveal(cid, circuitId, bytes32(uint256(123))); // wrong salt
        uint256 other = _mintAnd(alice, 3);
        _revealExpect(cid, alice, other, _err(Arena.CommitMismatch.selector)); // wrong circuit
    }

    function test_Reveal_RevertsNotCircuitOwner() public {
        uint256 circuitId = _mintAnd(bob, 3);
        _commit(cid, alice, circuitId, _salt(alice));
        _toReveal();
        _revealExpect(cid, alice, circuitId, abi.encodeWithSelector(Arena.NotCircuitOwner.selector, bob));
    }

    function test_Reveal_RevertsUnknownCircuit() public {
        _commit(cid, alice, 999, _salt(alice));
        _toReveal();
        _revealExpect(cid, alice, 999, bytes("no circuit"));
    }

    function test_Reveal_RevertsInputAndOutputCountMismatch() public {
        uint256 threeIn = _mintOn(cpu, alice, 3, _parityOuts(3), 3, 1);
        uint256 twoOut = _mintOn(cpu, bob, 3, _andOuts(), 2, 2);
        _commit(cid, alice, threeIn, _salt(alice));
        _commit(cid, bob, twoOut, _salt(bob));
        _toReveal();
        _revealExpect(cid, alice, threeIn, abi.encodeWithSelector(Arena.InputCountMismatch.selector, uint32(3), uint8(2)));
        _revealExpect(cid, bob, twoOut, abi.encodeWithSelector(Arena.OutputCountMismatch.selector, uint32(2), uint8(1)));
    }

    function test_Reveal_RevertsStatefulCircuit() public {
        uint256 latch = cpu.tapeout(alice, hex"01", 2, 1, 1, 3, _bytesOf(_andOuts()));
        _commit(cid, alice, latch, _salt(alice));
        _toReveal();
        _revealExpect(cid, alice, latch, abi.encodeWithSelector(Arena.StatefulCircuit.selector, uint32(1)));
    }

    function test_Reveal_RevertsEmptyEvaluation() public {
        WrapProcessor wrap = new WrapProcessor();
        reg.setCpu(address(wrap), true);
        CP memory p = _p();
        p.proc = address(wrap);
        uint256 id = _createP(p);
        uint256 circuitId = wrap.tapeout(alice, hex"01", 2, 1, 0, 3, _bytesOf(_andOuts()));
        wrap.setEvalMode(circuitId, 4);
        _commit(id, alice, circuitId, _salt(alice));
        _toReveal();
        _revealExpect(id, alice, circuitId, abi.encodeWithSelector(Arena.EmptyEvaluation.selector, 0));
    }

    function test_Reveal_RevertsAfterFinalize() public {
        uint256 circuitId = _enter(cid, alice, 3);
        _toReveal();
        _reveal(cid, alice, circuitId);
        _toEnd();
        arena.finalize(cid);
        _revealExpect(cid, alice, circuitId, _err(Arena.NotRevealPhase.selector));
        _revealExpect(cid, bob, circuitId, _err(Arena.NotRevealPhase.selector));
    }

    // ------------------------------------------------------------ leader selection

    function test_Leader_LowestGateCountWins() public {
        uint256 a = _enter(cid, alice, 5);
        uint256 b = _enter(cid, bob, 3);
        uint256 c = _enter(cid, carol, 4);
        _toReveal();
        vm.expectEmit(true, true, true, true, address(arena));
        emit Arena.Revealed(cid, alice, a, 5, 1, 100, true);
        _reveal(cid, alice, a);
        vm.expectEmit(true, true, true, true, address(arena));
        emit Arena.Revealed(cid, bob, b, 3, 2, 100, true);
        _reveal(cid, bob, b);
        vm.expectEmit(true, true, true, true, address(arena));
        emit Arena.Revealed(cid, carol, c, 4, 3, 100, false);
        _reveal(cid, carol, c);
        (address w, uint256 wc, uint32 s,) = arena.bestOf(cid);
        assertEq(w, bob);
        assertEq(wc, b);
        assertEq(s, 3);
    }

    function test_Leader_TieGoesToEarliestCommitAcrossBlocks() public {
        uint256 a = _enter(cid, alice, 4);
        vm.roll(block.number + 1);
        uint256 b = _enter(cid, bob, 4);
        vm.roll(block.number + 1);
        uint256 c = _enter(cid, carol, 4);
        _toReveal();
        _reveal(cid, carol, c);
        _reveal(cid, bob, b);
        (address w,,,) = arena.bestOf(cid);
        assertEq(w, bob);
        _reveal(cid, alice, a);
        (w,,,) = arena.bestOf(cid);
        assertEq(w, alice);
    }

    function test_Leader_TieSameBlockOrderedByCommitIndex() public {
        // bob commits first, alice second, in the same block; alice's address is lexicographically unrelated
        uint256 b = _enter(cid, bob, 4);
        uint256 a = _enter(cid, alice, 4);
        _toReveal();
        _reveal(cid, alice, a);
        vm.expectEmit(true, true, true, true, address(arena));
        emit Arena.Revealed(cid, bob, b, 4, 1, 100, true);
        _reveal(cid, bob, b);
        (address w,,, uint32 idx) = arena.bestOf(cid);
        assertEq(w, bob);
        assertEq(idx, 1);
    }

    function test_Leader_LaterEqualRevealDoesNotDisplace() public {
        uint256 a = _enter(cid, alice, 4);
        uint256 b = _enter(cid, bob, 4);
        _toReveal();
        _reveal(cid, alice, a);
        vm.expectEmit(true, true, true, true, address(arena));
        emit Arena.Revealed(cid, bob, b, 4, 2, 100, false);
        _reveal(cid, bob, b);
        (address w,,,) = arena.bestOf(cid);
        assertEq(w, alice);
    }

    function testFuzz_Leader_RevealOrderIrrelevant(uint8 g0, uint8 g1, uint8 g2, uint8 perm, uint8 blockBits) public {
        uint32[3] memory g = [uint32(bound(g0, 1, 4)), uint32(bound(g1, 1, 4)), uint32(bound(g2, 1, 4))];
        address[3] memory who = [alice, bob, carol];
        uint256[3] memory ids;
        for (uint256 i; i < 3; ++i) {
            ids[i] = _enter(cid, who[i], g[i]);
            if ((blockBits >> i) & 1 == 1) vm.roll(block.number + 1);
        }
        // expected: lowest gate count, ties to the lowest commit index (commit order == array order)
        uint256 exp;
        for (uint256 i = 1; i < 3; ++i) {
            if (g[i] < g[exp]) exp = i;
        }
        uint8[3][6] memory perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
        uint8[3] memory order = perms[perm % 6];
        _toReveal();
        for (uint256 k; k < 3; ++k) {
            _reveal(cid, who[order[k]], ids[order[k]]);
        }
        (address w, uint256 wc, uint32 s,) = arena.bestOf(cid);
        assertEq(w, who[exp]);
        assertEq(wc, ids[exp]);
        assertEq(s, g[exp]);
    }

    // ------------------------------------------------------------ finalize / withdraw

    function test_Finalize_WinnerFeeAndPayout() public {
        uint256 a = _enter(cid, alice, 5);
        uint256 b = _enter(cid, bob, 3);
        _toReveal();
        _reveal(cid, alice, a);
        _reveal(cid, bob, b);
        _toEnd();
        uint256 fee = (PRIZE * FEE) / 10_000;
        uint256 payout = PRIZE - fee;
        vm.expectEmit(true, true, false, true, address(arena));
        emit Arena.Finalized(cid, bob, b, 3, payout, fee);
        vm.prank(stranger);
        arena.finalize(cid);

        assertEq(fee, 25e6);
        assertEq(arena.pendingOf(token, bob), payout);
        assertEq(arena.pendingOf(token, feeRecipient), fee);
        assertEq(arena.pendingOf(token, alice), 0);
        assertEq(token.balanceOf(address(arena)), PRIZE, "finalize moves no tokens");
        assertTrue(arena.getChallenge(cid).finalized);
        assertFalse(arena.getChallenge(cid).refundable);

        vm.expectEmit(true, true, false, true, address(arena));
        emit Arena.Withdrawn(token, bob, payout);
        assertEq(_withdraw(bob, token), payout);
        assertEq(_withdraw(feeRecipient, token), fee);
        assertEq(token.balanceOf(address(arena)), 0);
        assertEq(arena.pendingOf(token, bob), 0);
        vm.prank(bob);
        vm.expectRevert(Arena.NothingToWithdraw.selector);
        arena.withdraw(token);
    }

    function test_Finalize_ZeroFeeDeployment() public {
        arena = new Arena(IProcessorRegistry(address(reg)), feeRecipient, 0);
        _fund(token, arena);
        uint256 id = _createP(_p());
        uint256 a = _enter(id, alice, 3);
        _toReveal();
        _reveal(id, alice, a);
        _toEnd();
        arena.finalize(id);
        assertEq(arena.pendingOf(token, alice), PRIZE);
        assertEq(arena.pendingOf(token, feeRecipient), 0);
    }

    function test_Finalize_TimingBoundary() public {
        vm.warp(revealEnd - 1);
        vm.expectRevert(Arena.ChallengeNotEnded.selector);
        arena.finalize(cid);
        vm.warp(revealEnd);
        arena.finalize(cid);
        vm.expectRevert(Arena.AlreadyFinalized.selector);
        arena.finalize(cid);
    }

    function test_Finalize_WithWinnerNobodyCanClaimRefund() public {
        uint256 a = _enter(cid, alice, 3);
        vm.prank(stranger);
        arena.topUp(cid, 5e6);
        _toReveal();
        _reveal(cid, alice, a);
        _toEnd();
        arena.finalize(cid);
        vm.prank(stranger);
        vm.expectRevert(Arena.RefundNotAvailable.selector);
        arena.claimRefund(cid);
        vm.prank(sponsor);
        vm.expectRevert(Arena.RefundNotAvailable.selector);
        arena.claimRefund(cid);
    }
}
