/**
 * Tab switching with every input (family feedback: "no way with mouse and keyboard to switch between
 * tabs for maps"): menu actions 'tabPrev' / 'tabNext' from LB / RB, Q / E (kb1) and PgUp / PgDn (kb2).
 */
import { describe, it, expect } from 'vitest';
import { createInputRig } from './helpers/fakeInput.js';
import { MENU_ACTIONS } from '../src/input/InputManager.js';
import { KEYBOARD_LAYOUTS, CODE_TO_KEYBOARD, readKeyboardFrame, layoutCodes } from '../src/input/keyboardLayouts.js';
import { readGamepad } from '../src/input/gamepadMapping.js';

const actions = (evs) => evs.map((e) => `${e.deviceId}:${e.action}`);

describe('tab menu actions', () => {
  it('are menu actions', () => {
    expect(MENU_ACTIONS).toContain('tabPrev');
    expect(MENU_ACTIONS).toContain('tabNext');
  });

  it('kb1 uses Q / E, kb2 uses Page Up / Page Down, and the layouts still never share a key', () => {
    expect(KEYBOARD_LAYOUTS.kb1.bindings.tabPrev).toEqual(['KeyQ']);
    expect(KEYBOARD_LAYOUTS.kb1.bindings.tabNext).toEqual(['KeyE']);
    expect(KEYBOARD_LAYOUTS.kb2.bindings.tabPrev).toEqual(['PageUp']);
    expect(KEYBOARD_LAYOUTS.kb2.bindings.tabNext).toEqual(['PageDown']);
    expect(CODE_TO_KEYBOARD.get('PageDown')).toBe('kb2');
    const a = new Set(layoutCodes(KEYBOARD_LAYOUTS.kb1));
    for (const code of layoutCodes(KEYBOARD_LAYOUTS.kb2)) expect(a.has(code), code).toBe(false);
    expect(KEYBOARD_LAYOUTS.kb1.labels.tabPrev).toBe('Q');
    expect(KEYBOARD_LAYOUTS.kb2.labels.tabNext).toBe('PgDn');
  });

  it('Q still means look back and E still means item while driving', () => {
    const f = readKeyboardFrame(KEYBOARD_LAYOUTS.kb1, new Set(['KeyQ', 'KeyE']), new Set());
    expect(f.held.lookBack).toBe(true);
    expect(f.held.item).toBe(true);
    expect(f.held.tabPrev).toBe(true);
    expect(f.held.tabNext).toBe(true);
  });

  it('keyboards queue tabPrev / tabNext once per press', () => {
    const rig = createInputRig();
    rig.target.keydown('KeyE');
    rig.frame();
    expect(actions(rig.im.consumeMenuEvents())).toEqual(['kb1:tabNext']);
    rig.frame(); // still held: no repeat event
    expect(rig.im.consumeMenuEvents()).toEqual([]);
    rig.target.keyup('KeyE');
    rig.target.keydown('PageUp');
    rig.frame();
    expect(actions(rig.im.consumeMenuEvents())).toEqual(['kb2:tabPrev']);
  });

  it('pads: LB = tabPrev, RB = tabNext (and they still drive the item / drift buttons)', () => {
    const rig = createInputRig();
    const pad = rig.connectPad(0);
    rig.frame();
    rig.im.consumeMenuEvents();
    pad.press(4);
    rig.frame();
    expect(actions(rig.im.consumeMenuEvents())).toEqual(['gp0:tabPrev']);
    pad.release(4);
    pad.press(5);
    rig.frame();
    expect(actions(rig.im.consumeMenuEvents())).toEqual(['gp0:tabNext']);
    const f = readGamepad({ mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: i === 5, value: i === 5 ? 1 : 0 })) });
    expect(f.held.drift).toBe(true);
    expect(f.held.tabNext).toBe(true);
    expect(f.held.tabPrev).toBe(false);
  });

  it('virtual devices may push tab actions', () => {
    const rig = createInputRig();
    rig.im.addVirtualDevice('bot');
    rig.im.pushVirtualMenuEvent('bot', 'tabNext');
    expect(actions(rig.im.consumeMenuEvents())).toEqual(['bot:tabNext']);
  });
});
