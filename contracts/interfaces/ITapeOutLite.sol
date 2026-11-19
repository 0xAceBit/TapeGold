// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Minimal TapeOut interfaces proven by fork tests on X Layer; see ../../SPIKE.md
// from this directory (repository-root SPIKE.md). Names deliberately avoid spike artifacts.
interface IProcessorRegistry {
    /// @notice Whether a circuits contract is registered as a processor.
    function isCPU(address circuits) external view returns (bool);
}

interface ICircuitsLite {
    /// @notice Evaluate a combinational circuit, with input/output bits packed LSB first.
    /// @dev For <=8 inputs send one vector byte; for <=8 outputs read byte zero.
    /// Bits above nOut are zero. Latches revert "has latch: use step"; unknown IDs revert "no circuit".
    function eval(uint256 id, bytes calldata inputs) external view returns (bytes memory);
    /// @notice Return dimensions and flattened gate count, including REFs and LATCH gates.
    function circuitInfo(uint256 id) external view returns (uint32 nIn, uint32 nOut, uint32 nState, uint32 gateCount);
    /// @notice Return exactly the originally submitted bytes, immutable after tape-out.
    function netlist(uint256 id) external view returns (bytes memory);
    /// @notice Return current ERC-721 ownership; unknown IDs revert.
    function ownerOf(uint256 id) external view returns (address);
}
