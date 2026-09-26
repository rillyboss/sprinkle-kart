// Grown-ups corner online rows (NETWORKING.md §1 rules 1/3/6, §10.1; acceptance M1 #3, M1-12, M1-17).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { installDoc, allText, fakeCtx, fakeNav, ev } from './net.screens.helpers.js';
import {
  createSettingsState, settingsReduce, settingsRows, SETTINGS_ROWS, ONLINE_ROWS, gateAnswer,
} from '../src/progress/screenState.js';
import settingsScreen, { applySettingsEffects, ROWS } from '../src/ui/screens/settings.js';
import { defaultSettings, mergeProgress, emptyProgress, ONLINE_SETTING_KEYS } from '../src/progress/schema.js';
import { TEXT } from '../src/net/session/texts.js';

const on = (relayAvailable = true) => ({ online: { relayAvailable }, seed: 11 });
const rowIndex = (s, key) => s.rows.indexOf(key);
const answerGate = (s) => {
  let st = s;
  for (let i = 0; i < gateAnswer(st.gate); i++) st = settingsReduce(st, ev('up')).state;
  return settingsReduce(st, ev('confirm'));
};

describe('settings schema: online switches', () => {
  it('default off, clamped on load (only a real true turns one on)', () => {
    expect(defaultSettings()).toMatchObject({ onlineEnabled: false, approvalGate: false, relayOnly: false });
    expect(emptyProgress().settings.onlineEnabled).toBe(false);
    expect(ONLINE_SETTING_KEYS).toEqual(['onlineEnabled', 'approvalGate', 'relayOnly']);
    const m = mergeProgress({ settings: { onlineEnabled: 'yes', approvalGate: 1, relayOnly: true, music: 0.5 } });
    expect(m.settings).toMatchObject({ onlineEnabled: false, approvalGate: false, relayOnly: true, music: 0.5 });
    expect(mergeProgress({ settings: { onlineEnabled: true } }).settings.onlineEnabled).toBe(true);
    expect(mergeProgress({}).settings.onlineEnabled).toBe(false);
    expect(mergeProgress(null).settings.onlineEnabled).toBe(false);
  });
});

describe('settings reducer: online rows', () => {
  it('the offline row list is unchanged; the screen adds online rows (relay row only with our relay)', () => {
    expect(SETTINGS_ROWS).toEqual(['music', 'sfx', 'kidAssist', 'unlockAll', 'reset', 'back']);
    expect(createSettingsState({}, false)).not.toHaveProperty('rows');
    expect(settingsRows(on(true))).toEqual(['music', 'sfx', 'kidAssist', 'unlockAll', 'reset', ...ONLINE_ROWS, 'back']);
    expect(settingsRows(on(false))).toEqual(['music', 'sfx', 'kidAssist', 'unlockAll', 'reset', 'online', 'approvalGate', 'back']);
    const s = createSettingsState({ onlineEnabled: true }, false, on());
    expect(s).toMatchObject({ online: true, approvalGate: false, relayOnly: false });
  });

  it('switching online ON shows the privacy sentence first, then the parent gate, then it is on', () => {
    let s = createSettingsState({}, false, on());
    let r = settingsReduce(s, ev('select', { index: rowIndex(s, 'online') }));
    expect(r.state.modal).toBe('privacy');
    expect(r.effects).toEqual([]);
    // "Okay, turn it on" → the grown-up question
    r = settingsReduce(r.state, ev('confirm'));
    expect(r.state.modal).toBe('gate');
    expect(r.state.gateFor).toBe('online');
    expect(r.effects).toEqual([]);
    // a wrong answer does nothing
    const wrong = settingsReduce(r.state, ev('confirm'));
    expect(wrong.effects).toEqual([]);
    const pass = answerGate(r.state);
    expect(pass.effects).toEqual([{ type: 'online', on: true }]);
    expect(pass.state).toMatchObject({ online: true, modal: 'done' });
    s = settingsReduce(pass.state, ev('confirm')).state;
    expect(s.modal).toBe(null);
    // switching it OFF needs no gate
    r = settingsReduce(s, ev('select', { index: rowIndex(s, 'online') }));
    expect(r.effects).toEqual([{ type: 'online', on: false }]);
    expect(r.state.online).toBe(false);
  });

  it('"Not now" / B on the privacy sentence changes nothing; B on the gate cancels', () => {
    const s = createSettingsState({}, false, on());
    let r = settingsReduce(s, ev('select', { index: rowIndex(s, 'online') }));
    expect(settingsReduce(r.state, ev('back')).state.modal).toBe(null);
    r = settingsReduce(r.state, ev('right'));
    expect(r.state.confirmIndex).toBe(1);
    const no = settingsReduce(r.state, ev('confirm'));
    expect(no.state).toMatchObject({ modal: null, online: false });
    expect(no.effects).toEqual([]);
    let g = settingsReduce(settingsReduce(s, ev('select', { index: rowIndex(s, 'online') })).state, ev('select', { index: 0 })).state;
    expect(g.modal).toBe('gate');
    g = settingsReduce(g, ev('back')).state;
    expect(g).toMatchObject({ modal: null, online: false });
  });

  it('"Only a grown-up can let houses in" / "Use the relay": on without the gate, off only through it', () => {
    for (const key of ['approvalGate', 'relayOnly']) {
      const s = createSettingsState({}, false, on());
      let r = settingsReduce(s, ev('select', { index: rowIndex(s, key) }));
      expect(r.effects).toEqual([{ type: key, on: true }]);
      expect(r.state[key]).toBe(true);
      r = settingsReduce(r.state, ev('confirm'));
      expect(r.state.modal).toBe('gate');
      expect(r.effects).toEqual([]);
      const pass = answerGate(r.state);
      expect(pass.effects).toEqual([{ type: key, on: false }]);
      expect(pass.state).toMatchObject({ [key]: false, modal: null });
    }
  });

  it('up / down walk the longer list and wrap', () => {
    let s = createSettingsState({}, false, on());
    s = settingsReduce(s, ev('up')).state;
    expect(s.rows[s.row]).toBe('back');
    s = settingsReduce(s, ev('up')).state;
    expect(s.rows[s.row]).toBe('relayOnly');
  });
});

describe('settings screen', () => {
  let doc;
  beforeEach(() => { doc = installDoc(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('renders the three online rows and the privacy sentence before enabling; saves only after the gate', () => {
    void doc;
    const ctx = fakeCtx();
    const inst = settingsScreen.mount(ctx, fakeNav(), { relayAvailable: true });
    let text = allText(inst.node);
    for (const k of ['online', 'approvalGate', 'relayOnly']) expect(text).toContain(ROWS[k][1]);
    expect(text).toContain('🔒 Grown-ups only');
    const rows = createSettingsState({}, false, on()).rows;
    inst.handle(ev('select', { index: rows.indexOf('online') }));
    text = allText(inst.node);
    expect(text).toContain(TEXT.privacy.slice(0, 60));
    expect(text).toContain('Okay, turn it on');
    expect(ctx.progress.getSettings().onlineEnabled).toBe(false);
    // (the gate itself is covered by the reducer tests above; its dial needs a real DOM)
    inst.handle(ev('right'));
    inst.handle(ev('confirm')); // Not now
    expect(allText(inst.node)).not.toContain('Okay, turn it on');
    expect(ctx.progress.getSettings().onlineEnabled).toBe(false);
  });

  it('without our relay the relay row is hidden', () => {
    const inst = settingsScreen.mount(fakeCtx(), fakeNav(), { relayAvailable: false });
    expect(allText(inst.node)).not.toContain(ROWS.relayOnly[1]);
  });

  it('applySettingsEffects saves the online switches', () => {
    const ctx = fakeCtx();
    applySettingsEffects(ctx, [{ type: 'online', on: true }, { type: 'approvalGate', on: true }, { type: 'relayOnly', on: true }]);
    expect(ctx.progress.getSettings()).toMatchObject({ onlineEnabled: true, approvalGate: true, relayOnly: true });
  });

  it('the privacy sentence is honest: no names / chat / accounts, and who can see your address', () => {
    expect(TEXT.privacy).toMatch(/no names, no chat, no accounts/);
    expect(TEXT.privacy).toMatch(/internet address/);
    expect(TEXT.privacy).toMatch(/friends' computers/);
    expect(TEXT.privacy).toMatch(/public matchmaking services/);
    expect(TEXT.privacy).toMatch(/STUN servers from Google and Cloudflare/);
    expect(TEXT.privacy).toMatch(/our own Cloudflare server/);
  });
});
