// Write one ERC-8004 registration file ("agent card") per roster agent to agents/cards/<slug>.json.
// The IdentityRegistry stores each agent's URI pointing at its card on GitHub raw.
// Cards carry only public data: wallet, role, x402 endpoint, Virtuals links, $OMEGA reference.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadDeployments } from './chain.mjs';
import { METAPROMPT, ROLE_NAME, PRICE } from './roles.mjs';

const roster = JSON.parse(readFileSync(join(ROOT, 'agents/roster.json'), 'utf8'));
const pub = JSON.parse(readFileSync(join(ROOT, 'agents/wallets.public.json'), 'utf8'));
const d = loadDeployments() || { agents: {} };
mkdirSync(join(ROOT, 'agents/cards'), { recursive: true });

for (const [i, a] of roster.agents.entries()) {
  const wallet = pub.agents[i].address;
  const card = {
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: a.name,
    description: a.description,
    image: 'https://raw.githubusercontent.com/AGIFutureFoundation/Metropolis-SmartCiti/main/web/omega.svg',
    services: [
      { name: 'x402', endpoint: `/x402/${a.slug}/work`, version: '1', price: `${Number(PRICE[a.role]) / 1e6} tOMEGA`, network: 'monad-testnet' },
      ...(a.virtuals ? [{ name: 'virtuals-acp', endpoint: a.virtuals.url }] : []),
    ],
    registrations: d.agents[a.slug] ? [{ agentId: d.agents[a.slug].erc8004Id, agentRegistry: `eip155:10143:${d.erc8004?.identity}` }] : [],
    supportedTrust: ['reputation'],
    x402Support: true,
    active: true,
    omega: {
      slug: a.slug,
      role: ROLE_NAME[a.role],
      metaprompt: METAPROMPT[a.role],
      wallet,
      // Multi-chain wallets (public addresses only), all derived from the swarm mnemonic; see agents/wallets.mjs.
      wallets: pub.agents[i].chains || { monad: wallet },
      caps: { perPayment: '5 tOMEGA', daily: '50 tOMEGA', above: 'needs 2-of-3 steward passkeys' },
      mayNever: roster.may_never,
      token: roster.omega_token,
      source: a.source,
      ...(a.virtuals ? { virtuals: a.virtuals } : {}),
    },
  };
  writeFileSync(join(ROOT, `agents/cards/${a.slug}.json`), JSON.stringify(card, null, 2) + '\n');
}
console.log(`wrote ${roster.agents.length} agent cards to agents/cards/`);
