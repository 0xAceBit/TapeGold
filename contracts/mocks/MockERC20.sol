// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice TEST ONLY: six-decimal ERC-20 with unrestricted minting.
contract MockERC20 is ERC20 {
    constructor() ERC20("MockERC20", "MOCK") {}

    /// @notice Return six decimals.
    function decimals() public pure override returns (uint8) { return 6; }

    /// @notice TEST ONLY: anyone may mint arbitrary amounts to any account.
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}
