// x402 resource server: every Omega agent sells something. Unpaid requests get HTTP 402 with the
// payment requirements; paid requests are settled onchain through the facilitator before delivery.
import http from 'node:http';
import { requirements, unb64, b64, X402_VERSION } from './x402.mjs';

/** catalogue: Map("/x402/<seller>/<item>" -> { price, payTo, description, deliver(payer, result) }) */
export function startServer({ port, catalogue, facilitator, token, onPaid }) {
  const server = http.createServer(async (req, res) => {
    const send = (code, body, headers = {}) => {
      res.writeHead(code, {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'X-PAYMENT',
        'access-control-expose-headers': 'X-PAYMENT-RESPONSE',
        ...headers,
      });
      res.end(JSON.stringify(body));
    };
    try {
      const path = new URL(req.url, 'http://x').pathname;
      if (path === '/x402/catalogue') {
        return send(200, [...catalogue.entries()].map(([r, it]) => ({ resource: r, price: it.price, payTo: it.payTo, description: it.description })));
      }
      const item = catalogue.get(path);
      if (!item) return send(404, { error: 'unknown resource' });
      const reqs = requirements({ resource: path, description: item.description, price: item.price, payTo: item.payTo, token });
      const header = req.headers['x-payment'];
      if (!header) return send(402, { x402Version: X402_VERSION, accepts: [reqs], error: 'X-PAYMENT header is required' });
      const result = await facilitator.settle(unb64(header), reqs);
      if (!result.success) return send(402, { x402Version: X402_VERSION, accepts: [reqs], error: result.errorReason });
      const body = await item.deliver(result.payer, result);
      onPaid?.({ resource: path, item, result, body });
      return send(200, body, { 'X-PAYMENT-RESPONSE': b64(result) });
    } catch (e) {
      return send(500, { error: e.shortMessage || e.message });
    }
  });
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok(server)));
}
