// The docs demo's pure core (docs/demo/model.js): its validators decide what "Set state" may write and what a reload
// may restore, so they are tested with real values here; the views are covered by tests/e2e/docs.spec.ts.
import { describe, expect, it } from 'vitest';
import { createStore } from '../../src/index.js';
import {
  addNote, defaults, describeChange, isChat, isForm, isNotes, isUi, jsonTokens, LIMITS, newId, notePath, preview, readPath, receive,
  replyText, samples, send, storedBytes,
} from '../../docs/demo/model.js';

const message = (id: string, from = 'you', text = 'hi') => ({ id, from, text, at: '2026-10-10T09:00:00.000Z' });

describe('docs demo validators', () => {
  it('accept the defaults and the "Set state" samples', () => {
    expect(isForm(defaults.form)).toBe(true);
    expect(isChat(defaults.chat)).toBe(true);
    expect(isNotes(defaults.notes)).toBe(true);
    expect(isUi(defaults.ui)).toBe(true);
    expect(isForm(samples.form)).toBe(true);
    expect(isChat(samples.chat)).toBe(true);
    expect(isNotes(samples.notes)).toBe(true);
  });

  it('reject extra or missing keys, wrong types and values past their limits', () => {
    expect(isForm({ ...defaults.form, admin: true })).toBe(false);
    const { bio: _bio, ...withoutBio } = defaults.form;
    expect(isForm(withoutBio)).toBe(false);
    expect(isForm({ ...defaults.form, newsletter: 'yes' })).toBe(false);
    expect(isForm({ ...defaults.form, plan: 'gold' })).toBe(false);
    expect(isForm({ ...defaults.form, name: 'x'.repeat(LIMITS.name + 1) })).toBe(false);
    expect(isForm(null)).toBe(false);
    expect(isForm([])).toBe(false);
    expect(isUi({ tab: 'settings' })).toBe(false);
  });

  it('reject chats and notes with invalid items, duplicate ids or too many entries', () => {
    expect(isChat({ draft: '', messages: [message('m-1'), message('m-1')] })).toBe(false);
    expect(isChat({ draft: '', messages: [{ ...message('m-1'), text: '   ' }] })).toBe(false);
    expect(isChat({ draft: '', messages: [{ ...message('m-1'), at: 'yesterday' }] })).toBe(false);
    expect(isChat({ draft: '', messages: [{ ...message('m-1'), from: 'bot' }] })).toBe(false);
    expect(isChat({ draft: '', messages: Array.from({ length: LIMITS.messages + 1 }, (_, i) => message(`m-${i}`)) })).toBe(false);
    expect(isNotes({ notes: [{ id: 'Bad Id', text: '' }] })).toBe(false);
    expect(isNotes({ notes: [{ id: 'n-1', text: '' }, { id: 'n-1', text: '' }] })).toBe(false);
    expect(isNotes({ notes: Array.from({ length: LIMITS.notes + 1 }, (_, i) => ({ id: `n-${i}`, text: '' })) })).toBe(false);
  });
});

describe('docs demo state changes', () => {
  it('send clears the draft, receive keeps it, both cap the thread', () => {
    const sent = send({ draft: 'hello', messages: [] }, message('m-1'));
    expect(sent).toEqual({ draft: '', messages: [message('m-1')] });
    const replied = receive({ ...sent, draft: 'typing…' }, message('m-2', 'store'));
    expect(replied.draft).toBe('typing…');
    expect(replied.messages.map((m) => m.id)).toEqual(['m-1', 'm-2']);
    const full = { draft: '', messages: Array.from({ length: LIMITS.messages }, (_, i) => message(`m-${i}`)) };
    const capped = send(full, message('m-new'));
    expect(capped.messages).toHaveLength(LIMITS.messages);
    expect(capped.messages[0]!.id).toBe('m-1');
    expect(isChat(capped)).toBe(true);
    expect(replyText(1)).toContain('1 message under');
    expect(replyText(2)).toContain('2 messages under');
  });

  it('addNote appends and notePath finds a note by id for path writes', () => {
    const notes = addNote(addNote(defaults.notes, 'n-a', 'one'), 'n-b');
    expect(notes).toEqual({ notes: [{ id: 'n-a', text: 'one' }, { id: 'n-b', text: '' }] });
    expect(notePath(notes, 'n-b')).toBe('notes[1]');
    expect(notePath(notes, 'n-missing')).toBeNull();
    // The path drives a real store write.
    const store = createStore(notes);
    store.set(`${notePath(notes, 'n-b')}.text`, 'two');
    expect(store.value.notes[1]!.text).toBe('two');
    expect(store.value.notes[0]).toBe(notes.notes[0]);
  });

  it('newId makes validator-safe ids from injectable sources', () => {
    const id = newId('n', 1_700_000_000_000, () => 0.5);
    expect(id).toMatch(/^n-[a-z0-9]+-[a-z0-9]+$/);
    expect(isNotes({ notes: [{ id, text: '' }] })).toBe(true);
    expect(newId('n', 1, () => 0.1)).not.toBe(newId('n', 1, () => 0.2));
  });
});

describe('docs devtools formatting', () => {
  it('describes path writes, removals and root replacements from a real listener', () => {
    const store = createStore({ items: [{ text: 'a' }, { text: 'b' }], title: 'x' });
    const lines: ReturnType<typeof describeChange>[] = [];
    store.subscribe((next, previous, changedPath) => lines.push(describeChange(next, previous, changedPath)));
    store.set('items[1].text', 'bb');
    store.remove('items[0]');
    store.set({ items: [], title: 'y' });
    expect(lines).toEqual([
      { path: 'items[1].text', kind: 'path', before: '"b"', after: '"bb"' },
      // a splice: index 0 then holds the next item, but the change is the removal
      { path: 'items[0]', kind: 'remove', before: '{"text":"a"}', after: '∅' },
      { path: '(root)', kind: 'root', before: '{"items":[{"text":"bb"}],"title":"x"}', after: '{"items":[],"title":"y"}' },
    ]);
    store.set('title', 'z');
    store.remove('title');
    expect(lines.at(-1)).toEqual({ path: 'title', kind: 'remove', before: '"z"', after: '∅' });
  });

  it('readPath reads own properties only; preview truncates; storedBytes counts UTF-8', () => {
    expect(readPath({ a: [{ b: 1 }] }, 'a[0].b')).toBe(1);
    expect(readPath({ a: [{ b: 1 }] }, 'a.0.b')).toBe(1);
    expect(readPath({}, 'toString')).toBeUndefined();
    expect(readPath({ a: null }, 'a.b')).toBeUndefined();
    expect(preview('x'.repeat(100), 10)).toBe(`"${'x'.repeat(8)}…`);
    expect(preview(undefined)).toBe('∅');
    expect(storedBytes(null)).toBeNull();
    expect(storedBytes('ä')).toBe(2);
  });
});

describe('docs devtools JSON highlighting', () => {
  it('tokenizes keys, strings, numbers and literals and gives the input back', () => {
    const json = JSON.stringify({ name: 'Ada "42" true', n: -1.5e3, ok: true, none: null, list: [1, 'x'] }, null, 2);
    const tokens = jsonTokens(json);
    expect(tokens.map((token) => token.text).join('')).toBe(json);
    expect(tokens.filter((token) => token.type !== 'plain')).toEqual([
      { type: 'key', text: '"name"' }, { type: 'string', text: '"Ada \\"42\\" true"' },
      { type: 'key', text: '"n"' }, { type: 'number', text: '-1500' },
      { type: 'key', text: '"ok"' }, { type: 'literal', text: 'true' },
      { type: 'key', text: '"none"' }, { type: 'literal', text: 'null' },
      { type: 'key', text: '"list"' }, { type: 'number', text: '1' }, { type: 'string', text: '"x"' },
    ]);
  });
});

