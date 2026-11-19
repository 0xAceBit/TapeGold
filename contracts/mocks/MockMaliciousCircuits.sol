// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MockCircuits} from "./MockCircuits.sol";

/// @notice TEST ONLY: unregistered processor impersonator that can supply correct truth tables.
/// @dev Inherits tapeout and eval from MockCircuits. Intentionally never registers itself;
/// tests must leave this address absent from MockProcessorRegistry to exercise rejection.
contract MockMaliciousCircuits is MockCircuits {}
