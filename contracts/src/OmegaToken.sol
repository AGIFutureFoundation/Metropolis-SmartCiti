// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title tOMEGA: a Monad-testnet stand-in for $OMEGA
/// @notice $OMEGA lives on Solana/Base (Virtuals). This token is a test asset on Monad testnet so the
///         Omega swarm can make real x402 micropayments onchain. It has no market value, and no bridge
///         to $OMEGA exists. It implements EIP-3009 transferWithAuthorization, the gasless "exact"
///         scheme that x402 settles with: an agent signs an authorization and a facilitator submits it.
/// @dev    Minting is reserved for the StewardCouncil (people govern the supply).
contract OmegaToken is ERC20, ERC20Permit {
    bytes32 public constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    address public immutable council;
    mapping(address => mapping(bytes32 => bool)) public authorizationState;

    event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce);

    error OnlyCouncil();
    error AuthorizationNotYetValid();
    error AuthorizationExpired();
    error AuthorizationAlreadyUsed();
    error InvalidSignature();

    constructor(address council_) ERC20("Omega Testnet Token", "tOMEGA") ERC20Permit("Omega Testnet Token") {
        council = council_;
    }

    function decimals() public pure override returns (uint8) {
        return 6; // matches USDC-style x402 amounts
    }

    function mint(address to, uint256 amount) external {
        if (msg.sender != council) revert OnlyCouncil();
        _mint(to, amount);
    }

    /// @notice Fund many agent wallets in one steward-approved call (gas is charged by limit on Monad,
    ///         so one batched call is much cheaper than one governed call per agent).
    function mintBatch(address[] calldata to, uint256 amount) external {
        if (msg.sender != council) revert OnlyCouncil();
        for (uint256 i; i < to.length; ++i) {
            _mint(to[i], amount);
        }
    }

    /// @notice EIP-3009: execute a transfer signed off-chain by `from`.
    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        if (block.timestamp <= validAfter) revert AuthorizationNotYetValid();
        if (block.timestamp >= validBefore) revert AuthorizationExpired();
        if (authorizationState[from][nonce]) revert AuthorizationAlreadyUsed();
        bytes32 structHash =
            keccak256(abi.encode(TRANSFER_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce));
        if (ECDSA.recover(_hashTypedDataV4(structHash), v, r, s) != from) revert InvalidSignature();
        authorizationState[from][nonce] = true;
        emit AuthorizationUsed(from, nonce);
        _transfer(from, to, value);
    }
}
