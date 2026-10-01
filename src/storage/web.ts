import { reportError } from '../internal.js';
import type { StorageBackend, WebStorageOptions } from './types.js';
/**
 * Import-safe in Node/SSR. Backend acquisition happens at first use.
 *
 * Resolution is one-shot and sticky: the fallback is chosen only when native
 * acquisition itself throws; without a fallback that error is rethrown on the
 * calling operation. Quota or I/O failures after selection propagate to the
 * caller and never switch backends.
 */
export function createWebStorage(area: 'local' | 'session', options: WebStorageOptions = {}): StorageBackend {
  // Area is validated eagerly so a typo fails at construction, not first use.
  if (area !== 'local' && area !== 'session') throw new TypeError('Storage area must be local or session');
  let backend: StorageBackend | undefined;
  // Set only when native storage was acquired; distinguishes native from fallback in subscribe.
  let host: Window | undefined;
  function resolve(): StorageBackend {
    if (backend) return backend;
    try {
      // Feature-detect a real browser window; the storage getter can also throw (denied storage).
      const browser = globalThis.window;
      const storage = browser?.document && browser[`${area}Storage`];
      if (!storage) throw new Error('Browser Web Storage is unavailable');
      host = browser;
      backend = storage;
    } catch (error) {
      if (!options.fallback) throw error;
      backend = options.fallback;
      // Reporting must not break acquisition.
      try { options.onUnavailable?.(error); } catch (reportingError) { reportError(reportingError); }
    }
    return backend;
  }
  return {
    getItem: key => resolve().getItem(key),
    setItem: (key, value) => resolve().setItem(key, value),
    removeItem: key => resolve().removeItem(key),
    subscribe(listener) {
      const storage = resolve();
      const browser = host;
      // A fallback has no native events; it must provide its own invalidation channel.
      if (!browser) {
        if (!storage.subscribe) throw new Error('Selected fallback does not support storage synchronization');
        return storage.subscribe(listener);
      }
      // Native events fire only in other same-origin documents; filter to the selected area.
      const handle = (event: StorageEvent) => {
        if (event.storageArea === storage) listener({ key: event.key });
      };
      browser.addEventListener('storage', handle);
      return () => browser.removeEventListener('storage', handle);
    },
  };
}
