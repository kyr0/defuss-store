# Architecture

The implementation follows defuss' small-package layout: TypeScript in `src`, colocated unit tests, Vitest, pkgroll ESM output, TypeScript declarations, a measured standalone browser build, Playwright fixtures and tests, build scripts, and Makefile aliases. It is self-contained outside the monorepo, including its own lockfile and CI workflow.

## Dependency boundaries

Core owns synchronous state, path updates, selectors, computation and cleanup. It imports no browser APIs or optional layer. Storage owns string backends and codecs, persistence owns schema/lifecycle policy, and bindings own DOM observation. `browser.ts` is the explicit convenience composition.

pkgroll emits ESM entries and shared chunks. TypeScript emits declarations preserving source module boundaries: combining all entry declarations in one bundle can incorrectly route a server type through the browser entry and require DOM libraries. The packed-consumer gate checks this boundary. The standalone browser entry is bundled by esbuild. The internal `Symbol.for('defuss-store.internal.v1')` property identifies a per-store protocol across independently bundled entry points. The registry contains a symbol, not state, listeners, or a storage singleton. This permits a root store to work with a separately bundled persistence entry. It is internal and deliberately absent from public entry exports.

## Transition processing

A commit compares equality, installs a snapshot, increments a revision, and queues a transition with a snapshot of listener registrations. One synchronous drain processes transitions FIFO. Each registration has an active flag, making self-unsubscribe and removal during delivery safe. New registrations only participate in later commits. Delivery errors are collected and thrown after draining; state remains committed.

Path writes copy only touched plain-object/array ancestors. Undefined on a path removes it, while undefined as a root value is a normal replacement. Argument count distinguishes these cases. Unsafe segments are rejected before traversal; own-property checks prevent inherited reads. Selectors keep their last delivered selection and update it before invoking user code. Computed stores own dependency subscriptions and expose only readable operations.

## Persistence protocol

One controller owns a store at a time. It subscribes before hydration so listeners triggered by hydration can make local changes without losing them. A private per-controller origin identifies restores/remote reads, preventing write echoes without suppressing independent nested local changes. Revisions prevent an obsolete queued transition from persisting over newer committed state.

The controller has three phases: paused, active and destroyed. Manual hydration and failed reads stay paused. Successful reads, explicit writes, and clear activate automatic persistence. Destroy removes ownership and subscriptions. Missing data is an active, dirty, absent state; it does not reset memory. Migrated and legacy data stay dirty until saved in the current envelope. Bad/future bytes remain untouched until explicit recovery.

Native storage events invalidate a key; handlers reread authoritative current bytes. Accepted-byte tracking suppresses duplicate clean remote restores. Storage removals mark absence but preserve the snapshot. Synchronization is last-write-wins and does not provide an atomic read/modify/write across tabs.

## Component binding

Bindings map one store selection to a component State API. Direct API calls are wrapped; legacy interactions are observed through scoped DOM mutations and captured events. Observation is coalesced in a microtask, while store pushes and API pulls are synchronous. Selection equality and an applying guard prevent feedback. Effective state is read after a push to normalize invalid/clamped requests. A callable disposer releases the observer, event handlers, store subscription, abort listener, and method wrapper.

Legacy component changes with no observable DOM or event effect require an explicit pull. The adapter does not change defuss-shadcn's source, DOM ownership, global setup, or rendering behavior. Actual tabs, pagination and sidebar fixtures validate the contract available at the pinned upstream revision.

## Verification boundaries

Unit tests run in Node without DOM mocks. Regression tests cover the identified upstream path/reset/unsubscription/reentry/persistence/isolation defects. Storage tests additionally cover serialization, acquisition failure, quota behavior and area filtering; persistence tests cover validation, migration, hydration modes, ownership and teardown.

Playwright tests run against built public entries and real native Web Storage in Chromium. Cross-page tests use two pages in one browser context, not two isolated origins. Component fixtures are pinned upstream code with the original licenses. Browser binding code is excluded from Node V8 coverage because it is exercised by the separate browser suite; no combined coverage claim is made.

The packed-consumer gate installs the actual npm tarball into a temporary directory outside this repository. It tests runtime imports, SSR isolation, package declarations under two resolvers, DOM-free server types, and browser bundling. It cannot resolve source aliases or rely on a monorepo symlink. The publish hook runs the full gate before source-directory publication.
