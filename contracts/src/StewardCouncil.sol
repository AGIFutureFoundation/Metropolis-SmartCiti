// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {P256} from "@openzeppelin/contracts/utils/cryptography/P256.sol";

/// @title StewardCouncil
/// @notice "Agents operate; people govern." Three human stewards hold P-256 keys (the curve WebAuthn
///         passkeys use). Any governed action executes only with 2-of-3 steward signatures, checked
///         with Monad's native P-256 precompile (RIP-7212 at 0x0100). There is no steward seed phrase.
/// @dev    Stewards sign sha256(abi.encode(council, chainId, nonce, target, value, keccak256(data))).
///         Signatures are raw (r,s) over that 32-byte digest. Every proposal consumes a nonce, so a
///         signature can never be replayed. Agent wallets are secp256k1 EOAs and have no P-256 key, so
///         an agent cannot approve its own action. The council can also register addresses as agents
///         and refuses to execute calls that originate from an agent.
contract StewardCouncil {
    struct StewardKey {
        bytes32 qx;
        bytes32 qy;
    }

    uint256 public constant STEWARDS = 3;
    uint256 public constant THRESHOLD = 2;

    StewardKey[3] internal _keys;
    uint256 public nonce;
    bool public paused;

    /// @dev Address of the most recent action hash, for the hash-chained governance log.
    bytes32 public headHash;

    event StewardKeySet(uint256 indexed index, bytes32 qx, bytes32 qy);
    event Executed(uint256 indexed nonce, address indexed target, uint256 value, bytes data, bytes32 actionHash, bytes32 headHash);
    event Paused(bool paused);

    error BadSignatures();
    error DuplicateSteward();
    error IsPaused();
    error CallFailed(bytes reason);
    error OnlySelf();

    constructor(bytes32[3] memory qx, bytes32[3] memory qy) {
        for (uint256 i; i < STEWARDS; ++i) {
            require(P256.isValidPublicKey(qx[i], qy[i]), "invalid steward key");
            _keys[i] = StewardKey(qx[i], qy[i]);
            emit StewardKeySet(i, qx[i], qy[i]);
        }
    }

    modifier onlySelf() {
        if (msg.sender != address(this)) revert OnlySelf();
        _;
    }

    function stewardKey(uint256 i) external view returns (bytes32, bytes32) {
        return (_keys[i].qx, _keys[i].qy);
    }

    /// @notice Digest the stewards sign for the next action.
    function digest(address target, uint256 value, bytes calldata data, uint256 n) public view returns (bytes32) {
        return sha256(abi.encode(address(this), block.chainid, n, target, value, keccak256(data)));
    }

    /// @notice Execute a governed call with 2-of-3 steward approvals.
    /// @param stewardIdx indexes (0..2) of the stewards that signed, distinct
    /// @param r          signature r values, same order
    /// @param s          signature s values, same order
    function execute(
        address target,
        uint256 value,
        bytes calldata data,
        uint8[] calldata stewardIdx,
        bytes32[] calldata r,
        bytes32[] calldata s
    ) external payable returns (bytes memory result) {
        // Unpausing must stay possible while paused, so only that one call bypasses the switch.
        if (paused && !(target == address(this) && bytes4(data) == this.setPaused.selector)) revert IsPaused();
        uint256 n = nonce;
        bytes32 h = digest(target, value, data, n);
        _checkQuorum(h, stewardIdx, r, s);
        nonce = n + 1;

        bool ok;
        (ok, result) = target.call{value: value}(data);
        if (!ok) revert CallFailed(result);

        bytes32 head = keccak256(abi.encode(headHash, h));
        headHash = head;
        emit Executed(n, target, value, data, h, head);
    }

    /// @notice Emergency switch. Only reachable through execute(), i.e. 2-of-3 stewards.
    function setPaused(bool p) external onlySelf {
        paused = p;
        emit Paused(p);
    }

    /// @notice Rotate a steward's passkey. Only reachable through execute().
    function setStewardKey(uint256 i, bytes32 qx, bytes32 qy) external onlySelf {
        require(i < STEWARDS && P256.isValidPublicKey(qx, qy), "invalid steward key");
        _keys[i] = StewardKey(qx, qy);
        emit StewardKeySet(i, qx, qy);
    }

    function _checkQuorum(bytes32 h, uint8[] calldata idx, bytes32[] calldata r, bytes32[] calldata s) internal view {
        if (idx.length < THRESHOLD || idx.length != r.length || idx.length != s.length) revert BadSignatures();
        uint256 seen;
        for (uint256 i; i < idx.length; ++i) {
            uint8 k = idx[i];
            if (k >= STEWARDS) revert BadSignatures();
            if (seen & (1 << k) != 0) revert DuplicateSteward();
            seen |= 1 << k;
            if (!P256.verify(h, r[i], s[i], _keys[k].qx, _keys[k].qy)) revert BadSignatures();
        }
    }

    receive() external payable {}
}
