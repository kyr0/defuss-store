/**
 * Packed-consumer gate (`npm run test:package`). Packs the real npm tarball, installs
 * it into a fresh temp project outside this repo, then verifies runtime imports, SSR
 * isolation, declaration resolution and browser bundling against that installation —
 * never against source paths or workspace aliases. Leaves the publishable tarball in
 * artifacts/ plus artifacts/package-verification.json naming what was checked.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, rm, lstat, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const root = fileURLToPath(new URL('../', import.meta.url));
// execFileSync runs a binary without a shell; on Windows npm is only reachable as npm.cmd.
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
/** Runs a command to completion; piped output feeds the catch below, and the timeout bounds a hung npm. */
const run = (command: string, args: string[], cwd = root) => execFileSync(command, args, { cwd, encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
/** The fields of one `npm pack --json` result entry that this gate consumes. */
interface Packed { name: string; version: string; filename: string; integrity: string; shasum: string; size: number; unpackedSize: number; files: { path: string }[]; }
await mkdir(join(root, 'artifacts'), { recursive: true });
// --ignore-scripts: packing must stay inert — no lifecycle hooks (prepublishOnly is the gate itself).
const [packed] = JSON.parse(run(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', 'artifacts'])) as [Packed];
const tarball = resolve(root, 'artifacts', packed.filename);
// package.json "files" is a whitelist; prove no development directory leaked into the tarball.
assert(!packed.files.some(file => /^(?:node_modules|tests|tmp|coverage|src)\//.test(file.path)), 'Tarball contains development files');
// A private consumer outside the repo: no workspace aliases, no shared node_modules.
const consumer = await mkdtemp(join(tmpdir(), 'defuss-store-consumer-'));
// macOS tmpdir is a symlink (/var → /private/var); the metafile check below compares real paths.
const consumerReal = await realpath(consumer);
try {
  await writeFile(join(consumer, 'package.json'), JSON.stringify({ name: 'isolated-consumer', version: '1.0.0', private: true, type: 'module' }));
  run(npm, ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball], consumer);
  // A symlinked install would silently test the source tree instead of the packed artifact.
  assert(!(await lstat(join(consumer, 'node_modules/defuss-store'))).isSymbolicLink());
  await writeFile(join(consumer, 'smoke.mjs'), `
import assert from 'node:assert/strict';
// A throwing window getter turns any import-time access to window into a loud failure: SSR isolation at runtime.
Object.defineProperty(globalThis, 'window', { get() { throw Error('SSR import accessed window'); }, configurable: true });
const { createStore, computed } = await import('defuss-store');
const { createMemoryStorage } = await import('defuss-store/storage');
const { attachPersistence } = await import('defuss-store/persist');
const binding = await import('defuss-store/bind');
const browser = await import('defuss-store/browser');
assert.equal(typeof binding.bindState, 'function');
assert.equal(typeof browser.createStore, 'function');
const storage = createMemoryStorage(), a = createStore(1);
const derived = computed(a, n => n * 2);
attachPersistence(a, { key: 'x', storage, version: 1, validate: x => typeof x === 'number' });
a.set(3);
assert.equal(derived.value, 6);
// One backend, two stores: the persist entry writes for a, then hydrates b — cross-entry persistence from packed code.
const b = createStore(0);
attachPersistence(b, { key: 'x', storage, version: 1, validate: x => typeof x === 'number' });
assert.equal(b.value, 3);
a.destroy(); b.destroy();
console.log('ESM entries, cross-entry persistence, computed values and SSR isolation passed.');
`);
  console.log(run(process.execPath, ['smoke.mjs'], consumer).trim());
  // Reuse the repo's public-API type tests against the packed declarations.
  const apiTests = await readFile(join(root, 'tests/types/api.ts'), 'utf8');
  await writeFile(join(consumer, 'types.ts'), apiTests);
  // The consumer installs no devDependencies; drive this repo's pinned tsc against its files.
  const tsc = join(root, 'node_modules/typescript/bin/tsc');
  // The exports map must resolve under NodeNext and Bundler resolution; skipLibCheck off means the shipped
  // declarations are checked in full. `!` on the tuple elements appeases noUncheckedIndexedAccess.
  for (const [module, resolution] of [['NodeNext', 'NodeNext'], ['ESNext', 'Bundler']]) {
    run(process.execPath, [tsc, '--noEmit', '--strict', '--skipLibCheck', 'false', '--target', 'ES2022', '--lib', 'ES2022,DOM', '--module', module!, '--moduleResolution', resolution!, 'types.ts'], consumer);
  }
  // Core + storage + persistence must also typecheck without DOM libraries.
  await writeFile(join(consumer, 'ssr-types.ts'), "import {createStore} from 'defuss-store'; import {createMemoryStorage} from 'defuss-store/storage'; import {attachPersistence} from 'defuss-store/persist'; attachPersistence(createStore(1),{key:'x',storage:createMemoryStorage(),version:1,validate:(x):x is number=>typeof x==='number'});\n");
  run(process.execPath, [tsc, '--noEmit', '--strict', '--target', 'ES2022', '--lib', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', 'ssr-types.ts'], consumer);
  await writeFile(join(consumer, 'browser-entry.js'), "export {createStore} from 'defuss-store'; export {createMemoryStorage} from 'defuss-store/storage'; export {attachPersistence} from 'defuss-store/persist';\n");
  const result = await build({ entryPoints: [join(consumer, 'browser-entry.js')], bundle: true, platform: 'browser', format: 'esm', write: false, metafile: true });
  // Every bundle input must come from the consumer's own install — never from this repo's sources.
  assert(Object.keys(result.metafile!.inputs).every(input => resolve(input).startsWith(consumerReal)), 'Consumer resolved a source outside its packed installation');
  const report = { name: packed.name, version: packed.version, filename: packed.filename, integrity: packed.integrity, shasum: packed.shasum, size: packed.size, unpackedSize: packed.unpackedSize, files: packed.files.length, checks: ['tarball isolation', 'all ESM exports', 'cross-entry persistence', 'SSR runtime', 'NodeNext types', 'Bundler types', 'DOM-free server types', 'isolated browser bundle'] };
  await writeFile(join(root, 'artifacts/package-verification.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  // execFileSync attaches the captured streams to the thrown error; print them or CI shows a bare exit code.
  const failure = error as { stdout?: unknown; stderr?: unknown };
  if (failure.stdout) console.error(String(failure.stdout));
  if (failure.stderr) console.error(String(failure.stderr));
  throw error;
} finally { await rm(consumer, { recursive: true, force: true }); }
