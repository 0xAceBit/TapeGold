// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MockERC20} from "./MockERC20.sol";

/// @notice TEST ONLY: burns floor(amount / 100) on every non-mint/non-burn transfer.
/// Inherits unrestricted minting, six decimals, and standard ERC-20 methods.
contract FeeOnTransferERC20 is MockERC20 {
    function _update(address from, address to, uint256 amount) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 fee = amount / 100;
            if (fee != 0) super._update(from, address(0), fee);
            super._update(from, to, amount - fee);
        } else {
            super._update(from, to, amount);
        }
    }
}
