import { describe, expect, it } from 'vitest';
import { createBrainReaders } from './index.ts';
import { FIXTURE, person } from './test-helpers.ts';

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

  it('returns an empty list when the brain is missing', async () => {
    expect(await createBrainReaders('/nonexistent/brain').skills(person('a', 'scout'))).toEqual([]);
  });
});
