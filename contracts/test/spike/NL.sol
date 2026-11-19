// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Netlist builders. Wire format per Cerebr TAPEOUT.md 4.1, re-proven by the fork tests:
///   NAND = 00 a:u24 b:u24   LATCH = 01 d:u24   REF = 02 cpu:20B id:u64 nIn:u8 nOut:u8 ins:u24*nIn
/// Signals: 0 const0, 1 const1, inputs 2..1+nIn, then each element appends its outputs.
library NL {
    function nand(uint24 a, uint24 b) internal pure returns (bytes memory) {
        return abi.encodePacked(uint8(0), a, b);
    }

    function ref(address cpu, uint64 id, uint8 nOut, uint24[] memory ins) internal pure returns (bytes memory r) {
        r = abi.encodePacked(uint8(2), cpu, id, uint8(ins.length), nOut);
        for (uint256 i; i < ins.length; ++i) {
            r = bytes.concat(r, abi.encodePacked(ins[i]));
        }
    }

    /// @dev Wraps `id` on `cpu` as a pure REF: inputs 2..1+nIn wired straight through. Burns no transistors.
    function wrapper(address cpu, uint64 id, uint8 nIn, uint8 nOut) internal pure returns (bytes memory) {
        uint24[] memory ins = new uint24[](nIn);
        for (uint256 i; i < nIn; ++i) {
            ins[i] = uint24(2 + i);
        }
        return ref(cpu, id, nOut, ins);
    }

    /// @dev 4-NAND XOR of signals a and b whose first new signal is `next`. Returns (netlist, nextFree, outSignal).
    function xor4(bytes memory nl, uint24 next, uint24 a, uint24 b)
        internal
        pure
        returns (bytes memory, uint24, uint24)
    {
        nl = bytes.concat(nl, nand(a, b), nand(a, next), nand(b, next), nand(next + 1, next + 2));
        return (nl, next + 4, next + 3);
    }

    // ---- circuits used by the spike (nIn / nOut noted) ----

    /// 1 gate. nIn 1, nOut 1. out = NOT in0
    function notGate() internal pure returns (bytes memory) {
        return nand(2, 2);
    }

    /// 4 gates. nIn 2, nOut 1. out = in0 XOR in1
    function xor4Circuit() internal pure returns (bytes memory nl) {
        (nl,,) = xor4("", 4, 2, 3);
    }

    /// 6 gates (xor4 plus a redundant NOT-NOT). nIn 2, nOut 1
    function xor6Circuit() internal pure returns (bytes memory nl) {
        (nl,,) = xor4("", 4, 2, 3);
        nl = bytes.concat(nl, nand(7, 7), nand(8, 8));
    }

    /// 3 gates. nIn 2, nOut 1. out = in0 AND NOT in1 (asymmetric on purpose)
    function aAndNotB() internal pure returns (bytes memory) {
        return bytes.concat(nand(3, 3), nand(2, 4), nand(5, 5));
    }

    /// 5 gates. nIn 2, nOut 2. out0 = in0 XOR in1 (sum), out1 = in0 AND in1 (carry)
    function halfAdder() internal pure returns (bytes memory) {
        return bytes.concat(nand(2, 3), nand(2, 4), nand(3, 4), nand(5, 6), nand(4, 4));
    }

    /// 2 gates. nIn 9, nOut 1. out = in8 (lives in the second input byte)
    function bufferInput8() internal pure returns (bytes memory) {
        return bytes.concat(nand(10, 10), nand(11, 11));
    }

    /// 9 gates. nIn 1, nOut 9. every output = NOT in0
    function nineOutputs() internal pure returns (bytes memory nl) {
        for (uint256 i; i < 9; ++i) {
            nl = bytes.concat(nl, nand(2, 2));
        }
    }

    /// 28 gates. nIn 8, nOut 1. out = parity of the 8 inputs
    function parity8() internal pure returns (bytes memory nl) {
        uint24 acc = 2;
        uint24 next = 10;
        for (uint24 i = 1; i < 8; ++i) {
            (nl, next, acc) = xor4(nl, next, acc, 2 + i);
        }
    }
}
