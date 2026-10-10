// The demo app's pure core: defaults, validators, the state changes the views make, samples for "Set state" and the
// devtools' change formatting. No DOM, no storage. VERIFIED: tests/unit/docs-model.test.ts runs it in Node with real
// values, including real store writes through notePath() and describeChange().
// Why validators are hand-written: attachPersistence() requires one on every read and write, and this file shows what
// "validate" means for real state - exact keys, types and limits - instead of hiding it behind a schema library.

export const KEYS = {
  form: 'defuss-store-docs:form',
  chat: 'defuss-store-docs:chat',
  notes: 'defuss-store-docs:notes',
  ui: 'defuss-store-docs:ui',
};

export const LIMITS = { name: 80, email: 120, bio: 500, draft: 500, messages: 50, notes: 24, note: 1000 };
export const ROLES = ['', 'engineer', 'designer', 'manager', 'other'];
export const PLANS = ['hobby', 'team', 'enterprise'];
export const TABS = ['form', 'chat', 'notes'];

export const defaults = {
  form: { name: '', email: '', role: '', plan: 'hobby', newsletter: false, bio: '' },
  chat: { draft: '', messages: [] },
  notes: { notes: [] },
  ui: { tab: 'form' },
};

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
// Exactly these keys: an unknown key is rejected, so "Set state" cannot smuggle fields into storage.
const hasKeys = (value, keys) => isRecord(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const isText = (value, max) => typeof value === 'string' && value.length <= max;
const isId = (value) => typeof value === 'string' && /^[a-z0-9-]{1,40}$/.test(value);

export function isForm(value) {
  return hasKeys(value, ['name', 'email', 'role', 'plan', 'newsletter', 'bio'])
    && isText(value.name, LIMITS.name) && isText(value.email, LIMITS.email)
    && ROLES.includes(value.role) && PLANS.includes(value.plan)
    && typeof value.newsletter === 'boolean' && isText(value.bio, LIMITS.bio);
}

export function isMessage(value) {
  return hasKeys(value, ['id', 'from', 'text', 'at']) && isId(value.id) && (value.from === 'you' || value.from === 'store')
    && isText(value.text, LIMITS.draft) && value.text.trim() !== '' && typeof value.at === 'string' && !Number.isNaN(Date.parse(value.at));
}

export function isChat(value) {
  return hasKeys(value, ['draft', 'messages']) && isText(value.draft, LIMITS.draft)
    && Array.isArray(value.messages) && value.messages.length <= LIMITS.messages && value.messages.every(isMessage)
    && new Set(value.messages.map((message) => message.id)).size === value.messages.length;
}

export function isNote(value) {
  return hasKeys(value, ['id', 'text']) && isId(value.id) && isText(value.text, LIMITS.note);
}

export function isNotes(value) {
  return hasKeys(value, ['notes']) && Array.isArray(value.notes) && value.notes.length <= LIMITS.notes && value.notes.every(isNote)
    && new Set(value.notes.map((note) => note.id)).size === value.notes.length;
}

export const isUi = (value) => hasKeys(value, ['tab']) && TABS.includes(value.tab);

/** A short unique id from a clock and a random source; both injectable so tests stay deterministic. */
export const newId = (prefix, now = Date.now(), random = Math.random) => `${prefix}-${now.toString(36)}-${Math.floor(random() * 36 ** 4).toString(36)}`;

/** The chat after sending the draft: the message is appended, the draft cleared, the oldest dropped past the limit. */
export function send(chat, message) {
  return { draft: '', messages: [...chat.messages, message].slice(-LIMITS.messages) };
}

/** The chat after a reply arrives: appended like a sent message, but a draft typed meanwhile stays. */
export function receive(chat, message) {
  return { draft: chat.draft, messages: [...chat.messages, message].slice(-LIMITS.messages) };
}

/** The local "assistant" reply: a fact about the state it just stored, so the chat explains the library while it runs. */
export function replyText(count) {
  return `Stored. This thread now holds ${count} ${count === 1 ? 'message' : 'messages'} under "${KEYS.chat}". Reload the page: they come back, and so does your next draft.`;
}

export const addNote = (notes, id, text = '') => ({ notes: [...notes.notes, { id, text }].slice(-LIMITS.notes) });

/** Path of a note (`notes[2]`) for store.set(`${path}.text`, value) and store.remove(path); null for an unknown id. */
export const notePath = (notes, id) => {
  const index = notes.notes.findIndex((note) => note.id === id);
  return index < 0 ? null : `notes[${index}]`;
};

/** What "Set state" offers to apply: a valid value that differs from the defaults in every field. */
export const samples = {
  form: { name: 'Ada Lovelace', email: 'ada@example.org', role: 'engineer', plan: 'team', newsletter: true, bio: 'Written by store.set(value) - the form followed the store.' },
  chat: {
    draft: 'This draft came from store.set(), not from the keyboard.',
    messages: [
      { id: 'm-sample-1', from: 'you', text: 'Does my draft survive a reload?', at: '2026-10-10T09:00:00.000Z' },
      { id: 'm-sample-2', from: 'store', text: 'Yes. Every keystroke is one synchronous store.set(\'draft\', value), validated and written to localStorage.', at: '2026-10-10T09:00:01.000Z' },
    ],
  },
  notes: {
    notes: [
      { id: 'n-sample-1', text: 'Notes live in one store: { notes: [{ id, text }] }.' },
      { id: 'n-sample-2', text: 'Typing writes store.set(\'notes[1].text\', value) - watch the devtools.' },
      { id: 'n-sample-3', text: 'Open the demo in a second tab: sync: true keeps both in step.' },
    ],
  },
};

const segments = (path) => path.split(/[.[\]]/).filter(Boolean);

/** Reads a dot/bracket path from a snapshot; own properties only, like store.get(path). */
export function readPath(value, path) {
  let current = value;
  for (const segment of segments(path)) {
    if (current === null || typeof current !== 'object' || !Object.hasOwn(current, segment)) return undefined;
    current = current[segment];
  }
  return current;
}

/** A one-line JSON preview, cut at `max` characters; undefined (a removed path) reads as ∅. */
export function preview(value, max = 48) {
  if (value === undefined) return '∅';
  const text = JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * One devtools log line from a listener's (next, previous, changedPath): the path written (or the root), the value
 * before and after at that path, and its kind - `path`, `root` (set/reset/restore/another tab) or `remove`.
 */
export function describeChange(next, previous, changedPath) {
  if (changedPath === undefined) return { path: '(root)', kind: 'root', before: preview(previous), after: preview(next) };
  const before = preview(readPath(previous, changedPath));
  // remove('items[0]') splices: the index then holds the next item, so a shrinking parent array means removal.
  const parent = segments(changedPath).slice(0, -1).join('.');
  const [was, is] = [readPath(previous, parent), readPath(next, parent)];
  const spliced = Array.isArray(was) && Array.isArray(is) && is.length < was.length;
  const after = readPath(next, changedPath);
  if (spliced || after === undefined) return { path: changedPath, kind: 'remove', before, after: '∅' };
  return { path: changedPath, kind: 'path', before, after: preview(after) };
}

// One JSON token: a string (a key when a colon follows), a number, or true/false/null. Strings match first, so digits
// and words inside them stay part of the string.
const JSON_TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b/g;

/**
 * JSON.stringify output as [{ type, text }] for highlighting: key, string, number, literal, and plain for punctuation
 * and whitespace. Concatenating every text gives the input back.
 */
export function jsonTokens(json) {
  const tokens = [];
  let last = 0;
  for (const match of json.matchAll(JSON_TOKEN)) {
    if (match.index > last) tokens.push({ type: 'plain', text: json.slice(last, match.index) });
    const [, string, colon, number, literal] = match;
    if (string !== undefined) {
      tokens.push({ type: colon ? 'key' : 'string', text: string });
      if (colon) tokens.push({ type: 'plain', text: colon });
    } else if (number !== undefined) tokens.push({ type: 'number', text: number });
    else tokens.push({ type: 'literal', text: literal });
    last = match.index + match[0].length;
  }
  if (last < json.length) tokens.push({ type: 'plain', text: json.slice(last) });
  return tokens;
}

/** UTF-8 size of a stored string, for "214 B stored"; null when the key is absent. */
export const storedBytes = (raw) => (raw === null ? null : new TextEncoder().encode(raw).length);

/** hh:mm:ss in the visitor's locale, for log lines and "Saved" badges. */
export const clock = (date = new Date()) => date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
