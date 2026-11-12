import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDepartments, parseTeamProfile, readMemberProfile } from './team-profile.ts';
import { copyFixture, FIXTURE, person } from './test-helpers.ts';

const EMPTY = { title: null, departments: [], owns: null };

describe('readMemberProfile', () => {
  it("finds the person's row in context/team-profile.md", async () => {
    expect(
      await readMemberProfile(FIXTURE, { ...person('sam-example', 'scout'), name: 'Sam Example' }),
    ).toEqual({
      title: 'Head of Search',
      departments: ['SEO', 'Content'],
      owns: 'Runs search delivery and the content calendar.',
    });
  });

  it('matches ignoring case, bold and a nickname in brackets', async () => {
    const alex = await readMemberProfile(FIXTURE, { ...person('x', 'team'), name: 'alexander sample' });
    expect(alex).toEqual({
      title: 'Account Manager',
      departments: ['PPC'],
      owns: 'Looks after paid accounts | reporting.',
    });
    const byNick = await readMemberProfile(FIXTURE, { ...person('x', 'team'), name: 'Alex  Sample' });
    expect(byNick.departments).toEqual(['PPC']);
    // The nickname written in the team list too.
    const both = await readMemberProfile(FIXTURE, {
      ...person('x', 'team'),
      name: 'Alexander (Alex) Sample',
    });
    expect(both.departments).toEqual(['PPC']);
  });

  it('gives empty fields for blank cells, someone not in the table, or an unknown person', async () => {
    expect(await readMemberProfile(FIXTURE, { ...person('jo', 'owner'), name: 'Jo Owner' })).toEqual({
      ...EMPTY,
      title: 'Strategic Director (Owner)',
    });
    expect(await readMemberProfile(FIXTURE, { ...person('x', 'team'), name: 'Nobody Here' })).toEqual(EMPTY);
    expect(await readMemberProfile(FIXTURE, { ...person('', 'unknown'), name: '' })).toEqual(EMPTY);
  });

  it('never throws for a missing or odd file', async () => {
    expect(
      await readMemberProfile('/nonexistent/brain', { ...person('s', 'team'), name: 'Sam Example' }),
    ).toEqual(EMPTY);
    const root = copyFixture();
    writeFileSync(join(root, 'context', 'team-profile.md'), '| just | a | row |\nno table here');
    expect(await readMemberProfile(root, { ...person('s', 'team'), name: 'just' })).toEqual(EMPTY);
  });
});

describe('parseTeamProfile', () => {
  it('reads only the table with Name and Departments columns, in any column order', () => {
    const md = [
      '| Client | Name |',
      '|---|---|',
      '| Acme | Sam Example |',
      '',
      '| Departments | Name |',
      '| --- | --- |',
      '| Finance, Technical | **Ian Example** |',
    ].join('\n');
    const rows = parseTeamProfile(md);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: 'Ian Example',
      departments: ['Finance', 'Technical'],
      title: null,
      owns: null,
    });
  });
});

describe('parseTeamProfile: other ways of writing the table', () => {
  it('takes a table without outer pipes, short dividers and a singular Department heading', () => {
    const md = ['Name | Department', '-|-', '**Sam Example** | SEO, PPC', '', 'After the table.'].join('\n');
    expect(parseTeamProfile(md)).toEqual([
      { name: 'Sam Example', title: null, departments: ['SEO', 'PPC'], owns: null },
    ]);
    expect(parseTeamProfile('| Name | Departments |\r\n|:-|-:|\r\n| Jo | Ops |\r\n')[0]?.departments).toEqual(
      ['Ops'],
    );
  });

  it('stays quick on a mangled, very long name cell', async () => {
    const root = copyFixture();
    const name = 'a('.repeat(40_000);
    writeFileSync(
      join(root, 'context', 'team-profile.md'),
      `| Name | Departments |\n|---|---|\n| ${name} | SEO |\n`,
    );
    const started = Date.now();
    await readMemberProfile(root, { ...person('x', 'team'), name });
    expect(Date.now() - started).toBeLessThan(500);
  });
});

describe('parseDepartments', () => {
  it('splits on commas, trims, drops blanks and repeats (first spelling wins)', () => {
    expect(parseDepartments('SEO, Content , seo,, ')).toEqual(['SEO', 'Content']);
    expect(parseDepartments('Social Media')).toEqual(['Social Media']);
    expect(parseDepartments('')).toEqual([]);
  });
});
