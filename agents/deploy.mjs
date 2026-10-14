// Deploy the Omega system to Monad testnet and bootstrap the swarm:
//   1. StewardCouncil (3 P-256 steward keys from .env), OmegaToken (tOMEGA), OmegaAgentHub, TradeCraftCredential
//   2. fund agent wallets with a little MON for gas (only agents that will sign onchain txs)
//   3. register each agent in the canonical ERC-8004 IdentityRegistry from its own wallet
//   4. stewards (2-of-3 passkeys) register the swarm in the hub with caps, and mint tOMEGA to it
// Idempotent: re-running skips finished steps (state in deployments/monad-testnet.json).
//
//   node agents/deploy.mjs [--agents N]     N = how many roster agents get ERC-8004 ids (default all)
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseEther, formatEther, Contract, ContractFactory, Interface } from 'ethers';
import { setup, artifact, loadDeployments, contracts, govern, DEPLOYMENTS, ERC8004, EXPLORER, ROOT } from './chain.mjs';
import { agentWallet } from './wallets.mjs';

const N = Number(process.argv[process.argv.indexOf('--agents') + 1]) || Infinity;
const GAS_PER_AGENT = parseEther(process.env.GAS_PER_AGENT || '0.05');
const PER_TX_CAP = 5_000_000n; // 5 tOMEGA per payment
const DAILY_CAP = 50_000_000n; // 50 tOMEGA per day
const AIRDROP = 100_000_000n; // 100 tOMEGA per agent

const IDENTITY_ABI = [
  'function register(string agentURI) returns (uint256)',
  'event Registered(uint256 indexed agentId, string agentURI, address indexed owner)',
];

const { env, provider, deployer } = setup();
const roster = JSON.parse(readFileSync(join(ROOT, 'agents/roster.json'), 'utf8')).agents.slice(0, N);
let d = loadDeployments() || { chainId: Number(env.CHAIN_ID), explorer: EXPLORER, erc8004: ERC8004, agents: {} };
const save = () => {
  mkdirSync(dirname(DEPLOYMENTS), { recursive: true });
  writeFileSync(DEPLOYMENTS, JSON.stringify(d, null, 2) + '\n');
};

const bal = await provider.getBalance(deployer.address);
console.log(`deployer ${deployer.address}: ${formatEther(bal)} MON`);
if (bal === 0n) {
  console.error('Deployer has 0 MON. Fund it at https://faucet.monad.xyz and re-run.');
  process.exit(2);
}

async function deploy(name, args) {
  if (d[name]) return d[name];
  const { abi, bytecode } = artifact(name);
  const c = await new ContractFactory(abi, bytecode, deployer).deploy(...args);
  await c.waitForDeployment();
  d[name] = await c.getAddress();
  d[`${name}_tx`] = c.deploymentTransaction().hash;
  save();
  console.log(`  ${name} ${d[name]}`);
  return d[name];
}

console.log('1) contracts');
const qx = [1, 2, 3].map((k) => env[`STEWARD${k}_P256_X`]);
const qy = [1, 2, 3].map((k) => env[`STEWARD${k}_P256_Y`]);
const council = await deploy('StewardCouncil', [qx, qy]);
const token = await deploy('OmegaToken', [council]);
await deploy('OmegaAgentHub', [council, token, ERC8004.identity, ERC8004.reputation]);
await deploy('TradeCraftCredential', [council]);
const c = contracts(d, deployer);

console.log('2) agent gas + 3) ERC-8004 identities');
const idIface = new Interface(IDENTITY_ABI);
for (const [i, a] of roster.entries()) {
  if (d.agents[a.slug]?.erc8004Id !== undefined) continue;
  const w = agentWallet(env, i).connect(provider);
  // Monad charges the full gas LIMIT x maxFee, so top up to GAS_PER_AGENT, not merely "above half".
  const have = await provider.getBalance(w.address);
  if (have < GAS_PER_AGENT) {
    await (await deployer.sendTransaction({ to: w.address, value: GAS_PER_AGENT - have })).wait();
  }
  const uri = `https://raw.githubusercontent.com/AGIFutureFoundation/Metropolis-SmartCiti/main/agents/cards/${a.slug}.json`;
  const rc = await (await new Contract(ERC8004.identity, IDENTITY_ABI, w).register(uri)).wait();
  const ev = rc.logs.map((l) => { try { return idIface.parseLog(l); } catch { return null; } }).find((x) => x?.name === 'Registered');
  d.agents[a.slug] = { index: i, wallet: w.address, erc8004Id: Number(ev.args.agentId), role: a.role, registerTx: rc.hash, uri };
  save();
  console.log(`  [${i}] ${a.slug} -> ERC-8004 #${ev.args.agentId}`);
}

console.log('4) steward-governed swarm registration + tOMEGA airdrop');
const done = roster.filter((a) => d.agents[a.slug]);
const pending = [];
for (const a of done) if (!(await c.hub.listed(d.agents[a.slug].wallet))) pending.push(a);
for (let k = 0; k < pending.length; k += 25) {
  const chunk = pending.slice(k, k + 25);
  const data = c.hub.interface.encodeFunctionData('registerAgents', [
    chunk.map((a) => d.agents[a.slug].wallet),
    chunk.map((a) => d.agents[a.slug].erc8004Id),
    chunk.map((a) => a.role),
    PER_TX_CAP,
    DAILY_CAP,
    chunk.map((a) => d.agents[a.slug].uri),
  ]);
  await govern(c, env, d.OmegaAgentHub, data, [1, 2], `hub.registerAgents x${chunk.length}`);
  const mint = c.token.interface.encodeFunctionData('mintBatch', [chunk.map((a) => d.agents[a.slug].wallet), AIRDROP]);
  await govern(c, env, d.OmegaToken, mint, [2, 3], `token.mintBatch x${chunk.length}`);
}
d.caps = { perTx: '5 tOMEGA', daily: '50 tOMEGA', airdrop: '100 tOMEGA' };
save();
console.log(`done: ${Object.keys(d.agents).length} agents; see ${EXPLORER}/address/${d.OmegaAgentHub}`);
console.log(`deployer balance now ${formatEther(await provider.getBalance(deployer.address))} MON`);
