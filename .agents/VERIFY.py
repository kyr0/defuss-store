"""Project-local verifier policy. Agents MAY extend it; every gate executes it fail-closed."""

CONFIG = {
    "coverage_min": 60,
    "lint_command": None,          # None → `make lint` (uv run ruff check . | bunx oxlint --deny-warnings).
    "test_command": None,          # None → `make test`. Commands run in the repo root.
    "coverage_command": None,      # None → `make coverage`; output needs `TOTAL <n>%` or an `All files |…|` table.
    "integration_commands": [],    # [] → `make integration` if present.
    "e2e_commands": [],            # [] → `make e2e`: build + consume the publishable artifact.
    "timeout_s": 180,
    "layout": True,                # Makefile verbs + gitignored var/log/ and tmp/.
    "toolchain": True,             # new (sub)projects start on bun (JS/TS) / uv (Python): newly added npm/yarn/pnpm/poetry/pipenv/pdm/pip lockfiles fail.
}

# Deterministic invariants only; no semantic guesses.
# kinds: command | file_exists | contains | regex | not_regex
# scope: "path" = one exact file; "glob" = every changed code file matching (fnmatch).
RULES = [{
    "id": "tests.no-mocks",
    "kind": "not_regex",
    "glob": "*",
    # Every alternative contains an escape, so this file never matches its own pattern.
    "pattern": r"unittest\.mock|from\s+unittest\s+import\s+mock|MagicMock\(|mock\.patch|mocker\.|"
               r"jest\.(?:mock|fn|spyOn)\(|vi\.(?:mock|fn|spyOn)\(|sinon\.|gomock\.|mock\.Mock\b|Mockito\.|@Mock\s|mockk\(",
    "claim": "tests exercise real subsystems, not mock frameworks",
}, {
    # Plain oxlint exits 0 on findings, so without the flag `npm run check` can never fail on lint.
    "id": "lint.deny-warnings",
    "kind": "contains",
    "path": "package.json",
    "text": "oxlint --deny-warnings",
    "claim": "the lint script fails on oxlint warnings",
}, {
    # Browser specs load dist/; an e2e run without a build verifies a stale artifact.
    "id": "e2e.builds-artifact",
    "kind": "regex",
    "path": "Makefile",
    "pattern": r"^e2e:.*\bbuild\b",
    "claim": "make e2e builds the publishable artifact before consuming it",
}, {
    # The public API type tests (tests/types) run only under typecheck, which no default gate verb covers.
    "id": "types.public-api",
    "kind": "command",
    "command": "make typecheck",
    "claim": "source and public API type tests pass",
}]
