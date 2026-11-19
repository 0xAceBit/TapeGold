// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import {ERC721Holder} from "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import {ITapeOutCircuits, ITapeOutTransistors, ITapeOutEval, ITapeOutExtras} from "./SpikeInterfaces.sol";

/// @notice A contract that calls TapeOut the way a contest contract would, and reports gas.
contract EvalCaller {
    function evalOnce(address circuits, uint256 id, bytes calldata inputs)
        external
        view
        returns (bytes memory out, uint256 gasUsed)
    {
        uint256 g = gasleft();
        out = ITapeOutEval(circuits).eval(id, inputs);
        gasUsed = g - gasleft();
    }

    /// @dev Runs eval for vectors 0..vectors-1, one input byte each. Returns first output byte of each.
    function sweep(address circuits, uint256 id, uint256 vectors)
        external
        view
        returns (bytes memory firstBytes, uint256 gasUsed)
    {
        firstBytes = new bytes(vectors);
        uint256 g = gasleft();
        for (uint256 i; i < vectors; ++i) {
            bytes memory o = ITapeOutEval(circuits).eval(id, abi.encodePacked(uint8(i)));
            firstBytes[i] = o[0];
        }
        gasUsed = g - gasleft();
    }

    function infoGas(address circuits, uint256 id)
        external
        view
        returns (uint32 nIn, uint32 nOut, uint32 nState, uint32 gateCount, uint256 gasUsed)
    {
        uint256 g = gasleft();
        (nIn, nOut, nState, gateCount) = ITapeOutCircuits(circuits).circuitInfo(id);
        gasUsed = g - gasleft();
    }

    function netlistGas(address circuits, uint256 id) external view returns (uint256 len, bytes32 h, uint256 gasUsed) {
        uint256 g = gasleft();
        bytes memory nl = ITapeOutCircuits(circuits).netlist(id);
        gasUsed = g - gasleft();
        len = nl.length;
        h = keccak256(nl);
    }

    function ownerGas(address circuits, uint256 id) external view returns (address owner, uint256 gasUsed) {
        uint256 g = gasleft();
        owner = ITapeOutExtras(circuits).ownerOf(id);
        gasUsed = g - gasleft();
    }
}

/// @notice A contract that tapes circuits out. No ERC-1155 or ERC-721 receiver hooks.
contract BareDesigner {
    function mintAndTapeout(address circuits, bytes calldata nl, uint32 nIn, uint32 nOut, uint256 nandCount)
        external
        payable
        returns (uint256 id)
    {
        _go(circuits, nl, nIn, nOut, nandCount);
        id = ITapeOutExtras(circuits).nextId();
    }

    function _go(address circuits, bytes calldata nl, uint32 nIn, uint32 nOut, uint256 nandCount) internal {
        ITapeOutTransistors t = ITapeOutTransistors(ITapeOutCircuits(circuits).transistors());
        if (nandCount > 0) {
            t.mint{value: nandCount * t.mintPrice() + t.protocolFee()}(0, nandCount);
        }
        ITapeOutCircuits(circuits).tapeout{value: ITapeOutCircuits(circuits).TAPEOUT_FEE()}(nl, nIn, nOut);
    }
}

/// @notice Same, but able to receive ERC-1155 transistors and ERC-721 circuit NFTs.
contract ReceiverDesigner is BareDesigner, ERC1155Holder, ERC721Holder {}

/// @notice Can receive ERC-1155 only (no ERC-721 receiver hook).
contract Erc1155OnlyDesigner is BareDesigner, ERC1155Holder {}
