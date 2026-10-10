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
const pkg = JSON.parse(await readFile('package.json', 'utf8')) as { private?: unknown; name: string; version: string; sideEffects: boolean; dependencies?: Record<string, string>; exports: Record<string, string | Record<string, string>> };
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
for (const file of ['README.md', 'ARCH.md', 'CHANGELOG.md', 'LICENSE', 'package-lock.json']) await access(file);
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

// The docs site (docs/, served by GitHub Pages) states facts about this build; each one is checked here.
// VERIFIED: changing one size, the version or one excerpt line in docs/index.html made the matching check fail.
// The site runs the shipped bundle: byte copies made by scripts/docs.ts at the end of the build.
for (const file of ['browser.js', 'browser.js.map']) {
  assert((await readFile(`dist/${file}`)).equals(await readFile(`docs/assets/defuss-store/${file}`)), `docs/assets/defuss-store/${file} differs from dist/${file}: run npm run build`);
}
const pages = { 'docs/index.html': await readFile('docs/index.html', 'utf8'), 'docs/demo/index.html': await readFile('docs/demo/index.html', 'utf8') };
const landing = pages['docs/index.html'];
// Every size on the page is a dist/stats.json number: data-stat="entry.field", formatted per data-unit.
const format = (bytes: number, unit: string | undefined) => unit === 'kB' ? `${(bytes / 1000).toFixed(1)}&nbsp;kB` : unit === 'B' ? `${bytes.toLocaleString('en-US')} B` : String(bytes);
const statTags = [...landing.matchAll(/data-stat="([^"]+)"(?: data-unit="([^"]+)")?>([^<]*)</g)];
assert(statTags.length >= 10, 'Expected the landing page to cite dist/stats.json');
for (const [, ref, unit, text] of statTags) {
  const [entry, field] = [ref!.slice(0, ref!.lastIndexOf('.')), ref!.slice(ref!.lastIndexOf('.') + 1)] as [string, 'bundledGzipBytes'];
  const value = (stats[entry] as Record<string, number> | undefined)?.[field];
  assert(typeof value === 'number', `Unknown stat ${ref}`);
  assert.equal(text, format(value, unit), `docs/index.html: ${ref} shows ${text}, dist/stats.json says ${value}`);
}
// Coverage: the page shows the unit-test coverage report's percentages, rounded down (make coverage runs first).
const coverage = JSON.parse(await readFile('coverage/coverage-summary.json', 'utf8').catch(() => { throw new Error('coverage/coverage-summary.json missing: run npm run test:coverage before verify'); })) as { total: Record<string, { pct: number }> };
const coverageTags = [...landing.matchAll(/data-coverage="(lines|branches)">([^<]*)</g)];
assert(coverageTags.length >= 2, 'Expected the landing page to cite line and branch coverage');
for (const [, metric, text] of coverageTags) assert.equal(text, String(Math.floor(coverage.total[metric!]!.pct)), `docs/index.html: ${metric} coverage shows ${text} %, the report says ${coverage.total[metric!]!.pct} %`);
// The benchmark snapshot backs the section's static claim: each cost grows with what it touches and with nothing
// else - reads are flat in list length, every other series is linear, none is superlinear.
const { exponent, shape } = await import('../docs/assets/scaling.js') as typeof import('../docs/assets/scaling.js');
const bench = JSON.parse(await readFile('docs/assets/bench.json', 'utf8')) as { charts: { id: string; series: { id: string; points: { x: number; ns: number; q1: number; q3: number }[] }[] }[] };
for (const chart of bench.charts) {
  for (const series of chart.series) {
    assert(series.points.length >= 5 && series.points.every((p, i, all) => p.ns > 0 && p.q1 <= p.ns && p.ns <= p.q3 && (i === 0 || all[i - 1]!.x < p.x)), `docs/assets/bench.json: malformed series ${series.id}`);
    assert.equal(shape(exponent(series.points)), series.id === 'length-get' ? 'flat' : 'linear', `docs/assets/bench.json: ${series.id} no longer grows as the scaling section says`);
  }
}
// Versions: the badges and the pinned jsDelivr URLs name the version in package.json.
for (const [, text] of landing.matchAll(/data-version>([^<]*)</g)) assert.equal(text, `v${pkg.version}`, 'docs/index.html shows a stale version');
for (const [, version] of landing.matchAll(/defuss-store@([^/'"]+)\//g)) assert.equal(version, pkg.version, 'docs/index.html links a stale defuss-store version');
// Code excerpts are real: every line of a pre[data-source] exists in that file ('// …' marks a gap).
const decode = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const excerpts = [...landing.matchAll(/<pre data-tab="[^"]+" data-source="([^"]+)"[^>]*><code>(.*?)<\/code><\/pre>/gs)];
assert(excerpts.length > 0, 'Expected demo source excerpts on the landing page');
for (const [, source, code] of excerpts) {
  const lines = new Set((await readFile(`docs/${source}`, 'utf8')).split('\n'));
  for (const [, line] of code!.matchAll(/<span>((?:(?!<span>).|<span[^>]*>[^<]*<\/span>)*?)<\/span>(?=<span>|$)/gs)) {
    const text = decode(line!);
    assert(text.trim() === '// …' || lines.has(text), `docs/index.html excerpt of ${source} has a line that is not in the file: ${text}`);
  }
}
// Third-party assets load from an exact version with Subresource Integrity, in the pages and in the docs scripts.
for (const [file, html] of Object.entries(pages)) {
  for (const [tag] of html.matchAll(/<(?:script|link)\b[^>]*https:\/\/[^>]*>/g)) {
    assert(/@\d+\.\d+\.\d+\//.test(tag) && /integrity="sha384-/.test(tag) && /crossorigin="anonymous"/.test(tag), `${file}: unpinned external asset ${tag}`);
  }
}
for (const file of ['docs/assets/scaling.js']) {
  const source = await readFile(file, 'utf8');
  for (const [url] of source.matchAll(/https:\/\/cdn\.jsdelivr\.net\/npm\/[^'"`\s]+/g)) assert(/@\d+\.\d+\.\d+\//.test(url) && /sha384-/.test(source), `${file}: unpinned external asset ${url}`);
}
console.log('Package metadata, public exports, upstream fixture integrity, optional-layer isolation, measured artifacts and docs facts verified.');
