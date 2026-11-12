import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Runner } from './identity.ts';
import { createBrainReaders } from './index.ts';
import { copyFixture, FIXTURE } from './test-helpers.ts';

const failing: Runner = async () => {
  throw new Error('boom');
};

describe('identity', () => {
  it('maps whoami JSON to an Identity (real child process against the fake whoami)', async () => {
    const id = await createBrainReaders(FIXTURE).identity();
    expect(id).toEqual({
      name: 'Sam Example',
      slug: 'sam-example',
      email: 'sam@example.test',
      role: 'scout',
      knownMember: true,
    });
  });

  it('maps roles', async () => {
    const mk =
      (role: string | null): Runner =>
      async () => ({
        stdout: JSON.stringify({ slug: 's', name: 'S', email: null, role, knownMember: true }),
      });
    const role = async (r: string | null) =>
      (await createBrainReaders(FIXTURE, { run: mk(r) }).identity()).role;
    expect(await role('owner')).toBe('owner');
    expect(await role('scout')).toBe('scout');
    expect(await role('head-scout')).toBe('scout');
    expect(await role('agency')).toBe('scout');
    expect(await role('team')).toBe('team');
    expect(await role('wizard')).toBe('unknown');
    expect(await role(null)).toBe('unknown');
  });

  it('falls back to git email matched against roles.json when whoami fails', async () => {
    const run: Runner = async (file) => {
      if (file === 'git') return { stdout: 'ALEX@example.test\n' };
      throw new Error('no whoami');
    };
    const id = await createBrainReaders(FIXTURE, { run }).identity();
    expect(id).toEqual({
      name: 'Alex Sample',
      slug: 'alex-sample',
      email: 'alex@example.test',
      role: 'team',
      knownMember: true,
    });
  });

  it('falls back to unknown when nothing works, and never throws', async () => {
    const id = await createBrainReaders(FIXTURE, { run: failing }).identity();
    expect(id.role).toBe('unknown');
    expect(id.knownMember).toBe(false);
    expect(id.email).toBeNull();
    expect(id.name.length).toBeGreaterThan(0);
    const id2 = await createBrainReaders('/nonexistent/brain').identity();
    expect(id2.role).toBe('unknown');
  });

  it('keeps an unmatched git email but stays unknown', async () => {
    const run: Runner = async (file) => {
      if (file === 'git') return { stdout: 'stranger@example.test\n' };
      throw new Error('x');
    };
    const id = await createBrainReaders(FIXTURE, { run }).identity();
    expect(id).toMatchObject({ email: 'stranger@example.test', role: 'unknown', knownMember: false });
  });

  it('treats garbage whoami output as a failure', async () => {
    const run: Runner = async (file) => {
      if (file === 'git') throw new Error('x');
      return { stdout: 'not json' };
    };
    expect((await createBrainReaders(FIXTURE, { run }).identity()).role).toBe('unknown');
  });
});

describe('a hand-edited team list', () => {
  it('skips stray entries that are not people and still finds the real member', async () => {
    const root = copyFixture();
    writeFileSync(
      join(root, '.team-config', 'roles.json'),
      JSON.stringify({
        members: [null, 3, [], 'x', { email: 'alex@example.test', name: 'Alex Sample', role: 'team' }],
      }),
    );
    const viaGit: Runner = async (file) => {
      if (file === 'git') return { stdout: 'alex@example.test\n' };
      throw new Error('no whoami');
    };
    expect(await createBrainReaders(root, { run: viaGit }).identity()).toMatchObject({
      name: 'Alex Sample',
      knownMember: true,
    });
  });
});
