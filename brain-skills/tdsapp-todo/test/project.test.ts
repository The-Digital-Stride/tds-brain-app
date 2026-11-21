// v0.6 of the `tdsapp-todo` script (plan 2026-11-20-projects-system, decisions 5, 6 and 8): the
// `project` action, `add` with client/project/stage, `projects/` as a link root, and capabilities.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseFrontmatter } from '../../../server/brain/frontmatter.ts';
import { TODO_PROJECT_CAPABILITY } from '../../../shared/projects-contract.ts';
import { type Brain, makeBrain } from './helpers.ts';

let b: Brain;
beforeEach(() => {
  b = makeBrain();
  b.folder('clients/acme/projects/website');
  b.folder('clients/skyseal/projects/roof-app');
  b.folder('projects/client-portal');
  b.folder('clients/_archive/skyseal/projects/old-site');
  b.folder('personal/projects/jev');
});
afterEach(() => b.remove());

const TODO =
  '---\nassignee: sam-example\ntitle: Send the quote\ncreated: 2026-11-01\nsource: added with the todo skill\n---\n\nDetails.\n';
const set = (fields: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  b.run('project', { file: 'a.md', ...fields, ...extra });

describe('project', () => {
  beforeEach(() => b.put('todo/a.md', TODO));

  it('adds client, project and stage lines before the closing ---, leaving every other byte', () => {
    expect(
      set({ client: 'acme', project: 'acme/website', stage: 'Build', expect: b.sha('todo/a.md') }),
    ).toEqual({
      code: 0,
      json: { ok: true, file: 'a.md', client: 'acme', project: 'acme/website', stage: 'Build' },
    });
    expect(b.read('todo/a.md')).toBe(
      TODO.replace(
        'source: added with the todo skill\n',
        'source: added with the todo skill\nclient: acme\nproject: acme/website\nstage: Build\n',
      ),
    );
  });

  it('replaces the lines in place and removes them for null', () => {
    b.put(
      'todo/a.md',
      TODO.replace('created: 2026-11-01\n', 'created: 2026-11-01\nproject: acme\nclient: acme\nstage: Old\n'),
    );
    expect(set({ client: 'acme', project: 'acme/website', stage: null }).code).toBe(0);
    expect(b.read('todo/a.md')).toBe(
      TODO.replace('created: 2026-11-01\n', 'created: 2026-11-01\nproject: acme/website\nclient: acme\n'),
    );
    expect(set({ client: 'acme', project: null, stage: null }).code).toBe(0);
    expect(b.read('todo/a.md')).toBe(
      TODO.replace('created: 2026-11-01\n', 'created: 2026-11-01\nclient: acme\n'),
    );
    expect(set({ client: null, project: null, stage: null }).code).toBe(0);
    expect(b.read('todo/a.md')).toBe(TODO);
  });

  it('writes nothing when nothing changes', () => {
    expect(set({ client: null, project: null, stage: null }).code).toBe(0);
    expect(b.read('todo/a.md')).toBe(TODO);
  });

  it('quotes a stage YAML would misread, and the app reads it back', () => {
    expect(set({ client: 'acme', project: 'acme/website', stage: 'Phase 2: build' }).code).toBe(0);
    expect(b.read('todo/a.md')).toContain('\nstage: "Phase 2: build"\n');
    expect(parseFrontmatter(b.read('todo/a.md')).data.stage).toBe('Phase 2: build');
  });

  it('refuses a personal project on a TDS to-do (privacy rule)', () => {
    expect(set({ client: null, project: 'personal/jev', stage: null })).toEqual({
      code: 2,
      json: { error: "a team to-do can't be in a personal project", status: 403 },
    });
    expect(b.read('todo/a.md')).toBe(TODO);
  });

  it('needs the client to be the project key’s client', () => {
    for (const fields of [
      { client: 'skyseal', project: 'acme/website' },
      { client: null, project: 'acme/website' },
      { client: 'acme', project: 'personal/jev', scope: 'personal' },
    ]) {
      b.put('personal/todo/a.md', TODO);
      expect(set({ stage: null, ...fields }).json.status, JSON.stringify(fields)).toBe(400);
    }
    expect(b.read('todo/a.md')).toBe(TODO);
  });

  it('needs the project folder to be there, in any location the key reads', () => {
    expect(set({ client: 'acme', project: 'acme/nothing', stage: null }).json).toEqual({
      error: 'there is no project acme/nothing',
      status: 400,
    });
    expect(
      set({ client: 'the-digital-stride', project: 'the-digital-stride/client-portal', stage: null }).code,
    ).toBe(0);
    expect(set({ client: 'skyseal', project: 'skyseal/old-site', stage: null }).code).toBe(0);
    expect(b.read('todo/a.md')).toContain('\nclient: skyseal\nproject: skyseal/old-site\n');
  });

  it('refuses malformed values, a stage with no project, and an old expect', () => {
    for (const fields of [
      { client: 'Acme', project: null, stage: null },
      { client: 'personal', project: null, stage: null },
      { client: 'acme', project: 'acme', stage: null },
      { client: 'acme', project: 'acme/Website', stage: null },
      { client: 'acme', project: null, stage: 'Build' },
      { client: 'acme', project: 'acme/website', stage: 'x'.repeat(41) },
      { client: 'acme', project: 'acme/website', stage: 'two\nlines' },
      { client: 'acme', project: 'acme/website', stage: 7 },
    ]) {
      expect(set(fields).json.status, JSON.stringify(fields)).toBe(400);
    }
    expect(set({ client: 'acme', project: null, stage: null, expect: 'f'.repeat(64) }).json.status).toBe(409);
    expect(b.read('todo/a.md')).toBe(TODO);
  });

  it('sets a client only, and works in personal/todo/ with a personal project', () => {
    expect(set({ client: 'acme', project: null, stage: null }).code).toBe(0);
    b.put('personal/todo/a.md', TODO);
    expect(set({ client: null, project: 'personal/jev', stage: 'Ideas', scope: 'personal' }).code).toBe(0);
    expect(b.read('personal/todo/a.md')).toContain('\nproject: personal/jev\nstage: Ideas\n---\n');
    // A personal to-do may be in a shared project.
    expect(set({ client: 'acme', project: 'acme/website', stage: null, scope: 'personal' }).code).toBe(0);
  });

  it('adds a frontmatter block when there is none, and keeps CRLF and a byte order mark', () => {
    b.put('todo/a.md', '# Plain\n');
    expect(set({ client: 'acme', project: 'acme/website', stage: null }).code).toBe(0);
    expect(b.read('todo/a.md')).toBe('---\nclient: acme\nproject: acme/website\n---\n\n# Plain\n');
    b.put('todo/a.md', `﻿${TODO.replace(/\n/g, '\r\n')}`);
    expect(set({ client: 'acme', project: 'acme/website', stage: null }).code).toBe(0);
    expect(b.read('todo/a.md')).toBe(
      `﻿${TODO.replace('source: added with the todo skill\n', 'source: added with the todo skill\nclient: acme\nproject: acme/website\n').replace(/\n/g, '\r\n')}`,
    );
  });
});

describe('add with client, project and stage', () => {
  it('writes them in the same new file', () => {
    const r = b.run('add', {
      title: 'Plan launch',
      client: 'acme',
      project: 'acme/website',
      stage: 'Launch',
    });
    expect(r.code).toBe(0);
    const text = b.read(`todo/${r.json.file}`);
    expect(parseFrontmatter(text).data).toMatchObject({
      client: 'acme',
      project: 'acme/website',
      stage: 'Launch',
    });
    expect(text).toMatch(
      /\ncreated_by: sam-example\nclient: acme\nproject: acme\/website\nstage: Launch\nsource: /,
    );
  });

  it('refuses a personal project on a TDS to-do and writes nothing', () => {
    expect(b.run('add', { title: 'Secret', project: 'personal/jev' }).json).toEqual({
      error: "a team to-do can't be in a personal project",
      status: 403,
    });
    expect(b.run('add', { title: 'Mismatch', client: 'skyseal', project: 'acme/website' }).json.status).toBe(
      400,
    );
    const personal = b.run('add', {
      title: 'Mine',
      project: 'personal/jev',
      scope: 'personal',
      by: 'sam-example',
    });
    expect(personal.code).toBe(0);
    expect(b.read(`personal/todo/${personal.json.file}`)).toContain('\nproject: personal/jev\n');
  });

  it('writes exactly what v0.5 wrote when none are sent', () => {
    const r = b.run('add', { title: 'Plain', client: null, project: null, stage: null });
    expect(b.read(`todo/${r.json.file}`)).not.toMatch(/\n(?:client|project|stage):/);
  });
});

describe('links to files in projects/', () => {
  it('attaches a file in a legacy projects/ folder', () => {
    b.put('todo/a.md', TODO);
    b.put('projects/client-portal/spec.md', '# Spec\n');
    expect(b.run('attach', { file: 'a.md', path: 'projects/client-portal/spec.md' }).json).toEqual({
      ok: true,
      file: 'a.md',
      path: 'projects/client-portal/spec.md',
      changed: true,
    });
    expect(b.read('todo/a.md')).toContain('\n## Files\n\n- [spec.md](../projects/client-portal/spec.md)\n');
    expect(b.run('attach', { file: 'a.md', path: 'projects/spec.md' }).json.status).toBe(400);
  });
});

// Review fix (decision 8): a team to-do never links into a personal project; other personal files
// stay linkable there, as in v0.5.
describe('links to personal files', () => {
  beforeEach(() => {
    b.put('personal/projects/jev/plan.md', '# Plan\n');
    b.put('personal/files/notes.pdf', 'pdf');
  });

  it('refuses a file under personal/projects/ on a team to-do, writing nothing', () => {
    b.put('todo/a.md', TODO);
    expect(b.run('attach', { file: 'a.md', path: 'personal/projects/jev/plan.md' }).json).toEqual({
      error: "a team to-do can't link a file from a personal project",
      status: 403,
    });
    expect(b.read('todo/a.md')).toBe(TODO);
  });

  it('still links another personal/ file on a team to-do, and a personal project file on a personal one', () => {
    b.put('todo/a.md', TODO);
    expect(b.run('attach', { file: 'a.md', path: 'personal/files/notes.pdf' }).json).toMatchObject({
      ok: true,
      changed: true,
    });
    b.put('personal/todo/b.md', TODO);
    expect(
      b.run('attach', { file: 'b.md', scope: 'personal', path: 'personal/projects/jev/plan.md' }).json,
    ).toMatchObject({ ok: true, changed: true });
  });
});

describe('capabilities', () => {
  it(`reports v0.6 with ${TODO_PROJECT_CAPABILITY}`, () => {
    expect(b.run('capabilities').json).toEqual({
      version: '0.6',
      features: ['handover', 'attach', TODO_PROJECT_CAPABILITY, 'scope'],
    });
  });
});
