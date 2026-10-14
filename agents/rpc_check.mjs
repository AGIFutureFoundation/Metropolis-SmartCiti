// Read-only RPC smoke test through the same connection the agents use (agents/chain.mjs setup()).
// Confirms the endpoint serves the chain .env expects. Sends nothing, signs nothing.
//
//   node agents/rpc_check.mjs
import { setup } from './chain.mjs';

const { env, provider, deployer } = setup();
const want = BigInt(env.CHAIN_ID);
const got = BigInt(await provider.send('eth_chainId', []));
const block = await provider.getBlockNumber();
const balance = await provider.getBalance(deployer.address);
const host = new URL(process.env.RPC_URL || env.MONAD_TESTNET_RPC).host;
console.log(`rpc ${host}: chainId ${got} (expected ${want}), block ${block}, deployer balance ${balance} wei`);
if (got !== want) {
  console.error(`chain mismatch: endpoint serves ${got}, .env CHAIN_ID is ${want}`);
  process.exit(1);
}
