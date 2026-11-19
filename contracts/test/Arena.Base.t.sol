// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Arena} from "../Arena.sol";
import {IProcessorRegistry} from "../interfaces/ITapeOutLite.sol";
import {MockProcessorRegistry} from "../mocks/MockProcessorRegistry.sol";
import {MockCircuits} from "../mocks/MockCircuits.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

abstract contract ArenaBase is Test {
    uint16 internal constant FEE = 250;
    uint256 internal constant PRIZE = 1_000e6;
    uint64 internal constant T0 = 1_000_000;

    Arena internal arena;
    MockProcessorRegistry internal reg;
    MockCircuits internal cpu;
    MockERC20 internal token;

    address internal sponsor = makeAddr("sponsor");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal dave = makeAddr("dave");
    address internal stranger = makeAddr("stranger");
    address internal feeRecipient = makeAddr("feeRecipient");

    uint64 internal commitEnd;
    uint64 internal revealEnd;
    uint256 internal cid; // default challenge id (1): 2 inputs, 1 output, AND

    struct CP {
        IERC20 token;
        uint256 pot;
        uint8 nIn;
        uint8 nOut;
        bytes table;
        uint64 ce;
        uint64 re;
        address proc;
    }

    function setUp() public virtual {
        vm.warp(T0);
        vm.roll(100);
        reg = new MockProcessorRegistry();
        cpu = new MockCircuits();
        reg.setCpu(address(cpu), true);
        arena = new Arena(IProcessorRegistry(address(reg)), feeRecipient, FEE);
        token = new MockERC20();
        commitEnd = T0 + 1 days;
        revealEnd = commitEnd + 1 days;
        _fund(token, arena);
        cid = _createP(_p());
    }

    // ---------------------------------------------------------------- encoding / circuits

    /// Arena's documented encoding: bit p = v*nOut + j, LSB first, table byte p>>3, bit p&7.
    function packTruthTable(uint8[] memory outs, uint8 nIn, uint8 nOut) internal pure returns (bytes memory t) {
        uint256 bits = (uint256(1) << nIn) * nOut;
        t = new bytes((bits + 7) / 8);
        for (uint256 v; v < (uint256(1) << nIn); ++v) {
            for (uint256 j; j < nOut; ++j) {
                if (((outs[v] >> j) & 1) == 1) {
                    uint256 p = v * nOut + j;
                    t[p >> 3] = bytes1(uint8(t[p >> 3]) | uint8(1 << (p & 7)));
                }
            }
        }
    }

    function _andOuts() internal pure returns (uint8[] memory o) {
        o = new uint8[](4);
        o[3] = 1;
    }

    function _parityOuts(uint8 nIn) internal pure returns (uint8[] memory o) {
        o = new uint8[](uint256(1) << nIn);
        for (uint256 v; v < o.length; ++v) {
            uint256 x = v;
            uint8 par;
            while (x != 0) {
                par ^= uint8(x & 1);
                x >>= 1;
            }
            o[v] = par;
        }
    }

    function _randOuts(uint256 seed, uint8 nIn, uint8 nOut) internal pure returns (uint8[] memory o) {
        o = new uint8[](uint256(1) << nIn);
        uint8 m = nOut == 8 ? 255 : uint8((1 << nOut) - 1);
        for (uint256 v; v < o.length; ++v) {
            o[v] = uint8(uint256(keccak256(abi.encode(seed, v)))) & m;
        }
    }

    function _bytesOf(uint8[] memory outs) internal pure returns (bytes memory t) {
        t = new bytes(outs.length);
        for (uint256 i; i < outs.length; ++i) {
            t[i] = bytes1(outs[i]);
        }
    }

    function _mintOn(MockCircuits c, address who, uint32 gates, uint8[] memory outs, uint8 nIn, uint8 nOut)
        internal
        returns (uint256)
    {
        return c.tapeout(who, hex"01", nIn, nOut, 0, gates, _bytesOf(outs));
    }

    function _mintAnd(address who, uint32 gates) internal returns (uint256) {
        return _mintOn(cpu, who, gates, _andOuts(), 2, 1);
    }

    // ---------------------------------------------------------------- challenges

    function _p() internal view returns (CP memory p) {
        p = CP(token, PRIZE, 2, 1, hex"08", commitEnd, revealEnd, address(cpu));
    }

    function _createP(CP memory p) internal returns (uint256) {
        vm.prank(sponsor);
        return arena.createChallenge(p.token, p.pot, p.nIn, p.nOut, p.table, p.ce, p.re, p.proc);
    }

    function _createExpect(CP memory p, bytes memory err) internal {
        vm.prank(sponsor);
        vm.expectRevert(err);
        arena.createChallenge(p.token, p.pot, p.nIn, p.nOut, p.table, p.ce, p.re, p.proc);
    }

    /// Fresh AND challenge with a different token/processor-independent default shape.
    function _createAnd(IERC20 t, uint256 pot) internal returns (uint256) {
        CP memory p = _p();
        p.token = t;
        p.pot = pot;
        return _createP(p);
    }

    function _fund(MockERC20 t, Arena a) internal {
        address[6] memory who = [sponsor, alice, bob, carol, dave, stranger];
        for (uint256 i; i < who.length; ++i) {
            t.mint(who[i], 1e15);
            vm.prank(who[i]);
            t.approve(address(a), type(uint256).max);
        }
    }

    // ---------------------------------------------------------------- actions

    function _salt(address who) internal pure returns (bytes32) {
        return keccak256(abi.encode("salt", who));
    }

    function _commit(uint256 id, address who, uint256 circuitId, bytes32 salt) internal {
        bytes32 h = arena.commitHashOf(circuitId, salt, who);
        vm.prank(who);
        arena.commit(id, h);
    }

    function _reveal(uint256 id, address who, uint256 circuitId) internal {
        vm.prank(who);
        arena.reveal(id, circuitId, _salt(who));
    }

    function _revealExpect(uint256 id, address who, uint256 circuitId, bytes memory err) internal {
        vm.prank(who);
        vm.expectRevert(err);
        arena.reveal(id, circuitId, _salt(who));
    }

    /// Mint an AND circuit of `gates` gates owned by `who` and commit to it on challenge `id`.
    function _enter(uint256 id, address who, uint32 gates) internal returns (uint256 circuitId) {
        circuitId = _mintAnd(who, gates);
        _commit(id, who, circuitId, _salt(who));
    }

    function _withdraw(address who, IERC20 t) internal returns (uint256 got) {
        uint256 before = t.balanceOf(who);
        vm.prank(who);
        arena.withdraw(t);
        got = t.balanceOf(who) - before;
    }

    function _toReveal() internal {
        vm.warp(commitEnd);
    }

    function _toEnd() internal {
        vm.warp(revealEnd);
    }

    function _err(bytes4 sel) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(sel);
    }
}
