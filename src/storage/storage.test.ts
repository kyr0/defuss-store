import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorage, createWebStorage, jsonCodec } from './index.js';
afterEach(() => vi.unstubAllGlobals());

describe('storage', () => {
  it('isolates memory instances and implements string storage, keys and clear', () => {
    const a = createMemoryStorage(), b = createMemoryStorage();
    a.setItem('', ''); a.setItem('other', 'value');
    expect(a.getItem('')).toBe(''); expect(a.length).toBe(2); expect(a.key(0)).toBe('');
    expect(a.key(-1)).toBeNull(); expect(a.key(10)).toBeNull(); expect(b.getItem('other')).toBeNull();
    a.removeItem('other'); expect(a.length).toBe(1); a.clear(); expect(a.getItem('')).toBeNull();
  });
  it('is lazy, SSR-safe and uses an explicit lifetime-sticky fallback', () => {
    const fallback = createMemoryStorage(), unavailable = vi.fn();
    const storage = createWebStorage('local', { fallback, onUnavailable: unavailable });
    expect(unavailable).not.toHaveBeenCalled();
    storage.setItem('a', '1'); expect(unavailable).toHaveBeenCalledOnce();
    const native = createMemoryStorage(); vi.stubGlobal('window', { document: {}, localStorage: native });
    expect(storage.getItem('a')).toBe('1'); expect(native.getItem('a')).toBeNull();
    expect(() => storage.subscribe!(() => {})).toThrow('synchronization');
    storage.removeItem('a'); expect(fallback.length).toBe(0);
  });
  it('throws if unavailable without fallback; rejects unknown areas', () => {
    expect(() => createWebStorage('local').getItem('x')).toThrow('unavailable');
    expect(() => createWebStorage('bad' as 'local')).toThrow('area');
  });
  it('catches denied acquisition but does not switch backends on quota failure', () => {
    vi.stubGlobal('window', { document: {}, get localStorage() { throw Error('denied'); } });
    const fallback = createMemoryStorage();
    const denied = createWebStorage('local', { fallback }); denied.setItem('a', '1');
    expect(fallback.getItem('a')).toBe('1');
    const backend = { getItem: () => null, setItem: () => { throw Error('quota'); }, removeItem() {} };
    vi.stubGlobal('window', { document: {}, sessionStorage: backend });
    const active = createWebStorage('session', { fallback });
    expect(() => active.setItem('b', '2')).toThrow('quota'); expect(fallback.getItem('b')).toBeNull();
  });
  it('filters native storage events by area and removes the listener', () => {
    const events = new EventTarget(), native = createMemoryStorage(), other = createMemoryStorage();
    vi.stubGlobal('window', { document: {}, localStorage: native,
      addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) });
    const storage = createWebStorage('local'), fn = vi.fn();
    const off = storage.subscribe!(fn);
    const dispatch = (storageArea: unknown, key: string | null) => events.dispatchEvent(Object.assign(new Event('storage'), { storageArea, key }));
    dispatch(other, 'a'); expect(fn).not.toHaveBeenCalled();
    dispatch(native, 'a'); dispatch(native, null);
    expect(fn.mock.calls).toEqual([[{ key: 'a' }], [{ key: null }]]);
    off(); dispatch(native, 'b'); expect(fn).toHaveBeenCalledTimes(2);
  });
});
describe('strict JSON codec', () => {
  it('roundtrips nested JSON, permits shared acyclic subobjects and null-prototype records', () => {
    const shared = { n: 1 }, value = { shared, again: shared, array: [null, true, 'a', 2] };
    expect(jsonCodec.decode(jsonCodec.encode(value))).toEqual(value);
    const plain = Object.assign(Object.create(null), { a: 1 });
    expect(jsonCodec.decode(jsonCodec.encode(plain))).toEqual({ a: 1 });
  });
  // A sparse array is deliberate: JSON would silently replace its holes with null.
  // eslint-disable-next-line unicorn/no-new-array
  it.each([undefined, NaN, Infinity, -Infinity, -0, 1n, Symbol('x'), () => {}, new Date(), new Map(), { x: undefined }, [undefined], new Array(2)])('rejects lossy value %#', value => {
    expect(() => jsonCodec.encode(value)).toThrow();
  });
  it('rejects cycles, getters, symbols, hidden and extended array properties', () => {
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    const getter = { get x() { throw Error('should not execute'); } };
    const array = Object.assign([1], { extra: true });
    const hidden = Object.defineProperty({}, 'x', { value: 1 });
    // A hole offset by a named or symbol key passes the key count but is still sparse and extended.
    const offset = Object.assign([1, 2, 3], { x: 2 }), symbolic = Object.assign([1, 2, 3], { [Symbol('x')]: 2 });
    delete offset[1]; delete symbolic[1];
    const index = Object.defineProperty([1], 0, { get: () => 1 });
    for (const value of [cycle, getter, { [Symbol('x')]: 1 }, array, hidden, offset, symbolic, index]) expect(() => jsonCodec.encode(value)).toThrow(TypeError);
    expect(() => jsonCodec.decode('{bad')).toThrow();
  });
});
