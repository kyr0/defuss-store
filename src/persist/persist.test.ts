import { describe, expect, it, vi } from 'vitest';
import { createStore } from '../store.js';
import { createMemoryStorage, jsonCodec, type StorageBackend } from '../storage/index.js';
import { attachPersistence } from './index.js';
import type { PersistenceOptions } from './types.js';

const valid = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const envelope = (value: unknown, version = 1) => JSON.stringify({ format: 'defuss-store', formatVersion: 1, version, value });
function setup(extra: Partial<PersistenceOptions<number>> = {}, initial = 0) {
  const store = createStore(initial), storage = extra.storage ?? createMemoryStorage(), onError = vi.fn();
  const persist = attachPersistence(store, { key: 'state', storage, version: 1, validate: valid, onError, ...extra });
  return { store, storage, persist, onError };
}
describe('persistence lifecycle', () => {
  it('does not eagerly overwrite saved data and never writes defaults just by mounting', () => {
    const storage = createMemoryStorage(); const write = vi.spyOn(storage, 'setItem');
    const empty = setup({ storage }); expect(write).not.toHaveBeenCalled(); expect(empty.persist.status().hasStoredValue).toBe(false);
    empty.store.destroy(); storage.setItem('state', envelope(42)); write.mockClear();
    const restored = setup({ storage }); expect(restored.store.value).toBe(42); expect(write).not.toHaveBeenCalled();
    restored.store.set(43); expect(storage.getItem('state')).toBe(envelope(43));
    expect(restored.persist.status()).toEqual({ phase: 'active', hasStoredValue: true, dirty: false });
  });
  it('supports empty keys, reset, clear without immediate recreation and explicit flush', () => {
    const { store, storage, persist } = setup({ key: '' }, 4);
    expect(persist.flush()).toBe(true); expect(storage.getItem('')).toBe(envelope(4));
    store.set(5); store.reset(); expect(storage.getItem('')).toBe(envelope(4));
    storage.setItem('unrelated', '1'); persist.clear(); expect(store.value).toBe(4); expect(storage.getItem('')).toBeNull();
    expect(storage.getItem('unrelated')).toBe('1'); store.set(6); expect(storage.getItem('')).toBe(envelope(6));
  });
  it('pauses manual hydration until explicitly resolved; skip mode writes only on change/flush', () => {
    const storage = createMemoryStorage(); storage.setItem('state', envelope(7));
    const manual = setup({ storage, hydrate: 'manual' }); manual.store.set(2);
    expect(storage.getItem('state')).toBe(envelope(7)); expect(manual.persist.status().phase).toBe('paused');
    manual.persist.rehydrate(); expect(manual.store.value).toBe(7); manual.store.set(8);
    expect(storage.getItem('state')).toBe(envelope(8)); manual.store.destroy();
    const skipped = setup({ storage, hydrate: 'skip' }); expect(skipped.store.value).toBe(0);
    expect(storage.getItem('state')).toBe(envelope(8)); skipped.persist.flush(); expect(storage.getItem('state')).toBe(envelope(0));
  });
  it('preserves current in-memory edits when a manual hydrate finds no value', () => {
    const { store, persist } = setup({ hydrate: 'manual' }); store.set(8); persist.rehydrate(); expect(store.value).toBe(8);
  });
  it('rejects multiple controllers and detaches on destruction', () => {
    const { store, persist, storage } = setup();
    expect(() => attachPersistence(store, { key: 'x', storage, version: 1, validate: valid })).toThrow('already');
    persist.destroy(); persist.destroy(); store.set(1); expect(storage.getItem('state')).toBeNull();
    const next = attachPersistence(store, { key: 'state', storage, version: 1, validate: valid });
    store.destroy(); expect(next.status().phase).toBe('destroyed');
    expect(() => next.flush()).toThrow('destroyed'); expect(() => next.clear()).toThrow('destroyed');
    expect(() => attachPersistence(store, { key: 'x', storage, version: 1, validate: valid })).toThrow('destroyed');
  });
  it('persists despite earlier listener exceptions and persists the latest reentrant value', () => {
    const store = createStore(0), storage = createMemoryStorage();
    store.subscribe(value => { if (value === 1) store.set(2); throw Error('listener'); });
    attachPersistence(store, { key: 'x', storage, version: 1, validate: valid });
    expect(() => store.set(1)).toThrow(AggregateError); expect(storage.getItem('x')).toBe(envelope(2));
  });
  it('does not swallow local writes made by a listener during restoration', () => {
    const store = createStore(0), storage = createMemoryStorage(); storage.setItem('x', envelope(4));
    store.subscribe(value => { if (value === 4) store.set(5); });
    const persist = attachPersistence(store, { key: 'x', storage, version: 1, validate: valid });
    expect(store.value).toBe(5); expect(storage.getItem('x')).toBe(envelope(5)); expect(persist.status().dirty).toBe(false);
  });
  it('cannot reactivate a controller destroyed inside a custom backend operation', () => {
    const reader = createStore(1);
    const reading = attachPersistence(reader, {
      key: 'x', version: 1, validate: valid, hydrate: 'manual',
      storage: { ...createMemoryStorage(), getItem() { reader.destroy(); return null; } },
    });
    expect(reading.rehydrate()).toBe(false);
    expect(reading.status().phase).toBe('destroyed');
    const remover = createStore(1);
    const removing = attachPersistence(remover, {
      key: 'x', version: 1, validate: valid,
      storage: { ...createMemoryStorage(), removeItem() { remover.destroy(); } },
    });
    expect(removing.clear()).toBe(true);
    expect(removing.status().phase).toBe('destroyed');
  });
});
describe('validation, versioning and recovery', () => {
  it.each(['{bad', '4', envelope('bad'), envelope(2, 99), JSON.stringify({ format: 'defuss-store', formatVersion: 2, version: 1, value: 1 })])('preserves bad or future bytes %s until explicit recovery', raw => {
    const storage = createMemoryStorage(); storage.setItem('state', raw);
    const { store, persist, onError } = setup({ storage }, 6);
    expect(store.value).toBe(6); expect(onError).toHaveBeenCalledOnce(); expect(persist.status().phase).toBe('paused');
    store.set(7); expect(storage.getItem('state')).toBe(raw);
    expect(persist.flush()).toBe(true); expect(storage.getItem('state')).toBe(envelope(7));
    expect(persist.status().phase).toBe('active');
  });
  it('migrates old envelopes and explicit raw JSON without eager rewriting', () => {
    const storage = createMemoryStorage(); storage.setItem('state', envelope({ n: 3 }, 0));
    const migrate = vi.fn((old: unknown) => (old as { n: number }).n);
    const current = setup({ storage, migrate }); expect(current.store.value).toBe(3); expect(migrate).toHaveBeenCalledWith({ n: 3 }, 0);
    expect(storage.getItem('state')).toBe(envelope({ n: 3 }, 0)); expect(current.persist.status().dirty).toBe(true);
    current.persist.flush(); expect(storage.getItem('state')).toBe(envelope(3)); current.store.destroy();
    storage.setItem('state', '9'); const legacy = setup({ storage, legacyVersion: 1 }); expect(legacy.store.value).toBe(9);
    expect(storage.getItem('state')).toBe('9'); legacy.persist.flush(); expect(storage.getItem('state')).toBe(envelope(9));
  });
  it('reports failed and missing migrations and validates their output', () => {
    for (const migrate of [undefined, () => { throw Error('migration'); }, () => 'invalid']) {
      const storage = createMemoryStorage(); storage.setItem('state', envelope(1, 0));
      const { store, onError, persist } = setup({ storage, migrate });
      expect(store.value).toBe(0); expect(onError).toHaveBeenCalledOnce(); expect(persist.status().phase).toBe('paused');
    }
  });
  it('reports read failure, then retries and accepts null with an appropriate validator', () => {
    const memory = createMemoryStorage(); const get = vi.fn((): string | null => { throw Error('read'); });
    const storage = { ...memory, getItem: get };
    const { persist, onError } = setup({ storage }); expect(onError.mock.calls[0]![0].operation).toBe('read');
    get.mockReturnValue(envelope(5)); expect(persist.rehydrate()).toBe(true);
    const store = createStore<number | null>(1); memory.setItem('nullable', envelope(null));
    attachPersistence(store, { key: 'nullable', storage: memory, version: 1, validate: (x): x is number | null => x === null || valid(x) });
    expect(store.value).toBeNull();
  });
  it('retains committed memory on quota failure and flush retries the latest snapshot', () => {
    const memory = createMemoryStorage(), write = vi.fn((_key: string, _value: string): void => { throw Error('quota'); });
    const storage = { ...memory, setItem: write };
    const { store, persist, onError } = setup({ storage });
    store.set(1); store.set(2); expect(store.value).toBe(2); expect(persist.status().dirty).toBe(true);
    expect(onError.mock.calls[0]![0].operation).toBe('write');
    write.mockImplementation(memory.setItem); expect(persist.flush()).toBe(true);
    expect(memory.getItem('state')).toBe(envelope(2)); expect(persist.status().dirty).toBe(false);
  });
  it('does not serialize unsupported values or invalid application state', () => {
    const store = createStore<unknown>(0), storage = createMemoryStorage(), error = vi.fn();
    const p = attachPersistence(store, { key: 'x', storage, version: 1, validate: (_v): _v is unknown => true, onError: error });
    store.set(new Map()); expect(error.mock.calls[0]![0].operation).toBe('encode'); expect(storage.getItem('x')).toBeNull();
    p.destroy(); const { store: numeric, onError } = setup(); numeric.set(NaN);
    expect(onError.mock.calls[0]![0].operation).toBe('validate');
  });
  it('supports a custom whole-envelope codec', () => {
    const codec = { encode: (v: unknown) => `prefix:${jsonCodec.encode(v)}`, decode: (s: string) => jsonCodec.decode(s.slice(7)) };
    const first = setup({ codec }); first.store.set(5); expect(first.storage.getItem('state')).toBe(`prefix:${envelope(5)}`);
    const second = setup({ codec, storage: first.storage }); expect(second.store.value).toBe(5);
  });
  it('reports remove failures without deleting memory or unrelated data', () => {
    const memory = createMemoryStorage(); const { store, persist, onError } = setup({ storage: { ...memory, removeItem() { throw Error('remove'); } } });
    store.set(3); expect(persist.clear()).toBe(false); expect(store.value).toBe(3);
    expect(onError.mock.calls[0]![0].operation).toBe('remove');
  });
  it('validates options before attaching and refuses unsupported synchronization', () => {
    expect(() => setup({ version: -1 })).toThrow('version');
    expect(() => setup({ legacyVersion: -1 })).toThrow('legacyVersion');
    expect(() => setup({ sync: true })).toThrow('synchronization');
    expect(() => setup({ hydrate: 'bad' as 'manual' })).toThrow('hydration');
  });
});
describe('remote synchronization', () => {
  function remoteStorage() {
    const memory = createMemoryStorage(); let listener: ((value: { key: string | null }) => void) | undefined;
    const off = vi.fn(() => { listener = undefined; });
    const storage: StorageBackend = { ...memory, subscribe(fn) { listener = fn; return off; } };
    const write = vi.spyOn(storage, 'setItem');
    return { storage, off, write, emit: (key: string | null) => listener?.({ key }) };
  }
  it('rereads current bytes, filters keys, suppresses echoes and handles removal/clear', () => {
    const remote = remoteStorage(); const { store, persist } = setup({ storage: remote.storage, sync: true });
    const listener = vi.fn(); store.subscribe(listener);
    remote.storage.setItem('state', envelope(4)); remote.write.mockClear();
    remote.emit('other'); expect(store.value).toBe(0);
    remote.emit('state'); expect(store.value).toBe(4); expect(remote.write).not.toHaveBeenCalled();
    remote.emit('state'); expect(listener).toHaveBeenCalledOnce();
    remote.storage.removeItem('state'); remote.emit(null); expect(store.value).toBe(4);
    expect(persist.status().hasStoredValue).toBe(false); expect(remote.write).not.toHaveBeenCalled();
    store.set(5); expect(remote.storage.getItem('state')).toBe(envelope(5));
    store.destroy(); expect(remote.off).toHaveBeenCalledOnce();
  });
  it('does not auto-hydrate a manual controller before explicit hydration', () => {
    const remote = remoteStorage(); const { store, persist } = setup({ storage: remote.storage, sync: true, hydrate: 'manual' });
    remote.storage.setItem('state', envelope(4)); remote.emit('state'); expect(store.value).toBe(0);
    persist.rehydrate(); expect(store.value).toBe(4);
    remote.storage.setItem('state', envelope(5)); remote.emit('state'); expect(store.value).toBe(5);
  });
  it('cleans up an attachment if backend subscription throws', () => {
    const store = createStore(0), storage = { ...createMemoryStorage(), subscribe() { throw Error('unsupported'); } };
    expect(() => attachPersistence(store, { key: 'x', storage, version: 1, validate: valid, sync: true })).toThrow('unsupported');
    const next = attachPersistence(store, { key: 'x', storage: createMemoryStorage(), version: 1, validate: valid });
    store.set(2); expect(next.status().dirty).toBe(false);
  });
});
