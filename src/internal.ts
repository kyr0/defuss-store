import type { Store, Unsubscribe } from './types.js';

// A protocol symbol, not a global store/registry. Independent ESM entry bundles
// share it without sharing a hidden module-level memory backend.
const INTERNAL = Symbol.for('defuss-store.internal.v1');
/**
 * Internal transition record. `path` is the written path, absent for root replacements; `origin`
 * is an opaque token of the committing party, so observers (persistence) can ignore their own
 * writes; `revision` is the store's monotonic commit counter, used to detect obsolete queued work.
 */
export interface Change<T> {
  value: T;
  previous: T;
  path?: string;
  origin?: object;
  revision: number;
}
/**
 * Per-store protocol surface installed under `INTERNAL`. Deliberately absent from public entry
 * exports: only layers holding the symbol (the persistence entry) can use it.
 */
export interface Internals<T> {
  /** Commit a root replacement tagged with an origin token. */
  set(value: T, origin?: object): void;
  /** Subscribe to raw transition records; same delivery semantics as public subscribe. */
  observe(listener: (change: Change<T>) => void): Unsubscribe;
  /** Current commit counter; comparing it across an operation detects interleaved commits. */
  revision(): number;
  /** Ownership slot for the single attached persistence controller, if any. Managed by the persistence layer. */
  persistence?: object;
}
/** Attach the protocol as a non-enumerable, non-writable property: invisible to spreads and JSON. */
export function installInternal<T>(store: Store<T>, api: Internals<T>): void {
  Object.defineProperty(store, INTERNAL, { value: api });
}
/** Read the protocol, or throw when `store` is not a defuss-store v1 protocol store. */
export function internalOf<T>(store: Store<T>): Internals<T> {
  const api = (store as unknown as Record<symbol, Internals<T>>)[INTERNAL];
  if (!api) throw new TypeError('Expected a defuss-store v1 protocol store');
  return api;
}
export function reportError(error: unknown): void {
  // Error reporting must never interrupt cleanup or persistence delivery.
  try { console.error(error); } catch { /* No functioning reporter in this host. */ }
}
/**
 * Arrays and plain objects (`Object.prototype` or null prototype): the only containers path writes
 * copy and JSON persistence accepts. Class instances such as Date never qualify.
 */
export function isContainer(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null
    && (Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
