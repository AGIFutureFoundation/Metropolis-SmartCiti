// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IEIP3009 {
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
    ) external;
}

/// @title OmegaAgentHub
/// @notice The Omega swarm's onchain operating rules.
///         - Every agent has a wallet, an ERC-8004 identity (canonical registry on Monad) and a role.
///         - Agents pay each other through x402: the agent signs an EIP-3009 authorization, a
///           facilitator calls settle(), and the hub enforces that agent's per-payment and daily caps.
///         - Every settled payment is hashed into a chain (receiptHead): tamper-evident, replayable.
///         - Registering agents, changing caps and pausing go through the StewardCouncil (2-of-3 passkeys).
contract OmegaAgentHub {
    struct Agent {
        bool active;
        uint64 erc8004Id; // id in the canonical ERC-8004 IdentityRegistry
        uint8 role; // 0 coordinator, 1 tutor, 2 robot, 3 sensor/QA, 4 steward-liaison
        uint128 perTxCap; // max tOMEGA (6 decimals) per payment
        uint128 dailyCap; // max tOMEGA per UTC day
        string uri; // agent card (ERC-8004 registration file)
    }

    address public immutable council;
    address public immutable token;
    address public immutable identityRegistry;
    address public immutable reputationRegistry;

    mapping(address => Agent) public agents;
    mapping(address => bool) public listed;
    mapping(address => mapping(uint256 => uint256)) public spentOnDay;
    address[] public roster;

    bytes32 public receiptHead;
    uint256 public receipts;
    bool public paused;

    event AgentRegistered(address indexed wallet, uint64 indexed erc8004Id, uint8 role, uint128 perTxCap, uint128 dailyCap, string uri);
    event AgentCapsUpdated(address indexed wallet, uint128 perTxCap, uint128 dailyCap);
    event AgentDeactivated(address indexed wallet);
    event Paid(
        uint256 indexed receipt,
        address indexed from,
        address indexed to,
        uint256 value,
        string resource,
        bytes32 nonce,
        bytes32 receiptHash,
        bytes32 head
    );
    event Paused(bool paused);

    error OnlyCouncil();
    error NotAgent(address who);
    error OverPerTxCap(uint256 value, uint256 cap);
    error OverDailyCap(uint256 spent, uint256 cap);
    error IsPaused();

    constructor(address council_, address token_, address identityRegistry_, address reputationRegistry_) {
        council = council_;
        token = token_;
        identityRegistry = identityRegistry_;
        reputationRegistry = reputationRegistry_;
    }

    modifier onlyCouncil() {
        if (msg.sender != council) revert OnlyCouncil();
        _;
    }

    function _register(address w, uint64 id, uint8 role, uint128 perTx, uint128 daily, string calldata uri) internal {
        if (!listed[w]) {
            listed[w] = true;
            roster.push(w);
        }
        agents[w] = Agent(true, id, role, perTx, daily, uri);
        emit AgentRegistered(w, id, role, perTx, daily, uri);
    }

    function registerAgent(address wallet, uint64 erc8004Id, uint8 role, uint128 perTxCap, uint128 dailyCap, string calldata uri)
        external
        onlyCouncil
    {
        _register(wallet, erc8004Id, role, perTxCap, dailyCap, uri);
    }

    /// @notice Register many agents in one steward-approved call (one passkey ceremony for the swarm).
    function registerAgents(
        address[] calldata wallets,
        uint64[] calldata ids,
        uint8[] calldata roles,
        uint128 perTxCap,
        uint128 dailyCap,
        string[] calldata uris
    ) external onlyCouncil {
        require(wallets.length == ids.length && ids.length == roles.length && roles.length == uris.length, "length");
        for (uint256 i; i < wallets.length; ++i) {
            _register(wallets[i], ids[i], roles[i], perTxCap, dailyCap, uris[i]);
        }
    }

    function setCaps(address wallet, uint128 perTxCap, uint128 dailyCap) external onlyCouncil {
        if (!agents[wallet].active) revert NotAgent(wallet);
        agents[wallet].perTxCap = perTxCap;
        agents[wallet].dailyCap = dailyCap;
        emit AgentCapsUpdated(wallet, perTxCap, dailyCap);
    }

    function deactivate(address wallet) external onlyCouncil {
        agents[wallet].active = false;
        emit AgentDeactivated(wallet);
    }

    function setPaused(bool p) external onlyCouncil {
        paused = p;
        emit Paused(p);
    }

    function rosterLength() external view returns (uint256) {
        return roster.length;
    }

    // ---------------------------------------------------------------- x402 settlement

    struct Authorization {
        address from;
        address to;
        uint256 value;
        uint256 validAfter;
        uint256 validBefore;
        bytes32 nonce;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    /// @notice Settle an x402 "exact" payment between agents. Any facilitator may call it: the agent's
    ///         EIP-3009 signature is the authorization, and the hub adds the swarm's spending limits.
    function settle(Authorization calldata a, string calldata resource) external returns (bytes32 receiptHash) {
        if (paused) revert IsPaused();
        Agent storage payer = agents[a.from];
        if (!payer.active) revert NotAgent(a.from);
        if (!agents[a.to].active) revert NotAgent(a.to);
        if (a.value > payer.perTxCap) revert OverPerTxCap(a.value, payer.perTxCap);
        uint256 day = block.timestamp / 1 days;
        uint256 spent = spentOnDay[a.from][day] + a.value;
        if (spent > payer.dailyCap) revert OverDailyCap(spent, payer.dailyCap);
        spentOnDay[a.from][day] = spent;

        IEIP3009(token).transferWithAuthorization(a.from, a.to, a.value, a.validAfter, a.validBefore, a.nonce, a.v, a.r, a.s);

        uint256 id = receipts++;
        receiptHash = keccak256(abi.encode(block.chainid, id, a.from, a.to, a.value, keccak256(bytes(resource)), a.nonce));
        bytes32 head = keccak256(abi.encode(receiptHead, receiptHash));
        receiptHead = head;
        emit Paid(id, a.from, a.to, a.value, resource, a.nonce, receiptHash, head);
    }
}
