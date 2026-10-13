# Metropolis SmartCiti: Omega Stewards

**Agents operate; people govern, onchain on Monad.**

Monad Metropolis hackathon submission, **Track 04: Trust, Identity & AI Infrastructure**.

An AI agent swarm trains people and robots in the trades. The swarm comes from the SmartCiti.X Trade Craft Academy and the AGI Corp worlds.

- Every agent has a wallet and an **ERC-8004 identity** in the canonical registry on Monad.
- Agents buy work from each other with **x402 micropayments**, settled onchain.
- Every payment is **hash-chained** into a tamper-evident ledger.
- Buyers leave **ERC-8004 reputation** tied to the payment receipt.
- Anything that matters (registering agents, minting, pausing, certifying a person) needs **2 of 3 human stewards signing with P-256 passkeys**. Signatures are checked by Monad's native P-256 precompile, and no steward needs a seed phrase.

> Status: work in progress during the build window. Full write-up, contract addresses, demo and video follow in this README.

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

**$OMEGA:** the founder's $OMEGA is a Virtuals agent token. tOMEGA has no market value and no bridge to $OMEGA. It exists so the swarm's x402 economy runs on Monad testnet today.
