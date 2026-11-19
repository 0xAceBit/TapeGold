// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Arena} from "../../Arena.sol";
import {ICircuitsLite} from "../../interfaces/ITapeOutLite.sol";
import {XLayerBase} from "./XLayerBase.sol";
import {XLayerConfig} from "./XLayerConfig.sol";
import {SolutionCircuits} from "./SolutionCircuits.sol";

/// @notice Step 4+: play the three seeded challenges with the circuits you taped out. One stage per run.
/// @dev Env: ARENA, FIRST_CHALLENGE (id of the full adder), STAGE = commit | reveal | finalize | withdraw.
///      commit and reveal also need CIRCUIT_IDS (three ids, comma separated, in challenge order) and SALT_SECRET
///      (a bytes32 you keep private: salt i is keccak256(abi.encode(SALT_SECRET, i)); losing it means losing the reveal).
///      Optional: ONLY=0|1|2 to act on a single challenge (recovery after a partial run). withdraw uses PRIZE_TOKEN
///      (default: native USDC). Live mode also needs CONFIRM_SPEND=YES and DEPLOYER.
///      Safety: each stage skips work that is already done, and before a commit or reveal it re-checks onchain that you own
///      the circuit, that it fits the challenge, and that it passes every row. One commit per account per challenge cannot be
///      undone, so a wrong circuit id is caught here, before anything is sent.
contract Play is XLayerBase {
    uint256 private lo;
    uint256 private hi = 3;

    function run() external {
        _requireChain();
        Arena arena = Arena(vm.envAddress("ARENA"));
        uint256 first = vm.envUint("FIRST_CHALLENGE");
        bytes32 stage = keccak256(bytes(vm.envString("STAGE")));
        uint256 only = vm.envOr("ONLY", uint256(99));
        if (only < 3) {
            lo = only;
            hi = only + 1;
        }
        _authenticateArena(arena);
        _begin(true);
        if (stage == keccak256("commit")) _commitAll(arena, first);
        else if (stage == keccak256("reveal")) _revealAll(arena, first);
        else if (stage == keccak256("finalize")) _finalizeAll(arena, first);
        else if (stage == keccak256("withdraw")) _withdraw(arena);
        else revert("STAGE must be commit, reveal, finalize or withdraw");
        _end();
    }

    function _salt(uint256 i) private view returns (bytes32) {
        return keccak256(abi.encode(vm.envBytes32("SALT_SECRET"), i));
    }

    function _ids() private view returns (uint256[] memory ids) {
        ids = vm.envUint("CIRCUIT_IDS", ",");
        require(ids.length == 3, "CIRCUIT_IDS needs three ids");
    }

    function _commitAll(Arena arena, uint256 first) private {
        uint256[] memory ids = _ids();
        for (uint256 i = lo; i < hi; ++i) {
            uint256 id = first + i;
            bytes32 h = arena.commitHashOf(ids[i], _salt(i), deployer);
            (bytes32 existing, uint32 index,,) = arena.commitOf(id, deployer);
            if (index != 0) {
                require(existing == h, "an existing commit does not match your CIRCUIT_IDS and SALT_SECRET");
                console2.log("already committed, skipping challenge", id);
                continue;
            }
            require(arena.phaseOf(id) == Arena.Phase.Commit, "challenge is not in its commit phase");
            _validateEntry(arena, id, ids[i]);
            _send(_label("commit to challenge ", id), address(arena), 0, abi.encodeCall(Arena.commit, (id, h)));
        }
    }

    function _revealAll(Arena arena, uint256 first) private {
        uint256[] memory ids = _ids();
        for (uint256 i = lo; i < hi; ++i) {
            uint256 id = first + i;
            (, uint32 index,, bool revealed) = arena.commitOf(id, deployer);
            if (revealed) {
                console2.log("already revealed, skipping challenge", id);
                continue;
            }
            require(index != 0, "you have no commit in this challenge");
            require(arena.phaseOf(id) == Arena.Phase.Reveal, "challenge is not in its reveal phase");
            _validateEntry(arena, id, ids[i]);
            _send(_label("reveal challenge ", id), address(arena), 0, abi.encodeCall(Arena.reveal, (id, ids[i], _salt(i))));
        }
    }

    function _finalizeAll(Arena arena, uint256 first) private {
        for (uint256 i = lo; i < hi; ++i) {
            uint256 id = first + i;
            Arena.Phase phase = arena.phaseOf(id);
            if (phase == Arena.Phase.Finalized) {
                console2.log("already finalized, skipping challenge", id);
                continue;
            }
            require(phase == Arena.Phase.Ended, "challenge has not ended yet");
            _send(_label("finalize challenge ", id), address(arena), 0, abi.encodeCall(Arena.finalize, (id)));
        }
    }

    function _withdraw(Arena arena) private {
        IERC20 token = IERC20(vm.envOr("PRIZE_TOKEN", XLayerConfig.DEFAULT_PRIZE_TOKEN));
        console2.log("pending for", deployer);
        console2.log("  base units:", arena.pendingOf(token, deployer));
        _send("withdraw pending balance", address(arena), 0, abi.encodeCall(Arena.withdraw, (token)));
    }

    /// @dev Read-only mirror of Arena's reveal checks, run before any commit or reveal is sent.
    function _validateEntry(Arena arena, uint256 id, uint256 circuitId) private view {
        Arena.Challenge memory c = arena.getChallenge(id);
        ICircuitsLite circuits = ICircuitsLite(c.processor);
        require(circuits.ownerOf(circuitId) == deployer, "you do not own that circuit id on this challenge's processor");
        (uint32 nIn, uint32 nOut, uint32 nState, uint32 gates) = circuits.circuitInfo(circuitId);
        require(nIn == c.nIn && nOut == c.nOut && nState == 0, "that circuit has the wrong shape for this challenge");
        _gradeEntry(circuits, circuitId, c.nIn, c.nOut, arena.truthTableOf(id));
        console2.log("entry checked: challenge", id);
        console2.log("  circuit id:", circuitId);
        console2.log("  gate count:", uint256(gates));
    }

    function _gradeEntry(ICircuitsLite circuits, uint256 circuitId, uint8 nIn, uint8 nOut, bytes memory table) private view {
        uint8 mask = uint8((1 << nOut) - 1);
        for (uint256 v; v < (uint256(1) << nIn); ++v) {
            // forge-lint: disable-next-line(unsafe-typecast)
            bytes memory out = circuits.eval(circuitId, abi.encodePacked(uint8(v)));
            require(uint8(out[0]) & mask == SolutionCircuits.expectedAt(table, nOut, v), "that circuit fails a truth-table row");
        }
    }

    function _label(string memory prefix, uint256 id) private pure returns (string memory) {
        return string.concat(prefix, vm.toString(id));
    }
}
