import { describe, it, expect, vi } from 'vitest';
import { createEventBus, EVENTS, bus as globalBus } from '../src/game/events.js';

describe('event bus', () => {
  it('delivers every argument to handlers in subscription order', () => {
    const bus = createEventBus();
    const calls = [];
    bus.on('race-end', (a, b) => calls.push(['first', a, b]));
    bus.on('race-end', (a) => calls.push(['second', a]));
    expect(bus.emit('race-end', { trackId: 'x' }, 'session')).toBe(2);
    expect(calls).toEqual([['first', { trackId: 'x' }, 'session'], ['second', { trackId: 'x' }]]);
  });

  it('on() returns an unsubscribe function; off() works too', () => {
    const bus = createEventBus();
    const fn = vi.fn();
    const off = bus.on('frame', fn);
    bus.emit('frame', 0.016);
    off();
    bus.emit('frame', 0.016);
    expect(fn).toHaveBeenCalledTimes(1);
    const fn2 = vi.fn();
    bus.on('frame', fn2);
    bus.off('frame', fn2);
    expect(bus.emit('frame', 1)).toBe(0);
    expect(fn2).not.toHaveBeenCalled();
  });

  it('once() fires a single time', () => {
    const bus = createEventBus();
    const fn = vi.fn();
    bus.once('race-start', fn);
    bus.emit('race-start', 1);
    bus.emit('race-start', 2);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(1);
  });

  it('rejects unknown event names (typo guard) until they are defined', () => {
    const bus = createEventBus();
    expect(() => bus.on('race-ennd', () => {})).toThrow(/unknown event/);
    expect(() => bus.emit('gp-standings', {})).toThrow(/unknown event/);
    bus.define('gp-standings', '(table)');
    expect(bus.has('gp-standings')).toBe(true);
    const fn = vi.fn();
    bus.on('gp-standings', fn);
    bus.emit('gp-standings', { a: 1 });
    expect(fn).toHaveBeenCalledWith({ a: 1 });
    expect(bus.names()).toContain('gp-standings');
  });

  it('keeps the race:* namespace open for forwarded Race events', () => {
    const bus = createEventBus();
    const fn = vi.fn();
    bus.on('race:brand-new-thing', fn);
    bus.emit('race:brand-new-thing', { type: 'brand-new-thing' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('isolates a throwing handler and reports it only once', () => {
    const onError = vi.fn();
    const bus = createEventBus({ onError });
    const good = vi.fn();
    bus.on('race-frame', () => { throw new Error('boom'); });
    bus.on('race-frame', good);
    bus.emit('race-frame', 0.1);
    bus.emit('race-frame', 0.1);
    expect(good).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][1]).toBe('race-frame');
  });

  it('lets a handler unsubscribe itself mid-emit without skipping others', () => {
    const bus = createEventBus();
    const calls = [];
    const off = bus.on('frame', () => { calls.push('a'); off(); });
    bus.on('frame', () => calls.push('b'));
    bus.emit('frame');
    bus.emit('frame');
    expect(calls).toEqual(['a', 'b', 'b']);
  });

  it('documents every built-in game-flow event', () => {
    for (const name of ['frame', 'menu-enter', 'race-start', 'race-frame', 'race-pause', 'race-resume', 'race-end', 'race-exit', 'results-choice']) {
      expect(typeof EVENTS[name], name).toBe('string');
    }
    expect(globalBus.has('race-end')).toBe(true);
  });

  it('validates arguments', () => {
    const bus = createEventBus();
    expect(() => bus.on('frame', 'nope')).toThrow();
    expect(() => bus.define('')).toThrow();
    expect(bus.count('frame')).toBe(0);
    bus.on('frame', () => {});
    expect(bus.count('frame')).toBe(1);
    bus.clear();
    expect(bus.count('frame')).toBe(0);
  });
});
