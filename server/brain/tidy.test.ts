import { describe, expect, it } from 'vitest';
import { INTERNAL_CLIENT, ProjectsError, type TidySuggestion } from '../../shared/projects-contract.ts';
import {
  buildTidyRows,
  checkSuggestion,
  nearSpelling,
  suggestTidy,
  type TidyContext,
  type TidyTodo,
  tidyTarget,
} from './tidy.ts';

// The real brain's labels (2026-11-20, read only): clients, legacy projects/ folders and Ian's local
// personal/projects/ folders, which a TDS to-do must never be tidied into.
const CTX: TidyContext = {
  projects: [
    {
      key: `${INTERNAL_CLIENT}/client-portal`,
      slug: 'client-portal',
      client: INTERNAL_CLIENT,
      space: 'legacy',
    },
    {
      key: `${INTERNAL_CLIENT}/ai-blueprint`,
      slug: 'ai-blueprint',
      client: INTERNAL_CLIENT,
      space: 'legacy',
    },
    { key: 'acme/website', slug: 'website', client: 'acme', space: 'client' },
    { key: 'skyseal/website', slug: 'website', client: 'skyseal', space: 'client' },
    { key: 'personal/tds-brain-app', slug: 'tds-brain-app', client: null, space: 'personal' },
    { key: 'personal/jev', slug: 'jev', client: null, space: 'personal' },
  ],
  clients: [
    'harvey-nash',
    'h2o-restoration',
    'book-vault',
    'urban-apothecary',
    'weightmans',
    'weightmans-litigation',
    'acme',
    'skyseal',
    INTERNAL_CLIENT,
  ],
};

let n = 0;
function todo(project: string | null, extra: Partial<TidyTodo> = {}): TidyTodo {
  n += 1;
  return {
    id: `2026110${n % 10}-t${n}.md`,
    scope: 'tds',
    title: `To-do ${n}`,
    client: null,
    assignee: 'simon-jones',
    version: String(n).padStart(64, '0'),
    project,
    stage: null,
    ...extra,
  };
}
const row = (label: string, todos: TidyTodo[]) => suggestTidy(label, todos, CTX);

describe('suggestTidy: the real label set', () => {
  it('harvey-nash is a client: client only', () => {
    const r = row('harvey-nash', [todo('harvey-nash'), todo('harvey-nash', { client: 'harvey-nash' })]);
    expect(r.suggestion).toEqual({ do: 'client-only', client: 'harvey-nash', why: 'is-a-client' });
    expect(r.todos).toHaveLength(2);
    expect(r.conflicts).toEqual([]);
  });

  it('h2o-restorations merges into the h2o-restoration client (a plural)', () => {
    expect(row('h2o-restorations', [todo('h2o-restorations')]).suggestion).toEqual({
      do: 'merge',
      into: 'h2o-restoration',
      why: 'near-spelling',
    });
    expect(row('h2o-restoration', [todo('h2o-restoration')]).suggestion.do).toBe('client-only');
  });

  it('bookvault merges into book-vault (a hyphen)', () => {
    expect(row('bookvault', [todo('bookvault')]).suggestion).toEqual({
      do: 'merge',
      into: 'book-vault',
      why: 'near-spelling',
    });
  });

  it('optional-project-slug is the template placeholder: clear', () => {
    expect(row('optional-project-slug', [todo('optional-project-slug')]).suggestion).toEqual({
      do: 'clear',
      why: 'placeholder',
    });
  });

  it('a legacy slug links to its project', () => {
    expect(row('client-portal', [todo('client-portal')]).suggestion).toEqual({
      do: 'link',
      key: `${INTERNAL_CLIENT}/client-portal`,
      why: 'same-slug',
    });
  });

  it("a slug in several clients links within the to-dos' client", () => {
    const r = row('website', [todo('website', { client: 'skyseal' }), todo('website')]);
    expect(r.suggestion).toEqual({ do: 'link', key: 'skyseal/website', why: 'same-slug' });
    expect(r.todos).toHaveLength(2);
  });

  it('anything else becomes a new project under the client, else The Digital Stride', () => {
    expect(row('ad-manager-cortex', [todo('ad-manager-cortex')]).suggestion).toEqual({
      do: 'new-project',
      client: INTERNAL_CLIENT,
      slug: 'ad-manager-cortex',
      why: 'no-match',
    });
    expect(row('uc-ai-search', [todo('uc-ai-search', { client: 'acme' })]).suggestion).toEqual({
      do: 'new-project',
      client: 'acme',
      slug: 'uc-ai-search',
      why: 'no-match',
    });
    expect(row('Website Refresh 2', [todo('Website Refresh 2')]).suggestion).toMatchObject({
      do: 'new-project',
      slug: 'website-refresh-2',
    });
  });
});

describe('suggestTidy: what it never does', () => {
  it('never fuzzy-merges a short label (os)', () => {
    expect(nearSpelling('os', 'ps')).toBe(false);
    expect(row('os', [todo('os')]).suggestion).toEqual({
      do: 'new-project',
      client: INTERNAL_CLIENT,
      slug: 'os',
      why: 'no-match',
    });
  });

  it('never overwrites a different client: those to-dos are listed apart', () => {
    const other = todo('harvey-nash', { client: 'weightmans' });
    const r = row('harvey-nash', [todo('harvey-nash'), other]);
    expect(r.todos.map((t) => t.id)).not.toContain(other.id);
    expect(r.conflicts).toEqual([{ id: other.id, scope: 'tds', title: other.title, client: 'weightmans' }]);
  });

  it('never makes a TDS to-do a personal project, even when one of that name is on this Mac', () => {
    const r = row('tds-brain-app', [todo('tds-brain-app'), todo('tds-brain-app')]);
    expect(r.suggestion).toEqual({
      do: 'new-project',
      client: INTERNAL_CLIENT,
      slug: 'tds-brain-app',
      why: 'no-match',
    });
  });

  it('offers a personal project to personal to-dos only', () => {
    expect(row('jev', [todo('jev', { scope: 'personal' })]).suggestion).toEqual({
      do: 'link',
      key: 'personal/jev',
      why: 'same-slug',
    });
    expect(row('notes-app', [todo('notes-app', { scope: 'personal' })]).suggestion).toEqual({
      do: 'new-project',
      client: null,
      slug: 'notes-app',
      why: 'no-match',
    });
  });

  it('skips a label that cannot become a folder name', () => {
    expect(row('!!!', [todo('!!!')]).suggestion).toEqual({ do: 'skip', why: 'no-match' });
  });
});

describe('buildTidyRows', () => {
  it('rows only legacy, client and loose labels: never a key, a missing key or none', () => {
    const rows = buildTidyRows(
      [
        todo('acme/website', { client: 'acme' }),
        todo('acme/new-thing'),
        todo('personal/jev'),
        todo(null),
        todo('  '),
        todo('harvey-nash'),
        todo('harvey-nash'),
        todo('client-portal'),
        todo('os'),
      ],
      CTX,
    );
    expect(rows.map((r) => r.label)).toEqual(['harvey-nash', 'client-portal', 'os']);
    expect(rows[0]?.todos).toHaveLength(2);
  });

  it("leaves a personal to-do's own personal match out of a row its TDS namesakes share", () => {
    const mine = todo('jev', { scope: 'personal' });
    const rows = buildTidyRows([todo('jev'), mine], CTX);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.todos.map((t) => t.scope)).toEqual(['tds']);
    expect(rows[0]?.suggestion.do).toBe('new-project');
  });
});

describe('checkSuggestion and tidyTarget (a changed suggestion is checked again)', () => {
  const tdsRow = row('tds-brain-app', [todo('tds-brain-app')]);
  const check = (s: TidySuggestion, r = tdsRow) => checkSuggestion(r.todos, s, CTX);
  const codeOf = (s: TidySuggestion) => {
    try {
      check(s);
      return null;
    } catch (err) {
      expect(err).toBeInstanceOf(ProjectsError);
      return (err as ProjectsError).code;
    }
  };

  it('refuses a personal project for a TDS to-do', () => {
    expect(codeOf({ do: 'link', key: 'personal/tds-brain-app', why: 'same-slug' })).toBe('not-allowed');
    expect(codeOf({ do: 'merge', into: 'personal/jev', why: 'near-spelling' })).toBe('not-allowed');
    expect(codeOf({ do: 'new-project', client: null, slug: 'x', why: 'no-match' })).toBe('not-allowed');
  });

  it('refuses a missing key, an unknown client and a bad slug', () => {
    expect(codeOf({ do: 'link', key: 'acme/new-thing', why: 'same-slug' })).toBe('not-found');
    expect(codeOf({ do: 'client-only', client: 'nobody', why: 'is-a-client' })).toBe('bad-request');
    expect(codeOf({ do: 'merge', into: 'nobody', why: 'near-spelling' })).toBe('bad-request');
    expect(codeOf({ do: 'new-project', client: 'acme', slug: 'Bad Slug', why: 'no-match' })).toBe(
      'bad-request',
    );
    expect(codeOf({ do: 'new-project', client: 'nobody', slug: 'x', why: 'no-match' })).toBe('bad-request');
    expect(codeOf({ do: 'link', key: 'acme/website', why: 'same-slug' })).toBeNull();
  });

  it('gives each to-do its three lines, keeping a stage only on a link', () => {
    const t = todo('website', { client: 'acme', stage: 'Build' });
    expect(tidyTarget(t, { do: 'link', key: 'acme/website', why: 'same-slug' })).toEqual({
      client: 'acme',
      project: 'acme/website',
      stage: 'Build',
    });
    expect(tidyTarget(t, { do: 'client-only', client: 'acme', why: 'is-a-client' })).toEqual({
      client: 'acme',
      project: null,
      stage: null,
    });
    expect(tidyTarget(t, { do: 'clear', why: 'placeholder' })).toEqual({
      client: 'acme',
      project: null,
      stage: null,
    });
    expect(tidyTarget(t, { do: 'merge', into: 'skyseal/website', why: 'near-spelling' })).toBeNull();
    expect(tidyTarget(t, { do: 'new-project', client: 'acme', slug: 'site', why: 'no-match' })).toEqual({
      client: 'acme',
      project: 'acme/site',
      stage: 'Build',
    });
    expect(tidyTarget(t, { do: 'skip', why: 'no-match' })).toBeNull();
  });
});
