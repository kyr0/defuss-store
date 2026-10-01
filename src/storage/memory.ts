import type { MemoryStorage } from './types.js';
/**
 * Each call owns a fresh map. Sharing is explicit through the returned object.
 * Keys and values are coerced with `String()`, mirroring DOM Storage. There is
 * no `subscribe`: instances never broadcast changes.
 */
export function createMemoryStorage(): MemoryStorage {
  const cache = new Map<string, string>();
  return {
    get length() { return cache.size; },
    // Map keys iterate in insertion order; anything outside is `null`, matching DOM Storage.
    key(index) { return Number.isInteger(index) && index >= 0 ? [...cache.keys()][index] ?? null : null; },
    getItem: key => cache.get(String(key)) ?? null,
    setItem: (key, value) => { cache.set(String(key), String(value)); },
    removeItem: key => { cache.delete(String(key)); },
    clear: () => { cache.clear(); },
  };
}
