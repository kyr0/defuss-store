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

## Docs site

`docs/` is a static GitHub Pages site with no build step. It uses plain HTML and ES modules, loads defuss-shadcn 0.9.8 from jsDelivr pinned by Subresource Integrity, and serves a byte copy of `dist/browser.js`. Pure demo logic (validators, state changes, change formatting) lives in `docs/demo/model.js` and is unit-tested in Node. The views only subscribe to stores and write to them.

The demos run as a same-origin page inside an `.iframe`, not inside defuss-shadcn's HTML Preview Editor. That editor runs its preview in a sandbox without `allow-same-origin`. VERIFIED: in Chromium, `localStorage` in such a frame throws `SecurityError`, so the stores would fall back to memory and nothing would survive a reload. A same-origin frame uses the page's real `localStorage`. It reloads like a page, and it opens unchanged in a full-screen tab. VERIFIED: when storage is blocked, the demo falls back to memory without `sync`, says so, and keeps working (`tests/e2e/docs.spec.ts`).

The theme is a persisted store with `sync: true`, so the landing page, the frame and any full-screen demo tab follow one switch through native storage events. Painting the frame from its parent would miss other tabs. VERIFIED: the switch repaints the frame, and a store change in a second demo tab reaches the first (`tests/e2e/docs.spec.ts`). The devtools subscribe to each store before its persistence attaches, so a restore after a reload appears in the log. VERIFIED: read synchronously, `persistence.status()` still showed the state before persistence's own listener wrote, so the devtools read it in a microtask.

`scripts/verify.ts` ties the site's claims to the build. It checks the copied bundle bytes, every `data-stat` size against `dist/stats.json`, the version against `package.json`, every line of a demo-source excerpt against its file, and the version pin and SRI hash of every external asset. It checks `README.md` the same way: each row of its size table against `dist/stats.json`, each row of its scaling table against `docs/assets/bench.json`, and its versions and Node badge against `package.json`. `tests/e2e/docs.spec.ts` drives both pages through reloads, a second tab, the theme switch, Get/Set state, the devtools and the phone layout. It fails on console errors and failed requests.

## Benchmarks

`src/store.bench.ts` times fixed-size operations of the source with Vitest. `scripts/bench-scaling.ts` times the built `dist/` while one input grows: path segments from 1 to 256, list items from 10 to 100,000 (reading and writing the last item, with and without persistence to memory storage), and subscribers from 1 to 10,000 (plain listeners, and selectors where one selection changes). Each point is the median of 15 timings, taken in 5 interleaved rounds over all sizes of a series. One timing repeats the operation for at least 15 ms.

VERIFIED: across six runs on one Apple M4 (2026-10-10), every series fitted the same growth exponent within ±0.03: reads flat in list length, everything else linear. Single points varied by up to 40 % between runs, most where a write copies 100,000 items or an operation takes under 100 ns. With sizes timed one after another, plain listeners cost about 3.5 ns each. Interleaved, with every size's store alive, they cost about 6.3 ns, because the listener call site sees many functions as in an application. The docs use the interleaved, more conservative method. Persistence encodes the whole stored value on every write: in the committed snapshot, a write to a persisted 100,000-item list takes about 34 ms. The docs page computes its takeaways from `docs/assets/bench.json` at runtime, and `scripts/verify.ts` fails when the snapshot stops supporting the page's static claim (flat reads by length, linear everything else). The numbers describe the machine in the snapshot, not the reader's.

