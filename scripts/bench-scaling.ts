/**
 * Scaling benchmark: how the cost of one operation grows with path depth, list length and subscriber count.
 * It measures the built dist/ (the code that ships), not src/, so run it after `npm run build`.
 * Each point is the median of ROUNDS × PER_ROUND timings; one timing repeats the operation until it took at
 * least SAMPLE_MS, so timer resolution and loop overhead stay small against the work. Calibration doubles the
 * repetitions and doubles as the warm-up. The sizes of a series are timed interleaved, round by round, so slow
 * drift (JIT state, heat) spreads over all of them instead of skewing one; a forced GC before each timing batch
 * (node --expose-gc) keeps one size's garbage out of the next. VERIFIED: with one point measured after another,
 * three runs differed by up to 39 % at single points; quartiles are kept so the page shows the spread too.
 * Writes output/bench-scaling.json, or the file given as `--out <path>` (`npm run bench:docs` refreshes the
 * snapshot the docs site charts: docs/assets/bench.json). The numbers describe the machine they ran on; the file
 * records which.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { arch, cpus, platform } from 'node:os';
import { dirname } from 'node:path';

type Core = typeof import('../src/index.js');
type Storage = typeof import('../src/storage/index.js');
type Persist = typeof import('../src/persist/index.js');
// Loaded by URL so the type checker reads src/ while Node runs the built dist/.
const load = <T>(entry: string) => import(new URL(`../dist/${entry}`, import.meta.url).href) as Promise<T>;
const { createStore } = await load<Core>('index.js');
const { createMemoryStorage } = await load<Storage>('storage/index.js');
const { attachPersistence } = await load<Persist>('persist/index.js');

const ROUNDS = 5;
const PER_ROUND = 3;
const SAMPLE_MS = 15;
type Point = { x: number; ns: number; q1: number; q3: number; repetitions: number };
type Series = { id: string; label: string; points: Point[] };
type Chart = { id: string; x: string; series: Series[] };

// Results land here so the engine cannot drop an operation whose value is never used.
const sink: unknown[] = Array.from({ length: 8 });
function time(operation: () => unknown, repetitions: number): number {
  const start = process.hrtime.bigint();
  for (let index = 0; index < repetitions; index++) sink[index & 7] = operation();
  return Number(process.hrtime.bigint() - start);
}
const quantile = (sorted: number[], q: number) => {
  const at = (sorted.length - 1) * q;
  const low = Math.floor(at);
  return sorted[low]! + (sorted[Math.ceil(at)]! - sorted[low]!) * (at - low);
};
const gc = () => (globalThis as { gc?: () => void }).gc?.();
function calibrate(operation: () => unknown): number {
  let repetitions = 1;
  while (time(operation, repetitions) < SAMPLE_MS * 1e6) repetitions *= 2;
  return repetitions;
}
function series(id: string, label: string, xs: number[], setup: (x: number) => () => unknown): Series {
  const operations = xs.map(setup);
  const repetitions = operations.map(calibrate);
  const samples = xs.map((): number[] => []);
  for (let round = 0; round < ROUNDS; round++) {
    operations.forEach((operation, i) => {
      gc();
      for (let sample = 0; sample < PER_ROUND; sample++) samples[i]!.push(time(operation, repetitions[i]!) / repetitions[i]!);
    });
  }
  const tenth = (ns: number) => Math.round(ns * 10) / 10;
  const points = xs.map((x, i) => {
    const sorted = samples[i]!.sort((a, b) => a - b);
    return { x, ns: tenth(quantile(sorted, 0.5)), q1: tenth(quantile(sorted, 0.25)), q3: tenth(quantile(sorted, 0.75)), repetitions: repetitions[i]! };
  });
  console.log(`${id.padEnd(22)} ${points.map((p) => `${p.x}:${p.ns}ns`).join('  ')}`);
  return { id, label, points };
}

let counter = 0;
// Depth: a path of `depth` segments, `child.child.….value`, into a store nested that deep.
const DEPTHS = [1, 2, 4, 8, 16, 32, 64, 128, 256];
function nested(depth: number) {
  let value: Record<string, unknown> = { value: 0 };
  for (let level = 1; level < depth; level++) value = { child: value };
  return { store: createStore(value), path: [...Array<string>(depth - 1).fill('child'), 'value'].join('.') };
}
// Length: one list of `length` items; reads and writes address the last one.
const LENGTHS = [10, 100, 1_000, 10_000, 100_000];
const list = (length: number) => ({ items: Array.from({ length }, (_, id) => ({ id, text: `item ${id}` })) });
// Subscribers: `count` listeners or selectors on one store.
const COUNTS = [1, 10, 100, 1_000, 10_000];

const charts: Chart[] = [
  {
    id: 'depth', x: 'path segments', series: [
      series('depth-get', 'get(path)', DEPTHS, (depth) => { const { store, path } = nested(depth); return () => store.get(path); }),
      series('depth-set', 'set(path, value)', DEPTHS, (depth) => { const { store, path } = nested(depth); return () => store.set(path, ++counter); }),
    ],
  },
  {
    id: 'length', x: 'list items', series: [
      series('length-get', 'get(items[last].text)', LENGTHS, (length) => {
        const store = createStore(list(length));
        const path = `items[${length - 1}].text`;
        return () => store.get(path);
      }),
      series('length-set', 'set(items[last].text, value)', LENGTHS, (length) => {
        const store = createStore(list(length));
        const path = `items[${length - 1}].text`;
        return () => store.set(path, `text ${++counter}`);
      }),
      series('length-persist', 'set(…) + persistence to memory storage', LENGTHS, (length) => {
        const store = createStore(list(length));
        // A trivial validator, so the time is the library's: envelope check and JSON encoding of the whole value.
        attachPersistence(store, { key: 'bench', storage: createMemoryStorage(), version: 1, validate: (value): value is ReturnType<typeof list> => typeof value === 'object' && value !== null });
        const path = `items[${length - 1}].text`;
        return () => store.set(path, `text ${++counter}`);
      }),
    ],
  },
  {
    id: 'subscribers', x: 'subscribers', series: [
      series('subscribers-all', 'set() calls every listener', COUNTS, (count) => {
        const store = createStore(0);
        let calls = 0;
        for (let index = 0; index < count; index++) store.subscribe(() => { calls++; });
        return () => { store.set(++counter); return calls; };
      }),
      series('subscribers-selected', 'set() with selectors, one selection changes', COUNTS, (count) => {
        const store = createStore({ hot: 0, cold: 0 });
        let calls = 0;
        for (let index = 0; index < count; index++) store.subscribe(index === 0 ? (value) => value.hot : (value) => value.cold, () => { calls++; });
        return () => { store.set('hot', ++counter); return calls; };
      }),
    ],
  },
];

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { name: string; version: string };
const result = {
  schema: 1,
  package: `${pkg.name}@${pkg.version}`,
  measuredAt: new Date().toISOString(),
  environment: { node: process.version, os: `${platform()} ${arch()}`, cpu: cpus()[0]?.model.trim() ?? 'unknown' },
  method: `median of ${ROUNDS * PER_ROUND} timings per point in ${ROUNDS} interleaved rounds; each timing repeats the operation for at least ${SAMPLE_MS} ms; dist/ build`,
  charts,
};
const outIndex = process.argv.indexOf('--out');
const out = outIndex > 0 ? process.argv[outIndex + 1]! : 'output/bench-scaling.json';
await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(result, null, 1) + '\n');
console.log(`Wrote ${out}`);
