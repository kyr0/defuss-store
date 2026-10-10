// The landing page script. index.html loads defuss-shadcn (df$) from jsDelivr first; this module wires the page.
// Its one piece of state, the theme, is a defuss-store store (./theme.js) - the same library the demo below shows.
import { initScaling } from './scaling.js';
import { isDark, setTheme, theme } from './theme.js';

const $ = (id) => document.getElementById(id);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

// ---- theme: one store, persisted with sync: true, so the demo frame and full-screen demo tabs follow -------------
const themeToggle = $('theme-toggle');
theme.subscribe((value) => { themeToggle.checked = isDark(value); }, { immediate: true });
themeToggle.addEventListener('change', () => setTheme(themeToggle.checked ? 'dark' : 'light'));

// ---- how it scales: charts and table from assets/bench.json, loaded when the section comes near -----------------
initScaling($('scaling'));

// ---- the demo frame ------------------------------------------------------------------------------------------------
const frame = document.querySelector('#playground iframe');
// A real reload of the frame's document: every store in it is created again and restored from localStorage.
$('playground-reload').addEventListener('click', () => frame.contentWindow?.location.reload());

// ---- in-page links scroll without adding history entries (the defuss-dom-router docs' behaviour) -------------------
// Layout offsets, not scrollIntoView(). HYPOTHESIS: a section still in its scroll-driven reveal is transformed, and
// scrollIntoView() would measure the transformed box and land off its margin - VERIFIED on the defuss-dom-router docs,
// whose sections use the same reveal; falsified if scrollIntoView() lands at the margin here.
document.addEventListener('click', (event) => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const anchor = event.target.closest('a[href^="#"]');
  let id = '';
  try { id = anchor ? decodeURIComponent(anchor.hash.slice(1)) : ''; } catch { return; }
  const target = id && document.getElementById(id);
  if (!target) return;
  event.preventDefault();
  let top = 0;
  for (let node = target; node; node = node.offsetParent) top += node.offsetTop;
  scrollTo({ top: top - parseFloat(getComputedStyle(target).scrollMarginTop || '0'), behavior: reducedMotion.matches ? 'auto' : 'smooth' });
  history.replaceState(history.state, '', anchor.hash);
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
});

// ---- copy buttons --------------------------------------------------------------------------------------------------
async function copyText(text, status, label) {
  try {
    await navigator.clipboard.writeText(text);
    status.textContent = 'Copied';
  } catch {
    status.textContent = 'Copy failed';
  }
  if (!label) return;
  label.textContent = status.textContent;
  setTimeout(() => { label.textContent = 'Copy prompt'; }, 2000);
}
for (const button of document.querySelectorAll('.mk-code-block-copy')) {
  button.addEventListener('click', () => {
    const block = button.closest('.mk-code-block');
    const tab = block.querySelector('.mk-code-block-tabs input:checked')?.value;
    const pre = tab ? block.querySelector(`pre[data-tab="${tab}"]`) : block.querySelector('pre');
    const lines = [...pre.querySelectorAll('code > span')].map((line) => line.textContent);
    void copyText(lines.join('\n'), block.querySelector('.mk-code-block-status'));
  });
}
$('copy-prompt').addEventListener('click', () => void copyText(
  [...document.querySelectorAll('#agent-prompt pre:not([data-tone]) code')].map((code) => code.textContent).join('\n'),
  $('copy-prompt-status'), $('copy-prompt').querySelector('span')));
