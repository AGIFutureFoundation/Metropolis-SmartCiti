// Shared chain helpers: provider, contract artifacts, steward P-256 signing for StewardCouncil.execute.
import { JsonRpcProvider, FetchRequest, Wallet, NonceManager, Contract, ContractFactory, getBytes, hexlify, AbiCoder, keccak256, sha256 } from 'ethers';
import { createPrivateKey, sign as nodeSign } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './wallets.mjs';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DEPLOYMENTS = join(ROOT, process.env.RPC_URL ? 'deployments/rehearsal-fork.json' : 'deployments/monad-testnet.json');

/** Canonical ERC-8004 registries on Monad testnet (verified on-chain: name()="AgentIdentity", v2.0.0). */
export const ERC8004 = {
  identity: '0x8004A818BFB912233c491871b3d84c89A494BD9e',
  reputation: '0x8004B663056A597Dffe9eCcC1965A193B7388713',
};
export const EXPLORER = 'https://testnet.monadexplorer.com';

const P256_N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

export function artifact(name) {
  const j = JSON.parse(readFileSync(join(ROOT, `contracts/out/${name}.sol/${name}.json`), 'utf8'));
  return { abi: j.abi, bytecode: j.bytecode.object };
}

/**
 * The JSON-RPC connection. RPC_URL overrides it (e.g. a local anvil fork of Monad testnet for rehearsals).
 * Dwellir endpoints (*.dwellir.com) authenticate with the X-Api-Key header from DWELLIR_API_KEY, so the key never
 * appears in a URL (ethers puts the request URL into its error messages and logs).
 */
export function rpcConnection(env) {
  const url = process.env.RPC_URL || env.MONAD_TESTNET_RPC;
  if (!url) throw new Error('No RPC: set MONAD_TESTNET_RPC in .env (or RPC_URL for a local fork)');
  if (!/^https?:\/\/[^/]*\.dwellir\.com(\/|$)/.test(url)) return url;
  if (!env.DWELLIR_API_KEY) throw new Error('MONAD_TESTNET_RPC is a Dwellir endpoint: set DWELLIR_API_KEY in .env');
  const req = new FetchRequest(url);
  req.setHeader('X-Api-Key', env.DWELLIR_API_KEY);
  return req;
}

export function setup() {
  const env = loadEnv();
  const provider = new JsonRpcProvider(rpcConnection(env), Number(env.CHAIN_ID), { staticNetwork: true });
  // NonceManager: Monad and forks can lag on "pending" nonce reads; track nonces locally instead.
  const deployer = new NonceManager(new Wallet(env.DEPLOYER_PRIVATE_KEY, provider));
  deployer.address = env.DEPLOYER_ADDRESS;
  return { env, provider, deployer };
}

export function loadDeployments() {
  return existsSync(DEPLOYMENTS) ? JSON.parse(readFileSync(DEPLOYMENTS, 'utf8')) : null;
}

export function contracts(d, runner) {
  return {
    council: new Contract(d.StewardCouncil, artifact('StewardCouncil').abi, runner),
    token: new Contract(d.OmegaToken, artifact('OmegaToken').abi, runner),
    hub: new Contract(d.OmegaAgentHub, artifact('OmegaAgentHub').abi, runner),
    cred: new Contract(d.TradeCraftCredential, artifact('TradeCraftCredential').abi, runner),
  };
}

/** The preimage StewardCouncil.digest() hashes: abi.encode(council, chainId, nonce, target, value, keccak256(data)). */
export function councilPreimage(council, chainId, nonce, target, value, data) {
  return AbiCoder.defaultAbiCoder().encode(
    ['address', 'uint256', 'uint256', 'address', 'uint256', 'bytes32'],
    [council, chainId, nonce, target, value, keccak256(data)],
  );
}

/** Steward k (1..3) signs with its P-256 key: ECDSA-P256 over sha256(preimage), exactly what a
 *  WebAuthn-style signer does. Returns low-s (r, s) for OpenZeppelin P256.verify. */
export function stewardSign(env, k, preimageHex) {
  const pem = Buffer.from(env[`STEWARD${k}_P256_PKCS8`], 'base64').toString('utf8');
  const sig = nodeSign('sha256', Buffer.from(getBytes(preimageHex)), { key: createPrivateKey(pem), dsaEncoding: 'ieee-p1363' });
  return { r: hexlify(sig.subarray(0, 32)), s: lowS(sig.subarray(32)) };
}

/** Run a governed call through the council with steward signatures (default stewards 1 and 2). */
export async function govern(c, env, target, data, signers = [1, 2], label = '') {
  const council = await c.council.getAddress();
  const nonce = await c.council.nonce();
  const pre = councilPreimage(council, Number(env.CHAIN_ID), nonce, target, 0n, data);
  const onchain = await c.council.digest(target, 0n, data, nonce);
  if (sha256(pre) !== onchain) throw new Error('digest mismatch between JS and StewardCouncil');
  const sigs = signers.map((k) => stewardSign(env, k, pre));
  const tx = await c.council.execute(target, 0n, data, signers.map((k) => k - 1), sigs.map((x) => x.r), sigs.map((x) => x.s));
  const rc = await tx.wait();
  console.log(`  governed ${label || target} (nonce ${nonce}, stewards ${signers.join('+')}) tx ${rc.hash}`);
  return rc;
}

function lowS(sBuf) {
  let s = BigInt('0x' + Buffer.from(sBuf).toString('hex'));
  if (s > P256_N / 2n) s = P256_N - s;
  return '0x' + s.toString(16).padStart(64, '0');
}

export { Contract, ContractFactory, Wallet };
