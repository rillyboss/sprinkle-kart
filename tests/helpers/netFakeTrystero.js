/**
 * A fake Trystero 0.25.4 module family for PublicSignaling tests (importer injection).
 * `createFakeTrystero({ net })` gives `importer(spec)` for '@trystero-p2p/torrent' and
 * '@trystero-p2p/nostr'. Every `joinRoom()` call is one "machine" with its own Trystero peer id;
 * machines that join the same strategy + appId + topic with the same password are connected
 * with a real fake-RTC pc pair (tests/helpers/netFakeRtc.js), then `onPeerJoin` fires on both
 * sides — exactly the surface PublicSignaling uses: makeAction (send/onMessage), onPeerJoin,
 * onPeerLeave, getPeers, leave.
 */
import { connectPair } from './netFakeRtc.js';

let tidSeq = 0;

export function createFakeTrystero({ net }) {
  const fake = {
    /** every joinRoom call: { strategy, config, roomId } */
    joins: [],
    /** strategies that are "unreachable" (import rejects) */
    broken: new Set(),
    /** strategies whose relays are up but deliver nothing (no peers ever meet) */
    silent: new Set(),
    imports: [],
    /** @type {Map<string, Set<any>>} */
    topics: new Map(),
  };

  function makeModule(strategy) {
    return {
      selfId: 'trystero-self',
      joinRoom(config, roomId, callbacks) {
        if (!config?.appId) throw new Error('Trystero: config map is missing appId field');
        fake.joins.push({ strategy, config, roomId, callbacks });
        const key = `${strategy}|${config.appId}|${roomId}`;
        const tid = `T${++tidSeq}`;
        const actions = new Map();
        const peers = new Map(); // remote tid → { pc, inst }
        const inst = {
          tid,
          password: config.password ?? '',
          strategy,
          config,
          left: false,
          peers,
          actions,
          room: null,
        };
        const leaveOf = (remoteTid) => {
          if (!peers.has(remoteTid)) return;
          peers.delete(remoteTid);
          room.onPeerLeave?.(remoteTid);
        };
        const room = {
          makeAction(name) {
            if (new TextEncoder().encode(name).length > 32) throw new Error('action type too long');
            const a = actions.get(name) ?? { onMessage: null, send: null };
            a.send = async (data, opts = {}) => {
              const targets = opts.target ? [opts.target] : [...peers.keys()];
              for (const t of targets) {
                const p = peers.get(t);
                if (!p) throw new Error(`no active peer with id ${t}`);
                const payload = JSON.parse(JSON.stringify(data));
                queueMicrotask(() => {
                  const ra = p.inst.actions.get(name);
                  if (ra?.onMessage && !p.inst.left) ra.onMessage(payload, { peerId: tid });
                });
              }
            };
            actions.set(name, a);
            return a;
          },
          onPeerJoin: null,
          onPeerLeave: null,
          getPeers() {
            const out = {};
            for (const [t, p] of peers) if (p.pc.connectionState !== 'closed') out[t] = p.pc;
            return out;
          },
          async leave() {
            if (inst.left) return;
            inst.left = true;
            fake.topics.get(key)?.delete(inst);
            for (const [t, p] of [...peers]) {
              peers.delete(t);
              p.pc.close();
              p.inst._remoteLeft(tid);
            }
          },
        };
        inst.room = room;
        inst._remoteLeft = leaveOf;
        const others = [...(fake.topics.get(key) ?? [])];
        if (!fake.topics.has(key)) fake.topics.set(key, new Set());
        fake.topics.get(key).add(inst);
        if (!fake.silent.has(strategy)) {
          for (const other of others) {
            if (other.left || other.password !== inst.password) continue; // wrong password: no handshake
            const Pc = config.rtcPolyfill ?? net.RTCPeerConnection;
            const OtherPc = other.config.rtcPolyfill ?? net.RTCPeerConnection;
            const mine = new Pc({ ...config.rtcConfig });
            const theirs = new OtherPc({ ...other.config.rtcConfig });
            mine.createDataChannel('data'); // Trystero's own channel (id 0), ignored by us
            queueMicrotask(async () => {
              await connectPair(mine, theirs);
              if (inst.left || other.left) return;
              peers.set(other.tid, { pc: mine, inst: other });
              other.peers.set(tid, { pc: theirs, inst });
              const watch = (pc, owner, remoteTid) =>
                pc.addEventListener('connectionstatechange', () => {
                  if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) owner._remoteLeft(remoteTid);
                });
              watch(mine, inst, other.tid);
              watch(theirs, other, tid);
              room.onPeerJoin?.(other.tid);
              other.room.onPeerJoin?.(tid);
            });
          }
        }
        return room;
      },
    };
  }

  fake.importer = async (spec) => {
    fake.imports.push(spec);
    const strategy = spec === '@trystero-p2p/torrent' ? 'torrent' : spec === '@trystero-p2p/nostr' ? 'nostr' : null;
    if (!strategy) throw new Error(`unexpected import ${spec}`);
    if (fake.broken.has(strategy)) throw new Error(`${strategy} unavailable`);
    return makeModule(strategy);
  };
  return fake;
}
