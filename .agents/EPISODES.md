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
