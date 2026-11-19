// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Arena} from "../Arena.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {SolutionCircuits} from "../script/xlayer/SolutionCircuits.sol";
import {XLayerBase} from "../script/xlayer/XLayerBase.sol";

/// @dev Exposes the script's internal calldata builder.
contract EncodeHarness is XLayerBase {
    function enc(IERC20 token, uint256 pot, address processor, uint64 ce, uint64 re, uint256 solution)
        external
        pure
        returns (bytes memory)
    {
        SeedParams memory p;
        p.token = token;
        p.pot = pot;
        p.processor = processor;
        p.commitEnd = ce;
        p.revealEnd = re;
        return encodeCreate(p, SolutionCircuits.get(solution));
    }
}

/// @notice Offline checks of the three seeded solution circuits and of the script's calldata builder.
contract XLayerSolutionsTest is Test {
    EncodeHarness internal h = new EncodeHarness();

    function test_everySolutionReproducesItsOwnTruthTable() public pure {
        for (uint256 i; i < SolutionCircuits.count(); ++i) {
            assertTrue(SolutionCircuits.selfCheck(SolutionCircuits.get(i)), "netlist differs from its table");
        }
    }

    function test_gateCountsAndShape() public pure {
        SolutionCircuits.Solution memory fa = SolutionCircuits.fullAdder();
        SolutionCircuits.Solution memory mj = SolutionCircuits.majority3();
        SolutionCircuits.Solution memory pa = SolutionCircuits.parity4();
        assertEq(fa.gates, 9);
        assertEq(mj.gates, 6);
        assertEq(pa.gates, 12);
        assertEq(fa.netlist.length, 63);
        assertEq(mj.netlist.length, 42);
        assertEq(pa.netlist.length, 84);
        assertEq(uint256(fa.nIn) * 10 + fa.nOut, 32);
        assertEq(uint256(mj.nIn) * 10 + mj.nOut, 31);
        assertEq(uint256(pa.nIn) * 10 + pa.nOut, 41);
        assertEq(fa.table.length, 2); // 8 vectors x 2 outputs = 16 bits
        assertEq(mj.table.length, 1);
        assertEq(pa.table.length, 2);
    }

    /// Independent spot checks, written from the definitions rather than from the tables.
    function test_spotChecksFromTheDefinitions() public pure {
        SolutionCircuits.Solution memory fa = SolutionCircuits.fullAdder();
        for (uint256 v; v < 8; ++v) {
            uint256 a = v & 1;
            uint256 b = (v >> 1) & 1;
            uint256 c = (v >> 2) & 1;
            uint256 total = a + b + c;
            uint8 want = uint8((total & 1) | ((total >> 1) << 1)); // out0 = sum, out1 = carry
            assertEq(SolutionCircuits.simulate(fa.netlist, 3, 2, v), want, "full adder");
        }
        SolutionCircuits.Solution memory mj = SolutionCircuits.majority3();
        assertEq(SolutionCircuits.simulate(mj.netlist, 3, 1, 0x3), 1); // 1,1,0
        assertEq(SolutionCircuits.simulate(mj.netlist, 3, 1, 0x1), 0); // 1,0,0
        assertEq(SolutionCircuits.simulate(mj.netlist, 3, 1, 0x7), 1);
        SolutionCircuits.Solution memory pa = SolutionCircuits.parity4();
        assertEq(SolutionCircuits.simulate(pa.netlist, 4, 1, 0xF), 0);
        assertEq(SolutionCircuits.simulate(pa.netlist, 4, 1, 0x7), 1);
        assertEq(SolutionCircuits.simulate(pa.netlist, 4, 1, 0x0), 0);
    }

    function test_netlistsAreFlatNandOnly() public pure {
        for (uint256 i; i < SolutionCircuits.count(); ++i) {
            bytes memory nl = SolutionCircuits.get(i).netlist;
            assertEq(nl.length % 7, 0);
            for (uint256 k; k < nl.length / 7; ++k) {
                assertEq(uint8(nl[7 * k]), 0, "every record is a NAND (tag 00): no REF, no LATCH");
            }
        }
    }

    /// The script builds calldata in pieces; it must equal the compiler's own encoding.
    function test_scriptCalldataMatchesAbiEncodeCall() public {
        MockERC20 token = new MockERC20();
        address processor = address(0xBEEF);
        for (uint256 i; i < SolutionCircuits.count(); ++i) {
            SolutionCircuits.Solution memory s = SolutionCircuits.get(i);
            bytes memory viaScript = h.enc(token, 1_000_000, processor, 1000, 2000, i);
            bytes memory viaCompiler = _compilerEncoding(token, processor, s);
            assertEq(viaScript, viaCompiler);
        }
    }

    function _compilerEncoding(MockERC20 token, address processor, SolutionCircuits.Solution memory s)
        private
        pure
        returns (bytes memory)
    {
        return abi.encodeCall(
            Arena.createChallenge, (IERC20(address(token)), 1_000_000, s.nIn, s.nOut, s.table, uint64(1000), uint64(2000), processor)
        );
    }
}
