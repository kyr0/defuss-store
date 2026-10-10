// Chat demo: a defuss-shadcn Session whose transcript and composer draft are one store. Each keystroke in the composer
// is one synchronous `store.set('draft', value)`, so a reload brings back the half-written message, not only the thread
// (VERIFIED: tests/e2e/docs.spec.ts reloads mid-sentence and finds the draft and both messages).
// Why one store, not a draft store beside a thread store: Set state and the devtools then show the whole chat as one
// value. Rows are plain DOM appends rather than df$.shadcn.session.append(): the Session's own MutationObserver
// follows appended rows (its skill), and reconcile() already owns the order.
import { createStore } from '../assets/defuss-store/browser.js';
import { h, reconcile, withCode } from '../assets/dom.js';
import { defaults, LIMITS, newId, receive, replyText, send } from './model.js';

const REPLY_MS = 700;
const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

function avatar(from) {
  return h('div', { class: 'message-avatar' },
    h('span', { class: 'avatar', 'data-size': 'sm' }, h('span', { class: 'avatar-fallback', text: from === 'you' ? 'You' : 'DS' })));
}

function row(message) {
  const mine = message.from === 'you';
  return h('div', { class: 'session-item', 'data-message-id': message.id },
    h('div', { class: 'message', 'data-align': mine ? 'end' : null },
      avatar(message.from),
      h('div', { class: 'message-content' },
        h('div', { class: 'message-header' },
          h('span', { class: 'message-name', text: mine ? 'You' : 'defuss-store' }),
          h('time', { class: 'message-time', datetime: message.at, text: time(message.at) })),
        h('div', { class: 'bubble', 'data-variant': mine ? null : 'secondary' }, h('div', { class: 'bubble-content' }, withCode(message.text))))));
}

function typingRow() {
  return h('div', { class: 'session-item', 'data-typing': true },
    h('div', { class: 'message' }, avatar('store'),
      h('div', { class: 'message-content' },
        h('div', { class: 'bubble', 'data-variant': 'secondary' },
          h('div', { class: 'bubble-content', role: 'status', 'aria-label': 'defuss-store is typing' },
            h('span', { class: 'bubble-typing', 'aria-hidden': 'true' }, h('span'), h('span'), h('span')))))));
}

export function chatDemo(panel) {
  const store = createStore(defaults.chat);
  const session = panel.querySelector('.session');
  const content = session.querySelector('.session-content');
  const composer = panel.querySelector('.textarea-group');
  const draft = composer.querySelector('textarea');
  const count = composer.querySelector('.textarea-group-count');
  const sendButton = composer.querySelector('[type="submit"]');
  let typing = null;
  let marker = null; // the "Restored from localStorage" separator, and the id of the message it sits under

  // Store → view: the draft and the transcript are two selections, so typing never re-renders the thread.
  store.subscribe((chat) => chat.draft, (text) => {
    if (draft.value !== text) draft.value = text;
    count.textContent = `${text.length} / ${LIMITS.draft}`;
    sendButton.disabled = text.trim() === '';
  }, { immediate: true });
  store.subscribe((chat) => chat.messages, (messages) => {
    // The separator only means something while the message it follows is still there (not after Reset or Set state).
    if (marker && !messages.some((message) => message.id === marker.after)) { marker.el.remove(); marker = null; }
    reconcile(content, messages, (message) => message.id, row, () => {}, typing);
  }, { immediate: true });

  // View → store.
  draft.addEventListener('input', () => store.set('draft', draft.value));
  draft.addEventListener('keydown', (event) => {
    // Enter sends, Shift+Enter breaks the line; an IME composition keeps its Enter.
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); composer.requestSubmit(); }
  });
  composer.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = store.value.draft.trim();
    if (!text) return;
    store.update((chat) => send(chat, { id: newId('m'), from: 'you', text, at: new Date().toISOString() }));
    reply();
  });

  // The local "assistant": a typing row while the Session streams, then one more message in the store.
  function reply() {
    if (typing) return;
    typing = typingRow();
    content.append(typing);
    session.api.setState('streaming');
    setTimeout(() => {
      typing.remove();
      typing = null;
      if (store.destroyed) return;
      store.update((chat) => receive(chat, { id: newId('m'), from: 'store', text: replyText(chat.messages.length + 1), at: new Date().toISOString() }));
      session.api.setState('default');
    }, REPLY_MS);
  }

  /** After a reload restored a thread: a separator under it, so new messages read as new. */
  function restored() {
    const last = store.value.messages.at(-1);
    if (!last || marker) return;
    // No data-key: reconcile() leaves it alone, and new messages are appended after it.
    const el = h('div', { class: 'session-item' },
      h('div', { class: 'marker', 'data-variant': 'separator' }, h('span', { class: 'marker-content', text: 'Restored from localStorage' })));
    content.append(el);
    marker = { el, after: last.id };
  }

  return { name: 'chat', store, restored };
}
