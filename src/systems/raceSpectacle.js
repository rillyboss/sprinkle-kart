/**
 * Race spectacle: the camera flourishes and party moments of a race.
 * OWNER: showcase presentation.
 *
 *   race-start   the track intro card ("🫧 Bubble Cup · Race 2 of 4 — Bubblegum
 *                Bay — Pop! goes the beach") slides in over the countdown
 *   race:bonked / shield-pop / bump   a small, kid-tuned screen wobble for that player
 *   race:finish  a human crossing the line: 3D confetti burst + their camera
 *                swings round to the front of the kart and slowly circles it
 *                (slowing down, like a slow-mo replay); two karts within a
 *                quarter second = "📸 Photo finish!" with a camera flash
 *   race-frame   applies the camera moves AFTER the chase cameras updated and
 *                before the frame is drawn (see main.js tick)
 *
 * "Gentle motion" turns off the orbit and the wobble (and halves the confetti);
 * "Screen wobble" off turns off only the wobble. Headless sessions (no scene /
 * no rigs) simply skip the visual parts.
 */
import * as THREE from 'three';
import '../presentation/presentation.css';
import { prefs as sharedPrefs, effectivePrefs } from '../presentation/prefs.js';
import {
  createShake, SHAKE_AMOUNTS, finishCameraPose, orbitSide, photoFinishPair, introCardModel,
} from '../presentation/cameraFx.js';
import { createConfetti } from '../presentation/confetti.js';
import { cupOfTrack, cupTracks } from '../data/cups.js';

const halfWidthOf = (s) => s?.path?.halfWidth ?? s?.race?.path?.halfWidth ?? null;
const canDom = () => typeof document !== 'undefined' && !!document.body;
const _fwd = new THREE.Vector3();
const _look = new THREE.Vector3();
const _pos = new THREE.Vector3();

function escapeText(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Build the intro card node (DOM only). */
export function buildIntroCard(model, { multi = false } = {}) {
  const node = document.createElement('div');
  node.className = `skx-intro${multi ? ' skx-intro-multi' : ''}`;
  node.setAttribute('aria-live', 'polite');
  const [a1, a2, a3] = model.art;
  node.innerHTML = `<div class="skx-intro-card">`
    + `<span class="skx-intro-art skx-a1">${escapeText(a1)}</span><span class="skx-intro-art skx-a2">${escapeText(a2 ?? '')}</span><span class="skx-intro-art skx-a3">${escapeText(a3 ?? '')}</span>`
    + `<div class="skx-intro-kicker">${escapeText(model.kicker)}</div>`
    + `<div class="skx-intro-title">${escapeText(model.title)}</div>`
    + (model.subtitle ? `<div class="skx-intro-sub">${escapeText(model.subtitle)}</div>` : '')
    + '</div>';
  return node;
}

/** @type {import('./index.js').SystemDef} */
export default {
  id: 'race-spectacle',
  order: 80,
  install(bus, app) {
    const store = app.prefs ?? sharedPrefs;
    let fx = effectivePrefs(store.get());
    let race = null; // per-race state

    const uiRoot = () => (canDom() ? document.getElementById('ui') || document.body : null);

    const removeIntro = (r) => {
      if (!r?.intro) return;
      const n = r.intro;
      r.intro = null;
      n.classList.add('skx-out');
      setTimeout(() => n.remove(), 650);
    };
    const photoFlashes = new Set();
    const flashPhoto = () => {
      const root = uiRoot();
      if (!root) return;
      const f = document.createElement('div');
      f.className = 'skx-photo-flash';
      f.innerHTML = '<div class="skx-photo-card">📸 Photo finish!</div>';
      root.appendChild(f);
      photoFlashes.add(f);
      setTimeout(() => { f.remove(); photoFlashes.delete(f); }, 1900);
    };
    // the race is over: the polaroid card must not sit on top of the results title
    const clearPhotoFlashes = () => { for (const f of photoFlashes) f.remove(); photoFlashes.clear(); };

    const pState = (pi) => {
      let p = race.players.get(pi);
      if (!p) { p = { shake: createShake({ seed: pi + 1 }), orbitAt: null }; race.players.set(pi, p); }
      return p;
    };
    const wobble = (s, kart, amount) => {
      if (!race || !fx.shake || !s?.isHuman?.(kart)) return;
      pState(kart.playerIndex).shake.add(amount);
    };

    if (app.game) {
      app.game.spectacle = () => (race ? {
        orbiting: [...race.players].filter(([, p]) => p.orbitAt !== null).map(([pi]) => pi),
        confetti: race.confetti?.alive ?? 0,
        intro: !!race.intro,
        introShown: race.introShown,
        photoFinish: race.photo,
        trauma: Object.fromEntries([...race.players].map(([pi, p]) => [pi, p.shake.trauma])),
      } : null);
      /** Debug / smoke hook: throw confetti at a world position. */
      app.game.confettiBurst = (origin, opts) => race?.confetti?.burst(origin, opts) ?? 0;
    }

    const offs = [
      bus.on('race-start', (info, s) => {
        fx = effectivePrefs(store.get());
        race = { players: new Map(), confetti: null, intro: null, introShown: false, finishes: [], photo: false, pending: [], emitters: [], session: s };
        if (s?.scene?.add) {
          try {
            race.confetti = createConfetti({ max: 700, seed: s.trackDef?.id ?? 'race' });
            s.scene.add(race.confetti.object);
          } catch (err) { console.warn('[spectacle] confetti', err); race.confetti = null; }
        }
        const root = uiRoot();
        if (root && s?.trackDef) {
          const cup = cupOfTrack(s.trackDef.id);
          const setup = s.setup ?? { mode: info?.mode };
          const model = introCardModel(s.trackDef, { ...setup, mode: info?.mode ?? setup.mode }, {
            cupName: cup?.name, cupEmoji: cup?.emoji, raceCount: cup ? cupTracks(cup.id).length || 4 : 4,
          });
          race.intro = buildIntroCard(model, { multi: (s.humans?.length ?? 1) > 1 });
          root.appendChild(race.intro);
          race.introShown = true;
          s.sfx?.('skx-intro', { volume: 0.8 });
        }
      }),

      bus.on('race:bonked', (e, s) => wobble(s, e.kart, SHAKE_AMOUNTS.bonked)),
      bus.on('race:shield-pop', (e, s) => { if (!e.expired) wobble(s, e.kart, SHAKE_AMOUNTS['shield-pop']); }),
      bus.on('race:bump', (e, s) => {
        const amt = Math.min(SHAKE_AMOUNTS.bumpMax, (Number(e.strength) || 0) * (e.wall ? SHAKE_AMOUNTS.bumpScale * 3 : SHAKE_AMOUNTS.bumpScale * 4.4));
        wobble(s, e.kart, amt);
        if (e.other) wobble(s, e.other, amt);
      }),

      bus.on('race:finish', (e, s) => {
        if (!race) return;
        const k = e.kart;
        const human = !!s?.isHuman?.(k);
        race.finishes.push({ time: Number.isFinite(k?.finishTime) ? k.finishTime : s?.race?.time, human });
        if (!race.photo && race.finishes.length >= 2) {
          const pair = photoFinishPair(race.finishes.slice(-2));
          if (pair) {
            race.photo = true;
            const karts = [k, race.lastFinisher].filter(Boolean);
            for (const who of karts) if (s.isHuman(who)) s.flash(who, '📸 Photo finish!');
            s.sfx?.('skx-photo');
            flashPhoto();
          }
        }
        race.lastFinisher = k;
        if (!human) return;
        const clock = s.race?.clock ?? 0;
        const p = pState(k.playerIndex);
        if (fx.flourishes && s.rigs) {
          p.orbitAt = clock;
          p.orbitDir = orbitSide(k.lateral, halfWidthOf(s));
          s.sfx?.('skx-whoosh', { pan: s.panFor(k), volume: 0.8 });
        }
        if (race.confetti && k.position) {
          const win = e.place === 1;
          // a confetti fountain that follows the kart for a moment (the kart keeps rolling
          // after the line, and the finish camera circles it) ...
          race.emitters.push({ kart: k, next: clock, until: clock + (win ? 2.2 : 1.2), count: 16 * fx.particleScale });
          // ... and for a winner, a gentle shower from above
          if (win) race.pending.push({ at: clock + 0.5, kart: k, dy: 6, count: 140 * fx.particleScale, power: 0.35, spread: 2.4, up: 0.2 });
          s.sfx?.('skx-confetti', { pan: s.panFor(k) });
        }
      }),

      bus.on('race-frame', (dt, s) => {
        if (!race || !s?.race) return;
        const r = s.race;
        const paused = !!s.paused;
        const step = paused ? 0 : dt;
        // intro card leaves as the countdown ends
        if (race.intro && (r.state !== 'countdown' || r.countdown <= 1.05)) removeIntro(race);
        // confetti fountains + delayed showers (both follow their kart)
        if (!paused && race.confetti) {
          race.emitters = race.emitters.filter((em) => {
            while (em.next <= r.clock && em.next <= em.until) {
              const p = em.kart.position;
              race.confetti.burst({ x: p.x, y: p.y + 1.1, z: p.z }, {
                count: em.count, power: 0.75, spread: 1.4, up: 0.8, inherit: em.kart.velocity,
              });
              em.next += 0.12;
            }
            return em.next <= em.until;
          });
          race.pending = race.pending.filter((b) => {
            if (r.clock < b.at) return true;
            const p = b.kart.position;
            race.confetti.burst({ x: p.x, y: p.y + (b.dy ?? 5), z: p.z }, {
              count: b.count, power: b.power ?? 1, spread: b.spread ?? 1, up: b.up ?? 1, inherit: b.kart.velocity,
            });
            return false;
          });
        }
        race.confetti?.update(step);
        // cameras: finish orbit, then wobble (applied on top of the chase camera's pose)
        const rigs = s.rigs;
        if (!rigs) return;
        (s.humans ?? []).forEach((h, i) => {
          const cam = rigs[i]?.camera;
          const p = race.players.get(h.playerIndex);
          if (!cam || !p) return;
          const kart = r.getPlayerKart?.(h.playerIndex);
          if (p.orbitAt !== null && kart && fx.flourishes) {
            const pose = finishCameraPose(kart.position, kart.heading, r.clock - p.orbitAt, {
              dir: p.orbitDir, lateral: kart.lateral, halfWidth: halfWidthOf(s),
            });
            const b = pose.blend;
            _fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
            _look.copy(cam.position).addScaledVector(_fwd, 6);
            _pos.set(pose.pos.x, pose.pos.y, pose.pos.z);
            cam.position.lerp(_pos, b);
            _look.lerp(_pos.set(pose.look.x, pose.look.y, pose.look.z), b);
            cam.lookAt(_look);
          }
          const off = p.shake.step(step);
          if (fx.shake && (off.x || off.y || off.roll)) {
            cam.translateX(off.x);
            cam.translateY(off.y);
            cam.rotateZ(off.roll);
          }
        });
      }),

      bus.on('race-end', () => clearPhotoFlashes()),
      bus.on('race-exit', () => {
        clearPhotoFlashes();
        if (!race) return;
        removeIntro(race);
        try { race.confetti?.dispose(); } catch { /* ignore */ }
        race = null;
      }),
      store.subscribe((p) => { fx = effectivePrefs(p); }),
    ];
    return () => {
      offs.forEach((off) => off());
      if (race) { removeIntro(race); race.confetti?.dispose(); race = null; }
    };
  },
};
