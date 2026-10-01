/**
 * Release-gate assertions over the built package; the final step of `npm run check`
 * (and prepublishOnly). Run from the repo root after build, stats and test:package —
 * paths here are cwd-relative. The first violation throws an AssertionError and fails
 * the gate.
 */
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
const pkg = JSON.parse(await readFile('package.json', 'utf8')) as { private?: unknown; name: string; sideEffects: boolean; dependencies?: Record<string, string>; exports: Record<string, string | Record<string, string>> };
// Publication invariants: public package, tree-shakeable (sideEffects: false), zero runtime dependencies.
assert.equal(pkg.private, undefined);
assert.equal(pkg.name, 'defuss-store');
assert.equal(pkg.sideEffects, false);
assert.equal(Object.keys(pkg.dependencies ?? {}).length, 0);
// Every target in the exports map must exist on disk — catches a missing build output before packing.
for (const mapping of Object.values(pkg.exports)) {
  for (const path of typeof mapping === 'string' ? [mapping] : Object.values(mapping)) await access(path);
}
// Docs and license ship in the tarball; the lockfile pins the reproducible development install.
for (const file of ['README.md', 'ARCH.md', 'RELEASE.md', 'CHANGELOG.md', 'LICENSE', 'package-lock.json']) await access(file);
const provenance = JSON.parse(await readFile('tests/fixtures/vendor/provenance.json', 'utf8')) as { files: { fixture: string; sha256: string }[] };
// The browser suite validates against pinned upstream defuss-shadcn code; any local fixture edit must fail the gate.
for (const fixture of provenance.files) {
  assert.equal(createHash('sha256').update(await readFile(fixture.fixture)).digest('hex'), fixture.sha256, `Upstream fixture changed: ${fixture.fixture}`);
}
const result = await build({ entryPoints: ['dist/index.js'], bundle: true, write: false, metafile: true, platform: 'neutral', format: 'esm' });
// Layer boundary on the built core: no optional-layer inputs, no browser globals. The word-boundary scan is a
// heuristic guard; package-tests.ts proves SSR import safety at runtime.
assert(!Object.keys(result.metafile!.inputs).some(path => /(?:storage|persist|bind)\//.test(path)), 'Core must not import optional layers');
const js = result.outputFiles![0]!.text;
assert(!/\b(?:window|document|localStorage|sessionStorage|MutationObserver)\b/.test(js), 'Core must not access browser globals');
const stats = JSON.parse(await readFile('dist/stats.json', 'utf8')) as Record<string, { bundledGzipBytes: number; bundledMinifiedBytes: number }>;
// Sizes must look measured, not hand-written: nonzero, and gzip smaller than minified for real bundles.
for (const value of Object.values(stats)) assert(value.bundledGzipBytes > 0 && value.bundledMinifiedBytes >= value.bundledGzipBytes);
console.log('Package metadata, public exports, upstream fixture integrity, optional-layer isolation and measured artifacts verified.');
