import { describe, it, expect } from 'vitest';
import { createStore } from './store.js';
import { parsePath, getByPath, setByPath } from './path.js';

describe('immutable paths (ported upstream scenarios)', () => {
  it.each(['a.b.c', 'users[0].name', 'users.0.name', 'matrix[0][1]', '[0].a'])('parses %s and roundtrips a new value', path => {
    const root = path.startsWith('[') ? [] : {};
    const next = setByPath(root, path, 'value');
    expect(getByPath(next, path)).toBe('value'); expect(getByPath(root, path)).toBeUndefined();
  });
  it('creates nested arrays, reads missing values and preserves reference integrity', () => {
    expect(parsePath('users[0].settings[1].x')).toEqual(['users', 0, 'settings', 1, 'x']);
    expect(setByPath({}, 'items.0.name', 'A')).toEqual({ items: [{ name: 'A' }] });
    const keep = { stable: true }, root = { keep, values: [{ n: 1 }, { n: 2 }] };
    const next = setByPath(root, 'values[0].n', 3);
    expect(next.keep).toBe(keep); expect(next.values[1]).toBe(root.values[1]);
    expect(next.values).not.toBe(root.values); expect(root.values[0]!.n).toBe(1);
    expect(getByPath(root, 'absent.child')).toBeUndefined();
    expect(getByPath({ n: null }, 'n.a')).toBeUndefined();
    expect(getByPath(Object.create({ n: 1 }), 'n')).toBeUndefined();
  });
  it('deletes object keys and splices array elements; missing removal is a no-op', () => {
    const root = { a: 1, arr: ['a', 'b', 'c'] };
    expect(setByPath(root, 'a', undefined)).toEqual({ arr: ['a', 'b', 'c'] });
    expect(setByPath(root, 'arr[1]', undefined)).toEqual({ a: 1, arr: ['a', 'c'] });
    expect(setByPath(root, 'missing.nested', undefined)).toBe(root);
    expect(setByPath(root, 'arr[99]', undefined)).toBe(root);
  });
  it('returns the same root for unchanged leaves and supports numeric dot indices', () => {
    const root = { a: { b: 1 }, arr: [2] };
    expect(setByPath(root, 'a.b', 1)).toBe(root);
    expect(setByPath(root, 'arr.0', 3)).toEqual({ a: { b: 1 }, arr: [3] });
    const store = createStore(root); store.remove('a.b'); expect(store.value.a).toEqual({});
  });
  it.each(['', '.a', 'a.', 'a..b', 'a.[0]', 'a[-1]', 'a[1.2]', 'a[01]', 'a[]', 'a[0]b', 'a]', 'a[', '__proto__.x', 'a.constructor.x', 'prototype.x', 'a[4294967295]'])('rejects malformed/unsafe path %s', path => {
    expect(() => setByPath({}, path, 1)).toThrow();
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
  it('does not coerce class instances or primitive intermediate values into records', () => {
    expect(() => setByPath({ a: new Date() }, 'a.x', 1)).toThrow('plain objects');
    expect(() => setByPath({ a: 1 }, 'a.x', 1)).toThrow('plain objects');
    expect(() => setByPath({ a: [] }, 'a.foo', 1)).toThrow('indices');
    expect(setByPath({ a: null }, 'a.x', 1)).toEqual({ a: { x: 1 } });
  });
  it('defines own data properties without reaching inherited setters', () => {
    const trap = { set() { throw Error('inherited setter'); }, configurable: true };
    let added, appended, replaced;
    // Polluted only around the writes, at an index no internal array reaches: assertions would hit the trap.
    Object.defineProperty(Object.prototype, 'polluted', trap); Object.defineProperty(Array.prototype, '5', trap);
    try {
      added = setByPath({ list: [0] }, 'polluted', 1);
      appended = setByPath(added, 'list[5]', 2); replaced = setByPath(added, 'list[0]', 3);
    } finally { delete (Object.prototype as Record<string, unknown>).polluted; delete (Array.prototype as unknown as Record<string, unknown>)[5]; }
    expect(Object.getOwnPropertyDescriptor(added, 'polluted')).toEqual({ value: 1, writable: true, enumerable: true, configurable: true });
    expect(appended.list[5]).toBe(2); expect(appended.list).toHaveLength(6); expect(replaced.list).toEqual([3]);
  });
  it('keeps unrelated references and key order for object, array and null-prototype copies', () => {
    const shared = { n: 1 }, record = Object.assign(Object.create(null) as Record<string, unknown>, { a: shared, b: 2 });
    const next = setByPath({ record, list: [shared, 1] }, 'record.a', 5);
    expect(Object.keys(next.record)).toEqual(['a', 'b']); expect(Object.getPrototypeOf(next.record)).toBe(Object.prototype);
    expect(setByPath(next, 'list[1]', 2).list[0]).toBe(shared); expect(setByPath(next, 'list[0]', undefined).list).toEqual([1]);
  });
});
