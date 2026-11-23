import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findCallNote, type NoteCard } from './call-notes.ts';
import { idFor } from './library.ts';

const card: NoteCard = {
  client: 'acme-heating',
  slug: 'web',
  folder: 'clients/acme-heating/projects/web',
  space: 'client',
};
const personal: NoteCard = {
  client: null,
  slug: 'reading',
  folder: 'personal/projects/reading',
  space: 'personal',
};
// 10:00 local on a fixed day, built from local parts so the test is time zone independent.
const START = new Date(2026, 10, 20, 10, 0, 0).toISOString();
const note = (fm: string) => `---\n${fm}\n---\n\n# Call\n`;

let root: string;
const put = async (rel: string, text: string) => {
  await fs.mkdir(join(root, ...rel.split('/').slice(0, -1)), { recursive: true });
  await fs.writeFile(join(root, ...rel.split('/')), text);
};
beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'call-notes-'));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('findCallNote', () => {
  it('matches meeting_start within 30 minutes, with or without a project tag, and returns the library id', async () => {
    const rel = 'clients/acme-heating/call-notes/2026-11-20-weekly.md';
    await put(
      rel,
      note(
        `title: Weekly\ndate: 2026-11-20\nclient: acme-heating\nmeeting_start: ${new Date(2026, 10, 20, 10, 20).toISOString()}`,
      ),
    );
    expect(await findCallNote(root, card, START)).toEqual({
      id: idFor('client:acme-heating', rel),
      path: rel,
    });
    await put(
      'clients/acme-heating/call-notes/2026-11-20-other.md',
      note(`date: 2026-11-20\nmeeting_start: ${new Date(2026, 10, 20, 10, 5).toISOString()}`),
    );
    // closest wins
    expect((await findCallNote(root, card, START))?.path).toBe(
      'clients/acme-heating/call-notes/2026-11-20-other.md',
    );
  });

  it('skips a note tagged for another project, even at the same time (back-to-back calls)', async () => {
    await put(
      'clients/acme-heating/call-notes/2026-11-20-ppc.md',
      note(
        `date: 2026-11-20\nproject: ppc-campaign\nmeeting_start: ${new Date(2026, 10, 20, 10, 0).toISOString()}`,
      ),
    );
    expect(await findCallNote(root, card, START)).toBeNull();
  });

  it('exactly 30 minutes apart does not count', async () => {
    const at = new Date(Date.parse(START) + 30 * 60 * 1000).toISOString();
    await put(
      'clients/acme-heating/call-notes/2026-11-20-edge.md',
      note(`date: 2026-11-20\nmeeting_start: ${at}`),
    );
    expect(await findCallNote(root, card, START)).toBeNull();
  });

  it('does not match a meeting_start more than 30 minutes away, tagged or not', async () => {
    await put(
      'clients/acme-heating/call-notes/2026-11-20-late.md',
      note(`date: 2026-11-20\nproject: web\nmeeting_start: ${new Date(2026, 10, 20, 11, 0).toISOString()}`),
    );
    expect(await findCallNote(root, card, START)).toBeNull();
  });

  it('falls back to date plus project when there is no meeting_start', async () => {
    const rel = 'clients/acme-heating/call-notes/2026-11-20-sync.md';
    await put(rel, note('date: 2026-11-20\nproject: web'));
    expect((await findCallNote(root, card, START))?.path).toBe(rel);
  });

  it('a wrong project, an untagged note or another day does not match', async () => {
    await put('clients/acme-heating/call-notes/2026-11-20-a.md', note('date: 2026-11-20\nproject: other'));
    await put('clients/acme-heating/call-notes/2026-11-20-b.md', note('date: 2026-11-20'));
    await put('clients/acme-heating/call-notes/2026-11-19-c.md', note('date: 2026-11-19\nproject: web'));
    expect(await findCallNote(root, card, START)).toBeNull();
  });

  it('finds an internal or personal note in the project folder', async () => {
    const rel = 'personal/projects/reading/2026-11-20-chat.md';
    await put(rel, note('date: 2026-11-20'));
    expect(await findCallNote(root, personal, START)).toEqual({ id: idFor('personal', rel), path: rel });
  });

  it('only opens files named for the meeting date or a day either side', async () => {
    await put(
      'clients/acme-heating/call-notes/2026-10-01-old.md',
      note(`meeting_start: ${START}\ndate: 2026-11-20`),
    );
    expect(await findCallNote(root, card, START)).toBeNull();
    await put('clients/acme-heating/call-notes/2026-11-21-next-day.md', note(`meeting_start: ${START}`));
    expect((await findCallNote(root, card, START))?.path).toContain('2026-11-21');
  });

  it('answers null for no folder or a bad start', async () => {
    expect(await findCallNote(root, card, START)).toBeNull();
    expect(await findCallNote(root, card, 'nonsense')).toBeNull();
  });
});
