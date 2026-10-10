// Store devtools, built only from the public API: one `store.subscribe((next, previous, changedPath) => ...)` per
// store feeds the log, `store.get()` the snapshot, `persistence.status()` the storage facts. It works the same for the
// demo stores and for the stores defuss-shadcn components expose as `el.store`.
import { h, withCode } from '../assets/dom.js';
import { clock, describeChange, jsonTokens, storedBytes } from './model.js';

const MAX_LINES = 200;
const tones = { root: 'info', remove: 'warning' };

/** `storage` is the adapter the stores persist to; `area` names it in the facts: localStorage, or memory when blocked. */
export function createDevtools(panel, storage, area) {
  const log = panel.querySelector('#dt-log');
  const filter = panel.querySelector('#dt-filter');
  const snapshot = panel.querySelector('#dt-snapshot');
  const snapshotTitle = panel.querySelector('#dt-snapshot-title');
  const facts = panel.querySelector('#dt-persistence');
  const reset = panel.querySelector('#dt-reset');
  const clear = panel.querySelector('#dt-clear-key');
  const total = panel.querySelector('#dt-count');
  const watched = new Map(); // name → { store, key, persistence, origin }
  let active = 'form';
  let changes = 0;

  const shown = () => (filter.value === 'all' ? active : filter.value);

  function line(name, text, tone) {
    const pre = h('pre', { 'data-store': name, 'data-tone': tone },
      h('code', {}, h('span', { class: 'ds-log-time', text: clock() }), ' ', h('span', { class: 'ds-log-store', text: name }), ` ${text}`));
    pre.hidden = filter.value !== 'all' && filter.value !== name;
    log.prepend(pre);
    while (log.children.length > MAX_LINES) log.lastElementChild.remove();
  }

  function fact(label, value) {
    return h('div', {}, h('dt', { text: label }), h('dd', { text: value }));
  }

  // The selected store's snapshot and storage facts, read once per burst of changes. Deferred to a microtask because
  // this listener subscribed before persistence did. VERIFIED: read synchronously, the status showed dirty: true and
  // nothing stored right after a write.
  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => { scheduled = false; render(); });
  }

  function render() {
    const name = shown();
    const entry = watched.get(name);
    if (!entry) return;
    snapshotTitle.replaceChildren(h('code', { text: `${name}.get()` }));
    // Highlighted as text nodes and spans, never as markup: the snapshot holds visitor text.
    snapshot.replaceChildren(...jsonTokens(JSON.stringify(entry.store.get(), null, 2))
      .map((token) => (token.type === 'plain' ? token.text : h('span', { class: `ds-json-${token.type}`, text: token.text }))));
    if (entry.persistence) {
      const status = entry.persistence.status();
      const bytes = storedBytes(storage.getItem(entry.key));
      facts.replaceChildren(
        fact('key', entry.key),
        fact('phase', status.phase),
        fact('dirty', String(status.dirty)),
        fact('stored', bytes === null ? 'nothing' : `${bytes.toLocaleString('en-US')} B in ${area}`),
        fact('last error', status.lastError ? status.lastError.operation : 'none'));
    } else {
      facts.replaceChildren(fact('owner', entry.origin), fact('persisted by', entry.key ?? 'nobody: memory only'));
    }
    reset.disabled = !entry.persistence;
    clear.disabled = !entry.persistence;
  }

  /** Subscribe to a store. Call before attaching persistence, so the restore after a reload shows up as a change. */
  function watch(name, store, { key = null, origin = 'this page' } = {}) {
    const entry = { store, key, persistence: null, origin };
    watched.set(name, entry);
    store.subscribe((next, previous, changedPath) => {
      const change = describeChange(next, previous, changedPath);
      changes++;
      total.replaceChildren(...withCode(`${changes} ${changes === 1 ? 'change' : 'changes'} via store.subscribe()`));
      line(name, `${change.path}: ${change.before} → ${change.after}`, tones[change.kind]);
      schedule();
    });
    return entry;
  }

  /** A muted line that is not a change: what attachPersistence() found, or a storage error. */
  function note(name, text, tone = 'muted') {
    line(name, text, tone);
    schedule();
  }

  filter.addEventListener('change', () => {
    for (const pre of log.children) pre.hidden = filter.value !== 'all' && filter.value !== pre.dataset.store;
    render();
  });
  reset.addEventListener('click', () => watched.get(shown())?.store.reset());
  clear.addEventListener('click', () => {
    const name = shown();
    // clear() removes only the stored key; memory keeps the state until the next change writes it again.
    if (watched.get(name)?.persistence?.clear()) note(name, 'persistence.clear(): key removed, memory kept - reload to see the defaults');
  });
  panel.querySelector('#dt-log-clear').addEventListener('click', () => log.replaceChildren());

  return {
    watch,
    note,
    /** The demo whose tab is open: the snapshot follows it while the filter shows all stores. */
    focus(name) { active = name; schedule(); },
  };
}
