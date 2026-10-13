// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {StewardCouncil} from "../src/StewardCouncil.sol";
import {OmegaToken} from "../src/OmegaToken.sol";
import {OmegaAgentHub} from "../src/OmegaAgentHub.sol";
import {TradeCraftCredential} from "../src/TradeCraftCredential.sol";

/// Stewards hold P-256 keys (WebAuthn curve). Forge's p256 cheatcodes produce real P-256 signatures,
/// verified by OpenZeppelin's P256 library (RIP-7212 precompile, Solidity fallback in the test EVM).
contract OmegaTest is Test {
    StewardCouncil council;
    OmegaToken token;
    OmegaAgentHub hub;
    TradeCraftCredential cred;

    uint256[3] stewardPk = [uint256(0xA11CE), uint256(0xB0B), uint256(0xC0FFEE)];
    uint256 alicePk = 0xA1;
    uint256 bobPk = 0xB2;
    address alice;
    address bob;
    address facilitator = address(0xFAC);

    function setUp() public {
        bytes32[3] memory qx;
        bytes32[3] memory qy;
        for (uint256 i; i < 3; ++i) {
            (uint256 x, uint256 y) = vm.publicKeyP256(stewardPk[i]);
            qx[i] = bytes32(x);
            qy[i] = bytes32(y);
        }
        council = new StewardCouncil(qx, qy);
        token = new OmegaToken(address(council));
        hub = new OmegaAgentHub(address(council), address(token), address(0x8004), address(0x8005));
        cred = new TradeCraftCredential(address(council));
        alice = vm.addr(alicePk);
        bob = vm.addr(bobPk);

        _gov(address(hub), abi.encodeCall(OmegaAgentHub.registerAgent, (alice, 1, 0, 5e6, 20e6, "ipfs://alice")), 0, 1);
        _gov(address(hub), abi.encodeCall(OmegaAgentHub.registerAgent, (bob, 2, 1, 5e6, 20e6, "ipfs://bob")), 1, 2);
        _gov(address(token), abi.encodeCall(OmegaToken.mint, (alice, 100e6)), 0, 2);
    }

    // ---------------------------------------------------------------- helpers

    function _sign(uint256 pk, bytes32 h) internal pure returns (bytes32 r, bytes32 s) {
        (r, s) = vm.signP256(pk, h);
        // normalise to low-s (OZ P256.verify rejects malleable high-s)
        uint256 n = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551;
        if (uint256(s) > n / 2) s = bytes32(n - uint256(s));
    }

    function _gov(address target, bytes memory data, uint8 a, uint8 b) internal {
        bytes32 h = council.digest(target, 0, data, council.nonce());
        uint8[] memory idx = new uint8[](2);
        bytes32[] memory r = new bytes32[](2);
        bytes32[] memory s = new bytes32[](2);
        idx[0] = a;
        idx[1] = b;
        (r[0], s[0]) = _sign(stewardPk[a], h);
        (r[1], s[1]) = _sign(stewardPk[b], h);
        council.execute(target, 0, data, idx, r, s);
    }

    function _auth(uint256 pk, address to, uint256 value, bytes32 nonce)
        internal
        view
        returns (OmegaAgentHub.Authorization memory a)
    {
        address from = vm.addr(pk);
        uint256 validBefore = vm.getBlockTimestamp() + 600;
        bytes32 structHash = keccak256(
            abi.encode(token.TRANSFER_WITH_AUTHORIZATION_TYPEHASH(), from, to, value, 0, validBefore, nonce)
        );
        bytes32 d = keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, d);
        a = OmegaAgentHub.Authorization(from, to, value, 0, validBefore, nonce, v, r, s);
    }

    // ---------------------------------------------------------------- governance

    function test_TwoOfThreePasskeysExecute() public view {
        (bool active,,,,,) = hub.agents(alice);
        assertTrue(active);
        assertEq(token.balanceOf(alice), 100e6);
        assertEq(council.nonce(), 3);
        assertTrue(council.headHash() != bytes32(0));
    }

    function test_OneSignatureIsNotEnough() public {
        bytes memory data = abi.encodeCall(OmegaToken.mint, (bob, 1e6));
        bytes32 h = council.digest(address(token), 0, data, council.nonce());
        uint8[] memory idx = new uint8[](1);
        bytes32[] memory r = new bytes32[](1);
        bytes32[] memory s = new bytes32[](1);
        (r[0], s[0]) = _sign(stewardPk[0], h);
        vm.expectRevert(StewardCouncil.BadSignatures.selector);
        council.execute(address(token), 0, data, idx, r, s);
    }

    function test_SameStewardTwiceRejected() public {
        bytes memory data = abi.encodeCall(OmegaToken.mint, (bob, 1e6));
        bytes32 h = council.digest(address(token), 0, data, council.nonce());
        uint8[] memory idx = new uint8[](2);
        bytes32[] memory r = new bytes32[](2);
        bytes32[] memory s = new bytes32[](2);
        (r[0], s[0]) = _sign(stewardPk[1], h);
        (r[1], s[1]) = (r[0], s[0]);
        idx[0] = 1;
        idx[1] = 1;
        vm.expectRevert(StewardCouncil.DuplicateSteward.selector);
        council.execute(address(token), 0, data, idx, r, s);
    }

    function test_SignatureForOtherActionRejected() public {
        bytes memory data = abi.encodeCall(OmegaToken.mint, (bob, 1e6));
        bytes memory evil = abi.encodeCall(OmegaToken.mint, (bob, 1e12));
        bytes32 h = council.digest(address(token), 0, data, council.nonce());
        uint8[] memory idx = new uint8[](2);
        bytes32[] memory r = new bytes32[](2);
        bytes32[] memory s = new bytes32[](2);
        idx[1] = 1;
        (r[0], s[0]) = _sign(stewardPk[0], h);
        (r[1], s[1]) = _sign(stewardPk[1], h);
        vm.expectRevert(StewardCouncil.BadSignatures.selector);
        council.execute(address(token), 0, evil, idx, r, s);
    }

    function test_AgentCannotGovern() public {
        vm.prank(alice);
        vm.expectRevert(OmegaAgentHub.OnlyCouncil.selector);
        hub.setCaps(alice, type(uint128).max, type(uint128).max);
        vm.prank(alice);
        vm.expectRevert(OmegaToken.OnlyCouncil.selector);
        token.mint(alice, 1);
    }

    function test_PauseStopsPaymentsAndCanBeLifted() public {
        _gov(address(hub), abi.encodeCall(OmegaAgentHub.setPaused, (true)), 0, 1);
        OmegaAgentHub.Authorization memory a = _auth(alicePk, bob, 1e6, keccak256("p"));
        vm.expectRevert(OmegaAgentHub.IsPaused.selector);
        hub.settle(a, "/x402/lesson");
        _gov(address(hub), abi.encodeCall(OmegaAgentHub.setPaused, (false)), 1, 2);
        hub.settle(a, "/x402/lesson");
    }

    function test_CouncilPauseCanBeLifted() public {
        _gov(address(council), abi.encodeCall(StewardCouncil.setPaused, (true)), 0, 1);
        vm.expectRevert(StewardCouncil.IsPaused.selector);
        this.govExternal(address(token), abi.encodeCall(OmegaToken.mint, (bob, 1)));
        _gov(address(council), abi.encodeCall(StewardCouncil.setPaused, (false)), 0, 2);
        _gov(address(token), abi.encodeCall(OmegaToken.mint, (bob, 1)), 0, 1);
        assertEq(token.balanceOf(bob), 1);
    }

    function govExternal(address target, bytes calldata data) external {
        _gov(target, data, 0, 1);
    }

    // ---------------------------------------------------------------- x402

    function test_X402PaymentSettlesAndChainsReceipt() public {
        bytes32 head0 = hub.receiptHead();
        vm.prank(facilitator);
        bytes32 rh = hub.settle(_auth(alicePk, bob, 2e6, keccak256("n1")), "/x402/tca-110/m1");
        assertEq(token.balanceOf(bob), 2e6);
        assertEq(hub.receiptHead(), keccak256(abi.encode(head0, rh)));
        assertEq(hub.receipts(), 1);
    }

    function test_ReplayRejected() public {
        OmegaAgentHub.Authorization memory a = _auth(alicePk, bob, 1e6, keccak256("n2"));
        hub.settle(a, "/r");
        vm.expectRevert(OmegaToken.AuthorizationAlreadyUsed.selector);
        hub.settle(a, "/r");
    }

    function test_PerTxCapEnforced() public {
        OmegaAgentHub.Authorization memory a = _auth(alicePk, bob, 6e6, keccak256("n3"));
        vm.expectRevert(abi.encodeWithSelector(OmegaAgentHub.OverPerTxCap.selector, 6e6, 5e6));
        hub.settle(a, "/r");
    }

    function test_DailyCapEnforced() public {
        for (uint256 i; i < 4; ++i) {
            hub.settle(_auth(alicePk, bob, 5e6, bytes32(i + 100)), "/r");
        }
        OmegaAgentHub.Authorization memory a = _auth(alicePk, bob, 1e6, bytes32(uint256(999)));
        vm.expectRevert(abi.encodeWithSelector(OmegaAgentHub.OverDailyCap.selector, 21e6, 20e6));
        hub.settle(a, "/r");
        vm.warp(vm.getBlockTimestamp() + 1 days);
        hub.settle(_auth(alicePk, bob, 1e6, bytes32(uint256(1000))), "/r");
    }

    function test_ForgedAuthorizationRejected() public {
        OmegaAgentHub.Authorization memory a = _auth(bobPk, bob, 1e6, keccak256("n4"));
        a.from = alice; // bob signed, claims to be alice
        vm.expectRevert(OmegaToken.InvalidSignature.selector);
        hub.settle(a, "/r");
    }

    function test_NonAgentCannotBePaid() public {
        OmegaAgentHub.Authorization memory a = _auth(alicePk, address(0xBAD), 1e6, keccak256("n5"));
        vm.expectRevert(abi.encodeWithSelector(OmegaAgentHub.NotAgent.selector, address(0xBAD)));
        hub.settle(a, "/r");
    }

    function test_MintBatchOnlyViaStewards() public {
        address[] memory to = new address[](2);
        to[0] = address(0x101);
        to[1] = address(0x102);
        vm.expectRevert(OmegaToken.OnlyCouncil.selector);
        token.mintBatch(to, 1e6);
        _gov(address(token), abi.encodeCall(OmegaToken.mintBatch, (to, 3e6)), 1, 2);
        assertEq(token.balanceOf(to[0]), 3e6);
        assertEq(token.balanceOf(to[1]), 3e6);
    }

    // ---------------------------------------------------------------- credentials

    function test_CredentialOnlyViaStewardsAndSoulbound() public {
        vm.prank(bob);
        vm.expectRevert(TradeCraftCredential.OnlyCouncil.selector);
        cred.issue(bob, "TCA-110 m1", bytes32(uint256(1)), 2);

        address learner = address(0x1EA2);
        _gov(address(cred), abi.encodeCall(TradeCraftCredential.issue, (learner, "TCA-110 m1", keccak256("run"), 2)), 0, 2);
        assertEq(cred.ownerOf(1), learner);
        vm.prank(learner);
        vm.expectRevert(TradeCraftCredential.Soulbound.selector);
        cred.transferFrom(learner, bob, 1);
    }
}
