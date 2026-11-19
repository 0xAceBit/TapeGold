// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Arena} from "../Arena.sol";
import {IProcessorRegistry} from "../interfaces/ITapeOutLite.sol";
import {XLayerConfig} from "../script/xlayer/XLayerConfig.sol";
import {SeedChallenges} from "../script/xlayer/SeedChallenges.s.sol";
import {TapeOutSolutions} from "../script/xlayer/TapeOutSolutions.s.sol";
import {Play} from "../script/xlayer/Play.s.sol";
import {SpikeBase} from "./spike/SpikeBase.t.sol";
import {ITapeOutExtras} from "../spike/SpikeInterfaces.sol";

/// @notice Runs the real deploy scripts (in dry-run mode) against the X Layer fork, stage by stage, with real TapeOut.
contract XLayerScriptsForkTest is SpikeBase {
    address internal constant DRY_DEPLOYER = address(uint160(uint256(keccak256("tapegolf.dryrun.deployer"))));
    IERC20 internal usdc = IERC20(XLayerConfig.DEFAULT_PRIZE_TOKEN);

    Arena internal arena;
    address internal processor;
    uint256[3] internal ids;

    function setUp() public override {
        super.setUp();
        (processor,) = _openCpu();
        arena = new Arena(IProcessorRegistry(XLayerConfig.FACTORY), XLayerConfig.FEE_RECIPIENT, XLayerConfig.DEFAULT_FEE_BPS);
        _baseEnv();
    }

    /// @dev Process environment variables are global, and forge runs test functions in parallel, so every scenario runs
    ///      inside ONE test function, one after another, each from a fresh snapshot of the fork.
    function _baseEnv() internal {
        vm.setEnv("CONFIRM_SPEND", "NO");
        vm.setEnv("DEPLOYER", vm.toString(DRY_DEPLOYER));
        vm.setEnv("ARENA", vm.toString(address(arena)));
        vm.setEnv("PROCESSOR", vm.toString(processor));
        vm.setEnv("PRIZE_TOKEN", vm.toString(address(usdc)));
        vm.setEnv("POT_MILLI", "1000");
        vm.setEnv("COMMIT_HOURS", "48");
        vm.setEnv("REVEAL_HOURS", "48");
        vm.setEnv("FIRST_CHALLENGE", "1");
        vm.setEnv("SALT_SECRET", vm.toString(bytes32(uint256(0xC0FFEE))));
        vm.setEnv("ONLY", "99");
    }

    function test_fork_scriptScenarios() public {
        _run(0);
        _run(1);
        _run(2);
        _run(3);
        _run(4);
        _run(5);
        _run(6);
    }

    function _run(uint256 which) internal {
        uint256 snap = vm.snapshotState();
        _baseEnv();
        if (which == 0) scenarioSeed();
        else if (which == 1) scenarioFullLifecycle();
        else if (which == 2) scenarioPartialReveal();
        else if (which == 3) scenarioSwappedId();
        else if (which == 4) scenarioNotOwner();
        else if (which == 5) scenarioImpostor();
        else scenarioCaps();
        vm.revertToState(snap);
    }

    function _seedAndTapeOut() internal {
        new SeedChallenges().run();
        uint256 n = ITapeOutExtras(processor).nextId();
        new TapeOutSolutions().run();
        uint256 last = ITapeOutExtras(processor).nextId();
        assertEq(last, n + 3);
        ids = [n + 1, n + 2, n + 3];
        vm.setEnv("CIRCUIT_IDS", string.concat(vm.toString(ids[0]), ",", vm.toString(ids[1]), ",", vm.toString(ids[2])));
    }

    function _stage(string memory s) internal {
        vm.setEnv("STAGE", s);
        new Play().run();
    }

    function scenarioSeed() internal {
        _seedAndTapeOut();
        assertEq(arena.challengeCount(), 3);
        assertEq(usdc.balanceOf(address(arena)), 3_000_000, "three pots of 1.000 USDC");
        assertEq(usdc.allowance(DRY_DEPLOYER, address(arena)), 0);
        Arena.Challenge memory c = arena.getChallenge(1);
        assertEq(c.nIn, 3);
        assertEq(c.nOut, 2);
        assertEq(arena.getChallenge(2).nOut, 1);
        assertEq(arena.getChallenge(3).nIn, 4);
        assertEq(c.processor, processor);
    }

    function scenarioFullLifecycle() internal {
        _seedAndTapeOut();
        _stage("commit");
        _stage("commit"); // resumable: the second run skips everything already committed
        vm.warp(block.timestamp + 48 hours);
        _stage("reveal");
        _stage("reveal");
        for (uint256 i = 1; i <= 3; ++i) {
            (address winner,, uint32 score,) = arena.bestOf(i);
            assertEq(winner, DRY_DEPLOYER);
            assertEq(score, i == 1 ? 9 : i == 2 ? 6 : 12, "gate counts of the shipped solutions");
        }
        vm.warp(block.timestamp + 48 hours);
        uint256 before = usdc.balanceOf(DRY_DEPLOYER);
        _stage("finalize");
        _stage("finalize");
        _stage("withdraw");
        uint256 fee = uint256(1_000_000) * uint256(XLayerConfig.DEFAULT_FEE_BPS) / 10_000;
        assertEq(usdc.balanceOf(DRY_DEPLOYER) - before, 3 * (1_000_000 - fee));
        assertEq(arena.pendingOf(usdc, XLayerConfig.FEE_RECIPIENT), 3 * fee);
        assertEq(usdc.balanceOf(address(arena)), 3 * fee, "only the fee is left, owed to the fee recipient");
    }

    function scenarioPartialReveal() internal {
        _seedAndTapeOut();
        _stage("commit");
        vm.warp(block.timestamp + 48 hours);
        vm.setEnv("ONLY", "1");
        _stage("reveal");
        (address w1,,,) = arena.bestOf(1);
        (address w2,,,) = arena.bestOf(2);
        assertEq(w1, address(0));
        assertEq(w2, DRY_DEPLOYER);
        vm.setEnv("ONLY", "99");
        _stage("reveal"); // skips #2, reveals #1 and #3
        (w1,,,) = arena.bestOf(1);
        assertEq(w1, DRY_DEPLOYER);
    }

    function scenarioSwappedId() internal {
        _seedAndTapeOut();
        // swap the majority and parity ids: both exist and both are owned by the deployer, but they do not fit
        vm.setEnv("CIRCUIT_IDS", string.concat(vm.toString(ids[0]), ",", vm.toString(ids[2]), ",", vm.toString(ids[1])));
        vm.setEnv("STAGE", "commit");
        Play play = new Play();
        vm.expectRevert(bytes("that circuit has the wrong shape for this challenge"));
        play.run();
        (, uint32 index,,) = arena.commitOf(2, DRY_DEPLOYER);
        assertEq(index, 0, "nothing was committed");
    }

    function scenarioNotOwner() internal {
        _seedAndTapeOut();
        vm.setEnv("CIRCUIT_IDS", string.concat(vm.toString(ids[0]), ",", vm.toString(ids[1]), ",", vm.toString(uint256(1))));
        vm.setEnv("STAGE", "commit");
        Play play = new Play();
        vm.expectRevert();
        play.run();
    }

    function scenarioImpostor() internal {
        FakeArena fake = new FakeArena();
        vm.setEnv("ARENA", vm.toString(address(fake)));
        SeedChallenges seed = new SeedChallenges();
        vm.expectRevert();
        seed.run();
    }

    function scenarioCaps() internal {
        vm.setEnv("POT_MILLI", "5001");
        SeedChallenges seed = new SeedChallenges();
        vm.expectRevert(bytes("pot outside the hard cap"));
        seed.run();
    }
}

/// @dev A contract that claims the right registry but is not Arena.
contract FakeArena {
    function registry() external pure returns (address) {
        return XLayerConfig.FACTORY;
    }

    function feeRecipient() external pure returns (address) {
        return XLayerConfig.FEE_RECIPIENT;
    }

    function feeBps() external pure returns (uint16) {
        return 250;
    }

    function challengeCount() external pure returns (uint256) {
        return 0;
    }
}
