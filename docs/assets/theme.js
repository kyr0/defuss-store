// The page theme is a defuss-store store as well: 'system', 'light' or 'dark', persisted under the key the defuss-shadcn
// sites use and synchronized through native storage events. So one switch on the landing page repaints the demo frame
// and every open demo tab, with no message protocol between them.
// Why not paint the frame from the parent page: storage events reach every same-origin document, a full-screen tab
// included, while a parent reaches only its own frames. VERIFIED: tests/e2e/docs.spec.ts sees the frame follow the
// switch, and a store change in a second demo tab reach the first.
import { createStore } from './defuss-store/browser.js';
import { persist } from './persist.js';

export const THEMES = ['system', 'light', 'dark'];
export const isTheme = (value) => THEMES.includes(value);

const prefersDark = matchMedia('(prefers-color-scheme: dark)');
const root = document.documentElement;
export const isDark = (value) => value === 'dark' || (value === 'system' && prefersDark.matches);
function paint(value) {
  const dark = isDark(value);
  root.classList.toggle('dark', dark);
  root.style.colorScheme = dark ? 'dark' : 'light';
}

export const theme = createStore('system');
// Subscribed before persistence attaches, so the restored value paints too (the head script already painted it once,
// before the stylesheets, to avoid a flash).
theme.subscribe(paint, { immediate: true });
prefersDark.addEventListener('change', () => paint(theme.value));
export const themePersistence = persist(theme, 'defuss-shadcn-theme', isTheme, (failure) => {
  console.warn(`theme persistence: ${failure.operation} failed`, failure.error);
});

/** The visitor picked a theme: store it, and replace unreadable stored bytes on purpose (a paused controller). */
export function setTheme(value) {
  theme.set(value);
  if (themePersistence.status().phase === 'paused') themePersistence.flush();
}
