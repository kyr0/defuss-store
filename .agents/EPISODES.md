# Episodes

<!-- Newest last. The gate appends FAIL|DONE|FINDING and keeps the last 100 entries (git keeps older ones).
Agents append `<UTC ISO> s=<session> LESSON <Signan>` only for a falsified HYPOTHESIS, a dead end, or a root cause.
A lesson recurring ≥2 → test | .agents/VERIFY.py rule | MEMORY line, then delete its lines. -->

2026-10-03T03:11:17Z s=7df361dd FAIL layout,coverage=?
2026-10-03T03:12:04Z s=7df361dd FAIL layout
2026-10-03T05:57:56Z s=7df361dd FAIL layout,wiring,tests.e2e.evidence
2026-10-03T05:59:19Z s=7df361dd FAIL env.example
2026-10-03T06:02:07Z s=7df361dd DONE fp=feb5f851b36a cov=98.2% paths=.github/workflows/ci.yml,.github/workflows/verify.yml,Makefile,package.json(+5)
2026-10-03T06:02:07Z s=7df361dd FINDING scripts/verify.ts:22 + package.json files learn=test: make e2e now runs npm run verify, which fails on any missing listed file
2026-10-03T06:02:07Z s=7df361dd FINDING package.json scripts.lint learn=verifier: .agents/VERIFY.py lint.deny-warnings
2026-10-03T06:02:07Z s=7df361dd FINDING src/types.ts ReadableStore.get(key) learn=test: tests/types/api.ts @ts-expect-error fails (TS2578) without fix; gate runs it via VERIFY.py types.public-api
2026-10-03T06:02:07Z s=7df361dd FINDING Makefile e2e learn=verifier: .agents/VERIFY.py e2e.builds-artifact
2026-10-03T06:02:07Z s=7df361dd FINDING .github/workflows/verify.yml (init template) learn=none: only observable on a GitHub runner; no local mechanical check
2026-10-03T06:02:07Z s=7df361dd FINDING CHANGELOG.md Unreleased learn=none: documentation judgment, not mechanically checkable
2026-10-04T08:21:21Z s=7df361dd DONE fp=c7b9561b0cbd cov=98.2% paths=.github/workflows/verify.yml,Makefile,package.json,playwright.config.ts(+4)
2026-10-04T08:21:21Z s=7df361dd FINDING scripts/verify.ts:22 + package.json files learn=test: make e2e now runs npm run verify, which fails on any missing listed file
2026-10-04T08:21:21Z s=7df361dd FINDING package.json scripts.lint learn=verifier: .agents/VERIFY.py lint.deny-warnings
2026-10-04T08:21:21Z s=7df361dd FINDING src/types.ts ReadableStore.get(key) learn=test: tests/types/api.ts @ts-expect-error fails (TS2578) without fix; gate runs it via VERIFY.py types.public-api
2026-10-04T08:21:21Z s=7df361dd FINDING Makefile e2e learn=verifier: .agents/VERIFY.py e2e.builds-artifact
2026-10-04T08:21:21Z s=7df361dd FINDING .github/workflows/verify.yml (init template) learn=none: only observable on a GitHub runner; no local mechanical check
2026-10-04T08:21:21Z s=7df361dd FINDING CHANGELOG.md Unreleased learn=none: documentation judgment, not mechanically checkable
2026-10-10T13:42:07Z s=1956eb00 DONE fp=0f9242be57b8 cov=98.2% paths=.github/workflows/verify.yml,.oxlintrc.json,ARCH.md,CHANGELOG.md(+24)
2026-10-10T13:42:07Z s=1956eb00 FINDING docs/assets/theme.js:26 themePersistence learn=test: tests/e2e/docs.spec.ts 'a theme switch replaces unreadable stored theme bytes on purpose'
2026-10-10T13:42:07Z s=1956eb00 FINDING docs/demo/app.js:48 ui persistence learn=none: a failing ui write needs a quota fault per key; the shared failure path is covered by the blocked-storage test
2026-10-10T13:42:07Z s=1956eb00 FINDING docs/assets/persist.js:13 + docs/demo/devtools.js:56 learn=test: tests/e2e/docs.spec.ts 'blocked storage falls back to memory, says so, and keeps working'
2026-10-10T13:42:07Z s=1956eb00 FINDING .github/workflows/verify.yml:24 learn=verifier: CI step fails when the committed docs copy differs from the build
2026-10-10T13:42:07Z s=1956eb00 FINDING docs/demo/model.js describeChange learn=test: tests/unit/docs-model.test.ts and the notes e2e assert the removal line and its warning tone
2026-10-10T13:42:07Z s=1956eb00 FINDING docs/demo/devtools.js:39 schedule() learn=test: devtools e2e asserts 'active' and 'B in localStorage' right after typing
2026-10-10T13:42:07Z s=1956eb00 FINDING tests/e2e/docs.spec.ts landing sections learn=test: 'renders every section ...' asserts the diagram nodes and controls, the accordion toggle and the FAB
2026-10-10T13:42:07Z s=1956eb00 FINDING docs/index.html demo-source excerpts learn=verifier: scripts/verify.ts docs facts
2026-10-10T14:13:17Z s=1956eb00 DONE fp=401c87833ff0 cov=98.2% paths=.github/workflows/verify.yml,.oxlintrc.json,ARCH.md,CHANGELOG.md(+29)
2026-10-10T14:13:17Z s=1956eb00 FINDING docs/assets/scaling.js chartOption aria learn=test: docs e2e asserts the depth chart's aria-label describes the growth ('linear')
2026-10-10T14:13:17Z s=1956eb00 FINDING docs/assets/scaling.js initScaling mount learn=test: docs e2e waits for three mounted chart SVGs
2026-10-10T14:13:17Z s=1956eb00 FINDING docs/assets/scaling.js formatNs learn=test: tests/unit/docs-scaling.test.ts formatting cases
2026-10-10T14:13:17Z s=1956eb00 FINDING docs/assets/scaling.js initScaling fetch learn=test: docs e2e 'without the snapshot the scaling section says the measurements could not load'
2026-10-10T14:13:17Z s=1956eb00 FINDING docs/assets/scaling.js series endLabel learn=none: label collision is visual; checked by screenshot, not mechanically
2026-10-10T14:13:17Z s=1956eb00 FINDING docs/assets/site.css --ds-series-* learn=none: validator run recorded in site.css and scaling.js comments; colour choice is design, not mechanically regression-prone
2026-10-10T14:13:17Z s=1956eb00 FINDING scripts/bench-scaling.ts method learn=verifier: scripts/verify.ts fails when the snapshot stops supporting the section's flat/linear claim (mutation-tested)
2026-10-10T14:13:17Z s=1956eb00 FINDING scripts/verify.ts coverage figures learn=verifier: scripts/verify.ts docs facts
2026-10-10T14:13:17Z s=1956eb00 FINDING process hygiene: bun run dev learn=memory: .agents/MEMORY.md dev-server line
2026-10-10T15:06:52Z s=1956eb00 DONE fp=5ce2f68ff0b2 cov=98.2% paths=.github/workflows/verify.yml,.oxlintrc.json,ARCH.md,CHANGELOG.md(+30)
2026-10-10T15:06:52Z s=1956eb00 FINDING docs/assets/dom.js withCode + callers (scaling.js, devtools.js, state-dialog.js, chat.js) learn=test: unit tests for splitCalls/legendText/tooltipHtml escaping; docs e2e asserts <code> in takeaways, table, devtools and the dialog error
2026-10-10T15:06:52Z s=1956eb00 FINDING docs/index.html devtools.js excerpt learn=verifier: scripts/verify.ts excerpt check
2026-10-10T15:06:52Z s=1956eb00 FINDING playwright.config.ts webServer learn=memory: .agents/MEMORY.md dev-server line (never kill the human's server)
2026-10-10T15:40:42Z s=1956eb00 DONE fp=3250935d9b14 cov=98.2% paths=.github/workflows/verify.yml,.oxlintrc.json,ARCH.md,CHANGELOG.md(+30)
2026-10-10T15:40:42Z s=1956eb00 FINDING docs/demo/devtools.js render + docs/demo/model.js jsonTokens learn=test: unit test round-trips tokens incl. escaped quotes; docs e2e parses the highlighted snapshot back to the stored value
2026-10-10T15:40:42Z s=1956eb00 FINDING docs/index.html Without defuss card learn=test: docs e2e asserts the eight job labels
2026-10-10T15:40:42Z s=1956eb00 FINDING tests/e2e/docs.spec.ts hero title learn=none: copy edits by the human are intended; the assertion follows them
2026-10-10T15:49:13Z s=1956eb00 DONE fp=decbb9f4708e cov=98.2% paths=.github/workflows/verify.yml,.oxlintrc.json,ARCH.md,CHANGELOG.md(+30)
2026-10-10T15:49:13Z s=1956eb00 FINDING docs/index.html Without defuss card learn=none: copy decision by the human
2026-10-10T15:49:13Z s=1956eb00 FINDING docs/index.html header npm link learn=test: docs e2e asserts the npm link's href
