import { describe, expect, it } from 'vitest';
import {
  compareVersions,
  firstParagraph,
  loadNotes,
  mayShowNotes,
  parseNote,
  pickNote,
  type WhatsNewNote,
  whatsNewNotes,
  whatsNewTopic,
} from './whats-new.ts';

const note = (version: string, over: Partial<WhatsNewNote> = {}): WhatsNewNote => ({
  version,
  title: `Note ${version}`,
  pages: ['welcome'],
  body: 'First words.\n\nMore words.',
  ...over,
});

describe('compareVersions', () => {
  it('compares as numbers', () => {
    expect(compareVersions('0.40.0', '0.9.0')).toBeGreaterThan(0);
    expect(compareVersions('0.9.0', '0.40.0')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('0.40.1', '0.40.0')).toBeGreaterThan(0);
  });
});

describe('pickNote', () => {
  const notes = [note('0.9.0'), note('0.40.0'), note('0.41.0')];
  it('returns the newest note not newer than the app', () => {
    expect(pickNote(notes, '0.40.2', null)?.version).toBe('0.40.0');
    expect(pickNote(notes, '0.41.0', null)?.version).toBe('0.41.0');
  });
  it('compares numerically, not as text', () => {
    expect(pickNote([note('0.9.0')], '0.40.0', null)?.version).toBe('0.9.0');
    expect(pickNote([note('0.40.0')], '0.9.0', null)).toBeNull();
  });
  it('skips notes at or below the one already closed', () => {
    expect(pickNote(notes, '0.41.0', '0.41.0')).toBeNull();
    expect(pickNote(notes, '0.41.0', '0.40.0')?.version).toBe('0.41.0');
    expect(pickNote(notes, '0.40.0', '0.9.0')?.version).toBe('0.40.0');
  });
  it('returns null with no notes or a very old app', () => {
    expect(pickNote([], '0.40.0', null)).toBeNull();
    expect(pickNote(notes, '0.1.0', null)).toBeNull();
  });
});

describe('mayShowNotes', () => {
  it('hides notes from a brand-new person (no chats, nothing closed before)', () => {
    expect(mayShowNotes(0, null)).toBe(false);
    expect(mayShowNotes(null, null)).toBe(false);
    expect(mayShowNotes(0, undefined)).toBe(false);
  });
  it('shows them with an earlier chat, or after a note was closed before', () => {
    expect(mayShowNotes(1, null)).toBe(true);
    expect(mayShowNotes(0, '0.30.0')).toBe(true);
  });
});

describe('parseNote and loadNotes', () => {
  const good = '---\nversion: 0.40.0\ntitle: Hello\npages: [welcome, dock-app]\n---\n\nWords here.\n';
  it('parses a good note', () => {
    expect(parseNote('0.40.0.md', good)).toEqual({
      ok: true,
      note: { version: '0.40.0', title: 'Hello', pages: ['welcome', 'dock-app'], body: 'Words here.' },
    });
  });
  it('rejects bad ones by name', () => {
    expect(parseNote('0.40.0.md', 'no frontmatter').ok).toBe(false);
    expect(parseNote('0.41.0.md', good).ok).toBe(false);
    expect(parseNote('x.md', good.replace('0.40.0', 'x')).ok).toBe(false);
    expect(parseNote('0.40.0.md', good.replace('pages: [welcome, dock-app]', '')).ok).toBe(false);
    expect(parseNote('0.40.0.md', good.replace('Words here.', '')).ok).toBe(false);
  });
  it('loads newest first and leaves bad files out', () => {
    const files = {
      'a/0.9.0.md': good.replaceAll('0.40.0', '0.9.0'),
      'a/0.40.0.md': good,
      'a/bad.md': 'nope',
    };
    expect(loadNotes(files).map((n) => n.version)).toEqual(['0.40.0', '0.9.0']);
  });
  it('bundles the 0.84.0, 0.82.0 and 0.81.0 notes, newest first', () => {
    expect(whatsNewNotes.slice(0, 3).map((n) => n.version)).toEqual(['0.84.0', '0.82.0', '0.81.0']);
  });
});

describe('firstParagraph and whatsNewTopic', () => {
  it('takes the first paragraph as plain text', () => {
    expect(firstParagraph('One **bold** [link](help:x).\nstill one.\n\nTwo.')).toBe(
      'One bold link. still one.',
    );
  });
  it('lists notes newest first with links to named pages', () => {
    const t = whatsNewTopic(
      [note('0.41.0'), note('0.40.0')],
      (id) => (id === 'welcome' ? 'Welcome' : undefined),
      '2026-11-15',
    );
    expect(t?.id).toBe('whats-new');
    expect(t?.since).toBe('0.41.0');
    expect((t?.body ?? '').indexOf('0.41.0')).toBeLessThan((t?.body ?? '').indexOf('0.40.0'));
    expect(t?.body).toContain('[Welcome](help:welcome)');
    expect(whatsNewTopic([], () => undefined, '2026-11-15')).toBeNull();
  });
});
