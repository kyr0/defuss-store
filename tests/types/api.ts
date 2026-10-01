import { computed, createStore } from 'defuss-store';
import type { StorageBackend } from 'defuss-store/storage';
import { createMemoryStorage } from 'defuss-store/storage';
import { attachPersistence } from 'defuss-store/persist';
import { bindState, type ComponentApi } from 'defuss-store/bind';
const state = createStore({ count: 1, label: 'counter' });
const number: number = state.get('count');
state.subscribe(value => value.count, (next, previous) => {
  const a: number = next, b: number | undefined = previous;
  void [a, b];
});
const derived = computed(state, value => value.count * 2);
const label = createStore('items');
const joined = computed([state, label] as const, (value, text) => `${value.count} ${text}`);
const output: string = joined.value;
// @ts-expect-error Derived stores have no write API.
derived.set(4);
// @ts-expect-error Root writes must match T.
state.set({ count: 'wrong', label: 'counter' });
// @ts-expect-error Functional updates must return T.
state.update(() => 'wrong');
// @ts-expect-error Unknown paths are not falsely typed.
const unsafe: number = state.get('nested.unknown');
// @ts-expect-error Backends are synchronous.
const asyncBackend: StorageBackend = { getItem: async () => null, setItem() {}, removeItem() {} };
const numeric = createStore<number | null>(1);
numeric.reset(null);
attachPersistence(numeric, { key: 'a', storage: createMemoryStorage(), version: 1, validate: (x): x is number | null => x === null || typeof x === 'number' });
declare const element: HTMLElement & { api: ComponentApi };
const binding = bindState(element, state, {
  select: value => value.count,
  toState: count => ({ name: 'default', config: { count } }),
  fromState: (component, current) => ({ ...current, count: Number(component.config.count) }),
});
binding.pull(); binding.push(); binding();
void [number, output, unsafe, asyncBackend];
