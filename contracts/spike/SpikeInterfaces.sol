// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

// Interfaces come from the OCCC repo (gm-lsp/Tape-OCCC, src/interfaces/ITapeOut.sol at commit bc0c64b, vendored unchanged in ./vendor/OCCC_ITapeOut.sol).
// That file targets BNB Smart Chain and does NOT declare eval or step, so those two come from the
// Cerebr integration notes (NetLayerLabs/Cerebr, TAPEOUT.md section 4.2) and are exercised by the
// fork tests before anything relies on them.
import {ITapeOutFactory, ITapeOutTransistors, ITapeOutCircuits} from "./vendor/OCCC_ITapeOut.sol";

/// @notice eval and step as seen on X Layer (not part of the OCCC interface file).
interface ITapeOutEval {
    function eval(uint256 id, bytes calldata inputs) external view returns (bytes memory);
    function step(uint256 id, bytes calldata state, bytes calldata inputs)
        external
        view
        returns (bytes memory newState, bytes memory outputs);
}

/// @notice Extra reads the spike needs that OCCC's interface does not declare.
interface ITapeOutExtras {
    function nextId() external view returns (uint256);
    function ownerOf(uint256 id) external view returns (address);
    function cpus(uint256 i) external view returns (address);
    function cpuCount() external view returns (uint256);
    function protocolFee() external view returns (uint256);
}
