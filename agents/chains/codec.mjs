// Small encoding helpers shared by the non-EVM chain modules (ASI:Chain, Solana).
// Base58 here is the Bitcoin alphabet with leading-zero preservation, used by both chains' addresses.

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/;

export function b58encode(bytes) {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = '';
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = '1' + out;
  }
  return out;
}

export function b58decode(str) {
  if (typeof str !== 'string' || !BASE58_RE.test(str)) throw new Error('invalid base58 string');
  let n = 0n;
  for (const ch of str) n = n * 58n + BigInt(ALPHABET.indexOf(ch));
  const bytes = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  for (const ch of str) {
    if (ch !== '1') break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

/** Attach a secret to a key object without making it enumerable, so console.log / JSON.stringify never print it. */
export function withSecret(obj, name, value) {
  Object.defineProperty(obj, name, { value, enumerable: false, writable: false });
  return obj;
}
