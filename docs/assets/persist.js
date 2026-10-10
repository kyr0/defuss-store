// One Web Storage adapter for every store on a page, and the one way this site persists a store. One adapter rather
// than one per store: the area is acquired once, so the page makes one fallback decision that every store shares.
// VERIFIED: ./defuss-store/browser.js is dist/browser.js byte for byte (scripts/verify.ts), so the site runs what ships.
import { attachPersistence, createMemoryStorage, createWebStorage } from './defuss-store/browser.js';

let memoryOnly = false;
export const storage = createWebStorage('local', {
  fallback: createMemoryStorage(),
  onUnavailable: () => { memoryOnly = true; },
});
// Acquire the area once, up front. VERIFIED (src/storage/web.ts): a memory fallback has no storage events, and
// attachPersistence() throws on sync: true with it - so a page whose storage is blocked (private mode, a sandboxed
// frame) learns that here and persists without sync, in memory, instead of failing.
storage.getItem('defuss-store-docs:probe');

/** False when the browser refused localStorage: state then lives in memory and is gone with the page. */
export const persistent = () => !memoryOnly;

/**
 * attachPersistence() with this site's policy: schema version 1, the store's own validator on every read and write,
 * and sync across tabs and frames whenever native storage is available. Missing keys never overwrite memory.
 */
export function persist(store, key, validate, onError) {
  return attachPersistence(store, { key, storage, version: 1, validate, sync: !memoryOnly, onError });
}
