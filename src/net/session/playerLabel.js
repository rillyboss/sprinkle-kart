/**
 * One label for a player (NETWORKING.md §10.8): replaces the hard-coded
 * `P${pi + 1}` labels in menus, results and the HUD.
 *
 *   offline (no context)          'P1'…'P4' (exactly as before)
 *   online, a player on THIS machine   'P1'…'P4' by local slot order
 *   online, a player in another house  '<house emoji> <racer name>', e.g. '🏡 Luna Lollicorn'
 *
 * No typed names anywhere (kid safety, §1 rule 4): remote players are known only
 * by their house emoji and the racer they picked.
 *
 * The online flow (WS7) sets the context once per session with
 * `setLabelContext({ localPis, lobby, characters })` and clears it when the room
 * closes, so call sites can keep calling `playerLabel(pi)`.
 *
 * OWNER: WS6 (session, lobby & screens).
 */
import { houseOfPi } from './lobby.js';

let current = null;

/** @param {{ localPis: number[], lobby?: object, characters?: Array<{id:string, name:string}> } | null} ctx */
export function setLabelContext(ctx) {
  current = ctx && Array.isArray(ctx.localPis) ? { localPis: [...ctx.localPis], lobby: ctx.lobby ?? null, characters: ctx.characters ?? [] } : null;
}

export function clearLabelContext() { current = null; }

export function getLabelContext() { return current; }

/**
 * @param {number} pi global player index
 * @param {{ localPis?: number[], lobby?: object, characters?: Array<{id:string, name:string}> } | null} [opts]
 *   default: the context set with setLabelContext (null offline)
 */
export function playerLabel(pi, opts = current) {
  const n = Number(pi);
  if (!opts || !Array.isArray(opts.localPis)) return `P${n + 1}`;
  const slot = opts.localPis.indexOf(n);
  if (slot >= 0) return `P${slot + 1}`;
  const house = houseOfPi(opts.lobby, n);
  const emoji = house?.emoji ?? '🏡';
  const player = house?.players?.find((p) => p.globalPi === n) ?? null;
  const char = (opts.characters ?? []).find((c) => c.id === player?.characterId);
  return `${emoji} ${char?.name ?? 'Friend'}`;
}

/**
 * "P1 Luna Lollicorn" for a local player (or offline), "🏡 Luna Lollicorn" for a
 * remote one (the house emoji stands in for P#; the name is never doubled).
 */
export function labelWithName(pi, name, opts = current) {
  const text = String(name ?? '').trim();
  const n = Number(pi);
  if (!opts || !Array.isArray(opts.localPis) || opts.localPis.includes(n)) {
    return text ? `${playerLabel(n, opts)} ${text}` : playerLabel(n, opts);
  }
  const house = houseOfPi(opts.lobby, n);
  return text ? `${house?.emoji ?? '🏡'} ${text}` : playerLabel(n, opts);
}

/** True when `pi` is a player on this machine (always true offline). */
export function isLocalPlayer(pi, opts = current) {
  if (!opts || !Array.isArray(opts.localPis)) return true;
  return opts.localPis.includes(Number(pi));
}
