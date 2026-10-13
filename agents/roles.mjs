// Metaprompts, prices and the x402 catalogue for the Omega swarm. Each role has a standing
// instruction (its metaprompt); a deliverable is derived from it plus the request and hashed, so every
// claim in the ledger is reproducible. Roles: 0 coordinator, 1 tutor, 2 robot, 3 sensor/QA, 4 liaison.
import { keccak256, toUtf8Bytes } from 'ethers';

export const METAPROMPT = {
  0: 'Coordinator: decompose the module into tasks, buy only what the cycle needs, never exceed the cap.',
  1: 'Tutor: return a flipped-lesson plan with objectives, safety gates and a graded check.',
  2: 'Robot: replay the signed simulator run; physical dispatch is disabled.',
  3: 'Sensor/QA: grade the run against its checks; flag any keep-out or load-limit breach.',
  4: 'Omega liaison: brief the human stewards; never vote, enact, move treasury or appoint.',
};

export const ROLE_NAME = { 0: 'coordinator', 1: 'tutor', 2: 'robot', 3: 'sensor-qa', 4: 'omega-liaison' };

/** Price per call in tOMEGA base units (6 decimals). All under the 5 tOMEGA per-payment cap. */
export const PRICE = { 0: 500_000n, 1: 2_000_000n, 2: 1_000_000n, 3: 1_500_000n, 4: 750_000n };

/** The five Trade Craft modules wired to real SmartCiti.X sites (per SmartCiti.X PR #107). */
export const MODULES = [
  'TCA-110 m1 Tower Crane Lift',
  'TCA-120 m4 Rigging Signal Call',
  'TCA-130 m1 Weld Bead Run',
  'TCA-140 m1 Forklift Yard Run',
  'TCA-150 m1 Scaffold Bay Build',
];

export function buildCatalogue(live) {
  const catalogue = new Map();
  for (const a of live) {
    catalogue.set(`/x402/${a.slug}/work`, {
      price: PRICE[a.role],
      payTo: a.wallet.address,
      description: `${a.name}: ${METAPROMPT[a.role]}`,
      deliver: async (payer, result) => {
        const work = { seller: a.slug, erc8004Id: a.erc8004Id, metaprompt: METAPROMPT[a.role], for: payer, receipt: result.receipt };
        return { ...work, deliverableHash: keccak256(toUtf8Bytes(JSON.stringify(work))) };
      },
    });
  }
  return catalogue;
}

/** Choose this cycle's team, falling back to other roles when a role has no live agents. */
export function team(live, cycle) {
  const by = (r) => live.filter((a) => a.role === r);
  const pick = (arr, i) => arr[i % arr.length];
  const or = (...lists) => lists.find((l) => l.length) || live;
  const coord = pick(or(by(0)), cycle);
  return {
    coord,
    tutor: pick(or(by(1), live.filter((a) => a !== coord)), cycle),
    robot: pick(or(by(2), by(1)), cycle),
    qa: pick(or(by(3), live.filter((a) => a !== coord)), cycle + 1),
    liaison: pick(or(by(4), by(1)), cycle),
    research: pick(or(by(1), by(0)), cycle + 1),
  };
}
