// Net debug overlay never prints an IP address (NETWORKING.md §1 rule 6, §14; acceptance M1-12).
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  formatNetDebug, netDebugText, scrubIps, candidateLabel, shouldShowNetDebug, createDebugOverlay,
} from '../src/net/debugOverlay.js';
import { summarizeStats } from '../src/net/transport/webrtc.js';
import { createFakeRtcNetwork, FAKE_IPS } from './helpers/netFakeRtc.js';
import { createFakeDocument } from './helpers/fakeDom.js';

const IPV4 = /\b\d{1,3}(\.\d{1,3}){3}\b/;
const IPS = [...FAKE_IPS, '10.0.0.5', '2001:db8::7', 'fe80::1%eth0', '[::1]:5000', '203.0.113.7:3478', 'a1b2c3d4-0000-1111-2222-333344445555.local'];

/** A stats report as leaky as a real getStats(): every field that could carry an address does. */
function leakyInfo() {
  return {
    role: 'guest',
    transport: 'worker',
    matchmakers: ['worker', 'public-torrent', `evil ${IPS[0]}`],
    self: { build: `abc123 ${IPS[1]}`, proto: 1, content: 777 },
    hostAdvantageMs: 38,
    peers: [{
      label: `host at ${IPS[2]}`,
      relayed: true,
      candidate: { type: 'relay', protocol: 'udp', address: IPS[3], ip: IPS[4], port: 3478, url: `turn:${IPS[1]}:3478` },
      rttMs: 84.2, jitterMs: 6, lossPct: 1.25, burstLen: 1.5, snapshotHz: 30, kbpsIn: 118, kbpsOut: 37, stateSkips: 0,
      interpDelayMs: 101, lead: 7, slack: 2, extrapolating: false, reconcileP50Cm: 1.2, reconcileP99Cm: 2.1, snaps: 0,
      eventsPerSec: 5.3, lastEventSeq: 1234, bufferedCtrl: 0, clockOffsetMs: -12.5, clockSpreadMs: 1.1, epoch: 2,
      hostTick: 3600, localTick: 3599.6, build: IPS[5], proto: 1, content: 777,
      remoteAddress: IPS[6], localCandidate: `candidate:1 1 udp 2122260223 ${IPS[0]} 50001 typ host`,
    }],
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('debug overlay', () => {
  it('shows the §14 fields', () => {
    const f = formatNetDebug(leakyInfo());
    const text = netDebugText(leakyInfo());
    for (const k of ['role', 'transport', 'matchmakers', 'rtt / jitter', 'loss / burst', 'snapshots in', 'wire kbps in / out', 'state skips',
      'interp delay', 'input lead / slack', 'extrapolating', 'reconcile p50 / p99', 'snaps', 'events/s · last seq', 'ctrl buffered',
      'clock offset', 'timebase epoch', 'host tick / estimate', 'their build', 'host advantage']) expect(text).toContain(k);
    expect(f.rows.find(([k]) => k === 'role')[1]).toBe('guest');
    expect(f.peers[0].rows.find(([k]) => k === 'path')[1]).toBe('relayed · relay/udp');
    expect(text).toContain('84 ms');
    expect(text).toContain('1234');
    expect(text).toContain('worker + public-torrent');
  });

  it('never prints an IP address or port, even from a leaky stats report', () => {
    const text = netDebugText(leakyInfo()) + JSON.stringify(formatNetDebug(leakyInfo()));
    for (const ip of IPS) expect(text).not.toContain(ip);
    expect(text).not.toMatch(IPV4);
    expect(text).not.toContain('3478');
    expect(text).not.toContain('.local');
  });

  it('works on a real summarizeStats() of the fake WebRTC getStats (which carries raw IPs)', async () => {
    const net = createFakeRtcNetwork({ udpBlocked: false });
    const pc = new net.RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.example:3478' }] });
    const report = await pc.getStats();
    const summary = summarizeStats(report);
    const text = netDebugText({ role: 'host', peers: [{ ...summary, candidate: summary?.candidateType, relayed: summary?.relayed }] });
    for (const ip of FAKE_IPS) expect(text).not.toContain(ip);
    expect(text).not.toMatch(IPV4);
  });

  it('candidate labels are whitelisted types only', () => {
    expect(candidateLabel('srflx')).toBe('srflx');
    expect(candidateLabel('relay/tls')).toBe('relay/tls');
    expect(candidateLabel('relay/203.0.113.7')).toBe('relay');
    expect(candidateLabel(FAKE_IPS[0])).toBe('—');
    expect(candidateLabel({ type: 'host', protocol: 'udp', address: FAKE_IPS[0] })).toBe('host/udp');
    expect(candidateLabel({ type: 'weird' })).toBe('—');
    expect(candidateLabel(null)).toBe('—');
  });

  it('scrubIps leaves ordinary text alone', () => {
    expect(scrubIps('rtt / jitter: 12 ms / 3 ms')).toBe('rtt / jitter: 12 ms / 3 ms');
    expect(scrubIps('build abc-1.2.3')).toBe('build abc-1.2.3');
    for (const ip of IPS) expect(scrubIps(`x ${ip} y`)).not.toContain(ip);
  });

  it('?netdebug=1 or the saved preference turns it on', () => {
    expect(shouldShowNetDebug({ search: '?netdebug=1' })).toBe(true);
    expect(shouldShowNetDebug({ search: '?netdebug=0' })).toBe(false);
    expect(shouldShowNetDebug({ showNetworkInfo: true })).toBe(true);
    expect(shouldShowNetDebug()).toBe(false);
  });

  it('renders into a DOM panel and removes itself (no DOM → a harmless stub)', () => {
    const doc = createFakeDocument();
    const o = createDebugOverlay({ doc });
    o.update(leakyInfo());
    expect(o.node.textContent).toContain('Network info');
    for (const ip of IPS) expect(o.node.textContent).not.toContain(ip);
    expect(doc.body.children).toContain(o.node);
    o.destroy();
    expect(doc.body.children).not.toContain(o.node);
    const stub = createDebugOverlay({ doc: null });
    expect(() => stub.update(leakyInfo())).not.toThrow();
  });
});
