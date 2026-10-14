// Solana devnet wallet + minimal client for the Omega swarm, built only on @noble (already in node_modules via ethers).
//
// Agent i's Solana key: SLIP-0010 ed25519 from the SAME swarm mnemonic (AGENT_MNEMONIC), path m/44'/501'/i'/0'
// (the Phantom / Solflare / `solana-keygen --derivation-path` convention), so the swarm still has one backup secret
// and any agent can be imported into Phantom with the mnemonic + account index.
//
// Transfers are SystemProgram.transfer in a legacy transaction message; signature = ed25519 over the message bytes.
import { ed25519 } from '@noble/curves/ed25519';
import { hmac } from '@noble/hashes/hmac';
import { sha512 } from '@noble/hashes/sha512';
import { Mnemonic } from 'ethers';
import { b58encode, b58decode, withSecret } from './codec.mjs';

export const LAMPORTS_PER_SOL = 1_000_000_000n;
export const SOLANA_DEFAULTS = {
  rpcUrl: 'https://api.devnet.solana.com',
  cluster: 'devnet',
  genesisHash: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG', // devnet
  explorer: 'https://explorer.solana.com/?cluster=devnet',
  faucet: 'https://faucet.solana.com',
};
const SYSTEM_PROGRAM = new Uint8Array(32); // 11111111111111111111111111111111

/** SLIP-0010 ed25519 derivation (hardened only). Returns the 32-byte private seed. */
export function slip10Ed25519(seed, path) {
  if (!/^m(\/\d+')+$/.test(path)) throw new Error(`ed25519 path must be fully hardened: ${path}`);
  let I = hmac(sha512, new TextEncoder().encode('ed25519 seed'), seed);
  let key = I.slice(0, 32), chain = I.slice(32);
  for (const seg of path.split('/').slice(1)) {
    const idx = (Number(seg.slice(0, -1)) + 0x80000000) >>> 0;
    const data = new Uint8Array(37);
    data.set(key, 1);
    new DataView(data.buffer).setUint32(33, idx, false);
    I = hmac(sha512, chain, data);
    key = I.slice(0, 32);
    chain = I.slice(32);
  }
  return key;
}

export const solanaPath = (index) => `m/44'/501'/${index}'/0'`;

/** Key object from a 32-byte ed25519 seed. Secret is non-enumerable (never logged / serialised). */
export function solanaKeyFromSeed(seed32) {
  const publicKey = ed25519.getPublicKey(seed32);
  return withSecret({ publicKey, address: b58encode(publicKey) }, 'secret', Uint8Array.from(seed32));
}

/** Agent i's Solana key from the swarm mnemonic. */
export function solanaAgentKey(mnemonicPhrase, index) {
  const seed = Buffer.from(Mnemonic.fromPhrase(mnemonicPhrase).computeSeed().slice(2), 'hex');
  return solanaKeyFromSeed(slip10Ed25519(seed, solanaPath(index)));
}

/** 64-byte secret||public, the format of `solana-keygen` JSON files and Phantom "import private key" (base58). */
export const solanaKeypairBytes = (key) => Uint8Array.from([...key.secret, ...key.publicKey]);

export function isSolanaAddress(a) {
  try { return typeof a === 'string' && b58decode(a).length === 32; } catch { return false; }
}

export function parseSol(v) {
  if (typeof v === 'bigint') return v;
  const m = String(v).trim().match(/^(\d+)(?:\.(\d{1,9}))?$/);
  if (!m) throw new Error(`invalid SOL amount: ${v} (max 9 decimals)`);
  return BigInt(m[1]) * LAMPORTS_PER_SOL + BigInt((m[2] || '').padEnd(9, '0'));
}
export function formatSol(lamports) {
  const l = BigInt(lamports);
  const frac = (l % LAMPORTS_PER_SOL).toString().padStart(9, '0').replace(/0+$/, '');
  return `${l / LAMPORTS_PER_SOL}${frac ? '.' + frac : ''}`;
}

const shortvec = (n) => {
  const out = [];
  for (;;) { let b = n & 0x7f; n >>= 7; if (n) { out.push(b | 0x80); } else { out.push(b); return out; } }
};

/** Legacy message bytes for a single SystemProgram.transfer(from -> to, lamports). */
export function transferMessage(fromPub, toPub, lamports, recentBlockhash) {
  const to = typeof toPub === 'string' ? b58decode(toPub) : toPub;
  if (to.length !== 32) throw new Error('invalid Solana recipient');
  if (Buffer.from(fromPub).equals(Buffer.from(to))) throw new Error('Solana transfer to self');
  const keys = [fromPub, to, SYSTEM_PROGRAM];
  const data = new Uint8Array(12);
  const dv = new DataView(data.buffer);
  dv.setUint32(0, 2, true); // SystemInstruction::Transfer
  dv.setBigUint64(4, BigInt(lamports), true);
  return Uint8Array.from([
    1, 0, 1, // header: 1 signer, 0 readonly signed, 1 readonly unsigned (system program)
    ...shortvec(keys.length), ...keys.flatMap((k) => [...k]),
    ...b58decode(recentBlockhash),
    ...shortvec(1), // one instruction
    2, // program id index (system program)
    2, 0, 1, // 2 account indexes: from, to
    ...shortvec(data.length), ...data,
  ]);
}

/** Signed wire transaction (base64) + its signature (base58 = transaction id). */
export function signTransfer(key, to, lamports, recentBlockhash) {
  const msg = transferMessage(key.publicKey, to, lamports, recentBlockhash);
  const sig = ed25519.sign(msg, key.secret);
  return { tx: Buffer.from([...shortvec(1), ...sig, ...msg]).toString('base64'), signature: b58encode(sig) };
}
/** Minimal JSON-RPC client. SOLANA_RPC_URL overrides the public devnet endpoint (it is rate-limited). */
export class SolanaClient {
  constructor({ rpcUrl = SOLANA_DEFAULTS.rpcUrl, commitment = 'confirmed', timeoutMs = 30_000 } = {}) {
    this.rpcUrl = rpcUrl;
    this.commitment = commitment;
    this.timeoutMs = timeoutMs;
    this.id = 0;
  }

  static fromEnv(env = {}) {
    return new SolanaClient({ rpcUrl: env.SOLANA_RPC_URL || SOLANA_DEFAULTS.rpcUrl });
  }

  async rpc(method, params = []) {
    const res = await fetch(this.rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++this.id, method, params }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.error) {
      const err = new Error(`Solana ${method}: ${body.error ? `${body.error.code} ${body.error.message}` : `HTTP ${res.status}`}`);
      err.code = body.error?.code ?? res.status;
      throw err;
    }
    return body.result;
  }

  genesisHash() { return this.rpc('getGenesisHash'); }
  version() { return this.rpc('getVersion'); }

  async balance(address) {
    return BigInt((await this.rpc('getBalance', [address, { commitment: this.commitment }])).value);
  }

  /** Devnet airdrop (heavily rate-limited on the public RPC; faucet.solana.com is the fallback). Returns tx signature. */
  airdrop(address, lamports) {
    return this.rpc('requestAirdrop', [address, Number(lamports), { commitment: this.commitment }]);
  }

  async transfer(key, to, lamports) {
    const { value } = await this.rpc('getLatestBlockhash', [{ commitment: this.commitment }]);
    const { tx, signature } = signTransfer(key, to, lamports, value.blockhash);
    const sent = await this.rpc('sendTransaction', [tx, { encoding: 'base64', preflightCommitment: this.commitment }]);
    if (sent !== signature) throw new Error(`Solana sendTransaction returned unexpected signature ${sent}`);
    return signature;
  }

  /** Resolves when the signature reaches the commitment level; throws if the tx failed. */
  async confirm(signature, { timeoutMs = 60_000, intervalMs = 2_000 } = {}) {
    const end = Date.now() + timeoutMs;
    const rank = { processed: 0, confirmed: 1, finalized: 2 };
    while (Date.now() < end) {
      const s = (await this.rpc('getSignatureStatuses', [[signature], { searchTransactionHistory: true }])).value[0];
      if (s?.err) throw new Error(`Solana tx ${signature} failed: ${JSON.stringify(s.err)}`);
      if (s && rank[s.confirmationStatus] >= rank[this.commitment]) return s;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error(`Solana tx ${signature} not ${this.commitment} after ${timeoutMs / 1000}s`);
  }
}
