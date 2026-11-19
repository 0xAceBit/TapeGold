// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Fixed inputs for the X Layer (chainId 196) scripts. Every value has a source; nothing is guessed.
library XLayerConfig {
    /// @dev X Layer mainnet.
    uint256 internal constant CHAIN_ID = 196;

    /// @dev TapeOut factory. SPIKE.md C1 (isCPU registry), re-read live; also used by gm-lsp/Tape-OCCC test/Copies.t.sol.
    address internal constant FACTORY = 0x1f09DAeFA827f02CBb40967cc91b259763760761;

    /// @dev Fee recipient, supplied by the user in chat. It can only ever receive the fee.
    address internal constant FEE_RECIPIENT = 0x362f5b4391AC51a56b13F9A63E98bB95731E86a3;

    /// @dev Native USDC issued by Circle on X Layer (6 decimals). Source: OKX "Native USDC & CCTP are Now Live on X Layer"
    ///      (web3.okx.com/learn/usdc-cctp-on-xlayer) and OKX payments docs; symbol and decimals re-read onchain.
    ///      Override with PRIZE_TOKEN. The bridged USDC (0x74b7...) and USD₮0 (0x779D...) are other options.
    address internal constant DEFAULT_PRIZE_TOKEN = 0xB6CEceAB302E2E4948951eE7843FC24E92933061;

    /// @dev The shared Arc Studio platform deployer wallet. It must never be a deployer, sponsor or fee recipient here.
    address internal constant PLATFORM_DEPLOYER = 0x5B12Ce46C7194aD57d143bC22847224047b1Ef42;

    /// @dev Default fee: 2.5%. Arena itself caps the fee at 10%.
    uint16 internal constant DEFAULT_FEE_BPS = 250;

    /// @dev Pot sizes are in thousandths of one whole token. Default 1.000 token per challenge.
    uint256 internal constant DEFAULT_POT_MILLI = 1000;
    /// @dev Hard cap per challenge: 5.000 whole tokens.
    uint256 internal constant MAX_POT_MILLI = 5000;
    /// @dev Hard cap for the three seeded challenges together: 10.000 whole tokens.
    uint256 internal constant MAX_TOTAL_POT_MILLI = 10_000;

    /// @dev Default phase lengths for the seeded challenges. Arena caps each phase at 90 days.
    uint256 internal constant DEFAULT_COMMIT_HOURS = 48;
    uint256 internal constant DEFAULT_REVEAL_HOURS = 48;
}
