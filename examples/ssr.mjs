// Run after building: node examples/ssr.mjs
import assert from 'node:assert/strict';
import { createStore } from '../dist/index.js';
import { createMemoryStorage } from '../dist/storage/index.js';
import { attachPersistence } from '../dist/persist/index.js';

function createRequestState() {
  const store = createStore(0);
  const storage = createMemoryStorage();
  attachPersistence(store, {
    key: 'count', storage, version: 1,
    validate: value => typeof value === 'number' && Number.isFinite(value),
  });
  return { store, storage };
}
const alice = createRequestState();
const bob = createRequestState();
alice.store.set(7);
assert.equal(bob.store.value, 0);
assert.equal(bob.storage.getItem('count'), null);
alice.store.destroy();
bob.store.destroy();
console.log('Request stores and backing memory remain isolated.');
