// playerLabel (NETWORKING.md §10.8) + its call sites stay "P1".."P4" offline.
import { describe, it, expect, afterEach } from 'vitest';
import {
  playerLabel, labelWithName, setLabelContext, clearLabelContext, getLabelContext, isLocalPlayer,
} from '../src/net/session/playerLabel.js';
import { createLobby, lobbyReduce } from '../src/net/session/lobby.js';
import { CHARACTERS } from '../src/characters/index.js';
import { ceremonyHeadline } from '../src/modes/grandPrix.js';

const run = (lobby, actions) => actions.reduce((l, a) => lobbyReduce(l, a).lobby, lobby);
const [A, B] = CHARACTERS;

function lobby() {
  let l = createLobby({ label: 'SPRINKLE-4821' });
  l = run(l, [{ type: 'house-join', isHost: true, players: 2 }, { type: 'house-approve', players: 2 }]);
  return run(l, [{ type: 'pick', houseId: 1, seat: 0, characterId: A.id }]);
}

afterEach(() => clearLabelContext());

describe('playerLabel', () => {
  it('offline: exactly the old P1..P4 labels', () => {
    expect([0, 1, 2, 3].map((pi) => playerLabel(pi))).toEqual(['P1', 'P2', 'P3', 'P4']);
    expect(labelWithName(1, B.name)).toBe(`P2 ${B.name}`);
    expect(isLocalPlayer(3)).toBe(true);
    expect(getLabelContext()).toBe(null);
  });

  it('online: local players by local slot, remote players "<house emoji> <racer name>"', () => {
    const opts = { localPis: [2, 3], lobby: lobby(), characters: CHARACTERS };
    expect(playerLabel(2, opts)).toBe('P1');
    expect(playerLabel(3, opts)).toBe('P2');
    expect(playerLabel(0, opts)).toBe('🏰 Friend'); // host house, no racer picked yet
    const guestView = { localPis: [0, 1], lobby: lobby(), characters: CHARACTERS };
    expect(playerLabel(2, guestView)).toBe(`🏡 ${A.name}`);
    expect(playerLabel(3, guestView)).toBe('🏡 Friend');
    expect(playerLabel(7, guestView)).toBe('🏡 Friend'); // unknown index: still friendly
    expect(labelWithName(2, A.name, guestView)).toBe(`🏡 ${A.name}`); // never "🏡 Name Name"
    expect(labelWithName(0, B.name, guestView)).toBe(`P1 ${B.name}`);
    expect(isLocalPlayer(2, guestView)).toBe(false);
  });

  it('the context set by the online flow is used by default and cleared afterwards', () => {
    setLabelContext({ localPis: [2], lobby: lobby(), characters: CHARACTERS });
    expect(playerLabel(2)).toBe('P1');
    expect(playerLabel(2 - 2)).toBe('🏰 Friend');
    clearLabelContext();
    expect(playerLabel(2)).toBe('P3');
    setLabelContext({ nope: true });
    expect(getLabelContext()).toBe(null);
  });

  it('no typed names anywhere: labels only use house emoji + registry racer names', () => {
    const l = lobby();
    const names = new Set(CHARACTERS.map((c) => c.name));
    for (let pi = 0; pi < 8; pi++) {
      const label = playerLabel(pi, { localPis: [], lobby: l, characters: CHARACTERS });
      const [, ...rest] = label.split(' ');
      const name = rest.join(' ');
      expect(name === 'Friend' || names.has(name), label).toBe(true);
    }
  });

  it('the ceremony headline call site keeps its offline wording and localizes online', () => {
    const result = { standings: [{ isCPU: false, playerIndex: 2, characterId: A.id }] };
    const nameOf = (id) => CHARACTERS.find((c) => c.id === id).name;
    expect(ceremonyHeadline(result, nameOf, 'the Sprinkle Cup')).toBe(`P3 ${A.name} wins the Sprinkle Cup! 🏆`);
    setLabelContext({ localPis: [0, 1], lobby: lobby(), characters: CHARACTERS });
    expect(ceremonyHeadline(result, nameOf, 'the Sprinkle Cup')).toBe(`🏡 ${A.name} wins the Sprinkle Cup! 🏆`);
  });
});
