// src/internal.ts
var INTERNAL = /* @__PURE__ */ Symbol.for("defuss-store.internal.v1");
function installInternal(store, api) {
  Object.defineProperty(store, INTERNAL, { value: api });
}
function internalOf(store) {
  const api = store[INTERNAL];
  if (!api) throw new TypeError("Expected a defuss-store v1 protocol store");
  return api;
}
function reportError(error) {
  try {
    console.error(error);
  } catch {
  }
}
function isContainer(value) {
  return typeof value === "object" && value !== null && (Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

// src/path.ts
var own = (value, key) => Object.hasOwn(value, key);
function parsePath(path) {
  if (typeof path !== "string" || !path) throw new TypeError("A nonempty path is required");
  const invalid = () => new TypeError(`Invalid path: ${path}`);
  const keys = [];
  for (let i = 0; i < path.length; ) {
    const bracket = path[i] === "[";
    const start = bracket ? ++i : i;
    let index = 0;
    let canonical = true;
    for (let code; i < path.length && (code = path.charCodeAt(i)) !== 46 && code !== 91 && code !== 93; i++) {
      canonical &&= code > 47 && code < 58 && (i === start || index > 0);
      index = index * 10 + code - 48;
    }
    if (i === start || bracket && (!canonical || path[i++] !== "]")) throw invalid();
    if (canonical) {
      if (index > 4294967294) throw new RangeError("Array index out of range");
      keys.push(index);
    } else {
      const key = path.slice(start, i);
      if (key === "__proto__" || key === "prototype" || key === "constructor") throw new TypeError(`Unsafe path segment: ${key}`);
      keys.push(key);
    }
    if (path[i] === ".") {
      if (++i === path.length || path[i] === "[") throw invalid();
    } else if (i < path.length && path[i] !== "[") throw invalid();
  }
  return keys;
}
function getByPath(value, path) {
  for (const key of parsePath(path)) {
    if (Object(value) !== value || !own(value, key)) return void 0;
    value = value[key];
  }
  return value;
}
function setByPath(root, path, next) {
  const keys = parsePath(path);
  const deleting = next === void 0;
  function visit(current, depth) {
    const key = keys[depth];
    if (!isContainer(current)) {
      if (current != null) throw new TypeError("Path updates require plain objects or arrays");
      if (deleting) return current;
      current = typeof key === "number" ? [] : {};
    }
    const source = current;
    const array = Array.isArray(source);
    if (array && typeof key !== "number") throw new TypeError("Array paths require nonnegative indices");
    const exists = own(source, key);
    if (!exists && deleting) return current;
    const old = exists ? source[key] : void 0;
    const leaf = depth === keys.length - 1;
    const updated = leaf ? next : visit(old, depth + 1);
    if (Object.is(old, updated) && (!deleting || !leaf)) return current;
    const copy = array ? source.slice() : { ...source, [key]: updated };
    if (leaf && deleting) {
      if (array) copy.splice(key, 1);
      else delete copy[key];
    } else if (array) {
      if (exists) copy[key] = updated;
      else Object.defineProperty(copy, key, { value: updated, enumerable: true, configurable: true, writable: true });
    }
    return copy;
  }
  return visit(root, 0);
}

// src/store.ts
function createStore(initial, options = {}) {
  const equals = options.equals ?? Object.is;
  let value = initial;
  let destroyed = false;
  let revision = 0;
  let draining = false;
  const listeners = /* @__PURE__ */ new Set();
  let snapshot;
  const cleanups = /* @__PURE__ */ new Set();
  const queue = [];
  function alive() {
    if (destroyed) throw new Error("Store is destroyed");
  }
  function observe(listener) {
    alive();
    const registration = { listener, active: true };
    listeners.add(registration);
    snapshot = void 0;
    return () => {
      registration.active = false;
      if (listeners.delete(registration)) snapshot = void 0;
    };
  }
  function commit(next, path, origin) {
    alive();
    if (equals(value, next)) return;
    const previous = value;
    value = next;
    ++revision;
    if (!listeners.size) return;
    queue.push({ value, previous, path, origin, revision, listeners: snapshot ??= [...listeners] });
    if (draining) return;
    draining = true;
    const errors = [];
    try {
      for (let index = 0; index < queue.length; index++) {
        const entry = queue[index];
        for (const registration of entry.listeners) {
          if (!registration.active) continue;
          try {
            registration.listener(entry);
          } catch (error) {
            errors.push(error);
          }
        }
      }
    } finally {
      queue.length = 0;
      draining = false;
    }
    if (errors.length) throw new AggregateError(errors, "Store listeners failed after state committed");
  }
  function subscribe(select, listener, options2 = {}) {
    alive();
    if (typeof listener !== "function") {
      options2 = listener ?? {};
      listener = select;
      select = void 0;
    }
    const notify = listener;
    const compare = options2.equals ?? Object.is;
    let selected = select?.(value);
    const off = observe((change) => {
      let next = change.value;
      let old = change.previous;
      if (select) {
        next = select(change.value);
        if (compare(selected, next)) return;
        old = selected;
        selected = next;
      }
      notify(next, old, change.path);
    });
    try {
      if (options2.immediate) notify(select ? selected : value, void 0, void 0);
    } catch (error) {
      off();
      throw error;
    }
    return off;
  }
  const store = {
    get value() {
      return value;
    },
    get destroyed() {
      return destroyed;
    },
    get: ((path) => path ? getByPath(value, path) : value),
    getRaw: () => value,
    set(pathOrValue, next) {
      alive();
      if (arguments.length === 1) commit(pathOrValue);
      else if (arguments.length === 2 && typeof pathOrValue === "string") commit(setByPath(value, pathOrValue, next), pathOrValue);
      else throw new TypeError("set expects a value or a string path and value");
    },
    setRaw: (next) => commit(next),
    update(updater) {
      alive();
      commit(updater(value));
    },
    remove(path) {
      alive();
      commit(setByPath(value, path, void 0), path);
    },
    // arguments.length keeps reset(undefined) distinct from reset().
    reset(next) {
      commit(arguments.length ? next : initial);
    },
    subscribe,
    onDestroy(cleanup) {
      alive();
      cleanups.add(cleanup);
      return () => {
        cleanups.delete(cleanup);
      };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const registration of listeners) registration.active = false;
      listeners.clear();
      snapshot = void 0;
      const errors = [];
      for (const cleanup of cleanups) {
        cleanups.delete(cleanup);
        try {
          cleanup();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length) throw new AggregateError(errors, "Store cleanup failed");
    }
  };
  installInternal(store, { set: (next, origin) => commit(next, void 0, origin), observe, revision: () => revision });
  return store;
}

// src/computed.ts
function computed(inputs, project, options) {
  const sources = Array.isArray(inputs) ? inputs : [inputs];
  if (sources.some((source) => source.destroyed)) throw new Error("Computed source is destroyed");
  const calculate = () => project(...sources.map((source) => source.value));
  const target = createStore(calculate(), options);
  const releases = [];
  target.onDestroy(() => {
    for (const release of releases.splice(0)) release();
  });
  try {
    for (const source of new Set(sources)) {
      releases.push(source.subscribe(() => target.setRaw(calculate())));
      releases.push(source.onDestroy(() => target.destroy()));
    }
  } catch (error) {
    target.destroy();
    throw error;
  }
  return {
    get value() {
      return target.value;
    },
    get destroyed() {
      return target.destroyed;
    },
    get: target.get,
    getRaw: target.getRaw,
    subscribe: target.subscribe,
    onDestroy: target.onDestroy,
    destroy: target.destroy
  };
}

// src/equals.ts
var jsonEquals = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// src/storage/memory.ts
function createMemoryStorage() {
  const cache = /* @__PURE__ */ new Map();
  return {
    get length() {
      return cache.size;
    },
    // Map keys iterate in insertion order; anything outside is `null`, matching DOM Storage.
    key(index) {
      return Number.isInteger(index) && index >= 0 ? [...cache.keys()][index] ?? null : null;
    },
    getItem: (key) => cache.get(String(key)) ?? null,
    setItem: (key, value) => {
      cache.set(String(key), String(value));
    },
    removeItem: (key) => {
      cache.delete(String(key));
    },
    clear: () => {
      cache.clear();
    }
  };
}

// src/storage/web.ts
function createWebStorage(area, options = {}) {
  if (area !== "local" && area !== "session") throw new TypeError("Storage area must be local or session");
  let backend;
  let host;
  function resolve() {
    if (backend) return backend;
    try {
      const browser = globalThis.window;
      const storage = browser?.document && browser[`${area}Storage`];
      if (!storage) throw new Error("Browser Web Storage is unavailable");
      host = browser;
      backend = storage;
    } catch (error) {
      if (!options.fallback) throw error;
      backend = options.fallback;
      try {
        options.onUnavailable?.(error);
      } catch (reportingError) {
        reportError(reportingError);
      }
    }
    return backend;
  }
  return {
    getItem: (key) => resolve().getItem(key),
    setItem: (key, value) => resolve().setItem(key, value),
    removeItem: (key) => resolve().removeItem(key),
    subscribe(listener) {
      const storage = resolve();
      const browser = host;
      if (!browser) {
        if (!storage.subscribe) throw new Error("Selected fallback does not support storage synchronization");
        return storage.subscribe(listener);
      }
      const handle = (event) => {
        if (event.storageArea === storage) listener({ key: event.key });
      };
      browser.addEventListener("storage", handle);
      return () => browser.removeEventListener("storage", handle);
    }
  };
}

// src/storage/codec.ts
function assertJsonValue(value) {
  const active = [];
  function visit(item) {
    if (item === null || typeof item === "string" || typeof item === "boolean") return;
    if (typeof item === "number" && Number.isFinite(item) && !Object.is(item, -0)) return;
    if (typeof item !== "object") throw new TypeError("Value is not lossless JSON data");
    if (active.includes(item)) throw new TypeError("Cyclic values cannot be persisted as JSON");
    if (!isContainer(item)) throw new TypeError("JSON persistence requires plain objects or arrays");
    const array = Array.isArray(item);
    const keys = Reflect.ownKeys(item);
    if (array && keys.length !== item.length + 1) throw new TypeError("Sparse or extended arrays are not JSON data");
    let extra = false;
    active.push(item);
    for (const key of keys) {
      if (array && key === "length") {
        extra = true;
        continue;
      }
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (typeof key === "symbol" || !descriptor.enumerable || !("value" in descriptor)) {
        throw new TypeError("JSON data cannot contain symbols, accessors or hidden properties");
      }
      if (extra) throw new TypeError("Extended arrays are not JSON data");
      visit(descriptor.value);
    }
    active.pop();
  }
  visit(value);
}
var jsonCodec = {
  encode(value) {
    assertJsonValue(value);
    return JSON.stringify(value);
  },
  decode(serialized) {
    const value = JSON.parse(serialized);
    assertJsonValue(value);
    return value;
  }
};

// src/persist/persist.ts
var format = "defuss-store";
var validVersion = (value) => Number.isSafeInteger(value) && value >= 0;
function attachPersistence(store, options) {
  const api = internalOf(store);
  if (store.destroyed) throw new Error("Store is destroyed");
  if (api.persistence) throw new Error("Store already has an attached persistence controller");
  if (typeof options.key !== "string" || !validVersion(options.version) || typeof options.validate !== "function") {
    throw new TypeError("Persistence requires a string key, nonnegative schema version and validator");
  }
  if (options.legacyVersion !== void 0 && !validVersion(options.legacyVersion)) throw new TypeError("Invalid legacyVersion");
  const mode = options.hydrate ?? "immediate";
  if (!["immediate", "manual", "skip"].includes(mode)) throw new TypeError("Invalid hydration mode");
  if (options.sync && !options.storage.subscribe) throw new TypeError("Storage backend does not support synchronization");
  const codec = options.codec ?? jsonCodec;
  const origin = {};
  let phase = mode === "skip" ? "active" : "paused";
  let dirty = true;
  let hasStoredValue = false;
  let lastError;
  let acceptedBytes;
  const releases = [];
  const dead = () => phase === "destroyed";
  function alive() {
    if (dead()) throw new Error("Persistence controller is destroyed");
  }
  function fail(operation, error, pause = false) {
    if (dead()) return false;
    lastError = { operation, key: options.key, error };
    dirty = true;
    if (pause) phase = "paused";
    try {
      if (options.onError) options.onError(lastError);
      else reportError(lastError);
    } catch (reportingError) {
      reportError(reportingError);
    }
    return false;
  }
  function settle(bytes, stale) {
    acceptedBytes = bytes;
    hasStoredValue = bytes !== null;
    dirty = stale;
    lastError = void 0;
    phase = "active";
    return true;
  }
  function write() {
    alive();
    const value = store.value;
    const revision = api.revision();
    let step = "validate";
    let bytes;
    try {
      if (!options.validate(value)) throw new TypeError("Current state failed persistence validation");
      step = "encode";
      const envelope = { format, formatVersion: 1, version: options.version, value };
      bytes = codec.encode(envelope);
      if (typeof bytes !== "string") throw new TypeError("Codec must encode to a string");
      if (api.revision() !== revision || dead()) return false;
      step = "write";
      options.storage.setItem(options.key, bytes);
    } catch (error) {
      return fail(step, error);
    }
    return dead() || settle(bytes, api.revision() !== revision);
  }
  function read(remote = false) {
    alive();
    let step = "read";
    let raw;
    let value;
    let stale = false;
    try {
      raw = options.storage.getItem(options.key);
      if (dead()) return false;
      if (raw === null) return settle(null, true);
      if (typeof raw !== "string") throw new TypeError("Storage getItem must return string or null");
      hasStoredValue = true;
      if (remote && raw === acceptedBytes && !dirty && phase === "active") return true;
      step = "decode";
      const decoded = codec.decode(raw);
      step = "version";
      let version;
      if (typeof decoded === "object" && decoded?.format === format && !Array.isArray(decoded)) {
        if (decoded.formatVersion !== 1 || !validVersion(decoded.version) || !Object.hasOwn(decoded, "value")) {
          throw new TypeError("Unsupported or malformed persistence envelope");
        }
        version = decoded.version;
        value = decoded.value;
      } else if (options.legacyVersion !== void 0) {
        stale = true;
        version = options.legacyVersion;
        value = decoded;
      } else throw new TypeError("Expected a defuss-store envelope; raw data needs legacyVersion");
      if (version > options.version) throw new Error("Stored schema is newer than this application");
      if (version !== options.version) {
        stale = true;
        step = "migrate";
        if (!options.migrate) throw new Error("Schema migration is required");
        value = options.migrate(value, version);
      }
      step = "validate";
      if (!options.validate(value)) throw new TypeError("Stored state failed validation");
    } catch (error) {
      return fail(step, error, true);
    }
    if (dead()) return false;
    const revision = api.revision();
    settle(raw, stale);
    try {
      api.set(value, origin);
    } catch (error) {
      return fail("notify", error);
    }
    if (acceptedBytes === raw && api.revision() <= revision + 1 && !Object.is(store.value, value)) dirty = true;
    return true;
  }
  const controller = {
    rehydrate: () => read(),
    flush: () => write(),
    clear() {
      alive();
      try {
        options.storage.removeItem(options.key);
      } catch (error) {
        return fail("remove", error);
      }
      return dead() || settle(null, true);
    },
    status: () => ({ phase, dirty, hasStoredValue, ...lastError ? { lastError } : {} }),
    destroy() {
      if (dead()) return;
      phase = "destroyed";
      if (api.persistence === controller) delete api.persistence;
      const errors = [];
      for (const release of releases.splice(0)) {
        try {
          release();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length) throw new AggregateError(errors, "Persistence cleanup failed");
    }
  };
  api.persistence = controller;
  try {
    releases.push(api.observe((change) => {
      if (change.origin === origin) return;
      dirty = true;
      if (phase === "active" && change.revision === api.revision()) write();
    }));
    releases.push(store.onDestroy(() => controller.destroy()));
    if (options.sync) releases.push(options.storage.subscribe((change) => {
      if (!dead() && (mode !== "manual" || acceptedBytes !== void 0) && (change.key === null || change.key === options.key)) read(true);
    }));
    if (mode === "immediate") read();
  } catch (error) {
    controller.destroy();
    throw error;
  }
  return controller;
}

// src/bind/index.ts
var bindings = /* @__PURE__ */ new WeakSet();
var defaultEvents = ["shadcn:statechange", "input", "change", "click", "keydown", "toggle", "close"];
function bindState(element, store, options) {
  const api = element.api;
  if (typeof api?.getState !== "function" || typeof api.setState !== "function") {
    throw new TypeError("Initialize the component State API before binding");
  }
  if (store.destroyed) throw new Error("Store is destroyed");
  if (bindings.has(element)) throw new Error("Element is already bound");
  if (![void 0, "store", "element"].includes(options.initial)) throw new TypeError("Invalid initial binding owner");
  const equals = options.equals ?? Object.is;
  const original = api.setState;
  const releases = [];
  let disposed = false;
  let applying = false;
  let pending = false;
  const observed = (source) => !options.sources || options.sources.includes(source);
  function pull() {
    if (disposed || applying) return;
    const current = store.value;
    const next = options.fromState(api.getState(), current);
    if (!equals(options.select(current), options.select(next))) store.setRaw(next);
  }
  function push() {
    if (disposed || applying) return;
    const selection = options.select(store.value);
    const state = options.toState(selection);
    applying = true;
    try {
      original.call(api, state.name, state.config);
    } finally {
      applying = false;
    }
    if (equals(selection, options.select(store.value))) pull();
  }
  function schedule(source) {
    if (disposed || applying || pending || !observed(source)) return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      if (disposed) return;
      try {
        pull();
      } catch (error) {
        if (options.onError) options.onError(error);
        else throw error;
      }
    });
  }
  const wrapped = function(name, config) {
    original.call(this, name, config);
    if (!applying && observed("api")) pull();
  };
  const dispose = (() => {
    if (disposed) return;
    disposed = true;
    bindings.delete(element);
    if (api.setState === wrapped) api.setState = original;
    const errors = [];
    for (const release of releases.splice(0)) {
      try {
        release();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) throw new AggregateError(errors, "Binding cleanup failed");
  });
  dispose.pull = pull;
  dispose.push = push;
  if (options.signal?.aborted) {
    disposed = true;
    return dispose;
  }
  bindings.add(element);
  try {
    api.setState = wrapped;
    const eventHandler = (event) => {
      if (event.type !== "shadcn:statechange") schedule("user");
      else if (event.target === element) schedule(event.detail?.source ?? "attribute");
    };
    for (const event of /* @__PURE__ */ new Set([...defaultEvents, ...options.events ?? []])) {
      element.addEventListener(event, eventHandler, true);
      releases.push(() => element.removeEventListener(event, eventHandler, true));
    }
    if (options.observe !== false) {
      const Observer = element.ownerDocument.defaultView?.MutationObserver;
      if (!Observer) throw new Error("MutationObserver unavailable; use observe:false and explicit events/pull");
      const observer = new Observer(() => schedule("attribute"));
      observer.observe(element, { attributes: true, childList: true, subtree: true, characterData: true });
      releases.push(() => observer.disconnect());
    }
    releases.push(store.subscribe(options.select, push, { equals }));
    releases.push(store.onDestroy(dispose));
    if (options.signal) {
      options.signal.addEventListener("abort", dispose, { once: true });
      releases.push(() => options.signal.removeEventListener("abort", dispose));
    }
    if (options.initial === "element") pull();
    else push();
  } catch (error) {
    dispose();
    throw error;
  }
  return dispose;
}
export {
  assertJsonValue,
  attachPersistence,
  bindState,
  computed,
  createMemoryStorage,
  createStore,
  createWebStorage,
  jsonCodec,
  jsonEquals
};
//# sourceMappingURL=browser.js.map
