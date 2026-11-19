// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IProcessorRegistry} from "../interfaces/ITapeOutLite.sol";

/// @notice TEST ONLY: freely mutable processor registry. Never use in production.
contract MockProcessorRegistry is IProcessorRegistry {
    mapping(address => bool) private _cpus;
    event CpuSet(address indexed circuits, bool registered);

    /// @notice TEST ONLY: anyone may change registration.
    function setCpu(address circuits, bool registered) external {
        _cpus[circuits] = registered;
        emit CpuSet(circuits, registered);
    }

    /// @notice Return the test registration flag.
    function isCPU(address circuits) external view override returns (bool) { return _cpus[circuits]; }
}
