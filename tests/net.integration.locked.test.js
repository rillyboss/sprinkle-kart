// Review #19 end to end on public signaling (fake Trystero + fake RTC, the real PublicSignaling, dual wrapper,
// WebRtcTransport and joinGuestRoom): a knock on a locked room ends with "The host's room is closed for now 🔒",
// never the NAT sentence or "couldn't find that room".
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createPublicSignaling } from '../src/net/signaling/public.js';
import { createDualSignaling, openOnline } from '../src/net/signaling/index.js';
import { joinGuestRoom } from '../src/online/onlineFlow.js';
import { TEXT } from '../src/net/session/texts.js';
import { createFakeRtcNetwork, fakeRoomIds } from './helpers/netFakeRtc.js';
import { createFakeTrystero } from './helpers/netFakeTrystero.js';

const HOST = 'aaaaaaaaaaaaaaaa';
const STUN = [{ urls: 'stun:stun.cloudflare.com:3478' }];
afterEach(() => vi.useRealTimers());

describe('a locked room on public signaling', () => {
  it('the guest hears "closed" from the host (not the NAT tips, not "not found")', async () => {
    vi.useFakeTimers();
    const net = createFakeRtcNetwork();
    const fake = createFakeTrystero({ net });
    const ids = fakeRoomIds('locked');
    const dual = (sig) => createDualSignaling({ transports: { public: sig }, kinds: ['public'] });
    const host = await openOnline({ role: 'host', selfId: HOST, ids, iceServers: STUN, deps: { signaling: dual(createPublicSignaling({ importer: fake.importer, nostrRelays: [] })) } });
    host.signaling.setLocked(true);
    let t = 0;
    const guest = await joinGuestRoom({
      secret: { label: 'SPRINKLE-4821', sweets: [1, 2, 3, 4, 5, 6] },
      deps: {
        deriveRoomIds: async () => ids, selfId: 'bbbbbbbbbbbbbbbb', now: () => t, tokenStore: null,
        platform: { userAgent: 'x', platform: 'Win32', maxTouchPoints: 0 },
        openOnline: (o) => openOnline({ ...o, iceServers: STUN, deps: { signaling: dual(createPublicSignaling({ importer: fake.importer, nostrRelays: [] })) } }),
      },
    });
    for (let i = 0; i < 40 && guest.session.state.phase !== 'ended'; i++) {
      await vi.advanceTimersByTimeAsync(250);
      t += 250;
      guest.session.dispatch({ type: 'tick' });
    }
    expect(guest.session.state.end).toEqual({ reason: 'locked', text: TEXT.closed });
    guest.close();
    host.transport.close();
    await host.signaling.leave();
  });
});
