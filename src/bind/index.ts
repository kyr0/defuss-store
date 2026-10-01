import type { EqualsFn, Store, Unsubscribe } from '../types.js';

/** Named state of a component State API: `name` is one of the component's state names, `config` its parameters. */
export interface ComponentState { name: string; config: Record<string, unknown>; }
/**
 * State API a component must expose as `element.api` before binding, as defuss-shadcn's init does.
 * `getState()` reports the effective UI state, including changes made without `setState` (clicks, keys,
 * attribute writes); observation pulls rely on it. `setState` applies a named state and may reject or
 * clamp the request (disabled tab, out-of-range page); the binding normalizes such results into the store.
 */
export interface ComponentApi { setState(name: string, config?: Record<string, unknown>): void; getState(): ComponentState; }
/**
 * How a component change was observed: `user` DOM events, `api` `setState` calls, `attribute` DOM mutations,
 * `layout` component-reported layout effects. Classifies the observation mechanism, not a guaranteed cause.
 */
export type StateSource = 'user' | 'api' | 'attribute' | 'layout';
/** Optional `detail` payload of a `shadcn:statechange` CustomEvent; `source` overrides the assumed classification. */
export interface ComponentChange { previous: ComponentState; current: ComponentState; source: StateSource; }
export interface BindingOptions<T, Selection> {
  /** Store slice this component owns; disjoint selections let several bindings share one store. */
  select: (value: T) => Selection;
  /** Maps a selection to the component state applied on push. */
  toState: (selection: Selection) => ComponentState;
  /** Maps the effective component state to the next store value; spread `current` to keep unrelated fields. */
  fromState: (state: ComponentState, current: T) => T;
  /**
   * Selection equality, `Object.is` by default. Gates both directions: store commits that keep the selection
   * do not push, and observed component states that reproduce the selection are not written back — which is
   * what makes the observation loop converge instead of echoing.
   */
  equals?: EqualsFn<Selection>;
  /** Initial owner: 'store' (default) applies the selection to the element; 'element' reads the element first. */
  initial?: 'store' | 'element';
  /** Restricts observed change sources; by default all four are observed. */
  sources?: readonly StateSource[];
  /** Aborts the binding; an already-aborted signal returns an inert binding without registering anything. */
  signal?: AbortSignal;
  /** Additional component-specific change events. */
  events?: readonly string[];
  /** Observe DOM-backed State APIs, including existing defuss-shadcn components. */
  observe?: boolean;
  /** Receives errors from microtask-coalesced observation pulls; without it they throw as uncaught errors. */
  onError?: (error: unknown) => void;
}
/**
 * Callable disposer returned by bindState. Calling it detaches the mutation observer, event handlers, store
 * subscription, abort listener and the `setState` wrapper (restoring the original). Idempotent; release
 * failures are collected and reported together as an `AggregateError`.
 */
export interface StateBinding extends Unsubscribe {
  /** Pull non-observable state changes (for example a registry-only config write). */
  pull(): void;
  /** Reapply the current store selection, normalizing rejected or clamped component results back into the store. */
  push(): void;
}
// One binding per element; a WeakSet never keeps a removed element alive.
const bindings = new WeakSet<HTMLElement>();
// Interaction events that may precede a state change. Over-observation is harmless: pull() re-reads the
// effective state and only writes on an actual selection change.
const defaultEvents = ['shadcn:statechange', 'input', 'change', 'click', 'keydown', 'toggle', 'close'];

/**
 * Binds one store selection to a component's State API, bidirectionally. Store commits push the selection
 * through `toState` into `api.setState` synchronously; user events, DOM mutations and direct `api.setState`
 * calls pull the effective `getState()` result back into the store through `fromState`. Event and mutation
 * observation is coalesced into one microtask pull, while API calls and store pushes are synchronous.
 * Selection equality and an internal applying-guard prevent feedback; after each push the effective state
 * is read back so rejected or clamped requests (disabled tab, out-of-range page) normalize the store.
 *
 * Requires an initialized `element.api` and a live store; one binding per element. The binding ends by
 * calling the returned disposer, aborting `options.signal`, or destroying the store. Removing the element
 * from the DOM alone does not dispose it.
 *
 * Opt-in binding; imports have no DOM side effects and install no globals.
 */
export function bindState<T, Selection>(
  element: HTMLElement & { api: ComponentApi }, store: Store<T>, options: BindingOptions<T, Selection>,
): StateBinding {
  const api = element.api;
  if (typeof api?.getState !== 'function' || typeof api.setState !== 'function') {
    throw new TypeError('Initialize the component State API before binding');
  }
  if (store.destroyed) throw new Error('Store is destroyed');
  if (bindings.has(element)) throw new Error('Element is already bound');
  if (![undefined, 'store', 'element'].includes(options.initial)) throw new TypeError('Invalid initial binding owner');
  const equals = options.equals ?? Object.is;
  const original = api.setState;
  const releases: Unsubscribe[] = [];
  let disposed = false;
  let applying = false;
  let pending = false;
  // Whether `source` passes the optional `sources` filter.
  const observed = (source: StateSource) => !options.sources || options.sources.includes(source);
  // Element -> store. No-op while a push applies; writes only on an actual selection change, which is what
  // keeps pushes, observers and events from echoing each other.
  function pull(): void {
    if (disposed || applying) return;
    const current = store.value;
    const next = options.fromState(api.getState(), current);
    if (!equals(options.select(current), options.select(next))) store.setRaw(next);
  }
  // Store -> element. Calls the original setState under the applying guard, so neither the wrapper below
  // nor scheduled observers feed the push back into the store.
  function push(): void {
    if (disposed || applying) return;
    const selection = options.select(store.value);
    const state = options.toState(selection);
    applying = true;
    try { original.call(api, state.name, state.config); }
    finally { applying = false; }
    // Normalize clamped/rejected requests, unless a newer store change arrived.
    if (equals(selection, options.select(store.value))) pull();
  }
  // Coalesces a burst of events/mutations into one microtask pull; `pending` dedupes the burst.
  function schedule(source: StateSource): void {
    if (disposed || applying || pending || !observed(source)) return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      if (disposed) return;
      try { pull(); }
      catch (error) { if (options.onError) options.onError(error); else throw error; }
    });
  }
  // A plain function, not an arrow, so `this` stays the caller's api object.
  const wrapped: ComponentApi['setState'] = function (this: ComponentApi, name, config) {
    original.call(this, name, config);
    // API calls are observed synchronously, unless a push is applying or 'api' sources are filtered out.
    if (!applying && observed('api')) pull();
  };
  // Idempotent teardown. Restores setState only if the wrapper was not replaced by someone else; release
  // errors are collected so every cleanup still runs, then reported together.
  const dispose = (() => {
    if (disposed) return;
    disposed = true;
    bindings.delete(element);
    if (api.setState === wrapped) api.setState = original;
    const errors: unknown[] = [];
    for (const release of releases.splice(0)) {
      try { release(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, 'Binding cleanup failed');
  }) as StateBinding;
  dispose.pull = pull;
  dispose.push = push;
  // Already aborted: return an inert binding before registering the element, so it stays bindable.
  if (options.signal?.aborted) { disposed = true; return dispose; }
  bindings.add(element);
  try {
    api.setState = wrapped;
    const eventHandler = (event: Event) => {
      if (event.type !== 'shadcn:statechange') schedule('user');
      // A nested component's own statechange belongs to that component's binding, not to this element.
      else if (event.target === element) schedule((event as CustomEvent<ComponentChange>).detail?.source ?? 'attribute');
    };
    for (const event of new Set([...defaultEvents, ...(options.events ?? [])])) {
      // Capture phase: interactions count even when an inner handler stops propagation.
      element.addEventListener(event, eventHandler, true);
      releases.push(() => element.removeEventListener(event, eventHandler, true));
    }
    if (options.observe !== false) {
      // Taken from the element's own document realm (iframe-safe) and only at bind time, so importing this
      // module stays free of DOM globals.
      const Observer = element.ownerDocument.defaultView?.MutationObserver;
      if (!Observer) throw new Error('MutationObserver unavailable; use observe:false and explicit events/pull');
      const observer = new Observer(() => schedule('attribute'));
      observer.observe(element, { attributes: true, childList: true, subtree: true, characterData: true });
      releases.push(() => observer.disconnect());
    }
    // Not immediate: the initial pull/push below syncs the chosen owner exactly once.
    releases.push(store.subscribe(options.select, push, { equals }));
    releases.push(store.onDestroy(dispose));
    if (options.signal) {
      options.signal.addEventListener('abort', dispose, { once: true });
      releases.push(() => options.signal!.removeEventListener('abort', dispose));
    }
    // Last, with all observation in place; a failure here unwinds through dispose() in the catch below.
    if (options.initial === 'element') pull(); else push();
  } catch (error) { dispose(); throw error; }
  return dispose;
}
