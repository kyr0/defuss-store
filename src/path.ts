import { isContainer } from './internal.js';

type Key = string | number;
// Reads and writes never follow the prototype chain.
const own = (value: object, key: Key) => Object.hasOwn(value, key);

/**
 * Dot properties and nonnegative bracket indices; no expression evaluation.
 * Canonical digits only (no sign, no leading zeros): `users.0.name` and `users[0].name` are
 * equivalent. Indices are limited to 2^32-2, the largest valid array index.
 */
export function parsePath(path: string): Key[] {
  if (typeof path !== 'string' || !path) throw new TypeError('A nonempty path is required');
  const invalid = () => new TypeError(`Invalid path: ${path}`);
  const keys: Key[] = [];
  for (let i = 0; i < path.length;) {
    const bracket = path[i] === '[';
    const start = bracket ? ++i : i;
    // One scan to the next '.' (46), '[' (91) or ']' (93), tracking whether the segment is canonical
    // digits '0'-'9' (48-57; only a lone '0' may start with zero) and their value, so indices need
    // neither a regex nor a slice.
    let index = 0;
    let canonical = true;
    for (let code; i < path.length && (code = path.charCodeAt(i)) !== 46 && code !== 91 && code !== 93; i++) {
      canonical &&= code > 47 && code < 58 && (i === start || index > 0);
      index = index * 10 + code - 48;
    }
    // Empty segment: a leading, trailing or doubled separator. Brackets must hold canonical digits
    // and close; checking the ']' also steps past it.
    if (i === start || bracket && (!canonical || path[i++] !== ']')) throw invalid();
    if (canonical) {
      // Long digit runs lose precision, but anything above the largest array index is rejected anyway.
      if (index > 4294967294) throw new RangeError('Array index out of range');
      keys.push(index);
    } else {
      const key = path.slice(start, i);
      // Prototype-pollution guard: these segments can reach Object.prototype internals.
      if (key === '__proto__' || key === 'prototype' || key === 'constructor') throw new TypeError(`Unsafe path segment: ${key}`);
      keys.push(key);
    }
    if (path[i] === '.') {
      // A dot must be followed by a named segment: reject 'a.' and 'a.[0]'; 'a..b' fails as an empty segment.
      if (++i === path.length || path[i] === '[') throw invalid();
    // Only '.' or '[' may follow a segment; 'a[0]b' and 'a]' are malformed.
    } else if (i < path.length && path[i] !== '[') throw invalid();
  }
  return keys;
}
/**
 * Read `path` under `value`. Missing keys, nullish intermediates and inherited properties all
 * yield `undefined`; values are never coerced.
 */
export function getByPath(value: unknown, path: string): unknown {
  for (const key of parsePath(path)) {
    // Primitives and nullish values have no own properties to follow.
    if (Object(value) !== value || !own(value as object, key)) return undefined;
    value = (value as Record<Key, unknown>)[key];
  }
  return value;
}
/**
 * Return `root` with `path` set to `next`, copying only the touched plain-object/array ancestors;
 * untouched branches keep their references. `undefined` deletes an object key or splices an array
 * index, so path writes cannot store `undefined`. Nullish intermediates are materialized (`[]`
 * before a numeric key, `{}` otherwise); primitives and class-instance intermediates throw. A
 * write that changes nothing — an equal leaf or an absent deletion — returns the identical root
 * reference, so store equality turns it into a no-op commit.
 */
export function setByPath<T>(root: T, path: string, next: unknown): T {
  const keys = parsePath(path);
  const deleting = next === undefined;
  function visit(current: unknown, depth: number): unknown {
    const key = keys[depth]!;
    if (!isContainer(current)) {
      if (current != null) throw new TypeError('Path updates require plain objects or arrays');
      // Removing through a nullish gap changes nothing.
      if (deleting) return current;
      // Materialize a nullish gap; the next key decides the container kind.
      current = typeof key === 'number' ? [] : {};
    }
    const source = current as Record<Key, unknown>;
    const array = Array.isArray(source);
    // parsePath turns every canonical index into a number, so a string key is never an index.
    if (array && typeof key !== 'number') throw new TypeError('Array paths require nonnegative indices');
    const exists = own(source, key);
    // Deleting an absent key changes nothing; keep the reference.
    if (!exists && deleting) return current;
    const old = exists ? source[key] : undefined;
    const leaf = depth === keys.length - 1;
    const updated = leaf ? next : visit(old, depth + 1);
    // No-op results propagate up without copying, but an existing leaf must still be deleted.
    if (Object.is(old, updated) && (!deleting || !leaf)) return current;
    // Object copies get a normal Object.prototype. Writes create plain own data properties and never
    // reach an inherited setter: literal keys are defined, not assigned, and slice() copies own
    // elements as writable data properties, so only a new array index needs defineProperty.
    const copy = (array ? source.slice() : { ...source, [key]: updated }) as unknown[] & Record<Key, unknown>;
    if (leaf && deleting) {
      if (array) copy.splice(key as number, 1);
      else delete copy[key];
    } else if (array) {
      if (exists) copy[key] = updated;
      else Object.defineProperty(copy, key, { value: updated, enumerable: true, configurable: true, writable: true });
    }
    return copy;
  }
  return visit(root, 0) as T;
}
