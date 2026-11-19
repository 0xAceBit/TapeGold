// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {ITapeOutFactory, ITapeOutTransistors, ITapeOutCircuits, ITapeOutEval, ITapeOutExtras} from "../../spike/SpikeInterfaces.sol";
import {EvalCaller} from "../../spike/SpikeContracts.sol";
import {NL} from "./NL.sol";

/// @notice Shared fork setup. Everything here talks to real X Layer state (chainId 196).
abstract contract SpikeBase is Test {
    // Factory: from OCCC test/Copies.t.sol (chain 196 branch) and Cerebr TAPEOUT.md; re-read live below.
    ITapeOutFactory internal constant FACTORY = ITapeOutFactory(0x1f09DAeFA827f02CBb40967cc91b259763760761);
    // Cerebr processor circuits contract (Cerebr launch/out/196.json); isCPU is asserted live in the tests.
    address internal constant CEREBR = 0xB04EB79D1A5EECaabAAfF7B77d7c27578EE693FF;
    uint256 internal constant PIN_BLOCK = 76_080_000;

    EvalCaller internal caller;
    address internal designer = makeAddr("designer");
    address internal copier = makeAddr("copier");

    function setUp() public virtual {
        vm.createSelectFork(vm.rpcUrl("xlayer"), vm.envOr("XLAYER_FORK_BLOCK", PIN_BLOCK));
        assertEq(block.chainid, 196, "not X Layer");
        caller = new EvalCaller();
        vm.deal(address(this), 100 ether);
        vm.deal(designer, 100 ether);
        vm.deal(copier, 100 ether);
    }

    /// @dev createCPU reverts on the forked chain (see SpikeAB test_a_createCpuReverts), so this finds an existing
    ///      processor that still has free transistor supply and accepts a tape-out from an arbitrary wallet.
    ///      Walks the factory list from the newest CPU down and probes with a snapshot that is reverted afterwards.
    struct CpuInfo {
        address circuits;
        address transistors;
        uint256 room;
        uint256 price;
        uint256 pfee;
        uint256 tfee;
        bool ok;
    }

    function _cpuInfo(address c) internal view returns (CpuInfo memory i) {
        i.circuits = c;
        (bool ok0, uint256 t256) = _u(c, ITapeOutCircuits.transistors.selector);
        if (!ok0) return i;
        i.transistors = address(uint160(t256));
        (bool ok1, uint256 cap) = _u(i.transistors, ITapeOutTransistors.supplyCap.selector);
        (bool ok2, uint256 minted) = _u(i.transistors, ITapeOutTransistors.minted.selector);
        (bool ok3, uint256 price) = _u(i.transistors, ITapeOutTransistors.mintPrice.selector);
        (bool ok4, uint256 pfee) = _u(i.transistors, ITapeOutTransistors.protocolFee.selector);
        (bool ok5, uint256 tfee) = _u(c, ITapeOutCircuits.TAPEOUT_FEE.selector);
        i.ok = ok1 && ok2 && ok3 && ok4 && ok5 && cap >= minted;
        i.room = cap - minted;
        i.price = price;
        i.pfee = pfee;
        i.tfee = tfee;
    }

    function _probe(CpuInfo memory i) internal returns (bool) {
        vm.startPrank(designer);
        (bool m,) = i.transistors.call{value: i.price + i.pfee}(abi.encodeCall(ITapeOutTransistors.mint, (0, 1)));
        bool w;
        if (m) {
            (w,) = i.circuits.call{value: i.tfee}(abi.encodeCall(ITapeOutCircuits.tapeout, (NL.notGate(), 1, 1)));
        }
        vm.stopPrank();
        return w;
    }

    function _openCpu() internal returns (address circuits, address transistors) {
        ITapeOutExtras f = ITapeOutExtras(address(FACTORY));
        uint256 n = f.cpuCount();
        for (uint256 k; k < 150 && k < n; ++k) {
            CpuInfo memory i = _cpuInfo(f.cpus(n - 1 - k));
            if (!i.ok || i.room < 200 || i.price > 1e16) continue;
            uint256 snap = vm.snapshotState();
            bool works = _probe(i);
            vm.revertToState(snap);
            if (works) {
                console2.log("using open CPU (circuits)", i.circuits);
                return (i.circuits, i.transistors);
            }
        }
        revert("no open CPU found");
    }

    function _u(address target, bytes4 sel) internal view returns (bool ok, uint256 v) {
        bytes memory ret;
        (ok, ret) = target.staticcall(abi.encodeWithSelector(sel));
        if (ok && ret.length >= 32) v = abi.decode(ret, (uint256));
        else ok = false;
    }

    /// @dev Mints `nands` NAND (exact price) and tapes out as `who`. Returns the new circuit id.
    function _tapeout(address who, address circuits, bytes memory nl, uint32 nIn, uint32 nOut, uint256 nands)
        internal
        returns (uint256 id)
    {
        ITapeOutTransistors t = ITapeOutTransistors(ITapeOutCircuits(circuits).transistors());
        vm.startPrank(who);
        if (nands > 0) t.mint{value: nands * t.mintPrice() + t.protocolFee()}(0, nands);
        id = ITapeOutCircuits(circuits).tapeout{value: ITapeOutCircuits(circuits).TAPEOUT_FEE()}(nl, nIn, nOut);
        vm.stopPrank();
    }

    function _eval(address circuits, uint256 id, bytes memory input) internal view returns (bytes memory) {
        return ITapeOutEval(circuits).eval(id, input);
    }

    function _info(address circuits, uint256 id)
        internal
        view
        returns (uint32 nIn, uint32 nOut, uint32 nState, uint32 gateCount)
    {
        return ITapeOutCircuits(circuits).circuitInfo(id);
    }

    /// @dev Low-level call returning (ok, revert string or hex). Never reverts.
    function _try(address target, bytes memory data, uint256 value) internal returns (bool ok, string memory why) {
        bytes memory ret;
        (ok, ret) = target.call{value: value}(data);
        if (ok) return (true, "");
        if (ret.length >= 68 && bytes4(ret) == 0x08c379a0) {
            bytes memory body = new bytes(ret.length - 4);
            for (uint256 i; i < body.length; ++i) {
                body[i] = ret[i + 4];
            }
            return (false, abi.decode(body, (string)));
        }
        return (false, vm.toString(ret));
    }
}
