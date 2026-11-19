// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console2} from "forge-std/Test.sol";
import {Arena} from "../Arena.sol";
import {IProcessorRegistry} from "../interfaces/ITapeOutLite.sol";
import {MockProcessorRegistry} from "../mocks/MockProcessorRegistry.sol";
import {MockCircuits} from "../mocks/MockCircuits.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

/// Drives Arena through random sequences across several actors. Every call may revert (that is part of the
/// exploration); only successful token movements are recorded in the ghost variables.
contract ArenaHandler is Test {
    Arena public arena;
    MockERC20 public token;
    MockCircuits public cpu;
    address public feeRecipient;
    address[] internal _actors;

    uint256 public ghostIn; // tokens that entered the arena through create/topUp
    uint256 public ghostOut; // tokens that left through withdraw
    uint256 public okReveals;
    uint256 public okFinalizeWinner;
    uint256 public okFinalizeNoWinner;
    uint256 public okRefunds;
    uint256 public okWithdraws;

    uint256 internal constant MAX_CHALLENGES = 8;

    mapping(uint256 => mapping(address => uint256)) internal _circuitOf;

    constructor(Arena arena_, MockERC20 token_, MockCircuits cpu_, address feeRecipient_) {
        arena = arena_;
        token = token_;
        cpu = cpu_;
        feeRecipient = feeRecipient_;
        for (uint256 i; i < 5; ++i) {
            address a = address(uint160(0x1000 + i));
            _actors.push(a);
            token_.mint(a, type(uint128).max);
            vm.prank(a);
            token_.approve(address(arena_), type(uint256).max);
        }
    }

    function actors() external view returns (address[] memory) {
        return _actors;
    }

    function accounts() public view returns (address[] memory all) {
        all = new address[](_actors.length + 1);
        for (uint256 i; i < _actors.length; ++i) {
            all[i] = _actors[i];
        }
        all[_actors.length] = feeRecipient;
    }

    function _actor(uint256 s) internal view returns (address) {
        return _actors[s % _actors.length];
    }

    function _id(uint256 s) internal view returns (uint256) {
        return bound(s, 1, arena.challengeCount());
    }

    /// First challenge (scanning from `s`) in `phase` for which `ok(id)` holds; falls back to a random id so the
    /// failing paths are still exercised.
    function _pick(uint256 s, Arena.Phase phase, address who, bool needCircuit) internal view returns (uint256) {
        uint256 n = arena.challengeCount();
        for (uint256 k; k < n; ++k) {
            uint256 id = ((s % n + k) % n) + 1;
            if (arena.phaseOf(id) != phase) continue;
            if (needCircuit && _circuitOf[id][who] == 0) continue;
            return id;
        }
        return _id(s);
    }

    // ------------------------------------------------------------ actions

    function createChallenge(uint256 who, uint256 potSeed, uint256 durA, uint256 durB) external {
        if (arena.challengeCount() >= MAX_CHALLENGES) return;
        uint256 pot = bound(potSeed, 1, 1e9);
        uint64 ce = uint64(block.timestamp + bound(durA, 30, 600));
        uint64 re = ce + uint64(bound(durB, 30, 600));
        vm.prank(_actor(who));
        try arena.createChallenge(token, pot, 2, 1, hex"08", ce, re, address(cpu)) {
            ghostIn += pot;
        } catch {}
    }

    function topUp(uint256 who, uint256 idSeed, uint256 amount) external {
        if (arena.challengeCount() == 0) return;
        amount = bound(amount, 1, 1e8);
        uint256 id = _id(idSeed);
        vm.prank(_actor(who));
        try arena.topUp(id, amount) {
            ghostIn += amount;
        } catch {}
    }

    function commit(uint256 who, uint256 idSeed, uint256 quality, uint256 gates) external {
        if (arena.challengeCount() == 0) return;
        address a = _actor(who);
        uint256 id = _pick(idSeed, Arena.Phase.Commit, a, false);
        (, uint32 idx,,) = arena.commitOf(id, a);
        if (idx != 0) return;
        bytes memory table = new bytes(4);
        table[3] = 0x01; // AND
        if (quality % 4 == 0) table[1] = 0x01; // 25%: wrong circuit
        uint256 circuitId = cpu.tapeout(a, hex"01", 2, 1, 0, uint32(bound(gates, 1, 10)), table);
        _circuitOf[id][a] = circuitId;
        bytes32 h = arena.commitHashOf(circuitId, _salt(id, a), a);
        vm.prank(a);
        try arena.commit(id, h) {} catch {}
    }

    function reveal(uint256 who, uint256 idSeed, uint256 mode) external {
        if (arena.challengeCount() == 0) return;
        address a = _actor(who);
        uint256 id = _pick(idSeed, Arena.Phase.Reveal, a, true);
        uint256 circuitId = _circuitOf[id][a];
        if (circuitId == 0) return;
        bytes32 salt = mode % 5 == 1 ? bytes32(uint256(0xdead)) : _salt(id, a);
        uint256 cid = mode % 5 == 2 ? circuitId + 1 : circuitId;
        vm.prank(a);
        try arena.reveal(id, cid, salt) {
            ++okReveals;
        } catch {}
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 120));
        vm.roll(block.number + 1);
    }

    function finalize(uint256 idSeed) external {
        if (arena.challengeCount() == 0) return;
        uint256 id = _pick(idSeed, Arena.Phase.Ended, address(0), false);
        try arena.finalize(id) {
            (address w,,,) = arena.bestOf(id);
            if (w == address(0)) ++okFinalizeNoWinner;
            else ++okFinalizeWinner;
        } catch {}
    }

    function claimRefund(uint256 who, uint256 idSeed) external {
        if (arena.challengeCount() == 0) return;
        address a = _actor(who);
        uint256 id = _pick(idSeed, Arena.Phase.Finalized, a, false);
        vm.prank(a);
        try arena.claimRefund(id) {
            ++okRefunds;
        } catch {}
    }

    function withdraw(uint256 who) external {
        address[] memory all = accounts();
        address a = all[who % all.length];
        uint256 before = token.balanceOf(a);
        vm.prank(a);
        try arena.withdraw(token) {
            ghostOut += token.balanceOf(a) - before;
            ++okWithdraws;
        } catch {}
    }

    /// Finalize everything, claim every refund, withdraw everything.
    function settleAll() external {
        vm.warp(block.timestamp + 365 days);
        uint256 n = arena.challengeCount();
        address[] memory all = accounts();
        for (uint256 id = 1; id <= n; ++id) {
            if (!arena.getChallenge(id).finalized) arena.finalize(id);
            for (uint256 i; i < _actors.length; ++i) {
                vm.prank(_actors[i]);
                try arena.claimRefund(id) {} catch {}
            }
        }
        for (uint256 i; i < all.length; ++i) {
            vm.prank(all[i]);
            try arena.withdraw(token) {} catch {}
        }
    }

    function _salt(uint256 id, address a) internal pure returns (bytes32) {
        return keccak256(abi.encode(id, a));
    }
}

/// forge-config: default.invariant.runs = 256
/// forge-config: default.invariant.depth = 128
/// forge-config: default.invariant.fail_on_revert = true
contract ArenaInvariantTest is Test {
    Arena internal arena;
    MockERC20 internal token;
    ArenaHandler internal handler;
    address internal feeRecipient = address(0xFEE);

    function setUp() public {
        vm.warp(1_000_000);
        vm.roll(100);
        MockProcessorRegistry reg = new MockProcessorRegistry();
        MockCircuits cpu = new MockCircuits();
        reg.setCpu(address(cpu), true);
        arena = new Arena(IProcessorRegistry(address(reg)), feeRecipient, 250);
        token = new MockERC20();
        handler = new ArenaHandler(arena, token, cpu, feeRecipient);
        targetContract(address(handler));
        bytes4[] memory sel = new bytes4[](8);
        sel[0] = ArenaHandler.createChallenge.selector;
        sel[1] = ArenaHandler.topUp.selector;
        sel[2] = ArenaHandler.commit.selector;
        sel[3] = ArenaHandler.reveal.selector;
        sel[4] = ArenaHandler.warp.selector;
        sel[5] = ArenaHandler.finalize.selector;
        sel[6] = ArenaHandler.claimRefund.selector;
        sel[7] = ArenaHandler.withdraw.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: sel}));
    }

    /// Everything the arena owes: pending balances, unfinalized pots, and unclaimed refunds of refundable challenges.
    function _liabilities() internal view returns (uint256 total) {
        uint256 n = arena.challengeCount();
        address[] memory actors = handler.actors();
        for (uint256 id = 1; id <= n; ++id) {
            Arena.Challenge memory c = arena.getChallenge(id);
            if (!c.finalized) {
                total += c.pot;
            } else if (c.refundable) {
                for (uint256 i; i < actors.length; ++i) {
                    total += arena.contributionOf(id, actors[i]);
                }
            }
        }
        address[] memory all = handler.accounts();
        for (uint256 i; i < all.length; ++i) {
            total += arena.pendingOf(token, all[i]);
        }
    }

    function invariant_BalanceCoversEveryLiability() public view {
        assertGe(token.balanceOf(address(arena)), _liabilities());
    }

    function invariant_BalanceEqualsLiabilitiesExactly() public view {
        assertEq(token.balanceOf(address(arena)), _liabilities(), "stray or missing tokens");
    }

    function invariant_BalanceEqualsTokensInMinusOut() public view {
        assertEq(token.balanceOf(address(arena)), handler.ghostIn() - handler.ghostOut());
    }

    function invariant_UnfinalizedPotEqualsSumOfContributions() public view {
        uint256 n = arena.challengeCount();
        address[] memory actors = handler.actors();
        for (uint256 id = 1; id <= n; ++id) {
            Arena.Challenge memory c = arena.getChallenge(id);
            if (c.finalized) continue;
            uint256 sum;
            for (uint256 i; i < actors.length; ++i) {
                sum += arena.contributionOf(id, actors[i]);
            }
            assertEq(sum, c.pot);
        }
    }

    /// Coverage guard: a scripted pseudo-random walk over the same handler must reach every interesting path, so the
    /// invariants above are not passing vacuously.
    function test_Coverage_HandlerReachesWinnerRefundAndWithdrawPaths() public {
        bytes4[16] memory sel = [
            ArenaHandler.createChallenge.selector,
            ArenaHandler.createChallenge.selector,
            ArenaHandler.topUp.selector,
            ArenaHandler.topUp.selector,
            ArenaHandler.commit.selector,
            ArenaHandler.commit.selector,
            ArenaHandler.commit.selector,
            ArenaHandler.commit.selector,
            ArenaHandler.reveal.selector,
            ArenaHandler.reveal.selector,
            ArenaHandler.reveal.selector,
            ArenaHandler.warp.selector,
            ArenaHandler.finalize.selector,
            ArenaHandler.finalize.selector,
            ArenaHandler.claimRefund.selector,
            ArenaHandler.withdraw.selector
        ];
        for (uint256 i; i < 800; ++i) {
            uint256 r = uint256(keccak256(abi.encode("walk", i)));
            bytes memory data = abi.encodeWithSelector(
                sel[r % 16],
                uint256(keccak256(abi.encode(r, 1))),
                uint256(keccak256(abi.encode(r, 2))),
                uint256(keccak256(abi.encode(r, 3))),
                uint256(keccak256(abi.encode(r, 4)))
            );
            (bool ok,) = address(handler).call(data);
            ok;
        }
        assertGt(handler.okReveals(), 0, "no reveal ever succeeded");
        assertGt(handler.okFinalizeWinner(), 0, "no challenge finalized with a winner");
        assertGt(handler.okFinalizeNoWinner(), 0, "no challenge finalized without a winner");
        assertGt(handler.okRefunds(), 0, "no refund claimed");
        assertGt(handler.okWithdraws(), 0, "no withdraw succeeded");
        assertEq(token.balanceOf(address(arena)), handler.ghostIn() - handler.ghostOut());
    }

    /// After every challenge is finalized and everyone has claimed and withdrawn, the contract holds nothing.
    function afterInvariant() public {
        handler.settleAll();
        assertEq(token.balanceOf(address(arena)), 0, "tokens left after full settlement");
        assertEq(_liabilities(), 0);
        console2.log("challenges", arena.challengeCount());
        console2.log("reveals", handler.okReveals());
        console2.log("finalized winner / none", handler.okFinalizeWinner(), handler.okFinalizeNoWinner());
    }
}
