import { isContainer } from '../internal.js';
import type { Codec } from './types.js';

/**
 * Validate JSON values before encoding; JSON.stringify alone silently loses data.
 *
 * Throws `TypeError` unless `value` round-trips losslessly. Accepts `null`,
 * strings, booleans, finite numbers except `-0`, plain objects
 * (`Object.prototype` or null prototype), and dense arrays; every property
 * must be an own enumerable data property with a string key. Rejects
 * `undefined`, bigints, functions, symbols, non-finite numbers, `-0`, cycles,
 * class instances, dates, maps, accessors, hidden or symbol-keyed properties,
 * and sparse or extended arrays. Shared acyclic references are accepted.
 * Accessors are detected from descriptors and never invoked.
 */
export function assertJsonValue(value: unknown): void {
  // Recursion stack, not a visited set: only a value containing itself is
  // cyclic; shared acyclic subgraphs reenter freely. Scanning the stack costs
  // only O(depth) and is cheaper than hashing every object into a Set.
  const active: object[] = [];
  function visit(item: unknown): void {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return;
    // Non-finite numbers serialize as null and -0 as 0; both lose information.
    if (typeof item === 'number' && Number.isFinite(item) && !Object.is(item, -0)) return;
    // What remains non-object here is undefined, bigint, function or symbol.
    if (typeof item !== 'object') throw new TypeError('Value is not lossless JSON data');
    if (active.includes(item)) throw new TypeError('Cyclic values cannot be persisted as JSON');
    if (!isContainer(item)) throw new TypeError('JSON persistence requires plain objects or arrays');
    const array = Array.isArray(item);
    const keys = Reflect.ownKeys(item);
    // A dense array owns exactly its indices plus 'length'; any other count is sparse or extended.
    if (array && keys.length !== item.length + 1) throw new TypeError('Sparse or extended arrays are not JSON data');
    // An ordinary array lists its own keys as indices, then 'length', then named extras (spec
    // order), so every string key after 'length' is an extra. A throw abandons the whole walk, so
    // the stack needs no cleanup.
    let extra = false;
    active.push(item);
    for (const key of keys) {
      if (array && key === 'length') { extra = true; continue; }
      // Inspect the descriptor, not the value: a getter must never execute.
      const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
      if (typeof key === 'symbol' || !descriptor.enumerable || !('value' in descriptor)) {
        throw new TypeError('JSON data cannot contain symbols, accessors or hidden properties');
      }
      if (extra) throw new TypeError('Extended arrays are not JSON data');
      visit(descriptor.value);
    }
    active.pop();
  }
  visit(value);
}
/**
 * Default persistence codec, applied to the whole envelope. Validates with
 * {@link assertJsonValue} before `JSON.stringify` and again after
 * `JSON.parse`, because parsed text can also be lossy (`-0`, or exponents
 * overflowing to `Infinity`); malformed JSON throws the parser's
 * `SyntaxError`. Reference identity and null prototypes are not preserved
 * across a round-trip.
 */
export const jsonCodec: Codec = {
  encode(value) { assertJsonValue(value); return JSON.stringify(value); },
  decode(serialized) {
    const value: unknown = JSON.parse(serialized);
    assertJsonValue(value);
    return value;
  },
};
