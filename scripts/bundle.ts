/**
 * Emits dist/browser.js and dist/browser.min.js, the standalone browser modules.
 * Runs after pkgroll and tsc in `npm run build`, overwriting pkgroll's chunk-split
 * browser entry with self-contained bundles; the two passes differ only in
 * minification, both with source maps. Target es2022 is the documented minimum.
 */
import { build } from 'esbuild';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
// Bundle, rather than externalize, the browser entry: works without a bundler
// or import map. TypeScript emits declarations with the original layer boundaries.
await build({
  entryPoints: [resolve(root, 'src/browser.ts')], outfile: resolve(root, 'dist/browser.js'),
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022', sourcemap: true,
});
await build({
  entryPoints: [resolve(root, 'src/browser.ts')], outfile: resolve(root, 'dist/browser.min.js'),
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, sourcemap: true,
});
