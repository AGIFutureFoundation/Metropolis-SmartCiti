// x402 on Monad for the Omega swarm: facilitator, resource server and agent client.
//
// Wire format follows x402 v1 ("exact" scheme, EIP-3009):
//   GET /x402/<seller>/<item>            -> 402 { x402Version, accepts:[PaymentRequirements], error }
//   GET ... with header X-PAYMENT: b64   -> facilitator verifies + settles via OmegaAgentHub.settle()
//                                         -> 200 + X-PAYMENT-RESPONSE: b64 { success, transaction, network, payer }
// The hub enforces the swarm's caps and hash-chains every receipt; tOMEGA checks signature + nonce.
import { randomBytes } from 'node:crypto';
import { Signature, verifyTypedData } from 'ethers';

export const NETWORK = 'monad-testnet';
export const X402_VERSION = 1;
export const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64');
export const unb64 = (s) => JSON.parse(Buffer.from(s, 'base64').toString('utf8'));

export function domain(chainId, token) {
  return { name: 'Omega Testnet Token', version: '1', chainId, verifyingContract: token };
}
export const TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};

export function requirements({ resource, description, price, payTo, token }) {
  return {
    scheme: 'exact',
    network: NETWORK,
    maxAmountRequired: String(price),
    resource,
    description,
    mimeType: 'application/json',
    payTo,
    maxTimeoutSeconds: 300,
    asset: token,
    extra: { name: 'Omega Testnet Token', version: '1', decimals: 6, symbol: 'tOMEGA' },
  };
}

export function makeFacilitator({ hub, token, chainId }) {
  async function verify(payment, req) {
    const { authorization: a, signature } = payment.payload;
    if (payment.scheme !== 'exact' || payment.network !== NETWORK) return { isValid: false, invalidReason: 'unsupported scheme/network' };
    if (a.to.toLowerCase() !== req.payTo.toLowerCase()) return { isValid: false, invalidReason: 'wrong payTo' };
    if (BigInt(a.value) < BigInt(req.maxAmountRequired)) return { isValid: false, invalidReason: 'insufficient amount' };
    const signer = verifyTypedData(domain(chainId, token), TYPES, a, signature);
    if (signer.toLowerCase() !== a.from.toLowerCase()) return { isValid: false, invalidReason: 'bad signature' };
    const agent = await hub.agents(a.from);
    if (!agent.active) return { isValid: false, invalidReason: 'payer is not a registered Omega agent' };
    if (BigInt(a.value) > agent.perTxCap) return { isValid: false, invalidReason: 'over per-payment cap (needs stewards)' };
    return { isValid: true, payer: a.from };
  }

  async function settle(payment, req) {
    const v = await verify(payment, req);
    if (!v.isValid) return { success: false, errorReason: v.invalidReason, network: NETWORK };
    const { authorization: a, signature } = payment.payload;
    const sig = Signature.from(signature);
    const tx = await hub.settle(
      { from: a.from, to: a.to, value: a.value, validAfter: a.validAfter, validBefore: a.validBefore, nonce: a.nonce, v: sig.v, r: sig.r, s: sig.s },
      req.resource,
    );
    const rc = await tx.wait();
    const paid = rc.logs.map((l) => { try { return hub.interface.parseLog(l); } catch { return null; } }).find((x) => x?.name === 'Paid');
    return {
      success: true,
      transaction: rc.hash,
      network: NETWORK,
      payer: a.from,
      receipt: Number(paid.args.receipt),
      receiptHash: paid.args.receiptHash,
      head: paid.args.head,
    };
  }
  return { verify, settle };
}

/** An agent wallet fetches a paid resource: GET -> 402 -> sign EIP-3009 -> retry with X-PAYMENT. */
export async function payAndFetch(url, wallet, { chainId, maxPrice }) {
  const first = await fetch(url);
  if (first.status !== 402) return { status: first.status, body: await first.json() };
  const { accepts } = await first.json();
  const req = accepts.find((r) => r.scheme === 'exact' && r.network === NETWORK);
  if (!req) throw new Error('no supported payment option');
  if (maxPrice !== undefined && BigInt(req.maxAmountRequired) > BigInt(maxPrice)) {
    throw new Error(`price ${req.maxAmountRequired} over agent budget ${maxPrice}`);
  }
  const now = Math.floor(Date.now() / 1000);
  const authorization = {
    from: wallet.address,
    to: req.payTo,
    value: req.maxAmountRequired,
    validAfter: '0',
    validBefore: String(now + req.maxTimeoutSeconds),
    nonce: '0x' + randomBytes(32).toString('hex'),
  };
  const signature = await wallet.signTypedData(domain(chainId, req.asset), TYPES, authorization);
  const payment = { x402Version: X402_VERSION, scheme: 'exact', network: NETWORK, payload: { signature, authorization } };
  const paid = await fetch(url, { headers: { 'X-PAYMENT': b64(payment) } });
  const body = await paid.json();
  const receipt = paid.headers.get('x-payment-response');
  return { status: paid.status, body, payment: receipt ? unb64(receipt) : null, requirements: req };
}
