// Version handshake (NETWORKING.md §7.2, net review #9): a real content hash + build id, so an old tab opened
// before a deploy gets "Different game version — everyone refresh the page 🔄" instead of silently racing a
// different track; a SETUP naming a track or racer this tab lacks is a version mismatch; the host never accepts a
// racer id it doesn't know.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  contentHash, contentSummary, canonical, fnv1a32, buildId, unknownSetupIds, knownTrackIds, knownCharacterIds, PROTOCOL_VERSION,
} from '../src/net/version.js';
import { identity } from '../src/online/onlineFlow.js';
import { TRACKS } from '../src/tracks/index.js';
import { CHARACTERS } from '../src/characters/index.js';
import { TUNING } from '../src/race/tuning.js';
import { buildIdentity, compatible } from '../src/net/session/wire.js';
import { createHostSession } from '../src/net/session/hostSession.js';
import { createGuestSession } from '../src/net/session/guestSession.js';
import { TEXT } from '../src/net/session/texts.js';
import { createSessionHub } from './net.session.hub.js';

const SECRET = { label: 'SPRINKLE-4821', sweets: [1, 2, 3, 4, 5, 6] };
const PC = { userAgent: 'x', platform: 'Win32', maxTouchPoints: 0 };

describe('contentHash', () => {
  it('is a stable, non-zero u32 of this bundle', () => {
    const h = contentHash();
    expect(Number.isInteger(h) && h > 0 && h <= 0xffffffff).toBe(true);
    expect(contentHash()).toBe(h);
    expect(fnv1a32(canonical(contentSummary()))).toBe(h);
    expect(fnv1a32('')).toBe(0x811c9dc5);
    expect(contentSummary().protocol).toBe(PROTOCOL_VERSION);
  });

  it('changes with a tuning constant, a track layout or a racer stat — not with key order', () => {
    const h = contentHash({});
    const firstKey = Object.keys(TUNING).find((k) => typeof TUNING[k] === 'number');
    expect(contentHash({ tuning: { ...TUNING, [firstKey]: TUNING[firstKey] + 0.01 } })).not.toBe(h);
    const [t0, ...rest] = TRACKS;
    const moved = { ...t0, controlPoints: t0.controlPoints.map((p, i) => (i === 0 ? [p[0] + 1, p[1], p[2]] : p)) };
    expect(contentHash({ tracks: [moved, ...rest] })).not.toBe(h);
    expect(contentHash({ tracks: rest })).not.toBe(h); // a track fewer (an old tab before a new track)
    const [c0, ...others] = CHARACTERS;
    expect(contentHash({ characters: [{ ...c0, stats: { ...c0.stats, speed: (c0.stats?.speed ?? 3) + 1 } }, ...others] })).not.toBe(h);
    const shuffled = Object.fromEntries(Object.entries(TUNING).reverse());
    expect(contentHash({ tuning: shuffled })).toBe(h);
    expect(canonical({ b: 1, a: [1.0000001, 'x', null, true], f() {} })).toBe('{"a":[1,"x",null,true],"b":1}');
  });

  it('identity() announces the real content hash and the baked-in build id', () => {
    const id = identity();
    expect(id.content).toBe(contentHash());
    expect(id.content).not.toBe(0);
    expect(id.proto).toBe(PROTOCOL_VERSION);
    expect(id.build).toBe(buildId());
    expect(typeof id.build).toBe('string');
    const cfg = readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8');
    expect(cfg).toMatch(/define: \{ __SK_BUILD__: JSON\.stringify\(skBuildId\(\)\) \}/);
    expect(compatible(id, { ...id, build: 'other' }).ok).toBe(true);
    expect(compatible(id, { ...id, content: (id.content + 1) >>> 0 }).ok).toBe(false);
  });
});

describe('an old tab meets a new host', () => {
  it('a different content hash gets REJECT version and the friendly sentence (never the lobby)', () => {
    const hub = createSessionHub();
    const host = createHostSession({ transport: hub.host(), signalings: [], now: () => 0, secret: SECRET, mine: identity() });
    host.dispatch({ type: 'open' });
    host.dispatch({ type: 'opened' });
    const old = { ...identity(), content: (contentHash() ^ 0x1234) >>> 0, build: 'oldtab' };
    const ep = hub.guest('guest-old');
    const g = createGuestSession({ transport: ep, secret: SECRET, now: () => 0, mine: buildIdentity(old), platform: PC });
    const fx = [];
    g.onEffect((e) => fx.push(e));
    g.dispatch({ type: 'connect' });
    hub.connect('guest-old');
    hub.flush();
    expect(g.state.end).toEqual({ reason: 'version', text: TEXT.version });
    expect(TEXT.version).toBe('Different game version — everyone refresh the page 🔄');
    expect(fx.find((e) => e.type === 'screen' && e.id === 'online-hub').params.message).toBe(TEXT.version);
    expect(host.prompt()).toBe(null);
    expect(host.lobby().houses).toHaveLength(1);
  });

  it('a SETUP naming a track or racer this tab lacks is caught (never TRACKS[0] online)', () => {
    const t = TRACKS[0].id;
    const c = CHARACTERS[0].id;
    expect(unknownSetupIds({ mode: 'free', trackId: t, participants: [{ characterId: c }], cpuIds: [c] })).toEqual([]);
    expect(unknownSetupIds({ mode: 'free', trackId: 'brand-new-track', participants: [{ characterId: c }] })).toEqual(['track:brand-new-track']);
    expect(unknownSetupIds({ mode: 'free', trackId: t, participants: [{ characterId: 'new-racer' }], cpuIds: ['new-racer', 'other'] })).toEqual(['racer:new-racer', 'racer:other']);
    expect(knownTrackIds().size).toBe(TRACKS.length);
    expect(knownCharacterIds().size).toBe(CHARACTERS.length);
    const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
    expect(main).toMatch(/if \(mod\.unknownSetupIds\(ev\.setup\)\.length\) \{[\s\S]{0,300}return \{ message: mod\.TEXT\.version \};/);
  });

  it('the host ignores a racer pick it does not know', () => {
    const hub = createSessionHub();
    const known = knownCharacterIds();
    const host = createHostSession({ transport: hub.host(), signalings: [], now: () => 0, secret: SECRET, isCharacter: (id) => known.has(id) });
    host.dispatch({ type: 'open' });
    host.dispatch({ type: 'opened' });
    host.dispatch({ type: 'host-intent', intent: { kind: 'pick', seat: 0, characterId: 'not-a-racer' } });
    expect(host.lobby().houses[0].players[0].characterId).toBe(null);
    host.dispatch({ type: 'host-intent', intent: { kind: 'pick', seat: 0, characterId: CHARACTERS[1].id } });
    expect(host.lobby().houses[0].players[0].characterId).toBe(CHARACTERS[1].id);
    host.dispatch({ type: 'host-intent', intent: { kind: 'pick', seat: 0, characterId: null } }); // un-pick is fine
    expect(host.lobby().houses[0].players[0].characterId).toBe(null);
    void vi;
  });
});
