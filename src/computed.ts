import { createStore } from './store.js';
import type { ReadableStore, StoreOptions, StoreValues, Unsubscribe } from './types.js';

/**
 * Derive a read-only store from a single source. The projection runs eagerly and on every source
 * commit; `options.equals` (default `Object.is`) decides whether a new projection result notifies.
 * A throwing projection retains the last successful value and the error joins the source's
 * `AggregateError` reporting. Destroying the source destroys the derived store; `destroy()`
 * detaches it early.
 */
export function computed<T, R>(store: ReadableStore<T>, project: (value: T) => R, options?: StoreOptions<R>): ReadableStore<R>;
/**
 * Derive a read-only store from a tuple of sources. Duplicate sources are subscribed once.
 * Multi-source updates are not batched: each source commit produces its own derived commit, with
 * no transactional glitch-free guarantee.
 */
export function computed<const S extends readonly ReadableStore<unknown>[], R>(stores: S, project: (...values: StoreValues<S>) => R, options?: StoreOptions<R>): ReadableStore<R>;
export function computed<R>(
  inputs: ReadableStore<unknown> | readonly ReadableStore<unknown>[],
  project: (...values: unknown[]) => R,
  options?: StoreOptions<R>,
): ReadableStore<R> {
  const sources = Array.isArray(inputs) ? inputs : [inputs as ReadableStore<unknown>];
  // A dead source could never deliver updates.
  if (sources.some(source => source.destroyed)) throw new Error('Computed source is destroyed');
  const calculate = () => project(...sources.map(source => source.value));
  // Eager first projection; a throw propagates before any source subscription exists.
  const target = createStore(calculate(), options);
  const releases: Unsubscribe[] = [];
  // Registered before subscribing, so destroying the target always detaches from every source.
  target.onDestroy(() => { for (const release of releases.splice(0)) release(); });
  try {
    // Repeated sources subscribe once each. A throwing projection propagates into the source's
    // error aggregation; the target keeps its last value. A derived store never outlives a source.
    // Pushed one at a time, so a throwing onDestroy cannot leak the subscription before it.
    for (const source of new Set(sources)) {
      releases.push(source.subscribe(() => target.setRaw(calculate())));
      releases.push(source.onDestroy(() => target.destroy()));
    }
  } catch (error) { target.destroy(); throw error; } // A half-subscribed setup must not leak.
  // Only read operations are exposed: no writable methods exist at runtime, not just in types.
  return {
    get value() { return target.value; },
    get destroyed() { return target.destroyed; },
    get: target.get, getRaw: target.getRaw, subscribe: target.subscribe,
    onDestroy: target.onDestroy, destroy: target.destroy,
  };
}
