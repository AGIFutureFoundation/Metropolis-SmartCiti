// Multi-chain wallets for the Omega swarm: every agent holds Monad (EVM), ASI:Chain DevNet and Solana devnet wallets,
// all derived from the one swarm mnemonic in .env (see agents/wallets.mjs agentKeys). Never prints a secret.
//
//   node agents/multichain.mjs status                     read-only: both networks reachable + on the expected chain
//   node agents/multichain.mjs addresses [--agents N]     public addresses per agent (from .env, no network)
//   node agents/multichain.mjs balances [--agents N]      read-only ASI + Solana balances (deployer + first N agents)
//   node agents/multichain.mjs faucet asi|solana [--agents N] [--sol 1]
//                                                         request DevNet tokens for the deployer (+ first N agents)
//   node agents/multichain.mjs send asi|solana <fromIndex|deployer> <toIndex|address> <amount>
//                                                         transfer between swarm wallets and wait for inclusion
//   node agents/multichain.mjs keyfiles [dir]             list ASI web-wallet keyfiles (default ~/Downloads), no password
//   ASI_KEYFILE_PASSWORD=… node agents/multichain.mjs sweep-keyfile <file> <toIndex|deployer|address> [--keep 1]
//                                                         move a web-wallet account's ASI into a swarm wallet
//
// Env overrides (.env or process env): ASI_NODE_URL, ASI_SHARD_ID, ASI_FAUCET_URL, SOLANA_RPC_URL.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEnv, agentKeys, deployerKeys } from './wallets.mjs';
import { ROOT } from './chain.mjs';
import { scanKeyfiles, unlockKeyfile } from './chains/asi_keyfile.mjs';
import { AsiClient, isAsiAddress, parseAsi, formatAsi } from './chains/asi.mjs';
import { SolanaClient, SOLANA_DEFAULTS, isSolanaAddress, parseSol, formatSol } from './chains/solana.mjs';

const argv = process.argv.slice(2);
const flag = (k, dflt) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : dflt);
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));
const [cmd, ...rest] = positional;

const OVERRIDES = ['ASI_NODE_URL', 'ASI_SHARD_ID', 'ASI_FAUCET_URL', 'SOLANA_RPC_URL'];
const env = { ...loadEnv(), ...Object.fromEntries(OVERRIDES.filter((k) => process.env[k]).map((k) => [k, process.env[k]])) };
const asi = AsiClient.fromEnv(env);
const sol = SolanaClient.fromEnv(env);
const N = Number(flag('--agents', 0));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** [{ label, monad?, asi, solana }] for the deployer and agents 0..n-1 (key objects; secrets non-enumerable). */
function wallets(n) {
  const d = deployerKeys(env);
  const out = [{ label: 'deployer', monadAddress: env.DEPLOYER_ADDRESS, asi: d.asi, solana: d.solana }];
  for (let i = 0; i < n; i++) {
    const k = agentKeys(env, i);
    out.push({ label: `agent ${i}`, monadAddress: k.monad.address, ...k });
  }
  return out;
}

function who(ref) {
  if (ref === 'deployer') return wallets(0)[0];
  if (!/^\d+$/.test(ref)) throw new Error(`expected an agent index or "deployer", got ${ref}`);
  return { label: `agent ${ref}`, ...agentKeys(env, Number(ref)) };
}
async function status() {
  let ok = true;
  try {
    const s = await asi.status();
    const good = s.shardId === asi.shardId;
    ok &&= good;
    console.log(`asi    ${new URL(asi.nodeUrl).host}: network ${s.networkId}, shard ${s.shardId} (expected ${asi.shardId}), `
      + `peers ${s.peers}, block ${await asi.latestBlockNumber()}${good ? '' : '  <-- MISMATCH'}`);
  } catch (e) { ok = false; console.log(`asi    unreachable: ${e.message}`); }
  try {
    const g = await sol.genesisHash();
    const devnet = g === SOLANA_DEFAULTS.genesisHash;
    if (!env.SOLANA_RPC_URL) ok &&= devnet; // a custom RPC may deliberately point elsewhere
    console.log(`solana ${new URL(sol.rpcUrl).host}: genesis ${g} (${devnet ? 'devnet' : 'NOT devnet'}), solana-core ${(await sol.version())['solana-core']}`);
  } catch (e) { ok = false; console.log(`solana unreachable: ${e.message}`); }
  if (!ok) process.exit(1);
}

function addresses() {
  for (const w of wallets(N || 5)) {
    console.log(`${w.label.padEnd(9)} monad ${w.monadAddress}  asi ${w.asi.address}  solana ${w.solana.address}`);
  }
}

async function balances() {
  for (const w of wallets(N)) {
    const [a, s] = await Promise.allSettled([asi.balance(w.asi.address), sol.balance(w.solana.address)]);
    const fa = a.status === 'fulfilled' ? `${formatAsi(a.value)} ASI` : `error: ${a.reason.message}`;
    const fs = s.status === 'fulfilled' ? `${formatSol(s.value)} SOL` : `error: ${s.reason.message}`;
    console.log(`${w.label.padEnd(9)} asi ${w.asi.address} ${fa.padStart(14)}   solana ${w.solana.address.padEnd(44)} ${fs}`);
  }
}

async function faucet(chain) {
  if (chain !== 'asi' && chain !== 'solana') throw new Error('faucet chain must be asi or solana');
  for (const w of wallets(N)) {
    try {
      if (chain === 'asi') {
        console.log(`${w.label.padEnd(9)} asi faucet -> ${w.asi.address} deploy ${await asi.faucet(w.asi.address)}`);
      } else {
        const lamports = parseSol(flag('--sol', '1'));
        const sig = await sol.airdrop(w.solana.address, lamports);
        console.log(`${w.label.padEnd(9)} solana airdrop ${formatSol(lamports)} SOL -> ${w.solana.address} tx ${sig}`);
      }
    } catch (e) {
      console.log(`${w.label.padEnd(9)} ${chain} faucet failed: ${e.message}`);
      const site = chain === 'asi' ? 'https://faucet.dev.asichain.io' : SOLANA_DEFAULTS.faucet;
      console.log(`          fallback: paste ${w[chain].address} into ${site}`);
    }
    await sleep(1500); // be gentle with public faucets
  }
}

async function send(chain, fromRef, toRef, amount) {
  const from = who(fromRef);
  if (chain === 'asi') {
    const to = isAsiAddress(toRef) ? toRef : who(toRef).asi.address;
    const atomic = parseAsi(amount);
    const before = await asi.balance(to);
    const id = await asi.transfer(from.asi, to, atomic);
    console.log(`asi ${from.label} -> ${to} ${formatAsi(atomic)} ASI  deploy ${id}`);
    console.log('  waiting for block inclusion + finalization (~20s blocks; finalization typically a few minutes)…');
    const s = await asi.waitForDeploy(id);
    if (s.errored) throw new Error(`deploy errored in block ${s.blockNumber}: ${s.error}`);
    const after = await asi.balance(to);
    console.log(`  finalized in block ${s.blockNumber} (${s.blockHash.slice(0, 16)}…), cost ${s.cost} phlo; recipient ${formatAsi(before)} -> ${formatAsi(after)} ASI`);
    if (after - before !== atomic) console.log('  WARNING: recipient balance did not rise by the amount (check sender balance / phlo)');
  } else if (chain === 'solana') {
    const to = /^\d+$/.test(toRef) || toRef === 'deployer' ? who(toRef).solana.address : toRef;
    if (!isSolanaAddress(to)) throw new Error(`invalid Solana address: ${toRef}`);
    const lamports = parseSol(amount);
    const sig = await sol.transfer(from.solana, to, lamports);
    console.log(`solana ${from.label} -> ${to} ${formatSol(lamports)} SOL  tx ${sig}`);
    await sol.confirm(sig);
    console.log(`  confirmed: https://explorer.solana.com/tx/${sig}?cluster=devnet`);
  } else throw new Error('send chain must be asi or solana');
}

/** Public scan of ASI web-wallet keyfiles: unique accounts, validity, live balance, swarm match. No password needed. */
async function keyfiles(dir) {
  const pub = JSON.parse(readFileSync(join(ROOT, 'agents/wallets.public.json'), 'utf8'));
  const ours = new Map([[pub.deployerChains?.asi, 'deployer'], ...pub.agents.map((a) => [a.chains?.asi, `agent ${a.index}`])]);
  const list = scanKeyfiles(dir);
  console.log(`${list.length} unique ASI account(s) in ${dir}`);
  for (const k of list) {
    let bal;
    try { bal = `${formatAsi(await asi.balance(k.address))} ASI`; } catch (e) { bal = `balance error: ${e.message}`; }
    console.log(`  ${k.address}  ${bal.padStart(14)}  swarm: ${ours.get(k.address) || 'no'}  copies: ${k.copies.length}`);
  }
}

/**
 * Sweep an ASI web-wallet account (keyfile) into a swarm wallet. Password comes ONLY from the env var
 * ASI_KEYFILE_PASSWORD (never argv: argv is visible in `ps` and shell history). Leaves `--keep` ASI (default 1) for phlo.
 */
async function sweep(file, toRef) {
  const password = process.env.ASI_KEYFILE_PASSWORD;
  if (!password) throw new Error('set ASI_KEYFILE_PASSWORD in the environment (e.g. `read -s ASI_KEYFILE_PASSWORD; export ASI_KEYFILE_PASSWORD`)');
  const key = await unlockKeyfile(readFileSync(file, 'utf8'), password);
  const to = isAsiAddress(toRef) ? toRef : who(toRef).asi.address;
  const have = await asi.balance(key.address);
  const amount = have - parseAsi(flag('--keep', '1'));
  if (amount <= 0n) throw new Error(`${key.address} holds ${formatAsi(have)} ASI; nothing to sweep after --keep`);
  const id = await asi.transfer(key, to, amount);
  console.log(`asi sweep ${key.address} -> ${to} ${formatAsi(amount)} ASI  deploy ${id}; waiting for finalization…`);
  const s = await asi.waitForDeploy(id);
  if (s.errored) throw new Error(`deploy errored in block ${s.blockNumber}: ${s.error}`);
  console.log(`  finalized in block ${s.blockNumber}; recipient now ${formatAsi(await asi.balance(to))} ASI`);
}

const USAGE = 'usage: node agents/multichain.mjs status | addresses | balances | faucet asi|solana | '
  + 'send asi|solana <from> <to> <amount> | keyfiles [dir] | sweep-keyfile <file> <toIndex|deployer|address> [--keep 1]'
  + '   [--agents N] [--sol X]';
try {
  if (cmd === 'keyfiles') await keyfiles(rest[0] || join(homedir(), 'Downloads'));
  else if (cmd === 'sweep-keyfile' && rest.length === 2) await sweep(...rest);
  else if (cmd === 'status') await status();
  else if (cmd === 'addresses') addresses();
  else if (cmd === 'balances') await balances();
  else if (cmd === 'faucet') await faucet(rest[0]);
  else if (cmd === 'send' && rest.length === 4) await send(...rest);
  else { console.error(USAGE); process.exit(1); }
} catch (e) {
  console.error(`error: ${e.message}`);
  process.exit(1);
}
