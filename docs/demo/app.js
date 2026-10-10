// The demo app's composition root. Each demo owns its store and its view; this file wires them to persistence, the
// devtools, the Get/Set state dialog and the tabs. Order matters once: the devtools subscribe to a store before its
// persistence attaches, so the restore after a reload appears in the log like any other change (VERIFIED: the reload
// smoke run logged `form (root): {...} → {...}` before "restored"). Persistence is attached here, not inside each demo,
// so the demos stay plain store + view modules that never touch storage.
import { bindState, createStore } from '../assets/defuss-store/browser.js';
import { persist, persistent, storage } from '../assets/persist.js';
import { theme, themePersistence } from '../assets/theme.js';
import { chatDemo } from './chat.js';
import { createDevtools } from './devtools.js';
import { formDemo } from './form.js';
import { defaults, isChat, isForm, isNotes, isUi, KEYS, samples, TABS, clock } from './model.js';
import { notesDemo } from './notes.js';
import { createStateDialog } from './state-dialog.js';

const $ = (id) => document.getElementById(id);
const devtools = createDevtools($('devtools'), storage, persistent() ? 'localStorage' : 'memory');
const dialog = createStateDialog($('state-dialog'));

const demos = {
  form: { ...formDemo($('panel-form')), key: KEYS.form, validate: isForm, sample: samples.form, shape: '{ name, email, role, plan, newsletter, bio } and nothing else' },
  chat: { ...chatDemo($('panel-chat')), key: KEYS.chat, validate: isChat, sample: samples.chat, shape: '{ draft, messages: [{ id, from, text, at }] } with up to 50 messages' },
  notes: { ...notesDemo($('panel-notes')), key: KEYS.notes, validate: isNotes, sample: samples.notes, shape: '{ notes: [{ id, text }] } with up to 24 notes' },
};

if (!persistent()) $('memory-only').hidden = false;

for (const demo of Object.values(demos)) {
  const entry = devtools.watch(demo.name, demo.store, { key: demo.key });
  const saved = $(`panel-${demo.name}`).querySelector('[data-saved]');
  demo.store.subscribe(() => { saved.textContent = `${persistent() ? 'Saved' : 'In memory'} · ${clock()}`; });
  demo.persistence = persist(demo.store, demo.key, demo.validate, (failure) => {
    saved.textContent = `Not saved: ${failure.operation} failed`;
    devtools.note(demo.name, `persistence ${failure.operation} failed: ${failure.error?.message ?? failure.error}`, 'destructive');
  });
  entry.persistence = demo.persistence;
  const restored = demo.persistence.status().hasStoredValue;
  if (restored) {
    saved.textContent = 'Restored from localStorage';
    demo.restored?.();
  }
  devtools.note(demo.name, restored ? `attachPersistence(): restored from "${demo.key}"` : `attachPersistence(): nothing stored under "${demo.key}" yet`);
}

// The page theme (shared with the landing page through sync: true) shows up here as just another store.
devtools.watch('theme', theme, { key: 'defuss-shadcn-theme' }).persistence = themePersistence;

// Which tab is open is state too: a persisted ui store, bound to the tablist's State API with bindState().
const ui = createStore(defaults.ui);
devtools.watch('ui', ui, { key: KEYS.ui }).persistence = persist(ui, KEYS.ui, isUi, (failure) => {
  devtools.note('ui', `persistence ${failure.operation} failed: ${failure.error?.message ?? failure.error}`, 'destructive');
});
const tablist = $('demo-tabs');
bindState(tablist, ui, {
  select: (value) => value.tab,
  toState: (tab) => ({ name: 'active', config: { id: `tab-${tab}` } }),
  fromState: (state, current) => {
    const tab = String(state.config.id ?? '').replace(/^tab-/, '');
    return TABS.includes(tab) ? { ...current, tab } : current;
  },
});
ui.subscribe((value) => value.tab, (tab) => devtools.focus(tab), { immediate: true });

// defuss-shadcn components keep their own state in defuss-store stores, exposed as el.store: subscribe like any store.
devtools.watch('tabs.store', tablist.store, { origin: 'defuss-shadcn tabs (el.store)' });
devtools.watch('layout.store', $('layout').store, { origin: 'defuss-shadcn border layout (el.store)', key: 'data-save="defuss-store-docs:layout"' });

for (const button of document.querySelectorAll('[data-action]')) {
  button.addEventListener('click', () => dialog.open(button.dataset.action, demos[button.dataset.demo]));
}
