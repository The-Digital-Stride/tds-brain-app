import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDepartments, type Runner } from './identity.ts';
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
      departments: ['SEO', 'Content'],
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
      departments: ['PPC'],
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

  it('has no departments for a member without dept, or someone not on the team list', async () => {
    const as =
      (email: string | null, name = 'Jo Owner'): Runner =>
      async () => ({ stdout: JSON.stringify({ slug: 'x', name, email, role: 'owner', knownMember: true }) });
    expect(
      (await createBrainReaders(FIXTURE, { run: as('jo@example.test') }).identity()).departments,
    ).toEqual([]);
    expect(
      (await createBrainReaders(FIXTURE, { run: as('nobody@example.test', 'Nobody') }).identity())
        .departments,
    ).toEqual([]);
    expect((await createBrainReaders(FIXTURE, { run: failing }).identity()).departments).toEqual([]);
  });

  it('matches departments by email ignoring case, else by name when whoami gives no email', async () => {
    const as =
      (email: string | null, name: string): Runner =>
      async () => ({ stdout: JSON.stringify({ name, email, role: 'team', knownMember: true }) });
    expect(
      (await createBrainReaders(FIXTURE, { run: as('ALEX@Example.test', 'Al') }).identity()).departments,
    ).toEqual(['PPC']);
    expect(
      (await createBrainReaders(FIXTURE, { run: as(null, 'Alex Sample') }).identity()).departments,
    ).toEqual(['PPC']);
  });
});

describe('a hand-edited team list', () => {
  it('skips stray entries that are not people and still finds the real member', async () => {
    const root = copyFixture();
    writeFileSync(
      join(root, '.team-config', 'roles.json'),
      JSON.stringify({
        members: [
          null,
          3,
          [],
          'x',
          { email: 'alex@example.test', name: 'Alex Sample', role: 'team', dept: 'PPC' },
        ],
      }),
    );
    const viaWhoami: Runner = async () => ({
      stdout: JSON.stringify({
        name: 'Alex Sample',
        email: 'alex@example.test',
        role: 'team',
        knownMember: true,
      }),
    });
    expect(await createBrainReaders(root, { run: viaWhoami }).identity()).toMatchObject({
      name: 'Alex Sample',
      departments: ['PPC'],
    });
    const viaGit: Runner = async (file) => {
      if (file === 'git') return { stdout: 'alex@example.test\n' };
      throw new Error('no whoami');
    };
    expect(await createBrainReaders(root, { run: viaGit }).identity()).toMatchObject({
      name: 'Alex Sample',
      departments: ['PPC'],
    });
  });
});

describe('parseDepartments', () => {
  it('splits on commas, trims, drops blanks and repeats (first spelling wins)', () => {
    expect(parseDepartments('SEO, Content , seo,, ')).toEqual(['SEO', 'Content']);
    expect(parseDepartments('Paid Social')).toEqual(['Paid Social']);
  });
  it('also takes a list, and ignores anything else', () => {
    expect(parseDepartments(['SEO', ' PPC ', 3, ''])).toEqual(['SEO', 'PPC']);
    expect(parseDepartments(undefined)).toEqual([]);
    expect(parseDepartments(null)).toEqual([]);
    expect(parseDepartments(42)).toEqual([]);
    expect(parseDepartments('')).toEqual([]);
  });
});
