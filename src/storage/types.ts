import type { Unsubscribe } from '../types.js';
/** Invalidation notice from a backend subscription. */
export interface StorageChange { readonly key: string | null; }
/**
 * Synchronous, string-valued key/value backend consumed by persistence.
 * DOM-free: any medium qualifies. Methods may throw; throws surface as
 * reported operational failures, never as silent retries or backend switches.
 */
export interface StorageBackend {
  /** Bytes for `key`, or `null` when absent; any other return type fails the read. */
  getItem(key: string): string | null;
  /** Overwrite `key`. Quota and permission failures throw and are reported. */
  setItem(key: string, value: string): void;
  /** Delete `key`; deleting an absent key is a no-op. */
  removeItem(key: string): void;
  /**
   * Remote invalidation. Native Web Storage does not notify its writer.
   * Required only by persistence with `sync: true`. Listeners receive
   * invalidations, not values: `key` names the changed key, `null` a
   * whole-area change (native `clear()`), and consumers reread current bytes.
   */
  subscribe?(listener: (change: StorageChange) => void): Unsubscribe;
}
/** In-memory backend adding the DOM `Storage` enumeration surface. */
export interface MemoryStorage extends StorageBackend {
  /** Number of stored keys. */
  readonly length: number;
  /** Insertion-ordered key at `index`; `null` when out of range or `index` is not a nonnegative integer. */
  key(index: number): string | null;
  /** Remove every key in this instance. */
  clear(): void;
}
/**
 * Whole-envelope serializer for persistence: `encode` turns the persisted
 * envelope into a string, `decode` parses it back to `unknown` because decoded
 * state still passes through the application's validator. Both may throw;
 * failures are reported as `encode`/`decode` operational errors.
 */
export interface Codec { encode(value: unknown): string; decode(serialized: string): unknown; }
/** Options for {@link createWebStorage}. */
export interface WebStorageOptions {
  /**
   * Backend chosen only when native storage acquisition itself throws on first
   * use (SSR, disabled storage, denied access). The choice is sticky for this
   * adapter's lifetime; quota or later I/O failures never switch backends.
   */
  fallback?: StorageBackend;
  /**
   * Called once, only when the fallback is selected. Not called when
   * acquisition fails without a fallback. A throwing callback is reported to
   * `console.error`, never propagated.
   */
  onUnavailable?: (error: unknown) => void;
}
