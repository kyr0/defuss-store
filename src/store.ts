import { getByPath, setByPath } from './path.js';
import { installInternal, type Change } from './internal.js';
import type { Listener, SelectorOptions, Store, StoreOptions, Unsubscribe } from './types.js';

// The active flag lets delivery skip registrations removed mid-drain without touching the
// per-transition snapshot array.
type Registration<T> = { active: boolean; listener: (change: Change<T>) => void };
// A queued transition doubles as the change record handed to its listeners.
type Transition<T> = Change<T> & { listeners: readonly Registration<T>[] };

/**
 * Create a synchronous observable store holding `initial`.
 *
 * A commit compares the candidate with `options.equals` (default `Object.is`), installs it, bumps
 * a revision and queues a transition carrying a snapshot of the current listener registrations.
 * One synchronous drain delivers transitions FIFO. Reentrant commits enqueue into the same drain,
 * so during an earlier callback `store.value` can already hold a later value; use the listener's
 * arguments for its own transition. Listener errors are collected and thrown as `AggregateError`
 * after the queue drains; state stays committed. There is no rollback or transaction API.
 */
export function createStore<T>(initial: T, options: StoreOptions<T> = {}): Store<T> {
  const equals = options.equals ?? Object.is;
  let value = initial;
  let destroyed = false;
  // Monotonic commit counter; lets persistence detect that a queued transition is obsolete.
  let revision = 0;
  // True while the outermost commit drains; reentrant commits only enqueue.
  let draining = false;
  const listeners = new Set<Registration<T>>();
  // Immutable copy of `listeners`, shared by every commit until a registration is added or removed.
  let snapshot: Registration<T>[] | undefined;
  const cleanups = new Set<() => void>();
  // FIFO transitions; each entry freezes the listener registrations of its commit.
  const queue: Transition<T>[] = [];
  function alive(): void {
    if (destroyed) throw new Error('Store is destroyed');
  }
  function observe(listener: (change: Change<T>) => void): Unsubscribe {
    alive();
    const registration = { listener, active: true };
    listeners.add(registration);
    snapshot = undefined;
    // Idempotent: deactivating skips queued entries, deleting keeps it out of later snapshots.
    return () => {
      registration.active = false;
      if (listeners.delete(registration)) snapshot = undefined;
    };
  }
  function commit(next: T, path?: string, origin?: object): void {
    alive();
    // Equal candidates are discarded: no install, no revision, no notification.
    if (equals(value, next)) return;
    const previous = value;
    value = next;
    ++revision;
    // Nobody to notify: an empty snapshot would deliver nothing.
    if (!listeners.size) return;
    queue.push({ value, previous, path, origin, revision, listeners: snapshot ??= [...listeners] });
    // A reentrant commit: the outer drain loop picks this entry up.
    if (draining) return;
    draining = true;
    const errors: unknown[] = [];
    try {
      // queue.length is re-read each pass: transitions queued by listeners drain in the same pass.
      for (let index = 0; index < queue.length; index++) {
        const entry = queue[index]!;
        for (const registration of entry.listeners) {
          // Unsubscribed or destroyed after this entry was queued.
          if (!registration.active) continue;
          // A throwing listener must not stop the rest; all errors are reported after the drain.
          try { registration.listener(entry); } catch (error) { errors.push(error); }
        }
      }
    } finally {
      queue.length = 0;
      draining = false;
    }
    // State is already committed; this reports delivery failures, it is not a rollback.
    if (errors.length) throw new AggregateError(errors, 'Store listeners failed after state committed');
  }
  // One implementation for both overloads: a plain listener is a selector-less subscription.
  function subscribe<S>(
    select: ((value: T) => S) | undefined,
    listener?: Listener<S> | SelectorOptions<S>,
    options: SelectorOptions<S> = {},
  ): Unsubscribe {
    alive();
    // A non-function second argument selects the plain-listener overload at runtime.
    if (typeof listener !== 'function') {
      options = listener ?? {};
      listener = select as unknown as Listener<S>;
      select = undefined;
    }
    const notify = listener;
    const compare = options.equals ?? Object.is;
    let selected = select?.(value);
    const off = observe(change => {
      let next = change.value as unknown as S;
      let old = change.previous as unknown as S | undefined;
      if (select) {
        next = select(change.value);
        if (compare(selected as S, next)) return;
        old = selected;
        // Update the tracked selection before user code runs, so reentrant commits compare
        // against the value this listener has actually seen.
        selected = next;
      }
      notify(next, old, change.path);
    });
    // A failed immediate call must not leak a registration.
    try { if (options.immediate) notify((select ? selected : value) as S, undefined, undefined); }
    catch (error) { off(); throw error; }
    return off;
  }
  const store: Store<T> = {
    get value() { return value; },
    get destroyed() { return destroyed; },
    get: ((path?: string) => path ? getByPath(value, path) : value) as Store<T>['get'],
    getRaw: () => value,
    set(pathOrValue: T | string, next?: unknown) {
      alive();
      // Argument count, not runtime type, separates root replacement from path write:
      // set('a.b', undefined) deletes a path, set('literal') replaces a string root.
      if (arguments.length === 1) commit(pathOrValue as T);
      else if (arguments.length === 2 && typeof pathOrValue === 'string') commit(setByPath(value, pathOrValue, next), pathOrValue);
      else throw new TypeError('set expects a value or a string path and value');
    },
    setRaw: next => commit(next),
    update(updater) { alive(); commit(updater(value)); },
    remove(path) { alive(); commit(setByPath(value, path, undefined), path); },
    // arguments.length keeps reset(undefined) distinct from reset().
    reset(next?: T) { commit(arguments.length ? next as T : initial); },
    subscribe: subscribe as Store<T>['subscribe'],
    onDestroy(cleanup) { alive(); cleanups.add(cleanup); return () => { cleanups.delete(cleanup); }; },
    destroy() {
      // Idempotent: the first call wins, later calls are no-ops.
      if (destroyed) return;
      // Mark first so cleanups reentering the store see it as destroyed.
      destroyed = true;
      // Deactivate so entries queued before destroy skip every listener in an in-progress drain.
      for (const registration of listeners) registration.active = false;
      listeners.clear();
      snapshot = undefined;
      const errors: unknown[] = [];
      // Live iteration: each cleanup runs once, and one cancelled by an earlier cleanup is skipped.
      // Nothing can be added any more, since onDestroy throws once destroyed.
      for (const cleanup of cleanups) {
        cleanups.delete(cleanup);
        try { cleanup(); } catch (error) { errors.push(error); }
      }
      if (errors.length) throw new AggregateError(errors, 'Store cleanup failed');
    },
  };
  // Non-enumerable protocol slot shared with separately bundled entries; see internal.ts.
  installInternal(store, { set: (next, origin) => commit(next, undefined, origin), observe, revision: () => revision });
  return store;
}
