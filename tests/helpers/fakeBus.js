/**
 * A recording event bus for node tests: the REAL bus (same name checks, same
 * error isolation) plus a log of every emit, so tests can assert what a system
 * or a flow emitted without subscribing by hand.
 *
 *   const bus = createFakeBus();
 *   installMySystem(bus, app);
 *   bus.emit('race-start', info, session);
 *   bus.emitted('race:boost')             // [[e, session], ...] argument lists
 *   bus.countOf('race-frame')             // how many times it was emitted
 *   bus.last('race-end')                  // argument list of the latest emit, or null
 *   bus.errors                            // [{ err, name }] handlers that threw (never rethrown)
 *   bus.emittedNames()                    // ['race-start', 'race:go', ...] in order
 *   bus.reset()                           // forget the log (handlers stay)
 */
import { createEventBus } from '../../src/game/events.js';

export function createFakeBus({ onError } = {}) {
  const errors = [];
  const inner = createEventBus({
    onError: (err, name) => {
      errors.push({ err, name });
      onError?.(err, name);
    },
  });
  const log = [];
  const bus = {
    ...inner,
    log,
    errors,
    emit(name, ...args) {
      if (inner.has(name)) log.push({ name, args }); // undeclared names throw below, unlogged
      return inner.emit(name, ...args);
    },
    /** Argument lists of every emit of `name`, oldest first. */
    emitted: (name) => log.filter((e) => e.name === name).map((e) => e.args),
    /** How many times `name` was emitted (handlers or not). */
    countOf: (name) => log.filter((e) => e.name === name).length,
    /** Argument list of the latest emit of `name`, or null. */
    last(name) {
      for (let i = log.length - 1; i >= 0; i--) if (log[i].name === name) return log[i].args;
      return null;
    },
    /** Event names in emit order (handy for flow assertions). `bus.names()` stays the declared list. */
    emittedNames: () => log.map((e) => e.name),
    reset() { log.length = 0; errors.length = 0; },
  };
  return bus;
}
