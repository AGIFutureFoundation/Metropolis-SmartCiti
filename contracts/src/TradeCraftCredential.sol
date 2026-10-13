// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @title TradeCraftCredential
/// @notice Non-transferable certificates for SmartCiti.X Trade Craft Academy modules. A credential is
///         minted only through the StewardCouncil (2-of-3 human passkeys), so an agent tutor can teach
///         and grade but can never certify a person on its own. Each credential commits to the hash of
///         the evidence (lesson run log + x402 receipt) so it can be checked later.
contract TradeCraftCredential is ERC721 {
    struct Credential {
        string module; // e.g. "TCA-110 m1"
        bytes32 evidenceHash; // hash of the graded run log and payment receipt
        uint64 tutorAgentId; // ERC-8004 id of the agent that taught it
        uint64 issuedAt;
    }

    address public immutable council;
    uint256 public totalIssued;
    mapping(uint256 => Credential) public credentials;

    event Issued(uint256 indexed tokenId, address indexed holder, string module, bytes32 evidenceHash, uint64 tutorAgentId);

    error OnlyCouncil();
    error Soulbound();

    constructor(address council_) ERC721("SmartCiti.X Trade Craft Credential", "TCX") {
        council = council_;
    }

    function issue(address holder, string calldata module, bytes32 evidenceHash, uint64 tutorAgentId)
        external
        returns (uint256 tokenId)
    {
        if (msg.sender != council) revert OnlyCouncil();
        tokenId = ++totalIssued;
        credentials[tokenId] = Credential(module, evidenceHash, tutorAgentId, uint64(block.timestamp));
        _safeMint(holder, tokenId);
        emit Issued(tokenId, holder, module, evidenceHash, tutorAgentId);
    }

    /// @dev Block every transfer except mint.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address from) {
        from = _ownerOf(tokenId);
        if (from != address(0)) revert Soulbound();
        return super._update(to, tokenId, auth);
    }
}
