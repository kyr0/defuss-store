import type { Codec, StorageBackend } from '../storage/types.js';

/** Serialized on-disk shape: a tagged envelope carrying the application schema `version` alongside `value`. */
export interface PersistedEnvelope<T> {
  /** Format tag identifying defuss-store persistence bytes. */
  format: 'defuss-store';
  /** Envelope layout version; only `1` is currently readable. */
  formatVersion: 1;
  /** Application schema version; a nonnegative safe integer. Newer-than-current versions are rejected, never downgraded. */
  version: number;
  /** Application state; validated against the current schema on every read and write. */
  value: T;
}

/** Which persistence step failed. `notify` means a restored value committed but delivering it to store listeners threw. */
export type PersistenceOperation = 'read' | 'decode' | 'version' | 'migrate' | 'validate' | 'encode' | 'write' | 'remove' | 'subscribe' | 'notify';

/** A reported operational failure. Delivered to `onError` (default `console.error`); never thrown into store delivery. */
export interface PersistenceFailure {
  /** The step that failed. Read-side failures also pause automatic writes, preserving the original bytes. */
  readonly operation: PersistenceOperation;
  /** The storage key being persisted. */
  readonly key: string;
  /** The original thrown value, or a descriptive Error created by the controller. */
  readonly error: unknown;
}

export interface PersistenceOptions<T> {
  /** Storage key. Empty strings are supported. */
  key: string;
  /** Synchronous string backend; see `defuss-store/storage`. With `sync: true` it must implement `subscribe`. */
  storage: StorageBackend;
  /** Current application schema version: a nonnegative safe integer. */
  version: number;
  /** Mandatory type guard applied to state on every read and write. Should be pure. */
  validate: (value: unknown) => value is T;
  /** Maps an older stored schema to the current one; the output is validated. Run sequential migrations inside for multiple old versions. */
  migrate?: (oldValue: unknown, fromVersion: number) => unknown;
  /** Schema version of raw non-envelope JSON written by the old defuss store. Without it, such bytes are rejected. */
  legacyVersion?: number;
  /** Whole-envelope serializer. Defaults to the strict `jsonCodec`; decoded state still passes through `validate`. */
  codec?: Codec;
  /**
   * When storage is read: 'immediate' (default) hydrates synchronously at attach, 'manual' pauses reads and
   * automatic writes until `rehydrate()`, `flush()` or `clear()`, 'skip' enables writes without reading first.
   */
  hydrate?: 'immediate' | 'manual' | 'skip';
  /** Reread current bytes on remote invalidation (e.g. native storage events). Last-write-wins; requires `storage.subscribe`. */
  sync?: boolean;
  /** Receives every operational failure. Defaults to `console.error`; a throwing callback is reported, not propagated. */
  onError?: (failure: PersistenceFailure) => void;
}

/** Point-in-time controller state, as returned by `status()`. */
export interface PersistenceStatus {
  /**
   * 'paused': automatic writes off (initial for 'manual', or after a read-side failure; the original bytes
   * are preserved). 'active': committed changes persist synchronously. 'destroyed': detached from the store.
   */
  readonly phase: 'paused' | 'active' | 'destroyed';
  /** Whether storage held a value for this key at the last successful read, write or clear. */
  readonly hasStoredValue: boolean;
  /** Whether memory is not known to match storage: never saved, changed since, or migrated/legacy bytes awaiting a flush. */
  readonly dirty: boolean;
  /** Most recent reported failure; cleared by the next successful operation. */
  readonly lastError?: PersistenceFailure;
}

/**
 * Owns persistence for one store until `destroy()`. `rehydrate()`, `flush()` and `clear()`
 * return false on reported operational failure and throw once the controller is destroyed.
 */
export interface PersistenceController {
  /** Read storage again: valid saved state wins; a missing key preserves memory. Activates a paused controller on success. */
  rehydrate(): boolean;
  /** Validate and save the current snapshot now; the explicit recovery for paused persistence. */
  flush(): boolean;
  /** Remove only this key, keeping state in memory; the next real mutation may recreate it. */
  clear(): boolean;
  /** Current phase and flags. Safe to call after destruction; the other methods are not. */
  status(): PersistenceStatus;
  /** Idempotently detach without writing or deleting; never flushes implicitly. Runs automatically on store destruction. */
  destroy(): void;
}
