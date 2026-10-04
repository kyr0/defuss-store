# defuss-store

Small synchronous observable stores, extracted from defuss and packaged independently. Zero runtime dependencies; TypeScript declarations; ESM for Node and browsers; optional validated Web Storage persistence and defuss-shadcn State API bindings.

## Install

After publication:

```sh
npm install defuss-store
```

Before publication, run `npm run test:package` and install the generated tarball with `npm install artifacts/defuss-store-0.1.0.tgz`.

Node 22.12+ is supported. Browsers must support modern ES2022 features. CommonJS and legacy browsers are not targeted. The root entry has no DOM or storage dependencies.

## Stores and derived values

```ts
import { createStore, computed } from 'defuss-store';

const preferences = createStore({ theme: 'system', page: 1 });
const label = computed(preferences, value => `Page ${value.page}`);

const unsubscribe = preferences.subscribe(
  value => value.theme,
  (theme, previous) => console.log({ theme, previous }),
  { immediate: true },
);

preferences.set('theme', 'dark');
preferences.update(current => ({ ...current, page: current.page + 1 }));
console.log(label.value); // Page 2

// Object selections can use an explicit equality function.
const offPage = preferences.subscribe(
  value => ({ page: value.page }),
  value => console.log(value.page),
  { equals: (a, b) => a.page === b.page },
);

unsubscribe();
offPage();
label.destroy();
preferences.destroy();
```

| API | Behavior |
| --- | --- |
| `createStore(initial, { equals? })` | `Object.is` equality by default; no notification for equal replacements |
| `.value`, `.get()`, `.getRaw()` | Current snapshot, returned by reference |
| `.get('field')` | Known top-level keys retain their TypeScript value type |
| `.get('items[0].name')` | Dynamic paths return `unknown`; own properties only |
| `.set(next)`, `.setRaw(next)` | Replace the root, including `null`/`undefined` when allowed by `T` |
| `.set(path, next)` | Copy the affected ancestors; preserve other references |
| `.set(path, undefined)`, `.remove(path)` | Delete an object property or splice an array index |
| `.update(fn)` | Synchronously replace with `fn(current)` |
| `.reset()`, `.reset(next)` | Restore the initial reference, or replace with the explicit argument |
| `.subscribe(listener, { immediate? })` | Receive `(next, previous, changedPath)`; return an idempotent unsubscribe |
| `.subscribe(selector, listener, { equals?, immediate? })` | Notify only when the selected result changes |
| `.onDestroy(cleanup)` | Register cleanup and receive a cancellation function |
| `.destroy()` | Idempotently release listeners and cleanup; last snapshot remains readable |

Treat snapshots as immutable: in-place mutation is not observed. `reset()` does not deep-clone the initial value. Path updates support plain objects and arrays, dot paths, and nonnegative indices (`items.0.name` or `items[0].name`). Empty writes, malformed paths, inherited traversal, and `__proto__`, `prototype`, or `constructor` segments are rejected. Dynamic path setters are deliberately not compile-time schema validation; prefer typed `update` for that. `.get('')` retains the old root-read behavior.

Each committed transition carries its own callback arguments. Reentrant writes commit immediately and their notifications drain FIFO. During an earlier callback, `.value` can therefore already contain a later reentrant value; use the callback's `next` argument for that transition. Removed listeners are skipped; newly subscribed listeners do not receive earlier queued transitions. Listener errors do not stop other listeners or persistence: an `AggregateError` is thrown after the queue drains. There is no rollback or transaction API.

`computed(source, project, { equals? })` and `computed([a, b] as const, (a, b) => result)` return a runtime read-only store. A projection runs eagerly and on source changes. Projection failure retains the last result and participates in source error reporting. Call `.destroy()` to detach early; destroying any source also destroys the derived store. Multi-source computation is not batched or transactionally glitch-free. Selectors, equality functions, validators, and projections should be pure.

Stores use `Object.is` identity equality by default. `jsonEquals` compares `JSON.stringify` results; it is order-sensitive and can throw on non-JSON values.

## Persistent preferences

```ts
import { createStore } from 'defuss-store';
import { createWebStorage, createMemoryStorage } from 'defuss-store/storage';
import { attachPersistence } from 'defuss-store/persist';

type Preferences = { theme: 'system' | 'light' | 'dark'; page: number };
function isPreferences(value: unknown): value is Preferences {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.theme === 'string'
    && ['system', 'light', 'dark'].includes(candidate.theme)
    && typeof candidate.page === 'number'
    && Number.isSafeInteger(candidate.page) && candidate.page >= 1;
}

const preferences = createStore<Preferences>({ theme: 'system', page: 1 });
const storage = createWebStorage('local', { fallback: createMemoryStorage() });
const persistence = attachPersistence(preferences, {
  key: 'my-app:preferences', storage, version: 1,
  validate: isPreferences,
  onError: failure => console.error(failure.operation, failure.error),
});

// Existing validated state has already been restored. No eager default write.
preferences.set('theme', 'dark'); // Persists synchronously.
persistence.clear();             // Removes this key; keeps state in memory.
persistence.flush();             // Explicitly saves the current snapshot.
preferences.destroy();          // Also disposes persistence.
```

The default format is `{ "format": "defuss-store", "formatVersion": 1, "version": 1, "value": ... }`. The application schema `version` must be a nonnegative safe integer. A validator is mandatory on reads and writes. Empty string keys are supported.

| Option / method | Contract |
| --- | --- |
| `hydrate: 'immediate'` (default) | Read and validate before enabling automatic writes |
| `hydrate: 'manual'` | Pause writes and remote hydration until `rehydrate()`, `flush()`, or `clear()` |
| `hydrate: 'skip'` | Enable writes without reading; no write until a change or `flush()` |
| `rehydrate()` | Read again; saved state wins; a missing key preserves current memory |
| `flush()` | Validate and save current memory; explicitly recovers paused persistence |
| `clear()` | Remove only this key; next real mutation may recreate it |
| `status()` | Snapshot of `phase`, `dirty`, last observed `hasStoredValue`, and optional `lastError` |
| `destroy()` | Unsubscribe without writing or deleting; never flushes implicitly |

The three operational methods return `true` on success and `false` on reported operational failure. Using a destroyed controller throws. Only one persistence controller may own a store at a time; dispose it before attaching another.

Missing data never overwrites memory. Invalid JSON, invalid state, migration errors, unsupported envelopes, and future schema versions pause automatic writes and preserve the original bytes. Recovery is explicit: fix storage and `rehydrate()`, replace it with `flush()`, or remove it with `clear()`. Write/quota errors retain committed memory, mark it dirty, and report through `onError`; the next mutation or `flush()` retries. With no error callback, errors are reported to `console.error`. These are not listener rollback semantics.

### Migration and serialization

Provide `migrate(oldValue, fromVersion)` when reading an older application schema. It must return the **current** schema; use sequential migrations inside that function for multiple old versions. Its output is validated. A migrated value stays dirty until an explicit flush or a local change; hydration does not rewrite storage.

To import the old defuss store's raw JSON, set `legacyVersion` to the schema version of that data. If it matches the current version, validation is sufficient; otherwise `migrate` is required. Legacy bytes are preserved until the next write, which uses the new envelope. Future versions are never downgraded automatically.

The default `jsonCodec` checks the entire envelope before serialization. It accepts JSON primitives, plain records, and dense arrays. It rejects cyclic references, `undefined`, `BigInt`, functions, symbols, dates, maps, non-finite numbers, negative zero, accessors, hidden properties, and sparse/extended arrays instead of silently losing information. Shared acyclic values are supported, but reference identity and null prototypes are not preserved by JSON. An optional `codec: { encode(value): string, decode(bytes): unknown }` can implement other formats; it processes the whole envelope and still passes decoded state through validation.

### Storage and cross-tab synchronization

`createMemoryStorage()` makes a fresh, isolated map every time. Share the same instance deliberately if stores need the same backing data. It implements `getItem`, `setItem`, `removeItem`, `clear`, `key`, and `length`, but does not broadcast changes.

`createWebStorage('local' | 'session', { fallback?, onUnavailable? })` lazily acquires browser storage on first use, so import is safe in SSR. A supplied fallback is selected only if acquiring storage fails; it stays selected for that adapter. A quota or later I/O failure does not silently switch backends. A fallback is optional and must be explicitly provided.

Use `sync: true` with native Web Storage to consume its `storage` events. Only the selected storage area and key are handled. The adapter rereads current bytes and hydration never echoes a remote write. Removal/clear preserves in-memory state and records that storage is absent. Local storage synchronizes across same-origin documents; session storage follows the browser's top-level browsing-context rules. Native events do not notify the writer or another store in the same document: share one store for same-page state. This is whole-value last-write-wins synchronization, with no cross-tab atomic update, merge, or CRDT guarantee.

`sync: true` requires a backend with `subscribe`. A plain memory fallback has no such capability: use persistence without sync, or supply a custom backend implementing remote invalidation. The raw backend interface is synchronous and DOM-free:

```ts
interface StorageBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  subscribe?(listener: (change: { key: string | null }) => void): () => void;
}
```

## defuss-shadcn bindings

Initialize the component normally with defuss-shadcn, then bind its existing `element.api`. The package does not install `df$` or import shadcn. A selector lets several components share one preferences object without overwriting each other's fields.

```ts
import { bindState, type ComponentApi } from 'defuss-store/bind';
import { createStore } from 'defuss-store';

const preferences = createStore({ tabId: 'account', page: 1 });
const tabs = document.querySelector<HTMLElement & { api: ComponentApi }>('#tabs')!;
const abort = new AbortController();
const binding = bindState(tabs, preferences, {
  select: value => value.tabId,
  toState: id => ({ name: 'active', config: { id } }),
  fromState: (state, current) => ({ ...current, tabId: String(state.config.id) }),
  signal: abort.signal,
});

preferences.set('tabId', 'billing'); // Component follows the store.
// Component clicks, keyboard actions and api.setState update the store.
abort.abort(); // Or binding(); both release everything idempotently.
```

Store state wins on mounting by default; set `initial: 'element'` to read the component first. Attach persistence before binding if restored preferences should initialize the UI. Rejected or clamped component requests are normalized back into the store (for example, disabled tabs or an out-of-range page).

The binding observes DOM mutations and component events, and wraps the existing `api.setState`. API calls are observed synchronously; event and attribute observations are coalesced into a microtask. It restores the original method and removes all observers/listeners on disposal, abort, or store destruction. Only one binding per element is allowed. Applications own the lifecycle: removing a DOM element alone does not dispose its binding.

Advanced options: `equals` compares selected values; `events` adds component-specific events; `observe: false` disables the mutation observer; `sources` filters observed `user`, `api`, `attribute`, and `layout` sources; `onError` handles asynchronous observation failures. `shadcn:statechange` events may supply `{ source }` in `detail`. Sources describe the observation mechanism, not a universally precise causal classification of legacy components. A registry-only configuration change with no DOM/event signal requires `binding.pull()`; `binding.push()` reapplies current store selection.

The browser tests use pinned, unmodified upstream core, tabs, pagination, and sidebar JavaScript, not mocked component implementations. See `tests/fixtures/components.html` for complete working mappings. Other State API components can use the same adapter but require their own field mapping and integration validation.

## SSR and package entries

Create stores and memory storage per request. Never export a mutable user store from a server module singleton. All entries can be imported without acquiring browser globals, and core/storage/persistence declarations typecheck without DOM libraries. Only using the optional binding requires DOM types and an initialized element.

| Import | Contents |
| --- | --- |
| `defuss-store` | Core, computed, equality helpers and store types |
| `defuss-store/storage` | Raw storage adapters, strict JSON codec and types |
| `defuss-store/persist` | Validated/versioned persistence and types |
| `defuss-store/bind` | Optional State API binding and types |
| `defuss-store/browser` | Standalone browser ESM with core/storage/persist/bind |

`dist/browser.js` and `dist/browser.min.js` are direct browser modules with source maps; the latter is a physical asset rather than a separate package import. Root imports do not pull in optional layers. Build measurements for each entry are in `dist/stats.json`; no guessed bundle sizes are advertised.

## Develop and release

```sh
npm ci
npx playwright install --with-deps chromium
npm run check
```

`check` runs lint, source and public API type checks, builds, unit coverage, real Chromium tests, an isolated packed-consumer install, and package verification. The packed consumer tests NodeNext and Bundler declaration resolution, DOM-free SSR types, every ESM entry, and browser bundling without workspace aliases. It writes the publishable `.tgz` and `artifacts/package-verification.json`.

Use `npm run dev` after building to open the browser example at `http://127.0.0.1:4178`. `npm run bench` runs local benchmarks without performance thresholds. A thin `Makefile` exposes the same workflows; `make verify` (lint, types, unit coverage, then build and the browser, packed-consumer and package checks) is what CI runs, and browser reports land in `output/`. `npm publish` runs the full `check` gate through `prepublishOnly`. See [ARCH.md](./ARCH.md) for internals. The provenance of the vendored browser fixtures is recorded in `tests/fixtures/vendor/provenance.json`.
