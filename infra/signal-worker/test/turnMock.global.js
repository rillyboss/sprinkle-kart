// Vitest global setup: a local stand-in for Cloudflare's TURN credentials API, so the worker tests never need
// an account or the network. The worker reaches it through TURN_API_BASE (see vitest.config.js).
//
//   POST /v1/turn/keys/:id/credentials/generate-ice-servers   → 201 { iceServers } (unique creds per call,
//                                                               including :53 URLs the worker must filter)
//   GET  /__log                                                → every mint request received
//   POST /__reset                                              → clear the log and go back to 'ok' mode
//   POST /__mode?m=ok|fail                                     → make the API answer 500 ('fail')
import { createServer } from 'node:http';

export function createTurnMock() {
  const log = [];
  let mode = 'ok';
  let n = 0;
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://mock');
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const send = (status, obj) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      if (req.method === 'GET' && url.pathname === '/__log') return send(200, log);
      if (req.method === 'POST' && url.pathname === '/__reset') {
        log.length = 0;
        mode = 'ok';
        return send(200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/__mode') {
        mode = url.searchParams.get('m') || 'ok';
        return send(200, { ok: true, mode });
      }
      const m = /^\/v1\/turn\/keys\/([^/]+)\/credentials\/generate-ice-servers$/.exec(url.pathname);
      if (req.method === 'POST' && m) {
        let parsed = null;
        try { parsed = JSON.parse(body); } catch { /* recorded as null */ }
        log.push({ keyId: decodeURIComponent(m[1]), auth: req.headers.authorization ?? null, body: parsed });
        if (mode === 'fail') return send(500, { error: 'mock failure' });
        n += 1;
        return send(201, {
          iceServers: [
            { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
            {
              urls: [
                'turn:turn.cloudflare.com:3478?transport=udp',
                'turn:turn.cloudflare.com:53?transport=udp',
                'turn:turn.cloudflare.com:3478?transport=tcp',
                'turn:turn.cloudflare.com:80?transport=tcp',
                'turns:turn.cloudflare.com:5349?transport=tcp',
                'turns:turn.cloudflare.com:443?transport=tcp',
              ],
              username: `mock-user-${n}`,
              credential: `mock-cred-${n}`,
            },
          ],
        });
      }
      return send(404, { error: 'not found' });
    });
  });
  return {
    server,
    listen: () => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`))),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

export default async function setup({ provide }) {
  const mock = createTurnMock();
  const url = await mock.listen();
  provide('turnMockUrl', url);
  return () => mock.close();
}
