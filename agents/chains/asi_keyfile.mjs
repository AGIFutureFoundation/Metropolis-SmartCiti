// ASI web-wallet keyfiles ("asi-wallet-keyfile", exported from wallet.dev.asichain.io -> Accounts -> Export).
// encryptedPrivateKey is the wallet's V2 envelope (asi-chain-wallet src/utils/encryptedPayload.ts):
//   { v: 2, salt(16B), iv(12B), tag(16B), ct, iter }  key = PBKDF2-SHA256(password, salt, iter) -> AES-256-GCM
//   plaintext = the secp256k1 private key as hex.
// We decrypt only in memory, verify the key really produces the file's address, and never print/persist the key.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';
import { asiKey, asiAddressFromEth, isAsiAddress } from './asi.mjs';

const subtle = webcrypto.subtle;
const b64 = (s) => Uint8Array.from(Buffer.from(s, 'base64'));

/** Parse + validate a keyfile (public checks only, no password needed). */
export function parseKeyfile(text) {
  const j = typeof text === 'string' ? JSON.parse(text) : text;
  if (j?.type !== 'asi-wallet-keyfile') throw new Error('not an asi-wallet-keyfile');
  const address = j.address || j.revAddress;
  if (!isAsiAddress(address)) throw new Error('keyfile address is not a valid ASI address');
  if (j.ethAddress && asiAddressFromEth(j.ethAddress) !== address) throw new Error('keyfile ethAddress does not match address');
  const env = JSON.parse(j.encryptedPrivateKey);
  if (env.v !== 2 || !env.salt || !env.iv || !env.tag || !env.ct) {
    throw new Error('unsupported keyfile encryption (only the wallet\'s V2 AES-GCM format is supported)');
  }
  return { address, ethAddress: j.ethAddress, envelope: env, exportedAt: j.timestamp };
}

/** Same envelope the wallet writes (sealV2). Used by tests and to re-export. */
export async function sealV2(plaintext, password, { iter = 310_000 } = {}) {
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, iter);
  const out = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext)));
  const enc = (b) => Buffer.from(b).toString('base64');
  return JSON.stringify({ v: 2, salt: enc(salt), iv: enc(iv), tag: enc(out.subarray(-16)), ct: enc(out.subarray(0, -16)), iter });
}

async function deriveKey(password, salt, iter) {
  const base = await subtle.importKey('raw', new TextEncoder().encode(password), { name: 'PBKDF2' }, false, ['deriveKey']);
  return subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt', 'encrypt']);
}

/** Decrypt a keyfile with its wallet password -> asiKey (secret non-enumerable). Throws on wrong password. */
export async function unlockKeyfile(text, password) {
  const kf = parseKeyfile(text);
  const e = kf.envelope;
  const key = await deriveKey(password, b64(e.salt), e.iter > 0 ? e.iter : 100_000);
  let plain;
  try {
    const ct = new Uint8Array([...b64(e.ct), ...b64(e.tag)]);
    plain = new TextDecoder().decode(await subtle.decrypt({ name: 'AES-GCM', iv: b64(e.iv) }, key, ct));
  } catch {
    throw new Error(`wrong password for ${kf.address} (AES-GCM authentication failed)`);
  }
  const hex = plain.trim().replace(/^0x/, '');
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('decrypted keyfile does not contain a 32-byte hex private key');
  const k = asiKey('0x' + hex);
  if (k.address !== kf.address) throw new Error('decrypted key does not match the keyfile address');
  return k;
}

/** All keyfiles in a directory, de-duplicated by address (the wallet re-exports the same account many times). */
export function scanKeyfiles(dir) {
  const byAddr = new Map();
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    const path = join(dir, f);
    if (!statSync(path).isFile()) continue;
    let kf;
    try { kf = parseKeyfile(readFileSync(path, 'utf8')); } catch { continue; }
    const cur = byAddr.get(kf.address);
    if (cur) cur.copies.push(path);
    else byAddr.set(kf.address, { ...kf, path, copies: [path] });
  }
  return [...byAddr.values()];
}
