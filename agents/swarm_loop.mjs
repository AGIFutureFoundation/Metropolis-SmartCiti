// The Omega swarm loop. Each cycle:
//   coordinator --x402--> tutor        lesson plan for the module
//   robot       --x402--> sensor/QA    grade my simulator run (Tactile $SENSE when it is live)
//   liaison     --x402--> research     evidence brief for the human stewards
//   each buyer  --ERC-8004--> giveFeedback(seller), bound to the x402 receipt hash
//   2-of-3 stewards (P-256) --> TradeCraftCredential.issue(learner), evidence = receipt chain head
//
//   node agents/swarm_loop.mjs [--cycles N] [--minutes M]     appends loop/ledger.jsonl, writes loop/console.json
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Contract, keccak256, toUtf8Bytes, formatUnits, AbiCoder } from 'ethers';
import { setup, loadDeployments, contracts, govern, ERC8004, ROOT } from './chain.mjs';
import { agentWallet } from './wallets.mjs';
import { makeFacilitator, payAndFetch } from './x402.mjs';
import { startServer } from './x402_server.mjs';
import { buildCatalogue, team, MODULES } from './roles.mjs';

const arg = (k, dflt) => (process.argv.includes(k) ? Number(process.argv[process.argv.indexOf(k) + 1]) : dflt);
const CYCLES = arg('--cycles', 1);
const MINUTES = arg('--minutes', 0);
const PORT = 8402;
const REPUTATION_ABI = ['function giveFeedback(uint256,int128,uint8,string,string,string,string,bytes32)'];

const { env, provider, deployer } = setup();
const d = loadDeployments();
if (!d) throw new Error('no deployments: run agents/deploy.mjs first');
const c = contracts(d, deployer);
const chainId = Number(env.CHAIN_ID);
const roster = JSON.parse(readFileSync(join(ROOT, 'agents/roster.json'), 'utf8')).agents;
const live = roster
  .filter((a) => d.agents[a.slug])
  .map((a) => ({ ...a, ...d.agents[a.slug], wallet: agentWallet(env, d.agents[a.slug].index).connect(provider) }));

// Monad reserves gas LIMIT x maxFee up front (~0.06 MON per ERC-8004 feedback tx at testnet fees),
// so make sure every live agent can afford a few feedback txs before the loop starts.
const SWARM_GAS = BigInt(Math.round(Number(process.env.SWARM_GAS_MON || '0.2') * 1e6)) * 10n ** 12n;
for (const a of live) {
  const have = await provider.getBalance(a.wallet.address);
  if (have < SWARM_GAS) {
    await (await deployer.sendTransaction({ to: a.wallet.address, value: SWARM_GAS - have })).wait();
    console.log(`  gas top-up ${a.slug} -> ${Number(SWARM_GAS) / 1e18} MON`);
  }
}

mkdirSync(join(ROOT, 'loop'), { recursive: true });
const LEDGER = join(ROOT, process.env.RPC_URL ? 'loop/ledger.rehearsal.jsonl' : 'loop/ledger.jsonl');
const log = (e) => appendFileSync(LEDGER, JSON.stringify({ t: new Date().toISOString(), ...e }) + '\n');

const facilitator = makeFacilitator({ hub: c.hub, token: d.OmegaToken, chainId });
const server = await startServer({ port: PORT, catalogue: buildCatalogue(live), facilitator, token: d.OmegaToken });
const url = (a) => `http://127.0.0.1:${PORT}/x402/${a.slug}/work`;

async function buy(buyer, seller, why) {
  const r = await payAndFetch(url(seller), buyer.wallet, { chainId, maxPrice: 5_000_000n });
  if (r.status !== 200) throw new Error(`${buyer.slug} -> ${seller.slug}: ${r.status} ${JSON.stringify(r.body)}`);
  const p = r.payment;
  const amt = formatUnits(r.requirements.maxAmountRequired, 6);
  console.log(`  x402 ${buyer.slug} -> ${seller.slug} ${amt} tOMEGA  receipt #${p.receipt} tx ${p.transaction.slice(0, 12)}…`);
  log({ kind: 'x402', why, buyer: buyer.slug, seller: seller.slug, amount: r.requirements.maxAmountRequired, tx: p.transaction, receipt: p.receipt, receiptHash: p.receiptHash, head: p.head, deliverableHash: r.body.deliverableHash });
  const rep = new Contract(ERC8004.reputation, REPUTATION_ABI, buyer.wallet);
  const score = 80 + (p.receipt % 20);
  const rc = await (await rep.giveFeedback(seller.erc8004Id, score, 0, 'tradecraft', why, url(seller), '', p.receiptHash)).wait();
  log({ kind: 'erc8004-feedback', from: buyer.slug, to: seller.slug, agentId: seller.erc8004Id, score, tx: rc.hash });
  return p;
}

const t0 = Date.now();
let cycle = 0;
const summary = [];
while (cycle < CYCLES || (MINUTES && Date.now() - t0 < MINUTES * 60_000)) {
  const mod = MODULES[cycle % MODULES.length];
  console.log(`cycle ${cycle + 1}: ${mod}`);
  log({ kind: 'cycle-start', cycle: cycle + 1, module: mod });
  const t = team(live, cycle);
  let pays = 0;
  for (const [b, s, why] of [[t.coord, t.tutor, 'lesson-plan'], [t.robot, t.qa, 'run-grading'], [t.liaison, t.research, 'steward-brief']]) {
    if (b.slug !== s.slug) { await buy(b, s, why); pays++; }
  }
  const head = await c.hub.receiptHead();
  const learner = '0x' + keccak256(toUtf8Bytes(`learner-${cycle}-${t0}`)).slice(26);
  const evidence = keccak256(AbiCoder.defaultAbiCoder().encode(['bytes32', 'string'], [head, mod]));
  const issue = c.cred.interface.encodeFunctionData('issue', [learner, mod, evidence, t.tutor.erc8004Id]);
  const rc = await govern(c, env, d.TradeCraftCredential, issue, cycle % 2 ? [1, 3] : [2, 3], `credential ${mod}`);
  log({ kind: 'credential', cycle: cycle + 1, module: mod, learner, evidence, receiptHead: head, tx: rc.hash });
  summary.push({ cycle: cycle + 1, module: mod, payments: pays, head });
  cycle++;
}
server.close();

const stats = {
  updated: new Date().toISOString(),
  cycles: cycle,
  receipts: Number(await c.hub.receipts()),
  receiptHead: await c.hub.receiptHead(),
  councilNonce: Number(await c.council.nonce()),
  credentials: Number(await c.cred.totalIssued()),
  agents: live.length,
  deployerMON: (await provider.getBalance(env.DEPLOYER_ADDRESS)).toString(),
  summary,
};
writeFileSync(join(ROOT, process.env.RPC_URL ? 'loop/console.rehearsal.json' : 'loop/console.json'), JSON.stringify(stats, null, 2) + '\n');
console.log(`done: ${stats.cycles} cycles, ${stats.receipts} receipts, ${stats.credentials} credentials, head ${stats.receiptHead.slice(0, 18)}…`);
