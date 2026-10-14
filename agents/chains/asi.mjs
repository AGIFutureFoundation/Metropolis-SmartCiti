// ASI:Chain DevNet (RChain/Rholang-based, NOT EVM) wallet + client for the Omega swarm.
//
// Keys are secp256k1, the same curve as Monad, so each agent's ASI wallet reuses that agent's existing EVM key:
// this is exactly how the official wallet (wallet.dev.asichain.io, "import private key") maps a key to an address.
// Nothing new to store, and any agent's account can be opened in the web wallet with its existing private key.
//
//   ASI address = base58( 00 00 00 00 | keccak256(ethAddressBytes) | blake2b-256(prefix|hash)[0..4] )   -> "1111..."
//   balances in atomic units, 8 decimals (1 ASI = 100_000_000)
//   deploy signature = DER secp256k1 (low-s) over blake2b-256(protobuf(DeployData))
//
// Format verified against asi-alliance/asi-chain-wallet src/utils/crypto.ts and src/services/rchain.ts.
import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';
import { blake2b } from '@noble/hashes/blake2b';
import { b58encode, b58decode, withSecret } from './codec.mjs';

export const ASI_DECIMALS = 8;
export const ASI_ATOMIC = 10n ** 8n;
export const ASI_DEFAULTS = {
  // Validator 1 serves both writes and reads on DevNet (docs.asichain.io "Useful Links": observer unstable).
  nodeUrl: 'http://34.196.119.4:40403',
  shardId: 'root',
  networkId: 'devnet1',
  faucetUrl: 'https://ffyp8igwwc.execute-api.us-east-1.amazonaws.com',
  explorer: 'https://explorer.dev.asichain.io',
  wallet: 'https://wallet.dev.asichain.io',
};

const PREFIX = Uint8Array.from([0, 0, 0, 0]); // coinId 000000 + version 00
const hex = (b) => Buffer.from(b).toString('hex');
const unhex = (h) => Uint8Array.from(Buffer.from(h.replace(/^0x/, ''), 'hex'));
const blake256 = (b) => blake2b(b, { dkLen: 32 });

/** ASI address from a 20-byte EVM address (hex, with or without 0x). */
export function asiAddressFromEth(ethAddress) {
  const eth = ethAddress.replace(/^0x/, '');
  if (!/^[0-9a-fA-F]{40}$/.test(eth)) throw new Error('invalid EVM address');
  const payload = new Uint8Array([...PREFIX, ...keccak_256(unhex(eth))]);
  const checksum = blake256(payload).subarray(0, 4);
  return b58encode(new Uint8Array([...payload, ...checksum]));
}

/** True only for a well-formed, checksummed ASI address (also the guard before an address enters Rholang). */
export function isAsiAddress(addr) {
  if (typeof addr !== 'string' || addr.length < 40 || addr.length > 60) return false;
  let raw;
  try { raw = b58decode(addr); } catch { return false; }
  if (raw.length !== 40 || !PREFIX.every((b, i) => raw[i] === b)) return false;
  const want = blake256(raw.subarray(0, 36)).subarray(0, 4);
  return want.every((b, i) => raw[36 + i] === b);
}

/** Key object for a secp256k1 private key (0x-hex). The private key is non-enumerable: logging the object never shows it. */
export function asiKey(privateKeyHex) {
  const priv = unhex(privateKeyHex);
  if (priv.length !== 32) throw new Error('ASI private key must be 32 bytes');
  const publicKey = secp256k1.getPublicKey(priv, false); // 65 bytes, 0x04-prefixed
  const ethAddress = '0x' + hex(keccak_256(publicKey.subarray(1)).subarray(-20));
  return withSecret({ publicKey: hex(publicKey), ethAddress, address: asiAddressFromEth(ethAddress) }, 'privateKey', priv);
}
// --- deploy serialisation (RChain CasperMessage.proto DeployDataProto: proto3, zero values omitted) ---
function varint(n) {
  let v = BigInt(n);
  if (v < 0n) throw new Error('negative varint');
  const out = [];
  while (v > 0x7fn) { out.push(Number((v & 0x7fn) | 0x80n)); v >>= 7n; }
  out.push(Number(v));
  return out;
}
function fieldString(no, s) {
  if (!s) return [];
  const b = Buffer.from(s, 'utf8');
  return [...varint((no << 3) | 2), ...varint(b.length), ...b];
}
function fieldInt(no, n) {
  return BigInt(n) === 0n ? [] : [...varint(no << 3), ...varint(n)];
}

/** protobuf bytes of {term=2, timestamp=3, phloPrice=7, phloLimit=8, validAfterBlockNumber=10, shardId=11}. */
export function serializeDeploy(d) {
  return Uint8Array.from([
    ...fieldString(2, d.term),
    ...fieldInt(3, d.timestamp),
    ...fieldInt(7, d.phloPrice),
    ...fieldInt(8, d.phloLimit),
    ...fieldInt(10, d.validAfterBlockNumber),
    ...fieldString(11, d.shardId),
  ]);
}

/** Sign a deploy and return the body for POST /api/deploy. The deploy id is the signature hex. */
export function signDeploy(deployData, key) {
  const digest = blake256(serializeDeploy(deployData));
  const sig = secp256k1.sign(digest, key.privateKey, { lowS: true });
  return {
    data: { ...deployData },
    sigAlgorithm: 'secp256k1',
    signature: sig.toDERHex(),
    deployer: key.publicKey,
  };
}

/** Parse "1.5" ASI (or a bigint of atomic units) into atomic units. */
export function parseAsi(v) {
  if (typeof v === 'bigint') return v;
  const m = String(v).trim().match(/^(\d+)(?:\.(\d{1,8}))?$/);
  if (!m) throw new Error(`invalid ASI amount: ${v} (max 8 decimals)`);
  return BigInt(m[1]) * ASI_ATOMIC + BigInt((m[2] || '').padEnd(8, '0'));
}
export function formatAsi(atomic) {
  const a = BigInt(atomic);
  const frac = (a % ASI_ATOMIC).toString().padStart(8, '0').replace(/0+$/, '');
  return `${a / ASI_ATOMIC}${frac ? '.' + frac : ''}`;
}

function requireAddress(a) {
  if (!isAsiAddress(a)) throw new Error(`invalid ASI address: ${String(a).slice(0, 60)}`);
  return a;
}

/** Rholang: read a vault balance (used with explore-deploy, free). Address is validated first (no injection). */
export function balanceTerm(address) {
  requireAddress(address);
  return `new return, rl(\`rho:registry:lookup\`), ASIVaultCh, vaultCh in {
  rl!(\`rho:rchain:asiVault\`, *ASIVaultCh) |
  for (@(_, ASIVault) <- ASIVaultCh) {
    @ASIVault!("findOrCreate", "${address}", *vaultCh) |
    for (@maybeVault <- vaultCh) {
      match maybeVault {
        (true, vault) => @vault!("balance", *return)
        (false, err)  => return!(err)
      }
    }
  }
}`;
}

/** Rholang: transfer from the deployer's own vault (authorised by rho:rchain:deployerId, i.e. the deploy signature). */
export function transferTerm(from, to, atomic) {
  requireAddress(from);
  requireAddress(to);
  const amount = BigInt(atomic);
  if (amount <= 0n) throw new Error('transfer amount must be positive');
  return `new deployerId(\`rho:rchain:deployerId\`), rl(\`rho:registry:lookup\`), ASIVaultCh, vaultCh, toVaultCh, keyCh, resultCh in {
  rl!(\`rho:rchain:asiVault\`, *ASIVaultCh) |
  for (@(_, ASIVault) <- ASIVaultCh) {
    @ASIVault!("findOrCreate", "${from}", *vaultCh) |
    @ASIVault!("findOrCreate", "${to}", *toVaultCh) |
    @ASIVault!("deployerAuthKey", *deployerId, *keyCh) |
    for (@(true, vault) <- vaultCh; key <- keyCh; @(true, _) <- toVaultCh) {
      @vault!("transfer", "${to}", ${amount}, *key, *resultCh) |
      for (_ <- resultCh) { Nil }
    }
  }
}`;
}
/** Thin client over the RNode Web API (/api/*) and the DevNet faucet API. */
export class AsiClient {
  constructor({ nodeUrl = ASI_DEFAULTS.nodeUrl, shardId = ASI_DEFAULTS.shardId, faucetUrl = ASI_DEFAULTS.faucetUrl, timeoutMs = 30_000 } = {}) {
    this.nodeUrl = nodeUrl.replace(/\/$/, '');
    this.shardId = shardId;
    this.faucetUrl = faucetUrl.replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
  }

  static fromEnv(env = {}) {
    return new AsiClient({
      nodeUrl: env.ASI_NODE_URL || ASI_DEFAULTS.nodeUrl,
      shardId: env.ASI_SHARD_ID || ASI_DEFAULTS.shardId,
      faucetUrl: env.ASI_FAUCET_URL || ASI_DEFAULTS.faucetUrl,
    });
  }

  async #http(base, path, { method = 'GET', body, text = false } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: body === undefined ? {} : { 'content-type': text ? 'text/plain' : 'application/json' },
      body: body === undefined ? undefined : text ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const raw = await res.text();
    let data;
    try { data = JSON.parse(raw); } catch { data = raw; }
    if (!res.ok) {
      const msg = typeof data === 'string' ? data : JSON.stringify(data);
      const err = new Error(`ASI ${method} ${path}: HTTP ${res.status} ${msg}`.slice(0, 400));
      err.status = res.status;
      throw err;
    }
    return data;
  }
  #api(path, opts) { return this.#http(this.nodeUrl, `/api/${path}`, opts); }

  status() { return this.#api('status'); }

  async latestBlockNumber() {
    const blocks = await this.#api('blocks/1');
    return blocks?.[0]?.blockNumber ?? 0;
  }

  /** Read-only Rholang evaluation (no fee, no signature). Returns the `expr` array. */
  async explore(term) {
    return (await this.#api('explore-deploy', { method: 'POST', body: term, text: true })).expr;
  }

  /** Balance in atomic units (bigint). */
  async balance(address) {
    const v = (await this.explore(balanceTerm(address)))?.[0];
    if (v?.ExprInt?.data !== undefined) return BigInt(v.ExprInt.data);
    if (v?.ExprString?.data !== undefined) throw new Error(`ASI balance error: ${v.ExprString.data}`);
    throw new Error('ASI balance: unexpected response');
  }

  /** Sign and submit a Rholang deploy; returns the deploy id (signature hex). */
  async deploy(term, key, { phloLimit = 500_000, phloPrice = 1 } = {}) {
    const deployData = {
      term,
      timestamp: Date.now(),
      phloPrice,
      phloLimit,
      validAfterBlockNumber: await this.latestBlockNumber(),
      shardId: this.shardId,
    };
    const res = await this.#api('deploy', { method: 'POST', body: signDeploy(deployData, key) });
    const id = typeof res === 'string' ? (res.match(/DeployId is:\s*([0-9a-fA-F]+)/)?.[1] || res) : res?.signature || res?.deployId;
    if (!id || !/^[0-9a-fA-F]+$/.test(id)) throw new Error(`ASI deploy: no deploy id in ${JSON.stringify(res).slice(0, 200)}`);
    return id;
  }

  /** null while pending; otherwise { blockHash, blockNumber, errored, error, cost }. */
  async deployStatus(deployId) {
    let light;
    try {
      light = await this.#api(`deploy/${deployId}`);
    } catch (e) {
      if (e.status === 400 && /Couldn't find block/i.test(e.message)) return null;
      throw e;
    }
    const block = await this.#api(`block/${light.blockHash}`);
    const d = (block.deploys || []).find((x) => x.sig === deployId);
    return {
      blockHash: light.blockHash,
      blockNumber: light.blockNumber ?? block.blockInfo?.blockNumber,
      errored: d ? Boolean(d.errored) : false,
      error: d?.systemDeployError || '',
      cost: d?.cost,
    };
  }

  async isFinalized(blockHash) {
    return (await this.#api(`is-finalized/${blockHash}`)) === true;
  }

  /**
   * Wait until the deploy is in a block and (by default) that block is finalized. Balance reads (explore-deploy)
   * see the last FINALIZED state, which lags inclusion by a few ~20s blocks; observed ~2-4 min on DevNet.
   */
  async waitForDeploy(deployId, { finalized = true, timeoutMs = 420_000, intervalMs = 5_000 } = {}) {
    const end = Date.now() + timeoutMs;
    let s = null;
    while (Date.now() < end) {
      s ||= await this.deployStatus(deployId);
      if (s && (!finalized || s.errored || await this.isFinalized(s.blockHash))) return { ...s, finalized: finalized && !s.errored };
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error(`ASI deploy ${deployId.slice(0, 16)}… ${s ? 'in a block but not finalized' : 'not in a block'} after ${timeoutMs / 1000}s`);
  }

  /** Transfer atomic units from key's own vault. Returns the deploy id (confirm with waitForDeploy + balance). */
  transfer(key, to, atomic, opts) {
    if (to === key.address) throw new Error('ASI transfer to self');
    return this.deploy(transferTerm(key.address, to, atomic), key, opts);
  }

  /** DevNet faucet: POST /transfer {to_address}. Refused once the address already holds the faucet threshold. */
  async faucet(address) {
    requireAddress(address);
    return (await this.#http(this.faucetUrl, '/transfer', { method: 'POST', body: { to_address: address } })).deploy_id;
  }
}
