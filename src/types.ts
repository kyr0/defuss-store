/** Cancels a subscription or registration. Idempotent: extra calls are no-ops. */
export type Unsubscribe = () => void;
/**
 * Equality predicate over snapshots or selections; should be pure. For store commits an equal
 * result discards the candidate entirely: the previous reference is kept and no listener runs.
 * For selectors an equal result skips the notification.
 */
export type EqualsFn<T> = (a: T, b: T) => boolean;
/**
 * Change callback. `previous` and `changedPath` are absent for the initial `immediate` call;
 * `changedPath` is absent for root replacements. During reentrant delivery `store.value` can
 * already be newer than `next`; use these arguments for the transition being delivered.
 */
export type Listener<T> = (next: T, previous?: T, changedPath?: string) => void;
export interface SubscribeOptions {
  /**
   * Invoke the listener synchronously at subscribe time with the current value. A throwing
   * immediate listener unsubscribes before the error propagates.
   */
  immediate?: boolean;
}
export interface SelectorOptions<S> extends SubscribeOptions {
  /** Equality over selected results; defaults to `Object.is`. Equal selections skip the listener. */
  equals?: EqualsFn<S>;
}
/**
 * Top-level keys that `get(key)` reads literally. VERIFIED: keys containing path syntax, the empty
 * key and unsafe segments are parsed as paths at runtime, so they fall through to the untyped overload.
 */
type PlainKey<T> = Exclude<Extract<keyof T, string>, '' | `${string}${'.' | '[' | ']'}${string}` | '__proto__' | 'prototype' | 'constructor'>;
/**
 * Read side of a store. Snapshots are returned by reference; treat them as immutable, in-place
 * mutation is not observed.
 */
export interface ReadableStore<T> {
  /**
   * Current snapshot, by reference. Can already be newer than a listener's `next` argument while
   * a reentrant transition is still draining.
   */
  readonly value: T;
  /** True after `destroy()`; reads keep working on the last snapshot. */
  readonly destroyed: boolean;
  /** Current snapshot, by reference. */
  get(): T;
  /**
   * Typed read of a known top-level key. VERIFIED: keys containing `.`, `[` or `]` are parsed as
   * paths at runtime (`{ 'a.b': 1 }` reads `undefined`), so they resolve to the untyped overload below.
   */
  get<K extends PlainKey<T>>(key: K): T[K];
  /**
   * Dynamic path read such as `'items[0].name'`; returns `unknown` and is deliberately not
   * compile-time schema validation. Own properties only: missing keys, nullish intermediates and
   * inherited properties all yield `undefined`. `''` reads the root.
   */
  get(path: string): unknown;
  /** Current snapshot, by reference. */
  getRaw(): T;
  /**
   * Notify `(next, previous, changedPath)` on every committed transition. Delivery is synchronous
   * and FIFO; a throwing listener does not stop the others, errors are collected and rethrown as
   * `AggregateError` after the queue drains. Removed listeners are skipped; listeners added during
   * delivery only see later commits. Returns an idempotent unsubscribe.
   */
  subscribe(listener: Listener<T>, options?: SubscribeOptions): Unsubscribe;
  /** Notify only when the selected result changes; the selection is re-evaluated on every commit. */
  subscribe<S>(select: (value: T) => S, listener: Listener<S>, options?: SelectorOptions<S>): Unsubscribe;
  /** Register a `destroy()` cleanup; the returned function cancels it. Each cleanup runs at most once. */
  onDestroy(cleanup: () => void): Unsubscribe;
  /**
   * Idempotently deactivate listeners and run cleanups; the last snapshot remains readable.
   * Cleanup errors are collected and rethrown as `AggregateError` after all cleanups ran.
   * Every operation except reads throws once destroyed.
   */
  destroy(): void;
}
/** Writable store. All writes are synchronous commits; see `createStore` for transition semantics. */
export interface Store<T> extends ReadableStore<T> {
  /**
   * Replace the root, including `null`/`undefined` when allowed by `T`. Argument count, not type,
   * separates this from the path form: a one-argument string call is a root replacement.
   */
  set(value: T): void;
  /**
   * Undefined removes a path; array removal splices.
   * Copies only the touched plain-object/array ancestors; other references are preserved.
   * Malformed paths, inherited traversal and `__proto__`/`prototype`/`constructor` segments throw
   * before any change. Path writes cannot store `undefined`.
   */
  set(path: string, value: unknown): void;
  /** Replace the root; the unambiguous spelling of `set(value)` when `T` itself may be a string. */
  setRaw(value: T): void;
  /** Replace with `updater(current)` synchronously. A throwing updater leaves state untouched. */
  update(updater: (current: T) => T): void;
  /** Delete an object property or splice an array index; identical to `set(path, undefined)`. */
  remove(path: string): void;
  /** Restore the initial reference. Not a deep clone. */
  reset(): void;
  /** Replace with the explicit argument; `reset(undefined)` never means `reset()`. */
  reset(value: T): void;
}
export interface StoreOptions<T> {
  /**
   * Root equality; defaults to `Object.is`. Applies to every commit, including path writes, whose
   * result is compared as a whole.
   */
  equals?: EqualsFn<T>;
}
/** Maps a tuple of stores to a tuple of their value types; used by multi-source `computed`. */
export type StoreValues<S extends readonly ReadableStore<unknown>[]> = {
  -readonly [K in keyof S]: S[K] extends ReadableStore<infer V> ? V : never;
};
