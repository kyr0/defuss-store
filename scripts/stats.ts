/**
 * Measures per-entry build sizes and writes dist/stats.json, the last step of
 * `npm run build`. README points readers to this file instead of advertising guessed
 * sizes. artifactBytes is the shipped dist file as-is, which may reference shared
 * pkgroll chunks; bundledMinifiedBytes and bundledGzipBytes bundle each entry alone,
 * so shared chunks count toward that entry's real standalone cost.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';
// One measurement per package export (the ./package.json mapping excluded).
const entries = ['index', 'storage/index', 'persist/index', 'bind/index', 'browser'];
const stats: Record<string, { artifactBytes: number; bundledMinifiedBytes: number; bundledGzipBytes: number }> = {};
for (const entry of entries) {
  // write: false — measure in memory only; the shipped artifacts come from pkgroll/tsc/bundle.ts.
  const result = await build({ entryPoints: [`src/${entry}.ts`], bundle: true, minify: true, format: 'esm', platform: 'browser', target: 'es2022', write: false });
  const raw = await readFile(`dist/${entry}.js`);
  const minified = result.outputFiles![0]!.contents;
  stats[entry] = { artifactBytes: raw.length, bundledMinifiedBytes: minified.length, bundledGzipBytes: gzipSync(minified).length };
}
await writeFile('dist/stats.json', JSON.stringify(stats, null, 2) + '\n');
console.log(JSON.stringify(stats, null, 2));
