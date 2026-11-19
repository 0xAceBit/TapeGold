// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ICircuitsLite} from "../interfaces/ITapeOutLite.sol";

/// @notice TEST ONLY: arbitrary circuit metadata and truth tables, not a real ERC-721.
/// @dev Does not register itself. String reverts intentionally reproduce TapeOut eval behavior.
contract MockCircuits is ICircuitsLite {
    struct Circuit {
        address owner;
        bytes netlistBytes;
        uint32 nIn;
        uint32 nOut;
        uint32 nState;
        uint32 gateCount;
        bytes table;
    }

    uint256 private _count;
    mapping(uint256 => Circuit) private _circuits;
    error ZeroOwner();
    error NotOwner();
    error UnsupportedInputCount(uint32 nIn);
    error InvalidTableLength(uint256 got, uint256 want);
    event TapedOut(uint256 indexed id, address indexed owner, uint32 nIn, uint32 nOut, uint32 nState, uint32 gateCount);
    event OwnerTransferred(uint256 indexed id, address indexed from, address indexed to);

    /// @notice TEST ONLY: create a fake circuit with caller-supplied metadata and table.
    function tapeout(
        address owner, bytes calldata netlistBytes, uint32 nIn, uint32 nOut,
        uint32 nState, uint32 gateCount, bytes calldata table
    ) external returns (uint256 id) {
        if (owner == address(0)) revert ZeroOwner();
        if (nIn > 8) revert UnsupportedInputCount(nIn);
        uint256 vectors = uint256(1) << nIn;
        if (table.length != vectors) revert InvalidTableLength(table.length, vectors);
        id = ++_count;
        _circuits[id] = Circuit(owner, netlistBytes, nIn, nOut, nState, gateCount, table);
        emit TapedOut(id, owner, nIn, nOut, nState, gateCount);
    }

    /// @notice Return one table byte; absent inputs are zero and excess input bits are ignored.
    function eval(uint256 id, bytes calldata inputs) external view virtual override returns (bytes memory) {
        Circuit storage c = _circuit(id);
        require(c.nState == 0, "has latch: use step");
        uint256 v = inputs.length == 0 ? 0 : uint8(inputs[0]);
        v &= (uint256(1) << c.nIn) - 1;
        return abi.encodePacked(c.table[v]);
    }

    /// @notice Return configured dimensions and gate count.
    function circuitInfo(uint256 id) external view override returns (uint32 nIn, uint32 nOut, uint32 nState, uint32 gateCount) {
        Circuit storage c = _circuit(id);
        return (c.nIn, c.nOut, c.nState, c.gateCount);
    }

    /// @notice Return the immutable fake netlist bytes.
    function netlist(uint256 id) external view override returns (bytes memory) { return _circuit(id).netlistBytes; }

    /// @notice Return the current fake owner, reverting for nonexistent IDs.
    function ownerOf(uint256 id) external view override returns (address) { return _circuit(id).owner; }

    /// @notice TEST ONLY: current owner may transfer ownership, without ERC-721 machinery.
    function transferOwner(uint256 id, address to) external {
        Circuit storage c = _circuit(id);
        if (msg.sender != c.owner) revert NotOwner();
        if (to == address(0)) revert ZeroOwner();
        address from = c.owner;
        c.owner = to;
        emit OwnerTransferred(id, from, to);
    }

    function _circuit(uint256 id) private view returns (Circuit storage c) {
        require(id != 0 && id <= _count, "no circuit");
        return _circuits[id];
    }
}
