// Offline tests for the ASI:Chain and Solana wallet modules (no network, no .env). Run: node agents/chains/test.mjs
// Expected values were produced by REFERENCE implementations, not by this code:
//   ASI    the official asi-chain-wallet algorithm (elliptic + js-sha3 + blakejs + bs58)
//   Solana @solana/web3.js Keypair/SystemProgram.transfer + ed25519-hd-key; SLIP-0010 spec test vectors
import assert from 'node:assert/strict';
import { secp256k1 } from '@noble/curves/secp256k1';
import { blake2b } from '@noble/hashes/blake2b';
import * as asi from './asi.mjs';
import * as sol from './solana.mjs';
import { b58encode, b58decode } from './codec.mjs';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`  ok  ${name}`); };

// Public test key (well-known, never funded) and the BIP-39 spec mnemonic.
const PRIV = '0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318';
const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const A1 = '1111MxJTVVXWUBdWWCQ9EvAc1z9PAdXppNanq2qwG9ca1Ld4oqMLG';
const A2 = '1111AtahZeefej4tvVR6ti9TJtv8yxLebT31SCEVDCKMNikBk5r3g'; // seen on DevNet

test('base58 round-trip incl. leading zeros', () => {
  for (const hex of ['00', '0000ff', '00010203', 'ffffffff']) {
    const b = Uint8Array.from(Buffer.from(hex, 'hex'));
    assert.deepEqual(b58decode(b58encode(b)), b);
  }
  assert.equal(b58encode(new Uint8Array(32)), '11111111111111111111111111111111'); // Solana system program
});

test('ASI key/address matches official wallet', () => {
  const k = asi.asiKey(PRIV);
  assert.equal(k.publicKey, '044e3b81af9c2234cad09d679ce6035ed1392347ce64ce405f5dcd36228a25de6e47fd35c4215d1edf53e6f83de344615ce719bdb0fd878f6ed76f06dd277956de');
  assert.equal(k.ethAddress, '0x2c7536e3605d9c16a7a3d7b1898e529396a65c23');
  assert.equal(k.address, A1);
  assert.equal(asi.asiAddressFromEth('0x2C7536E3605D9C16A7A3D7B1898E529396A65C23'), A1);
});

test('ASI private key is never serialised', () => {
  const k = asi.asiKey(PRIV);
  assert.ok(!JSON.stringify(k).includes('4c0883a6'));
  assert.ok(!Object.keys(k).includes('privateKey'));
});

test('ASI address validation + Rholang injection guard', () => {
  assert.ok(asi.isAsiAddress(A1));
  assert.ok(asi.isAsiAddress(A2));
  assert.ok(!asi.isAsiAddress(A1.slice(0, -1) + 'H')); // bad checksum
  assert.ok(!asi.isAsiAddress('0x2c7536e3605d9c16a7a3d7b1898e529396a65c23'));
  assert.throws(() => asi.balanceTerm('1111", *x) | @"y'), /invalid ASI address/);
  assert.throws(() => asi.transferTerm(A1, 'nope', 1n), /invalid ASI address/);
  assert.throws(() => asi.transferTerm(A1, A2, 0n), /positive/);
  assert.match(asi.transferTerm(A1, A2, 2_500_000_000n), /@vault!\("transfer", "1111Atah[^"]+", 2500000000, \*key/);
});
test('ASI deploy protobuf + signature verify', () => {
  const d = { term: 'new x in { x!(1) }', timestamp: 1791940539375, phloPrice: 1, phloLimit: 500000, validAfterBlockNumber: 122816, shardId: 'root' };
  const bytes = asi.serializeDeploy(d);
  // field 2 (term): tag 0x12 len 18; then field 3 (timestamp) tag 0x18; last field 11 (shardId) tag 0x5a "root"
  assert.equal(Buffer.from(bytes.subarray(0, 2)).toString('hex'), '1212');
  assert.equal(bytes[20], 0x18);
  assert.equal(Buffer.from(bytes.subarray(-6)).toString('hex'), '5a04726f6f74');
  const k = asi.asiKey(PRIV);
  const s = asi.signDeploy(d, k);
  assert.equal(s.sigAlgorithm, 'secp256k1');
  assert.equal(s.deployer, k.publicKey);
  const sig = secp256k1.Signature.fromDER(s.signature);
  assert.ok(!sig.hasHighS());
  assert.ok(secp256k1.verify(sig, blake2b(bytes, { dkLen: 32 }), k.publicKey));
});

test('ASI amounts (8 decimals)', () => {
  assert.equal(asi.parseAsi('25'), 2_500_000_000n);
  assert.equal(asi.parseAsi('0.00000001'), 1n);
  assert.equal(asi.formatAsi(997499764654n), '9974.99764654');
  assert.throws(() => asi.parseAsi('1.123456789'));
  assert.throws(() => asi.parseAsi('-1'));
});

test('SLIP-0010 ed25519 spec vector 1', () => {
  const seed = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex');
  assert.equal(Buffer.from(sol.slip10Ed25519(seed, "m/0'")).toString('hex'), '68e0fe46dfb67e368c75379acec591dad19df3cde26e63b93a8e704f1dade7a3');
  assert.equal(Buffer.from(sol.slip10Ed25519(seed, "m/0'/1'/2'/2'")).toString('hex'), '30d1dc7e5fc04c31219ab25a27ae00b50f6fd66622f6e9c913253d6511d1e662');
  assert.throws(() => sol.slip10Ed25519(seed, 'm/0'), /hardened/);
});

test('Solana agent keys match Phantom path (web3.js + ed25519-hd-key)', () => {
  assert.equal(sol.solanaAgentKey(PHRASE, 0).address, 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk');
  assert.equal(sol.solanaAgentKey(PHRASE, 1).address, 'Hh8QwFUA6MtVu1qAoq12ucvFHNwCcVTV7hpWjeY1Hztb');
  assert.equal(sol.solanaPath(7), "m/44'/501'/7'/0'");
  assert.ok(!Object.keys(sol.solanaAgentKey(PHRASE, 0)).includes('secret'));
});

test('Solana SystemProgram.transfer bytes identical to web3.js', () => {
  const a = sol.solanaAgentKey(PHRASE, 0);
  const bh = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
  const { tx } = sol.signTransfer(a, 'Hh8QwFUA6MtVu1qAoq12ucvFHNwCcVTV7hpWjeY1Hztb', 5000n, bh);
  assert.equal(tx, 'AQjKg+9WWJY5rF1JQxfONhinMpq2RhcouGumoP8N7+2U+SljVbLqE83oE0lMJy5Vc9iyIe9lcGFhPl7DuRWbLAcBAAED8DYnYkanW53jNJ7UKxXiMvZRj8IPX81PHWToH5vSWPf4AprPXLy91axG7BR/O3ij325QIu8EEdsrq2UNMppM1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAzlnbUID8LG07z3ypBxLTwuXmwo8n8N+7mVO9sIlMA6sBAgIAAQwCAAAAiBMAAAAAAAA=');
  assert.throws(() => sol.signTransfer(a, a.address, 1n, bh), /self/);
});

test('Solana amounts + address check', () => {
  assert.equal(sol.parseSol('1.5'), 1_500_000_000n);
  assert.equal(sol.formatSol(1_000_000_001n), '1.000000001');
  assert.ok(sol.isSolanaAddress('HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk'));
  assert.ok(!sol.isSolanaAddress(A1));
});

// ---- ASI web-wallet keyfiles (async: PBKDF2 + AES-GCM via WebCrypto) ----
const { parseKeyfile, unlockKeyfile, sealV2 } = await import('./asi_keyfile.mjs');
const atest = async (name, fn) => { await fn(); passed++; console.log(`  ok  ${name}`); };
const k1 = asi.asiKey(PRIV);
const keyfile = async (pw, iter = 1000) => JSON.stringify({ version: 1, type: 'asi-wallet-keyfile', address: k1.address,
  revAddress: k1.address, ethAddress: k1.ethAddress, encryptedPrivateKey: await sealV2(PRIV.slice(2), pw, { iter }) });

await atest('keyfile round-trip unlocks to the right key', async () => {
  const k = await unlockKeyfile(await keyfile('correct horse'), 'correct horse');
  assert.equal(k.address, A1);
  assert.ok(!JSON.stringify(k).includes('4c0883a6'));
});
await atest('keyfile wrong password / tampered / mismatched address are rejected', async () => {
  const kf = await keyfile('pw');
  await assert.rejects(unlockKeyfile(kf, 'nope'), /wrong password/);
  const j = JSON.parse(kf);
  await assert.rejects(unlockKeyfile(JSON.stringify({ ...j, address: A2, revAddress: A2, ethAddress: undefined }), 'pw'), /does not match/);
  assert.throws(() => parseKeyfile({ ...j, ethAddress: '0x' + '11'.repeat(20) }), /ethAddress does not match/);
  assert.throws(() => parseKeyfile({ ...j, type: 'x' }), /not an asi-wallet-keyfile/);
});
await atest('real web-wallet export shape parses (public fields only)', async () => {
  const real = { version: 1, type: 'asi-wallet-keyfile', address: '1111neXhV9Qp3Pzk7uzq9iKSsXcmSQDtJoESWRgpgY4Vhm2SJLZje',
    revAddress: '1111neXhV9Qp3Pzk7uzq9iKSsXcmSQDtJoESWRgpgY4Vhm2SJLZje', ethAddress: '0x4223d9366c2811e4cbc7345affc9901409492feb',
    encryptedPrivateKey: JSON.stringify({ v: 2, salt: 'AA==', iv: 'AA==', tag: 'AA==', ct: 'AA==', iter: 310000 }) };
  assert.equal(parseKeyfile(real).envelope.iter, 310000);
});

console.log(`chains: ${passed} tests passed`);
