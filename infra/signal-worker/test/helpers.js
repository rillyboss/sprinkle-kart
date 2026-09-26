// Shared helpers for the worker tests (they run inside workerd).
import { SELF, env } from 'cloudflare:test';
import { expect } from 'vitest';

export const BASE = 'https://signal.test';
export const PROD_ORIGIN = 'https://rillyboss.github.io';

const hex = (n) => [...crypto.getRandomValues(new Uint8Array(Math.ceil(n / 2)))]
  .map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, n);

export const roomCode = () => `r${hex(24)}`;
export const peerId = () => hex(16);

let ipSeq = 0;
/** A distinct documentation-range IP per call, so tests never share guard counters by accident. */
export function freshIp() {
  ipSeq += 1;
  return `198.51.${Math.floor(ipSeq / 250) % 250}.${(ipSeq % 250) + 1}`;
}

export function get(path, headers = {}, init = {}) {
  return SELF.fetch(`${BASE}${path}`, { headers, ...init });
}

/** A test WebSocket client with a message queue. */
export function wrapSocket(ws) {
  const queue = [];
  const waiters = [];
  let closeInfo = null;
  const closeWaiters = [];
  ws.addEventListener('message', (ev) => {
    let data = ev.data;
    if (typeof data === 'string' && data !== 'pong') {
      try { data = JSON.parse(data); } catch { /* keep raw */ }
    }
    const w = waiters.shift();
    if (w) w(data); else queue.push(data);
  });
  ws.addEventListener('close', (ev) => {
    closeInfo = { code: ev.code, reason: ev.reason };
    for (const w of closeWaiters.splice(0)) w(closeInfo);
  });
  ws.accept();
  return {
    ws,
    send(msg) { ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); },
    /** Next message (parsed JSON, or 'pong'). Rejects after `ms`. */
    next(ms = 3000) {
      if (queue.length) return Promise.resolve(queue.shift());
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => {
          const i = waiters.indexOf(done);
          if (i >= 0) waiters.splice(i, 1);
          reject(new Error('no message'));
        }, ms);
        const done = (m) => { clearTimeout(t); resolve(m); };
        waiters.push(done);
      });
    },
    /** Resolve with the next message, or null if none arrives within `ms`. */
    async maybeNext(ms = 150) {
      try { return await this.next(ms); } catch { return null; }
    },
    pending() { return [...queue]; },
    closed(ms = 3000) {
      if (closeInfo) return Promise.resolve(closeInfo);
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('not closed')), ms);
        closeWaiters.push((c) => { clearTimeout(t); resolve(c); });
      });
    },
    close() { try { ws.close(1000, 'bye'); } catch { /* already closed */ } },
  };
}

/**
 * Open /room/:code as a WebSocket through the Worker.
 * @returns {Promise<ReturnType<typeof wrapSocket> & { res: Response }>}
 */
export async function connect(code, {
  role = 'guest', peer = peerId(), ip = freshIp(), origin = PROD_ORIGIN, proto = '1', query,
} = {}) {
  const headers = { Upgrade: 'websocket', 'CF-Connecting-IP': ip };
  if (origin !== null) headers.Origin = origin;
  const q = query ?? `role=${role}&peer=${peer}&proto=${proto}`;
  const res = await SELF.fetch(`${BASE}/room/${code}?${q}`, { headers });
  expect(res.status).toBe(101);
  const client = wrapSocket(res.webSocket);
  return Object.assign(client, { res, peer, ip });
}

/** Connect and read the first message (joined or error). */
export async function join(code, opts = {}) {
  const c = await connect(code, opts);
  const first = await c.next();
  return Object.assign(c, { first });
}

/** Host + optional guests, all joined. */
export async function hostedRoom(guests = 0) {
  const code = roomCode();
  const host = await join(code, { role: 'host' });
  expect(host.first.t).toBe('joined');
  const gs = [];
  for (let i = 0; i < guests; i++) {
    const g = await join(code, { role: 'guest' });
    expect(g.first.t).toBe('joined');
    expect(await host.next()).toEqual({ t: 'peer-join', peer: g.peer });
    gs.push(g);
  }
  return { code, host, guests: gs };
}

// ---- TURN mock control -------------------------------------------------------------------------------------

export async function mockReset() {
  await fetch(`${env.TURN_API_BASE}/__reset`, { method: 'POST' });
}
export async function mockLog() {
  return (await fetch(`${env.TURN_API_BASE}/__log`)).json();
}
export async function mockMode(m) {
  await fetch(`${env.TURN_API_BASE}/__mode?m=${m}`, { method: 'POST' });
}

export const guardStub = () => env.SIGNAL_ROOM.get(env.SIGNAL_ROOM.idFromName('guard'));
export const roomStub = (code) => env.SIGNAL_ROOM.get(env.SIGNAL_ROOM.idFromName(code));

/** Wait a tick so the Durable Object can finish handling a message. */
export const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));
