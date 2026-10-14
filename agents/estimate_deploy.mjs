// Read-only cost estimate for agents/deploy.mjs on the live RPC: sends nothing, signs nothing.
// Estimates the 4 contract deployments with eth_estimateGas and prices everything at the current max fee.
//
//   node agents/estimate_deploy.mjs [--agents N]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ContractFactory, formatEther, parseEther, ZeroAddress } from 'ethers';
import { setup, artifact, ERC8004, ROOT } from './chain.mjs';
import { agentWallet } from './wallets.mjs';

const N = Number(process.argv[process.argv.indexOf('--agents') + 1]) || Infinity;
const GAS_PER_AGENT = parseEther(process.env.GAS_PER_AGENT || '0.05');
const { env, provider, deployer } = setup();
const roster = JSON.parse(readFileSync(join(ROOT, 'agents/roster.json'), 'utf8')).agents.slice(0, N);
const fee = await provider.getFeeData();
const price = fee.maxFeePerGas ?? fee.gasPrice;

const qx = [1, 2, 3].map((k) => env[`STEWARD${k}_P256_X`]);
const qy = [1, 2, 3].map((k) => env[`STEWARD${k}_P256_Y`]);
const placeholder = deployer.address; // any non-zero address: constructor args only change calldata, not size much
const plan = [
  ['StewardCouncil', [qx, qy]],
  ['OmegaToken', [placeholder]],
  ['OmegaAgentHub', [placeholder, placeholder, ERC8004.identity, ERC8004.reputation]],
  ['TradeCraftCredential', [placeholder]],
];
let deployGas = 0n;
for (const [name, args] of plan) {
  const { abi, bytecode } = artifact(name);
  const tx = await new ContractFactory(abi, bytecode).getDeployTransaction(...args);
  let g;
  try { g = await provider.estimateGas({ ...tx, from: deployer.address }); }
  catch (e) { console.log(`${name}: estimateGas failed (${e.shortMessage || e.message}); using 6,000,000`); g = 6_000_000n; }
  deployGas += g;
  console.log(`${name.padEnd(22)} ${g.toString().padStart(10)} gas  ${formatEther(g * price)} MON`);
}

let toFund = 0;
for (let i = 0; i < roster.length; i++) {
  if ((await provider.getBalance(agentWallet(env, i).address)) < GAS_PER_AGENT / 2n) toFund++;
}
const funding = GAS_PER_AGENT * BigInt(toFund);
const transfers = 21_000n * BigInt(toFund) * price;
// governed steps: batch registration (chunks of 25), caps, mint — generous allowance of 3,000,000 gas each
const governed = BigInt(Math.ceil(roster.length / 25) + 2) * 3_000_000n * price;
const total = deployGas * price + funding + transfers + governed;
const bal = await provider.getBalance(deployer.address);

console.log(`max fee ${price} wei/gas (Monad charges the gas LIMIT, so estimates are near the real cost)`);
console.log(`agents in run: ${roster.length}; need gas top-up: ${toFund} x ${formatEther(GAS_PER_AGENT)} = ${formatEther(funding)} MON`);
console.log(`contracts ${formatEther(deployGas * price)} + top-ups ${formatEther(funding)} + transfer gas ${formatEther(transfers)} + governed allowance ${formatEther(governed)}`);
console.log(`ESTIMATED deployer spend: ${formatEther(total)} MON; deployer balance ${formatEther(bal)} MON; ${bal >= total ? 'FITS' : 'SHORT by ' + formatEther(total - bal) + ' MON'}`);
