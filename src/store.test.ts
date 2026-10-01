import { describe, it, expect, vi } from 'vitest';
import { createStore, computed, jsonEquals } from './index.js';

describe('store: retained upstream behavior', () => {
  it('reads roots and nested paths, replaces roots and reports exact callback arguments', () => {
    const initial = { count: 0, user: { name: 'John' } };
    const store = createStore(initial);
    const listener = vi.fn();
    store.subscribe(listener);
    expect(listener).not.toHaveBeenCalled();
    expect(store.value).toBe(initial);
    expect(store.get()).toBe(initial);
    expect(store.getRaw()).toBe(initial);
    expect(store.get('')).toBe(initial);
    expect(store.get('user.name')).toBe('John');
    store.set('user.name', 'Jane');
    expect(listener).toHaveBeenLastCalledWith({ count: 0, user: { name: 'Jane' } }, initial, 'user.name');
    const previous = store.value;
    store.set({ count: 1, user: { name: 'Sam' } });
    expect(listener).toHaveBeenLastCalledWith(store.value, previous, undefined);
    store.reset();
    expect(store.value).toBe(initial);
  });
  it('defaults to Object.is; JSON equality is explicit', () => {
    const normal = createStore({ count: 0 });
    const deep = createStore({ count: 0 }, { equals: jsonEquals });
    const a = vi.fn(), b = vi.fn();
    normal.subscribe(a); deep.subscribe(b);
    normal.set({ count: 0 }); deep.set({ count: 0 });
    expect(a).toHaveBeenCalledOnce(); expect(b).not.toHaveBeenCalled();
    normal.set(normal.value); expect(a).toHaveBeenCalledOnce();
  });
  it('handles scalar, function, NaN and signed-zero roots without updater ambiguity', () => {
    const scalar = createStore<number>(NaN); const spy = vi.fn(); scalar.subscribe(spy);
    scalar.set(NaN); expect(spy).not.toHaveBeenCalled();
    scalar.set(0); scalar.set(-0); expect(spy).toHaveBeenCalledTimes(2);
    const fn = () => 3; const store = createStore(fn); const next = () => 4;
    store.set(next); expect(store.value).toBe(next);
  });
  it('updates from current state and respects a root comparator for path updates', () => {
    const store = createStore({ count: 1 });
    store.update(value => ({ count: value.count + 1 })); expect(store.value.count).toBe(2);
    const fixed = createStore({ count: 1 }, { equals: () => true });
    fixed.set('count', 5); expect(fixed.value.count).toBe(1);
    expect(() => store.update(() => { throw new Error('updater'); })).toThrow('updater');
    expect(store.value.count).toBe(2);
  });
});
describe('regressions and subscriptions', () => {
  it('distinguishes root strings, undefined path deletion and explicit null/undefined reset', () => {
    const object = createStore({ field: 1 }); object.set('field', undefined);
    expect(object.value).toEqual({});
    const root = createStore<string | undefined>('initial'); root.set('next'); expect(root.value).toBe('next');
    root.reset(undefined); expect(root.value).toBeUndefined(); root.reset(); expect(root.value).toBe('initial');
    const nullable = createStore<number | null>(1); nullable.reset(null); expect(nullable.value).toBeNull();
  });
  it('does not skip the next listener after self-unsubscribe', () => {
    const store = createStore(0); const seen: string[] = [];
    const off = store.subscribe(() => { seen.push('a'); off(); });
    store.subscribe(() => seen.push('b')); store.set(1); store.set(2);
    expect(seen).toEqual(['a', 'b', 'b']); off(); off();
  });
  it('skips removed registrations and defers added listeners to later commits', () => {
    const store = createStore(0); const b = vi.fn(), c = vi.fn();
    let added = false;
    store.subscribe(() => { offB(); if (!added) { added = true; store.subscribe(c); } });
    const offB = store.subscribe(b);
    store.set(1); expect(b).not.toHaveBeenCalled(); expect(c).not.toHaveBeenCalled();
    store.set(2); expect(c).toHaveBeenCalledOnce();
  });
  it('treats duplicate callbacks as separate registrations', () => {
    const store = createStore(0); const fn = vi.fn();
    const a = store.subscribe(fn); store.subscribe(fn); a(); store.set(1);
    expect(fn).toHaveBeenCalledOnce();
  });
  it('queues reentrant transitions without changing their values', () => {
    const store = createStore(0); const seen: number[][] = [];
    store.subscribe(value => { if (value === 1) store.set(2); });
    store.subscribe((value, old) => seen.push([old!, value, store.value]));
    store.set(1); expect(seen).toEqual([[0, 1, 2], [1, 2, 2]]);
  });
  it('finishes every queued listener before throwing an aggregate', () => {
    const store = createStore(0); const spy = vi.fn();
    store.subscribe(value => { if (value === 1) store.set(2); throw new Error(`bad ${value}`); });
    store.subscribe(spy);
    expect(() => store.set(1)).toThrow(AggregateError);
    expect(spy).toHaveBeenCalledTimes(2); expect(store.value).toBe(2);
  });
  it('supports immediate and selective subscriptions without unrelated notifications', () => {
    const store = createStore({ count: 1, label: 'a' }); const spy = vi.fn();
    const off = store.subscribe(value => value.count, spy, { immediate: true });
    expect(spy).toHaveBeenLastCalledWith(1, undefined, undefined);
    store.set('label', 'b'); expect(spy).toHaveBeenCalledOnce();
    store.set('count', 2); expect(spy).toHaveBeenLastCalledWith(2, 1, 'count');
    off(); store.set('count', 3); expect(spy).toHaveBeenCalledTimes(2);
    const all = vi.fn(); store.subscribe(all, { immediate: true });
    expect(all).toHaveBeenLastCalledWith(store.value, undefined, undefined);
  });
  it('supports selector comparators and cleans up failed immediate subscriptions', () => {
    const store = createStore({ n: 1 }); const spy = vi.fn();
    store.subscribe(value => ({ n: value.n }), spy, { equals: (a, b) => a.n === b.n });
    store.set({ n: 1 }); expect(spy).not.toHaveBeenCalled();
    const bad = vi.fn(() => { throw Error('immediate'); });
    expect(() => store.subscribe(bad, { immediate: true })).toThrow('immediate');
    expect(() => store.subscribe(value => value.n, bad, { immediate: true })).toThrow('immediate');
    store.set({ n: 2 }); expect(bad).toHaveBeenCalledTimes(2);
  });
  it('destroys idempotently, runs all cleanup and rejects new activity', () => {
    const store = createStore(1); const cleanup = vi.fn();
    store.onDestroy(() => { throw Error('cleanup'); }); store.onDestroy(cleanup);
    expect(() => store.destroy()).toThrow(AggregateError); expect(cleanup).toHaveBeenCalledOnce();
    store.destroy(); expect(store.value).toBe(1); expect(store.destroyed).toBe(true);
    expect(() => store.set(2)).toThrow('destroyed');
    expect(() => store.subscribe(() => {})).toThrow('destroyed');
    expect(() => store.onDestroy(() => {})).toThrow('destroyed');
  });
  it('does not deliver to listeners after destruction during a callback', () => {
    const store = createStore(0); const spy = vi.fn();
    store.subscribe(() => store.destroy()); store.subscribe(spy); store.set(1);
    expect(spy).not.toHaveBeenCalled();
  });
});
describe('computed', () => {
  it('projects one or multiple explicitly typed sources', () => {
    const a = createStore(2), b = createStore(3);
    const doubled = computed(a, x => x * 2), sum = computed([a, b] as const, (x, y) => x + y);
    expect(doubled.value).toBe(4); expect(sum.value).toBe(5);
    const spy = vi.fn(); sum.subscribe(spy); a.set(4);
    expect(sum.value).toBe(7); expect(doubled.value).toBe(8);
    expect(spy).toHaveBeenLastCalledWith(7, 5, undefined);
    expect('set' in sum).toBe(false); expect('reset' in sum).toBe(false);
  });
  it('does not notify unchanged projections and releases all sources', () => {
    const source = createStore({ count: 1, label: 'a' }); const project = vi.fn(v => v.count * 2);
    const derived = computed(source, project), listener = vi.fn(); derived.subscribe(listener);
    source.set('label', 'b'); expect(listener).not.toHaveBeenCalled();
    derived.destroy(); const calls = project.mock.calls.length;
    source.set('count', 3); expect(project).toHaveBeenCalledTimes(calls); expect(derived.value).toBe(2);
  });
  it('retains its last successful value after a projection failure, then recovers', () => {
    const source = createStore(1); const derived = computed(source, x => { if (x === 2) throw Error('project'); return x * 2; });
    expect(() => source.set(2)).toThrow(AggregateError); expect(derived.value).toBe(2);
    source.set(3); expect(derived.value).toBe(6);
    source.destroy(); expect(derived.destroyed).toBe(true);
    expect(() => computed(source, x => x)).toThrow('destroyed');
  });
  it('subscribes to duplicate source instances only once', () => {
    const source = createStore(1); const project = vi.fn((a: number, b: number) => a + b);
    const derived = computed([source, source] as const, project);
    source.set(2); expect(project).toHaveBeenCalledTimes(2); expect(derived.value).toBe(4);
  });
});
