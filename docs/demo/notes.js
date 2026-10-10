// Notes demo: yellow sticky notes (the look of the defuss-vectorsearch notes board) kept in one store,
// { notes: [{ id, text }] }. Typing writes `store.set('notes[2].text', value)`, deleting `store.remove('notes[2]')`.
// VERIFIED: the notes e2e logs `notes[2].text` while typing and finds the board unchanged after a reload.
import { createStore } from '../assets/defuss-store/browser.js';
import { h, icon, reconcile } from '../assets/dom.js';
import { persistent } from '../assets/persist.js';
import { addNote, clock, defaults, LIMITS, newId, notePath } from './model.js';

function note(item) {
  const field = `note-${item.id}-text`;
  return h('article', { class: 'ds-note', id: `note-${item.id}`, 'data-id': item.id },
    h('div', { class: 'ds-note-head' },
      h('label', { class: 'ds-note-label', for: field }),
      h('button', { class: 'btn ds-note-delete', type: 'button', 'data-variant': 'ghost', 'data-size': 'icon-xs', 'data-delete-note': true }, icon('trash'))),
    h('textarea', { class: 'textarea ds-note-text', id: field, rows: 4, maxlength: LIMITS.note, placeholder: 'Write anything…' }),
    h('p', { class: 'ds-note-status', role: 'status' }));
}

export function notesDemo(panel) {
  const store = createStore(defaults.notes);
  const list = panel.querySelector('.ds-notes');
  const empty = panel.querySelector('.mk-empty-state');
  const count = panel.querySelector('[data-notes-count]');
  const add = panel.querySelector('[data-add-note]');

  // Store → board. Kept notes are updated in place, so the note being typed keeps its caret when another tab writes.
  store.subscribe((value) => value.notes, (notes) => {
    reconcile(list, notes, (item) => item.id, note, (el, item, i) => {
      el.querySelector('.ds-note-label').textContent = `Note ${i + 1}`;
      el.querySelector('.ds-note-delete').setAttribute('aria-label', `Delete note ${i + 1}`);
      const text = el.querySelector('textarea');
      if (text.value !== item.text) text.value = item.text;
    });
    empty.hidden = notes.length > 0;
    count.textContent = `${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`;
    add.disabled = notes.length >= LIMITS.notes;
  }, { immediate: true });

  // Board → store: paths, so the devtools show which note changed.
  add.addEventListener('click', () => {
    const id = newId('n');
    store.update((value) => addNote(value, id));
    document.getElementById(`note-${id}-text`)?.focus();
  });
  list.addEventListener('input', (event) => {
    const el = event.target.closest('.ds-note');
    const path = el && notePath(store.value, el.dataset.id);
    if (!path) return;
    store.set(`${path}.text`, event.target.value);
    el.querySelector('.ds-note-status').textContent = `${persistent() ? 'Saved to localStorage' : 'Kept in memory'} · ${clock()}`;
  });
  list.addEventListener('click', (event) => {
    const button = event.target.closest('[data-delete-note]');
    const path = button && notePath(store.value, button.closest('.ds-note').dataset.id);
    if (!path) return;
    store.remove(path);
    add.focus();
  });

  return { name: 'notes', store };
}
