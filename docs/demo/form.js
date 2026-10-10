// Form demo: every field is one key of one store. Typing writes a path (`store.set('name', value)`), the form follows
// the store through one subscription, and persistence (attached by app.js) writes each commit to localStorage.
// Path writes rather than reading the whole form (FormData) into one root replacement: the devtools then name the field
// that changed, and untouched fields keep their references (VERIFIED: the devtools e2e types "Ad" and finds
// `form name: "A" → "Ad"`).
import { createStore } from '../assets/defuss-store/browser.js';
import { defaults } from './model.js';

export function formDemo(panel) {
  const store = createStore(defaults.form);
  const form = panel.querySelector('form');

  // Store → form. Whoever wrote the value - the keyboard, "Set state", a reload or another tab - the fields follow.
  store.subscribe((value) => {
    for (const [name, next] of Object.entries(value)) {
      const field = form.elements.namedItem(name);
      if (field instanceof RadioNodeList) field.value = next;
      else if (field.type === 'checkbox') field.checked = next;
      else if (field.value !== next) field.value = next;
    }
  }, { immediate: true });

  // Form → store: one path write per edit, so the devtools log `name: "Ad" → "Ada"`, not a root replacement.
  form.addEventListener('input', (event) => {
    const field = event.target;
    if (field.name) store.set(field.name, field.type === 'checkbox' ? field.checked : field.value);
  });
  form.addEventListener('submit', (event) => event.preventDefault());
  // Reset restores the initial reference; persistence then stores the defaults like any other commit.
  form.addEventListener('reset', (event) => { event.preventDefault(); store.reset(); });

  return { name: 'form', store };
}
