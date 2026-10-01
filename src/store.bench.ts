import { test } from 'vitest';
import { createStore } from './store.js';
import { createMemoryStorage } from './storage/memory.js';
import { attachPersistence } from './persist/persist.js';

test('store operations', async ({ bench }) => {
  const store = createStore({ count: 0, nested: { text: 'hello' } });
  const observed = createStore(0);
  for (let index = 0; index < 10; index++) observed.subscribe(() => {});
  const selected = createStore({ hit: 0, miss: 0 });
  for (let index = 0; index < 10; index++) selected.subscribe(value => index ? value.miss : value.hit, () => {});
  const list = createStore({ items: Array.from({ length: 1000 }, (_, id) => ({ id, done: false })) });
  const persisted = createStore(0);
  attachPersistence(persisted, {
    key: 'benchmark', storage: createMemoryStorage(), version: 1,
    validate: (value): value is number => typeof value === 'number',
  });
  const items = Array.from({ length: 1000 }, (_, id) => ({ id, name: `item ${id}`, tags: ['a', 'b'] }));
  const document = createStore({ items });
  attachPersistence(document, {
    key: 'document', storage: createMemoryStorage(), version: 1,
    validate: (value): value is { items: typeof items } => typeof value === 'object' && value !== null,
  });
  const run = { time: 100, warmupTime: 50, iterations: 16 };
  let id = 0;
  await bench('root read', () => { store.get(); }).run(run);
  await bench('nested path read', () => { store.get('nested.text'); }).run(run);
  await bench('no-op replacement', () => { store.setRaw(store.value); }).run(run);
  await bench('immutable path update', () => { store.set('count', store.value.count + 1); }).run(run);
  await bench('dynamic path update (1000 distinct paths)', () => { list.set(`items[${id++ % 1000}].done`, id % 2 === 0); }).run(run);
  await bench('notify ten listeners', () => { observed.set(observed.value + 1); }).run(run);
  await bench('ten selectors, one changed', () => { selected.set('hit', selected.value.hit + 1); }).run(run);
  await bench('persist to memory', () => { persisted.set(persisted.value + 1); }).run(run);
  await bench('persist 1000 items to memory', () => { document.set({ items: items.slice() }); }).run(run);
  store.destroy(); observed.destroy(); selected.destroy(); list.destroy(); persisted.destroy(); document.destroy();
});
