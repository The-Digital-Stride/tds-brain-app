import { copyFileSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createBrainReaders } from './index.ts';
import { ownLevel } from './skills.ts';
import { copyFixture, FIXTURE, person } from './test-helpers.ts';

const brain = createBrainReaders(FIXTURE);
const names = (l: { name: string }[]) => l.map((s) => s.name);

describe('skills', () => {
  it('lists skills and commands for a scout, sorted by title, skipping broken ones', async () => {
    const list = await brain.skills(person('sam-example', 'scout'));
    expect(names(list)).toEqual([
      'admin-setup',
      'gm',
      'meeting-notes',
      'scout-tool',
      'standup',
      'trusted-audit',
      'vendor-pack',
    ]);
    expect(list.find((s) => s.name === 'broken-skill')).toBeUndefined();
    expect(list.find((s) => s.name === 'no-file')).toBeUndefined();
  });

  it('reads frontmatter fields', async () => {
    const list = await brain.skills(person('sam-example', 'scout'));
    const mn = list.find((s) => s.name === 'meeting-notes');
    expect(mn).toMatchObject({
      title: 'Meeting notes',
      description: 'Turn raw meeting notes into a filed client record.',
      kind: 'skill',
      maturity: 'live',
      argumentHint: '[paste notes]',
      restrictedTo: null,
    });
    expect(list.find((s) => s.name === 'admin-setup')).toMatchObject({
      maturity: 'draft',
      restrictedTo: ['owner', 'scout'],
    });
    expect(list.find((s) => s.name === 'trusted-audit')).toMatchObject({
      maturity: 'trusted',
      restrictedTo: ['scout', 'owner'],
    });
  });

  it('a skill beats a command of the same name', async () => {
    const list = await brain.skills(person('sam-example', 'scout'));
    expect(list.filter((s) => s.name === 'meeting-notes')).toHaveLength(1);
    expect(list.find((s) => s.name === 'meeting-notes')?.kind).toBe('skill');
  });

  it('describes commands from frontmatter or the first paragraph', async () => {
    const list = await brain.skills(person('sam-example', 'scout'));
    expect(list.find((s) => s.name === 'gm')).toMatchObject({
      kind: 'command',
      description: 'Good morning routine.',
    });
    expect(list.find((s) => s.name === 'standup')?.description).toBe('Run the daily stand-up.');
  });

  it('hides role-restricted and non-invocable skills from a team seat', async () => {
    const list = names(await brain.skills(person('alex-sample', 'team')));
    expect(list).toEqual(['gm', 'meeting-notes', 'standup', 'vendor-pack']);
  });

  it('treats unknown as team, and shows restricted skills to an owner', async () => {
    expect(names(await brain.skills(person('x', 'unknown')))).not.toContain('admin-setup');
    expect(names(await brain.skills(person('jo-owner', 'owner')))).toContain('admin-setup');
    expect(names(await brain.skills(person('jo-owner', 'owner')))).not.toContain('scout-tool');
  });

  it('does not hide a skill for members: false', async () => {
    expect(names(await brain.skills(person('alex-sample', 'team')))).toContain('vendor-pack');
  });

  it('skillAccess checks all skills, including hidden ones', async () => {
    const team = person('alex-sample', 'team');
    expect(await brain.skillAccess(team, 'admin-setup')).toBe('restricted');
    expect(await brain.skillAccess(team, 'scout-tool')).toBe('restricted');
    expect(await brain.skillAccess(team, 'meeting-notes')).toBe('allowed');
    expect(await brain.skillAccess(team, 'hidden-helper')).toBe('allowed');
    expect(await brain.skillAccess(team, 'nope')).toBe('unknown-skill');
    expect(await brain.skillAccess(team, '../etc')).toBe('unknown-skill');
    expect(await brain.skillAccess(person('sam-example', 'scout'), 'trusted-audit')).toBe('allowed');
  });

  it('lets every role run the tdsapp-projects copy this repo ships to the brain (brain compat 9)', async () => {
    const root = copyFixture();
    mkdirSync(join(root, '.claude', 'skills', 'tdsapp-projects'), { recursive: true });
    copyFileSync(
      join(import.meta.dirname, '..', '..', 'brain-skills', 'tdsapp-projects', 'SKILL.md'),
      join(root, '.claude', 'skills', 'tdsapp-projects', 'SKILL.md'),
    );
    const readers = createBrainReaders(root);
    for (const role of ['owner', 'scout', 'team'] as const) {
      expect(await readers.skillAccess(person('alex-sample', role), 'tdsapp-projects'), role).toBe('allowed');
    }
  });

  it('returns an empty list when the brain is missing', async () => {
    expect(await createBrainReaders('/nonexistent/brain').skills(person('a', 'scout'))).toEqual([]);
  });
});

describe('own level (frontmatter model and effort)', () => {
  function brainWith(files: Record<string, string>): string {
    const root = copyFixture();
    for (const [rel, text] of Object.entries(files)) {
      const abs = join(root, '.claude', rel);
      mkdirSync(join(abs, '..'), { recursive: true });
      writeFileSync(abs, text);
    }
    return root;
  }
  const fm = (lines: string) => `---\nname: x\ndescription: d\n${lines}\n---\nBody\n`;

  it('is null for skills that set neither', async () => {
    const list = await createBrainReaders(FIXTURE).skills(person('sam-example', 'scout'));
    expect(list.length).toBeGreaterThan(0);
    for (const s of list) expect(s.ownLevel).toBeNull();
  });

  it('reads model and effort from a skill and from a command, either one alone', async () => {
    const root = brainWith({
      'skills/both/SKILL.md': fm('model: haiku\neffort: low'),
      'skills/model-only/SKILL.md': fm('model: opus'),
      'commands/effort-only.md': fm('effort: HIGH'),
    });
    const list = await createBrainReaders(root).skills(person('sam-example', 'scout'));
    const get = (n: string) => list.find((s) => s.name === n)?.ownLevel;
    expect(get('both')).toEqual({ model: 'haiku', effort: 'low' });
    expect(get('model-only')).toEqual({ model: 'opus', effort: null });
    expect(get('effort-only')).toEqual({ model: null, effort: 'high' });
  });

  it('ignores `inherit`, an unknown effort and a model that is not a model name', async () => {
    const root = brainWith({
      'skills/a/SKILL.md': fm('model: inherit\neffort: extreme'),
      'skills/b/SKILL.md': fm('model: "no no"'),
    });
    expect(await ownLevel(root, 'a')).toBeNull();
    expect(await ownLevel(root, 'b')).toBeNull();
  });

  it('looks any skill up by name, including hidden and role-restricted ones', async () => {
    const root = brainWith({
      'skills/secret/SKILL.md': fm('user-invocable: false\nroles: owner\nmodel: haiku'),
    });
    const list = await createBrainReaders(root).skills(person('ben', 'team'));
    expect(list.find((s) => s.name === 'secret')).toBeUndefined();
    expect(await ownLevel(root, 'secret')).toEqual({ model: 'haiku', effort: null });
  });

  it('a skill beats a command of the same name; unknown or odd names give null', async () => {
    const root = brainWith({
      'skills/dup/SKILL.md': fm('model: opus'),
      'commands/dup.md': fm('model: haiku'),
      'commands/only-cmd.md': fm('effort: max'),
    });
    expect(await ownLevel(root, 'dup')).toEqual({ model: 'opus', effort: null });
    expect(await ownLevel(root, 'only-cmd')).toEqual({ model: null, effort: 'max' });
    expect(await ownLevel(root, 'nothing-here')).toBeNull();
    expect(await ownLevel(root, '../x')).toBeNull();
    expect(await ownLevel(root, '.hidden')).toBeNull();
    expect(await ownLevel('/nonexistent/brain', 'dup')).toBeNull();
  });

  it('notices a change to the file (cached by mtime)', async () => {
    const root = brainWith({ 'skills/c/SKILL.md': fm('model: haiku') });
    expect(await ownLevel(root, 'c')).toEqual({ model: 'haiku', effort: null });
    const file = join(root, '.claude', 'skills', 'c', 'SKILL.md');
    writeFileSync(file, fm('model: opus'));
    const later = new Date(Date.now() + 5000);
    utimesSync(file, later, later);
    expect(await ownLevel(root, 'c')).toEqual({ model: 'opus', effort: null });
    writeFileSync(file, fm('description: none'));
    const later2 = new Date(Date.now() + 10000);
    utimesSync(file, later2, later2);
    expect(await ownLevel(root, 'c')).toBeNull();
  });
});
