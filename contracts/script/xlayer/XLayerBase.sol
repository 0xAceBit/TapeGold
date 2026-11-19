// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {StdCheats} from "forge-std/StdCheats.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Arena} from "../../Arena.sol";
import {IProcessorRegistry, ICircuitsLite} from "../../interfaces/ITapeOutLite.sol";
import {XLayerConfig} from "./XLayerConfig.sol";
import {SolutionCircuits} from "./SolutionCircuits.sol";

/// @dev TapeOut transistor contract functions used here (SPIKE.md C3, C5).
interface IXTransistors {
    function mint(uint256 id, uint256 amount) external payable;
    function mintPrice() external view returns (uint256);
    function protocolFee() external view returns (uint256);
    function supplyCap() external view returns (uint256);
    function minted() external view returns (uint256);
}

/// @dev TapeOut circuits functions used here (SPIKE.md C3, C5).
interface IXCircuits {
    function transistors() external view returns (address);
    function TAPEOUT_FEE() external view returns (uint256);
    function tapeout(bytes calldata nl, uint32 nIn, uint32 nOut) external payable returns (uint256);
    function nextId() external view returns (uint256);
}

/// @notice Shared plumbing for the X Layer scripts: mode handling, transaction printing and the three deployment steps.
/// @dev SAFETY MODEL
///      - Dry run (default): `CONFIRM_SPEND` is not `YES`. The script never calls a broadcast cheatcode, so even
///        `--broadcast` cannot send anything. It uses a prank on a funded throwaway sender.
///      - Live: `CONFIRM_SPEND=YES` and `DEPLOYER=<your address>` start a broadcast for that address. Nothing leaves
///        the machine unless forge is also run with `--broadcast`. Keys are never read here; use `--account` or a
///        hardware wallet.
///      Every transaction is printed with its target, value and calldata before it is executed.
abstract contract XLayerBase is Script, StdCheats {
    bool internal live;
    address internal deployer;
    uint256 internal txCount;

    // ------------------------------------------------------------------------------------------------- modes

    function _requireChain() internal view {
        require(block.chainid == XLayerConfig.CHAIN_ID, "not X Layer (chainid 196): run with --fork-url or --rpc-url");
    }

    function _begin(bool allowLive) internal {
        bool confirmed = keccak256(bytes(vm.envOr("CONFIRM_SPEND", string("")))) == keccak256(bytes("YES"));
        live = allowLive && confirmed;
        if (live) {
            deployer = vm.envAddress("DEPLOYER");
            require(deployer != address(0) && deployer != XLayerConfig.PLATFORM_DEPLOYER, "bad DEPLOYER");
            console2.log("MODE: LIVE. Broadcast is active for", deployer);
            console2.log("Nothing is sent unless forge was run with --broadcast.");
            vm.startBroadcast(deployer);
        } else {
            deployer = vm.envOr("DEPLOYER", address(uint160(uint256(keccak256("tapegolf.dryrun.deployer")))));
            vm.deal(deployer, 100 ether);
            vm.startPrank(deployer);
            console2.log("MODE: DRY RUN. No broadcast is ever started; nothing can be sent.");
            console2.log("Simulated sender", deployer);
        }
    }

    function _end() internal {
        if (live) vm.stopBroadcast();
        else vm.stopPrank();
    }

    // ------------------------------------------------------------------------------------------- tx printing

    function _announce(string memory label, address to, uint256 value, bytes memory data) internal {
        txCount++;
        console2.log("");
        console2.log(string.concat("TX ", vm.toString(txCount), ": ", label));
        console2.log("  to:    ", to);
        console2.log("  value: ", value, "wei");
        console2.log("  data:  ", vm.toString(data));
    }

    function _send(string memory label, address to, uint256 value, bytes memory data) internal returns (bytes memory ret) {
        _announce(label, to, value, data);
        bool ok;
        (ok, ret) = to.call{value: value}(data);
        if (!ok) {
            console2.log("  RESULT: REVERTED");
            _bubble(ret);
        }
    }

    function _bubble(bytes memory ret) internal pure {
        assembly {
            revert(add(ret, 32), mload(ret))
        }
    }

    function _label(string memory prefix, uint256 n, string memory name) internal pure returns (string memory) {
        return string.concat(prefix, vm.toString(n), ": ", name);
    }

    // ------------------------------------------------------------------------------------------- step 1: Arena

    function _deployArena(address feeRecipient, uint16 feeBps) internal returns (Arena arena) {
        require(feeRecipient != address(0) && feeRecipient != XLayerConfig.PLATFORM_DEPLOYER, "bad fee recipient");
        require(feeBps <= 1000, "fee above Arena cap");
        require(XLayerConfig.FACTORY.code.length > 0, "factory has no code");
        bytes memory args = abi.encode(XLayerConfig.FACTORY, feeRecipient, feeBps);
        txCount++;
        console2.log("");
        console2.log(string.concat("TX ", vm.toString(txCount), ": deploy Arena(registry, feeRecipient, feeBps)"));
        console2.log("  to:       (contract creation)");
        console2.log("  value:     0 wei");
        console2.log("  registry: ", XLayerConfig.FACTORY);
        console2.log("  feeRecipient:", feeRecipient);
        console2.log("  feeBps:   ", uint256(feeBps));
        console2.log("  encoded constructor args:", vm.toString(args));
        arena = new Arena(IProcessorRegistry(XLayerConfig.FACTORY), feeRecipient, feeBps);
        require(address(arena).code.length > 0, "Arena was not deployed");
        require(address(arena.registry()) == XLayerConfig.FACTORY, "registry mismatch");
        require(arena.feeRecipient() == feeRecipient && arena.feeBps() == feeBps, "config mismatch");
        console2.log("  Arena:", address(arena));
        console2.log("  constructor args:", vm.toString(args));
    }

    /// @dev Checks that `arena` runs exactly this repository's Arena code with its own constructor arguments, by deploying a
    ///      throwaway copy in simulation and comparing code hashes. Call BEFORE `_begin` so the copy is never broadcast.
    function _authenticateArena(Arena arena) internal {
        require(address(arena).code.length > 0, "ARENA has no code");
        if (keccak256(bytes(vm.envOr("SKIP_ARENA_BYTECODE_CHECK", string("")))) == keccak256(bytes("YES"))) {
            console2.log("WARNING: Arena bytecode check skipped on request");
            return;
        }
        Arena probe = new Arena(arena.registry(), arena.feeRecipient(), arena.feeBps());
        require(
            address(probe).codehash == address(arena).codehash,
            "ARENA code differs from this repository's Arena (set SKIP_ARENA_BYTECODE_CHECK=YES only if you built it with other compiler settings)"
        );
        console2.log("Arena bytecode matches this repository:", address(arena));
    }

    // ------------------------------------------------------------------------------------ step 2: challenges

    struct SeedParams {
        Arena arena;
        IERC20 token;
        address processor;
        uint256 potMilli;
        uint256 commitHours;
        uint256 revealHours;
        uint256 pot;
        uint64 commitEnd;
        uint64 revealEnd;
    }

    function _potUnits(IERC20 token, uint256 potMilli) internal view returns (uint256 pot) {
        require(potMilli > 0 && potMilli <= XLayerConfig.MAX_POT_MILLI, "pot outside the hard cap");
        require(potMilli * 3 <= XLayerConfig.MAX_TOTAL_POT_MILLI, "total pots above the hard cap");
        uint8 decimals = IERC20Metadata(address(token)).decimals();
        require(decimals >= 3 && decimals <= 18, "unsupported token decimals");
        pot = potMilli * (10 ** decimals) / 1000;
    }

    function _seed(SeedParams memory p) internal returns (uint256 firstId, uint256 pot) {
        pot = _seedChecks(p);
        p.pot = pot;
        _fundAndApprove(p);

        firstId = p.arena.challengeCount() + 1;
        p.commitEnd = uint64(block.timestamp + p.commitHours * 1 hours);
        p.revealEnd = uint64(uint256(p.commitEnd) + p.revealHours * 1 hours);
        for (uint256 i; i < SolutionCircuits.count(); ++i) {
            _createOne(p, i);
        }
        require(p.arena.challengeCount() == firstId + 2, "unexpected challenge count");
        require(p.token.allowance(deployer, address(p.arena)) == 0, "allowance left over after seeding");
        console2.log("first challenge id:", firstId);
    }

    function _seedChecks(SeedParams memory p) internal view returns (uint256 pot) {
        require(address(p.token).code.length > 0, "prize token has no code");
        require(address(p.arena.registry()) == XLayerConfig.FACTORY, "Arena is not wired to the TapeOut factory");
        require(IProcessorRegistry(XLayerConfig.FACTORY).isCPU(p.processor), "processor is not registered with the factory");
        pot = _potUnits(p.token, p.potMilli);
        console2.log("prize token:", address(p.token));
        console2.log("  symbol:", IERC20Metadata(address(p.token)).symbol());
        console2.log("  decimals:", uint256(IERC20Metadata(address(p.token)).decimals()));
        console2.log("pot per challenge (token base units):", pot);
        console2.log("total escrowed (token base units):", pot * SolutionCircuits.count());
    }

    function _fundAndApprove(SeedParams memory p) internal {
        uint256 total = p.pot * SolutionCircuits.count();
        if (!live) deal(address(p.token), deployer, total);
        require(p.token.balanceOf(deployer) >= total, "deployer does not hold enough prize token");
        _send("approve Arena to pull the pots", address(p.token), 0, abi.encodeCall(IERC20.approve, (address(p.arena), total)));
    }

    function _createOne(SeedParams memory p, uint256 i) internal {
        SolutionCircuits.Solution memory s = SolutionCircuits.get(i);
        require(SolutionCircuits.selfCheck(s), "solution does not match its own truth table");
        string memory label = _label("createChallenge #", i + 1, s.name);
        _send(label, address(p.arena), 0, encodeCreate(p, s));
    }

    /// @dev Equivalent to `abi.encodeCall(Arena.createChallenge, (...))`, built in pieces because encoding eight arguments
    ///      at once overflows the stack without via-IR. The equivalence is asserted in XLayerScripts.t.sol.
    function encodeCreate(SeedParams memory p, SolutionCircuits.Solution memory s) internal pure returns (bytes memory) {
        bytes memory head1 = abi.encode(p.token, p.pot, s.nIn, s.nOut);
        bytes memory head2 = abi.encode(uint256(8 * 32), p.commitEnd, p.revealEnd, p.processor);
        bytes memory tail = abi.encodePacked(s.table.length, s.table, new bytes((32 - s.table.length % 32) % 32));
        return bytes.concat(Arena.createChallenge.selector, head1, head2, tail);
    }

    // ------------------------------------------------------------------------------- step 3: solution circuits

    struct TapeOutCosts {
        uint256 gates;
        uint256 mintValue;
        uint256 tapeoutFee;
        uint256 totalValue;
    }

    function _costs(address processor) internal view returns (TapeOutCosts memory c) {
        IXTransistors t = IXTransistors(IXCircuits(processor).transistors());
        for (uint256 i; i < SolutionCircuits.count(); ++i) {
            c.gates += SolutionCircuits.get(i).gates;
        }
        c.mintValue = c.gates * t.mintPrice() + t.protocolFee();
        c.tapeoutFee = IXCircuits(processor).TAPEOUT_FEE();
        c.totalValue = c.mintValue + c.tapeoutFee * SolutionCircuits.count();
    }

    function _tapeOut(address processor) internal returns (uint256[3] memory ids) {
        require(IProcessorRegistry(XLayerConfig.FACTORY).isCPU(processor), "processor is not registered with the factory");
        TapeOutCosts memory c = _costs(processor);
        _printCosts(processor, c);
        if (!live) vm.deal(deployer, c.totalValue + 1 ether);
        require(deployer.balance >= c.totalValue, "deployer does not hold enough OKB for the TapeOut fees");

        address t = IXCircuits(processor).transistors();
        _send("mint NAND transistors for all three circuits", t, c.mintValue, abi.encodeCall(IXTransistors.mint, (0, c.gates)));
        for (uint256 i; i < SolutionCircuits.count(); ++i) {
            ids[i] = _tapeOutOne(processor, c.tapeoutFee, i);
        }
    }

    function _printCosts(address processor, TapeOutCosts memory c) internal view {
        IXTransistors t = IXTransistors(IXCircuits(processor).transistors());
        require(t.supplyCap() - t.minted() >= c.gates, "processor has too little transistor supply left");
        console2.log("processor:", processor);
        console2.log("NAND to mint:", c.gates);
        console2.log("mint price per transistor (wei):", t.mintPrice());
        console2.log("mint protocol fee (wei):", t.protocolFee());
        console2.log("tape-out fee each (wei):", c.tapeoutFee);
        console2.log("TOTAL native cost before gas (wei):", c.totalValue);
    }

    function _tapeOutOne(address processor, uint256 fee, uint256 i) internal returns (uint256 id) {
        SolutionCircuits.Solution memory s = SolutionCircuits.get(i);
        require(SolutionCircuits.selfCheck(s), "solution does not match its own truth table");
        string memory label = _label("tapeout #", i + 1, s.name);
        bytes memory data = abi.encodeCall(IXCircuits.tapeout, (s.netlist, s.nIn, s.nOut));
        _send(label, processor, fee, data);
        // In a simulation this is a PREDICTION: another wallet may tape out first. The authoritative id is the TapedOut event
        // of the confirmed transaction (scripts/xlayer-record.ts reads it), and Play.s.sol re-validates ownership and results.
        id = IXCircuits(processor).nextId();
        _checkOnchain(processor, id, s);
        console2.log("  circuit id:", id);
    }

    /// @dev Reads the new circuit back through the real TapeOut contract and grades every vector.
    function _checkOnchain(address processor, uint256 id, SolutionCircuits.Solution memory s) internal view {
        (uint32 nIn, uint32 nOut, uint32 nState, uint32 gates) = ICircuitsLite(processor).circuitInfo(id);
        require(nIn == s.nIn && nOut == s.nOut && nState == 0 && gates == s.gates, "circuitInfo does not match");
        require(ICircuitsLite(processor).ownerOf(id) == deployer, "unexpected circuit owner");
        for (uint256 v; v < (uint256(1) << s.nIn); ++v) {
            // forge-lint: disable-next-line(unsafe-typecast)
            bytes memory out = ICircuitsLite(processor).eval(id, abi.encodePacked(uint8(v)));
            uint8 mask = uint8((1 << s.nOut) - 1);
            require(uint8(out[0]) & mask == SolutionCircuits.expectedAt(s.table, s.nOut, v), "onchain eval differs from the truth table");
        }
    }

    // ------------------------------------------------------------------------------------ processor search

    struct CpuInfo {
        address transistors;
        uint256 room;
        uint256 price;
        uint256 pfee;
        uint256 tfee;
        bool ok;
    }

    function _cpuInfo(address processor) internal view returns (CpuInfo memory i) {
        (bool a, uint256 tAddr) = _word(processor, IXCircuits.transistors.selector);
        if (!a) return i;
        i.transistors = address(uint160(tAddr));
        (bool b, uint256 cap) = _word(i.transistors, IXTransistors.supplyCap.selector);
        (bool c, uint256 minted) = _word(i.transistors, IXTransistors.minted.selector);
        (bool d, uint256 price) = _word(i.transistors, IXTransistors.mintPrice.selector);
        (bool e, uint256 pfee) = _word(i.transistors, IXTransistors.protocolFee.selector);
        (bool f, uint256 tfee) = _word(processor, IXCircuits.TAPEOUT_FEE.selector);
        i.ok = b && c && d && e && f && cap >= minted;
        i.room = cap - minted;
        i.price = price;
        i.pfee = pfee;
        i.tfee = tfee;
    }

    /// @dev True when a throwaway wallet can mint one NAND and tape out a 1-gate circuit on `processor` (simulated, then undone).
    function _probe(address processor) internal returns (bool) {
        CpuInfo memory i = _cpuInfo(processor);
        if (!i.ok || i.room < 100 || i.price > 1e15) return false;
        address who = address(uint160(uint256(keccak256("tapegolf.probe"))));
        vm.deal(who, 10 ether);
        uint256 snap = vm.snapshotState();
        vm.startPrank(who);
        (bool m,) = i.transistors.call{value: i.price + i.pfee}(abi.encodeCall(IXTransistors.mint, (0, 1)));
        bool w;
        if (m) {
            bytes memory nl = abi.encodePacked(uint8(0), uint24(2), uint24(2));
            (w,) = processor.call{value: i.tfee}(abi.encodeCall(IXCircuits.tapeout, (nl, 1, 1)));
        }
        vm.stopPrank();
        vm.revertToState(snap);
        return w;
    }

    function _word(address target, bytes4 sel) internal view returns (bool ok, uint256 v) {
        bytes memory ret;
        (ok, ret) = target.staticcall(abi.encodeWithSelector(sel));
        if (ok && ret.length >= 32) v = abi.decode(ret, (uint256));
        else ok = false;
    }

    function _pickProcessor(uint256 scan) internal returns (address) {
        IXCpus f = IXCpus(XLayerConfig.FACTORY);
        uint256 n = f.cpuCount();
        for (uint256 k; k < scan && k < n; ++k) {
            address c = f.cpus(n - 1 - k);
            if (_probe(c)) return c;
        }
        revert("no open processor found");
    }
}

/// @dev Factory list functions (SPIKE.md C1 / Cerebr TAPEOUT.md; re-read live).
interface IXCpus {
    function cpuCount() external view returns (uint256);
    function cpus(uint256 i) external view returns (address);
}
