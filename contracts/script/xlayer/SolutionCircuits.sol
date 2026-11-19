// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Flat NAND-only solution circuits and truth tables for the three seeded challenges.
/// @dev Netlist wire format (SPIKE C10): NAND = 00 a:u24 b:u24, 7 bytes. Signals: 0 const0, 1 const1, inputs from 2,
///      gate k outputs signal 2 + nIn + k. Outputs are the last nOut signals, output 0 first (SPIKE C7).
///      Truth table packing (Arena.createChallenge): output bit j of vector v is bit v * nOut + j, LSB first.
///      `simulate` re-implements the evaluation in Solidity so the scripts can check every netlist against its table
///      before anything is sent.
library SolutionCircuits {
    struct Solution {
        string name;
        uint8 nIn;
        uint8 nOut;
        bytes netlist;
        uint32 gates;
        bytes table;
    }

    function count() internal pure returns (uint256) {
        return 3;
    }

    function get(uint256 i) internal pure returns (Solution memory) {
        if (i == 0) return fullAdder();
        if (i == 1) return majority3();
        if (i == 2) return parity4();
        revert("no such solution");
    }

    // ---------------------------------------------------------------------------------------------- circuits

    /// @dev Full adder: inputs a (in0), b (in1), carry-in (in2). out0 = sum, out1 = carry-out. 9 NAND gates.
    function fullAdder() internal pure returns (Solution memory s) {
        // g0=N(a,b) g1=N(a,g0) g2=N(b,g0) g3=N(g1,g2)=a^b g4=N(g3,c) g5=N(g3,g4) g6=N(c,g4) g7=N(g5,g6)=sum g8=N(g0,g4)=carry
        bytes memory nl;
        nl = _add(nl, 2, 3);
        nl = _add(nl, 2, 5);
        nl = _add(nl, 3, 5);
        nl = _add(nl, 6, 7);
        nl = _add(nl, 8, 4);
        nl = _add(nl, 8, 9);
        nl = _add(nl, 4, 9);
        nl = _add(nl, 10, 11);
        nl = _add(nl, 5, 9);
        uint8[] memory expected = new uint8[](8);
        for (uint256 v; v < 8; ++v) {
            expected[v] = uint8(_ones(v)); // sum bit and carry bit together equal the number of ones, 0..3
        }
        s = Solution("Full adder", 3, 2, nl, 9, pack(expected, 2));
    }

    /// @dev Majority of three inputs. 6 NAND gates.
    function majority3() internal pure returns (Solution memory s) {
        // g0=N(a,b) g1=N(b,c) g2=N(a,c) g3=N(g0,g1) g4=N(g3,g3) g5=N(g4,g2)=maj
        bytes memory nl;
        nl = _add(nl, 2, 3);
        nl = _add(nl, 3, 4);
        nl = _add(nl, 2, 4);
        nl = _add(nl, 5, 6);
        nl = _add(nl, 8, 8);
        nl = _add(nl, 9, 7);
        uint8[] memory expected = new uint8[](8);
        for (uint256 v; v < 8; ++v) {
            expected[v] = _ones(v) >= 2 ? 1 : 0;
        }
        s = Solution("3-input majority", 3, 1, nl, 6, pack(expected, 1));
    }

    /// @dev Parity (XOR) of four inputs, as three chained 4-NAND XORs. 12 NAND gates.
    function parity4() internal pure returns (Solution memory s) {
        bytes memory nl;
        uint24 acc = 2;
        uint24 next = 6; // first gate output after inputs 2..5
        for (uint24 i = 1; i < 4; ++i) {
            uint24 b = 2 + i;
            nl = _add(nl, acc, b);
            nl = _add(nl, acc, next);
            nl = _add(nl, b, next);
            nl = _add(nl, next + 1, next + 2);
            acc = next + 3;
            next += 4;
        }
        uint8[] memory expected = new uint8[](16);
        for (uint256 v; v < 16; ++v) {
            expected[v] = uint8(_ones(v) & 1);
        }
        s = Solution("4-bit parity", 4, 1, nl, 12, pack(expected, 1));
    }

    // ------------------------------------------------------------------------------------------------ helpers

    /// @dev Packs one nOut-bit value per vector into Arena's truth table encoding.
    function pack(uint8[] memory values, uint8 nOut) internal pure returns (bytes memory t) {
        uint256 bits = values.length * nOut;
        t = new bytes((bits + 7) / 8);
        for (uint256 v; v < values.length; ++v) {
            for (uint256 j; j < nOut; ++j) {
                if ((values[v] >> j) & 1 == 1) {
                    uint256 p = v * nOut + j;
                    t[p >> 3] = bytes1(uint8(t[p >> 3]) | uint8(1 << (p & 7)));
                }
            }
        }
    }

    /// @dev Evaluates a flat NAND netlist for input vector `v`. Returns the nOut output bits (output 0 = bit 0).
    function simulate(bytes memory netlist, uint8 nIn, uint8 nOut, uint256 v) internal pure returns (uint8 out) {
        require(netlist.length % 7 == 0, "bad netlist length");
        uint256 gates = netlist.length / 7;
        uint256 total = 2 + nIn + gates;
        uint8[] memory sig = new uint8[](total);
        sig[1] = 1;
        for (uint256 i; i < nIn; ++i) {
            sig[2 + i] = uint8((v >> i) & 1);
        }
        for (uint256 k; k < gates; ++k) {
            uint256 o = 7 * k;
            require(netlist[o] == 0x00, "not a NAND");
            uint256 a = (uint256(uint8(netlist[o + 1])) << 16) | (uint256(uint8(netlist[o + 2])) << 8) | uint8(netlist[o + 3]);
            uint256 b = (uint256(uint8(netlist[o + 4])) << 16) | (uint256(uint8(netlist[o + 5])) << 8) | uint8(netlist[o + 6]);
            require(a < 2 + nIn + k && b < 2 + nIn + k, "future signal");
            sig[2 + nIn + k] = (sig[a] & sig[b]) == 1 ? 0 : 1;
        }
        for (uint256 j; j < nOut; ++j) {
            out |= sig[total - nOut + j] << j;
        }
    }

    /// @dev The expected nOut-bit value of vector v, read from a packed table.
    function expectedAt(bytes memory table, uint8 nOut, uint256 v) internal pure returns (uint8 value) {
        for (uint256 j; j < nOut; ++j) {
            uint256 p = v * nOut + j;
            value |= ((uint8(table[p >> 3]) >> (p & 7)) & 1) << j;
        }
    }

    /// @dev True when the solution's netlist reproduces its own truth table on every vector.
    function selfCheck(Solution memory s) internal pure returns (bool) {
        if (s.netlist.length != uint256(s.gates) * 7) return false;
        for (uint256 v; v < (uint256(1) << s.nIn); ++v) {
            if (simulate(s.netlist, s.nIn, s.nOut, v) != expectedAt(s.table, s.nOut, v)) return false;
        }
        return true;
    }

    function _add(bytes memory nl, uint24 a, uint24 b) private pure returns (bytes memory) {
        return bytes.concat(nl, abi.encodePacked(uint8(0), a, b));
    }

    function _ones(uint256 v) private pure returns (uint256 n) {
        while (v != 0) {
            n += v & 1;
            v >>= 1;
        }
    }
}
