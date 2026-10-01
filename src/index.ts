/**
 * Root entry: stores, derived values and equality helpers. Importing it touches no DOM or storage
 * globals, so it is SSR-safe; optional layers live in `defuss-store/storage`,
 * `defuss-store/persist` and `defuss-store/bind`.
 */
export { createStore } from './store.js';
export { computed } from './computed.js';
export { jsonEquals } from './equals.js';
export type { Store, ReadableStore, Listener, EqualsFn, StoreOptions, SubscribeOptions, SelectorOptions, Unsubscribe, StoreValues } from './types.js';
