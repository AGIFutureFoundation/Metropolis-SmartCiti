# Metropolis SmartCiti: Omega Stewards

**Agents operate; people govern, onchain on Monad.**

Monad Metropolis hackathon submission, **Track 04: Trust, Identity & AI Infrastructure**.

An AI agent swarm trains people and robots in the trades. The swarm comes from the SmartCiti.X Trade Craft Academy and the AGI Corp worlds.

- Every agent has a wallet and an **ERC-8004 identity** in the canonical registry on Monad.
- Agents buy work from each other with **x402 micropayments**, settled onchain.
- Every payment is **hash-chained** into a tamper-evident ledger.
- Buyers leave **ERC-8004 reputation** tied to the payment receipt.
- Anything that matters (registering agents, minting, pausing, certifying a person) needs **2 of 3 human stewards signing with P-256 passkeys**. Signatures are checked by Monad's native P-256 precompile, and no steward needs a seed phrase.

## Live on Monad testnet (chain 10143)

Deployed and exercised by the swarm. Every transaction below was re-checked against the Monad testnet RPC (41 of 41 confirmed, status success). Full record: [`deployments/monad-testnet.json`](deployments/monad-testnet.json), [`loop/ledger.jsonl`](loop/ledger.jsonl).

| Contract | Address |
|---|---|
| StewardCouncil (2-of-3 P-256 stewards) | [`0x7582DdE41532a903943f091bFFa4e6f87aCD55ff`](https://testnet.monadexplorer.com/address/0x7582DdE41532a903943f091bFFa4e6f87aCD55ff) |
| OmegaToken (tOMEGA, EIP-3009) | [`0xbc5F1B47ba3C95947a020a3F99D0cC0a5f8c790A`](https://testnet.monadexplorer.com/address/0xbc5F1B47ba3C95947a020a3F99D0cC0a5f8c790A) |
| OmegaAgentHub (x402 settlement + receipts) | [`0x32d1a038bB8a1fDA75a90a791b7EBf6cDfD7Ebf2`](https://testnet.monadexplorer.com/address/0x32d1a038bB8a1fDA75a90a791b7EBf6cDfD7Ebf2) |
| TradeCraftCredential (non-transferable) | [`0x8c5565932a8c400c5F5aFa98e7936dC29d99EACA`](https://testnet.monadexplorer.com/address/0x8c5565932a8c400c5F5aFa98e7936dC29d99EACA) |
| ERC-8004 Identity Registry (canonical) | [`0x8004A818BFB912233c491871b3d84c89A494BD9e`](https://testnet.monadexplorer.com/address/0x8004A818BFB912233c491871b3d84c89A494BD9e) |
| ERC-8004 Reputation Registry (canonical) | [`0x8004B663056A597Dffe9eCcC1965A193B7388713`](https://testnet.monadexplorer.com/address/0x8004B663056A597Dffe9eCcC1965A193B7388713) |

- **12 agents** (Robotics DAO + Agentic Payments teams) registered in the ERC-8004 identity registry (IDs from 2339).
- **11 x402 payments** between agents, each settled onchain with a hash-chained receipt (head `0x758cf112…5ebe`), plus **10 ERC-8004 reputation entries** tied to those receipts.
- **4 Trade Craft credentials** issued (Tower Crane Lift, Rigging Signal Call, Weld Bead Run). Minting is steward-only: 2-of-3 P-256 signatures checked through Monad's native P-256 precompile (RIP-7212). The council nonce stands at 6.
- Spending caps per agent: 5 tOMEGA per payment, 50 tOMEGA per day.
- Tests: `forge test` 15/15, `node agents/chains/test.mjs` 13/13.

## Layout
| Path | What |
|---|---|
| `contracts/src/StewardCouncil.sol` | 2-of-3 P-256 (passkey-curve) steward multisig with a hash-chained governance log and a pause switch |
| `contracts/src/OmegaAgentHub.sol` | Agent registry, per-agent spending caps, x402 settlement, hash-chained receipts |
| `contracts/src/OmegaToken.sol` | **tOMEGA**: Monad-testnet stand-in for $OMEGA, with EIP-3009 gasless transfers (the scheme x402 uses) |
| `contracts/src/TradeCraftCredential.sol` | Non-transferable Trade Craft certificates, minted only by stewards |
| `agents/` | Wallets, deploy script, x402 facilitator/server/client, swarm loop, ERC-8004 agent cards |

## Quick start
```bash
npm ci && (cd contracts && forge test)
node agents/wallets.mjs init        # writes .env (git-ignored): deployer, agent mnemonic, steward P-256 keys
                                    # then set DWELLIR_API_KEY in .env (RPC: Dwellir Monad testnet full node)
node agents/rpc_check.mjs           # read-only: confirms the RPC serves chain 10143
node agents/deploy.mjs              # needs testnet MON on the deployer (faucet.monad.xyz)
node agents/swarm_loop.mjs --cycles 3
```

## Multi-chain agents: Monad + ASI:Chain + Solana
Every agent has a wallet on three networks, all derived from the one swarm mnemonic in `.env`. No new secrets are needed.

| Chain | Network | Agent *i* key | Address |
|---|---|---|---|
| Monad | testnet (EVM, chain 10143) | BIP-44 `m/44'/60'/0'/0/i` | `0x…` |
| ASI:Chain | DevNet (`devnet1`, shard `root`; RChain/Rholang, **not EVM**) | the same secp256k1 key as Monad | `1111…` |
| Solana | devnet | SLIP-0010 ed25519 `m/44'/501'/i'/0'` (Phantom/Solflare path) | base58 |

- ASI addresses use the official [ASI wallet](https://wallet.dev.asichain.io) derivation. Import an agent's Monad private key there to open its ASI account.
- Solana keys import into Phantom using the swarm mnemonic plus the account index.
- The deployer's ASI wallet uses `DEPLOYER_PRIVATE_KEY`. Its Solana wallet is account index 1000 of the swarm mnemonic.
- `agents/wallets.public.json` lists `chains: { monad, asi, solana }` per agent. Agent cards carry the same under `omega.wallets`.

```bash
node agents/wallets.mjs derive                    # rewrite wallets.public.json with all three chains
node agents/multichain.mjs status                 # read-only: ASI node (shard root) + Solana devnet genesis
node agents/multichain.mjs addresses --agents 5
node agents/multichain.mjs balances --agents 5
node agents/multichain.mjs faucet asi --agents 5  # ASI DevNet faucet (deployer + agents 0..4)
node agents/multichain.mjs faucet solana          # public airdrop; falls back to faucet.solana.com
node agents/multichain.mjs send asi deployer 1 25 # Rholang vault transfer, waits for finalization
node agents/multichain.mjs keyfiles               # list ASI web-wallet keyfile exports in ~/Downloads (no password)
read -s ASI_KEYFILE_PASSWORD && export ASI_KEYFILE_PASSWORD
node agents/multichain.mjs sweep-keyfile <keyfile.json> deployer   # move that account's ASI into the swarm (keeps 1 ASI)
node agents/chains/test.mjs                       # offline tests (vectors from the official ASI wallet + @solana/web3.js)
```

Optional `.env` overrides: `ASI_NODE_URL` (default: DevNet Validator 1 `http://34.196.119.4:40403`), `ASI_SHARD_ID`, `ASI_FAUCET_URL`, `SOLANA_RPC_URL` (the public devnet RPC is rate-limited).

ASI DevNet notes: blocks arrive about every 20 s. Balances reflect *finalized* state, so a transfer appears after finalization. The ASI faucet refuses addresses that already hold its threshold. The node endpoint is plain HTTP, as published in the [ASI docs](https://docs.asichain.io/general/useful-links/).

**$OMEGA:** the founder's $OMEGA is a Virtuals agent token. tOMEGA has no market value and no bridge to $OMEGA. It exists so the swarm's x402 economy runs on Monad testnet today.
