// A tiny DOM builder shared by the landing page and the demo (taken from the defuss-dom-router docs). The views build
// nodes, never HTML strings, so they need no morphing (defuss-morph) - only the keyed append below.
// VERIFIED: notes, chat messages and "Set state" JSON are visitor-controlled, so this builder only creates elements,
// attributes and text nodes. Template strings through innerHTML would be shorter, but every interpolation would then be
// an HTML sink to escape by hand.

/** h('a', { class, text, href, 'data-x': true }, ...children): null/false props and children are skipped,
 * `true` sets an empty attribute, strings become text nodes. */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) if (child != null && child !== false) el.append(child);
  return el;
}

/**
 * Keeps the keyed children (`data-key`) of `container` in step with `items`: removes the ones whose key is gone,
 * appends new ones before `anchor`, and calls `update` on every kept or created element. While the kept keys stay in
 * order, existing nodes are never moved - moving a focused textarea would drop its caret - otherwise the keyed
 * children are rebuilt. Children without `data-key` (a static intro row) are left alone.
 */
export function reconcile(container, items, keyOf, create, update, anchor = null) {
  const keys = items.map(keyOf);
  const wanted = new Set(keys);
  const kept = [];
  // A copy: children is a live collection, and removing from it while iterating would skip elements.
  for (const el of Array.from(container.children)) {
    if (el.dataset.key === undefined) continue;
    if (wanted.has(el.dataset.key)) kept.push(el);
    else el.remove();
  }
  const inOrder = kept.every((el, i) => el.dataset.key === keys[i]);
  if (!inOrder) for (const el of kept.splice(0)) el.remove();
  items.forEach((item, i) => {
    let el = kept[i];
    if (!el) {
      el = create(item, i);
      el.dataset.key = keys[i];
      container.insertBefore(el, anchor);
    }
    update(el, item, i);
  });
}

// A function call in running text: a name (dots allowed), then one pair of parentheses - get(path), store.set(),
// set(…). Nested parentheses are not matched; the site's prose has none.
const CALL = /[A-Za-z_$][\w$.]*\([^()]*\)/g;

/** Splits text at function calls: [{ text, call }], in order, empty pieces dropped. Pure, so Node tests it. */
export function splitCalls(text) {
  const parts = [];
  let last = 0;
  for (const match of text.matchAll(CALL)) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index), call: false });
    parts.push({ text: match[0], call: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), call: false });
  return parts;
}

/** Text as nodes for h() or replaceChildren(): every function call in a <code>, the rest as plain text. */
export const withCode = (text) => splitCalls(text).map((part) => (part.call ? h('code', { text: part.text }) : part.text));

/** An inline sprite icon: <svg class="ds-icon"><use href="#i-name"/></svg>. */
export function icon(name, extra = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', `ds-icon${extra ? ` ${extra}` : ''}`);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}
