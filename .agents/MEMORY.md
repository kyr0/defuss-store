# Agent memory

<!-- One tagged line per durable fact NOT derivable from code, git or docs:
- VERIFIED[scope] fact BC evidence
- HYPOTHESIS[scope] claim; falsifier=`cmd`
- UNKNOWN[scope] gap BC missing evidence
Replace stale lines instead of appending. Mechanizable lessons belong in tests or .agents/VERIFY.py.
Budget 4 KiB (`vae.py doctor --repo .`); entries are injected at session start. -->
- VERIFIED[dev-server] stopping a background `bun run dev` leaves its `node … scripts/serve.ts` child on 4178 (kill the child); the human may run `bun run dev` themselves - never kill that one, local Playwright reuses it (reuseExistingServer off only in CI); pick probe ports with `lsof -iTCP:<port> -sTCP:LISTEN` first, other local projects' servers use nearby ports BC 2026-10-10 PIDs survived TaskStop; a human dev server held 4178
