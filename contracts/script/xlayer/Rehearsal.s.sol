// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Arena} from "../../Arena.sol";
import {XLayerBase} from "./XLayerBase.sol";
import {XLayerConfig} from "./XLayerConfig.sol";

/// @notice Full dry run of everything on an X Layer fork: deploy Arena, create the three challenges, tape out the three
///         solutions on a real TapeOut processor, then commit, reveal, finalize and withdraw through the REAL TapeOut `eval`.
/// @dev NEVER broadcasts: it always runs in dry-run mode, whatever CONFIRM_SPEND says. Every transaction is printed.
///      forge script contracts/script/xlayer/Rehearsal.s.sol --fork-url https://rpc.xlayer.tech
///      Env (all optional): PROCESSOR (default: the first open processor found), PRIZE_TOKEN, FEE_RECIPIENT, FEE_BPS,
///      POT_MILLI, COMMIT_HOURS, REVEAL_HOURS, DEPLOYER (the simulated sender; default is a throwaway address).
contract Rehearsal is XLayerBase {
    struct Run {
        Arena arena;
        IERC20 token;
        address processor;
        address feeRecipient;
        uint256 firstId;
        uint256 pot;
        uint16 feeBps;
        uint64 commitEnd;
        uint64 revealEnd;
        uint256[3] circuitIds;
    }

    function run() external {
        _requireChain();
        Run memory r;
        r.processor = vm.envOr("PROCESSOR", address(0));
        if (r.processor == address(0)) r.processor = _pickProcessor(80);
        r.feeRecipient = vm.envOr("FEE_RECIPIENT", XLayerConfig.FEE_RECIPIENT);
        r.token = IERC20(vm.envOr("PRIZE_TOKEN", XLayerConfig.DEFAULT_PRIZE_TOKEN));
        r.feeBps = uint16(vm.envOr("FEE_BPS", uint256(XLayerConfig.DEFAULT_FEE_BPS)));

        _begin(false);

        console2.log("=== STEP 1: deploy Arena ===");
        r.arena = _deployArena(r.feeRecipient, r.feeBps);

        console2.log("");
        console2.log("=== STEP 2: seed the three challenges ===");
        SeedParams memory p;
        p.arena = r.arena;
        p.token = r.token;
        p.processor = r.processor;
        p.potMilli = vm.envOr("POT_MILLI", XLayerConfig.DEFAULT_POT_MILLI);
        p.commitHours = vm.envOr("COMMIT_HOURS", XLayerConfig.DEFAULT_COMMIT_HOURS);
        p.revealHours = vm.envOr("REVEAL_HOURS", XLayerConfig.DEFAULT_REVEAL_HOURS);
        (r.firstId, r.pot) = _seed(p);
        r.commitEnd = p.commitEnd;
        r.revealEnd = p.revealEnd;

        console2.log("");
        console2.log("=== STEP 3: tape out the three solutions ===");
        r.circuitIds = _tapeOut(r.processor);

        console2.log("");
        console2.log("=== STEP 4: commit ===");
        for (uint256 i; i < 3; ++i) {
            _commit(r, i);
        }

        console2.log("");
        console2.log("=== STEP 5: reveal (after the commit deadline) ===");
        vm.warp(r.commitEnd);
        for (uint256 i; i < 3; ++i) {
            _reveal(r, i);
        }

        console2.log("");
        console2.log("=== STEP 6: finalize and withdraw (after the reveal deadline) ===");
        vm.warp(r.revealEnd);
        for (uint256 i; i < 3; ++i) {
            _send("finalize", address(r.arena), 0, abi.encodeCall(Arena.finalize, (r.firstId + i)));
        }
        _withdrawAndCheck(r);
        _end();
        _writeJson(r);
    }

    function _withdrawAndCheck(Run memory r) private {
        uint256 startBalance = r.token.balanceOf(deployer);
        _send("withdraw the winner payouts", address(r.arena), 0, abi.encodeCall(Arena.withdraw, (r.token)));
        uint256 fee = r.pot * r.feeBps / 10_000;
        uint256 payout = (r.pot - fee) * 3;
        if (r.feeRecipient == deployer) {
            // the same account is winner and fee recipient: one combined pending balance was paid above
            require(r.token.balanceOf(deployer) == startBalance + payout + fee * 3, "unexpected combined payout");
        } else {
            require(r.token.balanceOf(deployer) == startBalance + payout, "unexpected winner payout");
            vm.stopPrank();
            vm.startPrank(r.feeRecipient);
            _send("withdraw the fees (as the fee recipient)", address(r.arena), 0, abi.encodeCall(Arena.withdraw, (r.token)));
            vm.stopPrank();
            vm.startPrank(deployer);
            require(r.token.balanceOf(r.feeRecipient) >= fee * 3, "unexpected fee payout");
        }
        require(r.token.balanceOf(address(r.arena)) == 0, "Arena still holds tokens after everyone withdrew");
        console2.log("");
        console2.log("REHEARSAL OK. Arena holds 0 tokens. Winner payout (base units):", payout);
        console2.log("fees paid to the fee recipient (base units):", fee * 3);
        console2.log("transactions printed:", txCount);
    }

    function _writeJson(Run memory r) private {
        string memory k = "dryrun";
        vm.serializeBool(k, "dryRun", true);
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeAddress(k, "arena", address(r.arena));
        vm.serializeAddress(k, "processor", r.processor);
        vm.serializeAddress(k, "prizeToken", address(r.token));
        vm.serializeAddress(k, "feeRecipient", r.feeRecipient);
        vm.serializeUint(k, "feeBps", r.feeBps);
        vm.serializeUint(k, "potBaseUnits", r.pot);
        vm.serializeUint(k, "firstChallengeId", r.firstId);
        string memory out = vm.serializeUint(k, "solutionCircuitIds", _arr(r.circuitIds));
        vm.writeJson(out, "deployments/xlayer.dryrun.json");
    }

    function _arr(uint256[3] memory a) private pure returns (uint256[] memory out) {
        out = new uint256[](3);
        for (uint256 i; i < 3; ++i) out[i] = a[i];
    }

    function _salt(uint256 i) private pure returns (bytes32) {
        return keccak256(abi.encode("tapegolf-rehearsal-salt", i));
    }

    function _commit(Run memory r, uint256 i) private {
        bytes32 h = r.arena.commitHashOf(r.circuitIds[i], _salt(i), deployer);
        _send(
            string.concat("commit to challenge ", vm.toString(r.firstId + i)),
            address(r.arena),
            0,
            abi.encodeCall(Arena.commit, (r.firstId + i, h))
        );
    }

    function _reveal(Run memory r, uint256 i) private {
        _send(
            string.concat("reveal challenge ", vm.toString(r.firstId + i)),
            address(r.arena),
            0,
            abi.encodeCall(Arena.reveal, (r.firstId + i, r.circuitIds[i], _salt(i)))
        );
        (address winner,, uint32 score,) = r.arena.bestOf(r.firstId + i);
        require(winner == deployer, "the solution circuit did not take the lead");
        console2.log("  leader score (gate count):", uint256(score));
    }
}
