/**
 * Dependency-free ESM bundle for direct browser/CDN imports. No global install.
 * Composes core, storage, persistence and bindings in one entry; bundled by esbuild into
 * `dist/browser.js` and `dist/browser.min.js` with source maps.
 */
export * from './index.js';
export * from './storage/index.js';
export * from './persist/index.js';
export * from './bind/index.js';
