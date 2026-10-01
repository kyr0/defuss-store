import { internalOf, reportError } from '../internal.js';
import { jsonCodec } from '../storage/codec.js';
import type { Store, Unsubscribe } from '../types.js';
import type { PersistedEnvelope, PersistenceController, PersistenceFailure, PersistenceOperation, PersistenceOptions, PersistenceStatus } from './types.js';

const format = 'defuss-store';
// Application schema versions are nonnegative safe integers.
const validVersion = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

/**
 * Attach the persistence controller owning `store`. One controller owns a store at a
 * time; destroying the store also disposes it.
 *
 * With the default `hydrate: 'immediate'`, saved state is read, validated and restored
 * synchronously before this returns; automatic writes start only afterwards. Mounting
 * never writes defaults eagerly and never overwrites saved data. Bytes that fail to
 * decode, migrate or validate pause automatic writes and stay untouched until explicit
 * recovery via `rehydrate()`, `flush()` or `clear()`. Operational failures are reported
 * through `onError` (default `console.error`), never thrown into store delivery.
 *
 * Throws on a foreign or destroyed store, a second controller, and invalid options.
 */
export function attachPersistence<T>(store: Store<T>, options: PersistenceOptions<T>): PersistenceController {
  const api = internalOf(store);
  if (store.destroyed) throw new Error('Store is destroyed');
  // Ownership is claimed per store; a second attach is a programming error.
  if (api.persistence) throw new Error('Store already has an attached persistence controller');
  // Options are validated before any ownership or subscription, so a rejected attach leaves no residue.
  if (typeof options.key !== 'string' || !validVersion(options.version) || typeof options.validate !== 'function') {
    throw new TypeError('Persistence requires a string key, nonnegative schema version and validator');
  }
  if (options.legacyVersion !== undefined && !validVersion(options.legacyVersion)) throw new TypeError('Invalid legacyVersion');
  const mode = options.hydrate ?? 'immediate';
  if (!['immediate', 'manual', 'skip'].includes(mode)) throw new TypeError('Invalid hydration mode');
  if (options.sync && !options.storage.subscribe) throw new TypeError('Storage backend does not support synchronization');
  const codec = options.codec ?? jsonCodec;
  // Private per-controller token marking our own restores, so the observer below never echoes them back into storage.
  const origin = {};
  let phase: PersistenceStatus['phase'] = mode === 'skip' ? 'active' : 'paused';
  let dirty = true;
  let hasStoredValue = false;
  let lastError: PersistenceFailure | undefined;
  // Bytes we wrote or accepted: undefined = storage never loaded, null = known absent. Suppresses
  // duplicate remote restores and gates remote invalidation for 'manual' controllers.
  let acceptedBytes: string | null | undefined;
  const releases: Unsubscribe[] = [];
  // A function, not a comparison, so TypeScript does not narrow `phase` across reentrant user code.
  const dead = () => phase === 'destroyed';
  // Operational methods throw after destroy; status() deliberately does not.
  function alive(): void { if (dead()) throw new Error('Persistence controller is destroyed'); }
  // Record and report without throwing into store delivery. `pause` stops automatic
  // writes so unreadable or untrusted bytes are never overwritten implicitly.
  function fail(operation: PersistenceOperation, error: unknown, pause = false): false {
    if (dead()) return false;
    lastError = { operation, key: options.key, error };
    dirty = true;
    if (pause) phase = 'paused';
    // A throwing onError is itself reported; reporting must never break persistence.
    try { if (options.onError) options.onError(lastError); else reportError(lastError); }
    catch (reportingError) { reportError(reportingError); }
    return false;
  }
  // Every successful read, write or clear: storage is known to hold `bytes`, automatic writes run.
  function settle(bytes: string | null, stale: boolean): true {
    acceptedBytes = bytes;
    hasStoredValue = bytes !== null;
    dirty = stale;
    lastError = undefined;
    phase = 'active';
    return true;
  }
  function write(): boolean {
    alive();
    const value = store.value;
    const revision = api.revision();
    // Each step names itself before running, so one handler reports any failure under its step.
    let step: PersistenceOperation = 'validate';
    let bytes: string;
    try {
      // The validator is mandatory on writes too: it also guards what reaches the codec.
      if (!options.validate(value)) throw new TypeError('Current state failed persistence validation');
      step = 'encode';
      const envelope: PersistedEnvelope<T> = { format, formatVersion: 1, version: options.version, value };
      bytes = codec.encode(envelope);
      if (typeof bytes !== 'string') throw new TypeError('Codec must encode to a string');
      // A user validator/codec may reenter the store. Never overwrite its newer state.
      if (api.revision() !== revision || dead()) return false;
      step = 'write';
      options.storage.setItem(options.key, bytes);
    } catch (error) { return fail(step, error); }
    // setItem may have reentered and destroyed the controller; the bytes did land.
    // Anything committed during a reentrant setItem is not yet persisted.
    return dead() || settle(bytes, api.revision() !== revision);
  }
  function read(remote = false): boolean {
    alive();
    let step: PersistenceOperation = 'read';
    let raw: string | null;
    let value: unknown;
    let stale = false;
    // Read-side failures pause automatic writes, preserving the original bytes until explicit recovery.
    try {
      raw = options.storage.getItem(options.key);
      // getItem is backend code and may have destroyed the controller.
      if (dead()) return false;
      // Missing data is active, dirty and absent; it never resets in-memory state.
      if (raw === null) return settle(null, true);
      if (typeof raw !== 'string') throw new TypeError('Storage getItem must return string or null');
      hasStoredValue = true;
      // Identical clean bytes we wrote or already accepted: skip the redundant restore.
      if (remote && raw === acceptedBytes && !dirty && phase === 'active') return true;
      step = 'decode';
      const decoded = codec.decode(raw) as Partial<PersistedEnvelope<unknown>> | null;
      step = 'version';
      let version: number;
      // Arrays decode as legacy or invalid values, never as envelopes.
      if (typeof decoded === 'object' && decoded?.format === format && !Array.isArray(decoded)) {
        if (decoded.formatVersion !== 1 || !validVersion(decoded.version) || !Object.hasOwn(decoded, 'value')) {
          throw new TypeError('Unsupported or malformed persistence envelope');
        }
        version = decoded.version;
        value = decoded.value;
      } else if (options.legacyVersion !== undefined) {
        // Pre-envelope raw JSON from the old defuss store, versioned by configuration.
        stale = true;
        version = options.legacyVersion;
        value = decoded;
      } else throw new TypeError('Expected a defuss-store envelope; raw data needs legacyVersion');
      // Future schemas are never downgraded; their bytes stay untouched until explicit recovery.
      if (version > options.version) throw new Error('Stored schema is newer than this application');
      if (version !== options.version) {
        // Migrated or legacy bytes stay dirty until saved in the current envelope.
        stale = true;
        step = 'migrate';
        if (!options.migrate) throw new Error('Schema migration is required');
        value = options.migrate(value, version);
      }
      step = 'validate';
      if (!options.validate(value)) throw new TypeError('Stored state failed validation');
    } catch (error) { return fail(step, error, true); }
    // migrate/validate are user code and may have destroyed the controller.
    if (dead()) return false;
    const revision = api.revision();
    settle(raw, stale);
    // Observe before hydrating: user listeners may make independent local writes.
    try { api.set(value as T, origin); }
    catch (error) { return fail('notify', error); }
    // A store-level equality no-op absorbed the hydration without adopting the persisted
    // value; storage then no longer describes memory, so stay dirty.
    if (acceptedBytes === raw && api.revision() <= revision + 1 && !Object.is(store.value, value)) dirty = true;
    return true;
  }
  const controller: PersistenceController = {
    rehydrate: () => read(),
    flush: () => write(),
    clear() {
      alive();
      try { options.storage.removeItem(options.key); } catch (error) { return fail('remove', error); }
      // The key is gone even if removeItem reentered and destroyed the controller.
      // Memory is kept but no longer persisted anywhere.
      return dead() || settle(null, true);
    },
    status: () => ({ phase, dirty, hasStoredValue, ...(lastError ? { lastError } : {}) }),
    destroy() {
      if (dead()) return;
      phase = 'destroyed';
      // Release ownership only if it is still ours.
      if (api.persistence === controller) delete api.persistence;
      const errors: unknown[] = [];
      for (const release of releases.splice(0)) {
        try { release(); } catch (error) { errors.push(error); }
      }
      // Cleanup continues past individual failures; all are reported together.
      if (errors.length) throw new AggregateError(errors, 'Persistence cleanup failed');
    },
  };
  api.persistence = controller;
  try {
    releases.push(api.observe(change => {
      // Our own restores must not echo back into storage.
      if (change.origin === origin) return;
      dirty = true;
      // Later reentrant commits already own the current state; their queued
      // records will persist it. Do not write an obsolete intermediate snapshot.
      if (phase === 'active' && change.revision === api.revision()) write();
    }));
    // Store destruction disposes persistence.
    releases.push(store.onDestroy(() => controller.destroy()));
    if (options.sync) releases.push(options.storage.subscribe!(change => {
      // A null key signals a bulk clear; reread to confirm our key. Manual controllers
      // ignore remote invalidation until an explicit operation has loaded storage once.
      if (!dead() && (mode !== 'manual' || acceptedBytes !== undefined) && (change.key === null || change.key === options.key)) read(true);
    }));
    if (mode === 'immediate') read();
  } catch (error) {
    // A partially attached controller (e.g. a throwing subscribe) must not leak ownership or subscriptions.
    controller.destroy();
    throw error;
  }
  return controller;
}
