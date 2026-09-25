/**
 * Tiny safe JSON storage for the modes workstream (record holders, ghosts).
 * Private windows / blocked storage fall back to memory; tests pass their own
 * `backend` ({ getItem, setItem, removeItem }).
 */

export function defaultBackend() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** A Map-backed backend (tests, or when localStorage is missing). */
export function memoryBackend() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    get size() { return m.size; },
  };
}

/**
 * @param {string} key
 * @param {object|null} [backend]
 * @returns {{ read(): object, write(obj): boolean, clear(): void }}
 */
export function jsonStore(key, backend = defaultBackend()) {
  let memory = {};
  return {
    read() {
      if (!backend) return memory;
      try {
        const raw = backend.getItem(key);
        const v = raw ? JSON.parse(raw) : {};
        return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
      } catch {
        return {};
      }
    },
    write(obj) {
      memory = obj;
      if (!backend) return true;
      try { backend.setItem(key, JSON.stringify(obj)); return true; } catch { return false; }
    },
    clear() {
      memory = {};
      try { backend?.removeItem?.(key); } catch { /* ignore */ }
    },
  };
}
