import { describe, expect, it } from 'vitest';
import {
  archivedFolderPath,
  archiveFolderFor,
  folderTitle,
  isProjectSlug,
  liveFolderFor,
  matchedKey,
  movedFolderPath,
  movedKey,
  parseLinkedFiles,
  parseProjectKey,
  projectLabel,
  resolveLinkedFilePath,
  resolveTodoProject,
  splitLinkedFiles,
} from './projects.ts';
import type { ProjectCard } from './projects-contract.ts';

type P = Pick<ProjectCard, 'key' | 'slug' | 'client' | 'space'>;
const shared = (client: string, slug: string, space: P['space'] = 'client'): P => ({
  key: `${client}/${slug}`,
  slug,
  client,
  space,
});
const personal = (slug: string): P => ({ key: `personal/${slug}`, slug, client: null, space: 'personal' });

// The real brain's shape (2026-11-20): legacy internal projects, a client project, and Ian's local
// personal/projects/tds-brain-app, which a TDS to-do must never resolve to (overseer B2).
const PROJECTS: P[] = [
  shared('the-digital-stride', 'client-portal', 'legacy'),
  shared('the-digital-stride', 'ai-blueprint', 'legacy'),
  shared('skyseal', 'website-rebuild'),
  shared('acme', 'website-rebuild'),
  personal('tds-brain-app'),
  personal('jev'),
];
const CLIENTS = ['harvey-nash', 'skyseal', 'acme', 'book-vault', 'the-digital-stride'];

const tds = (value: string | null, client: string | null = null) =>
  resolveTodoProject(value, client, 'tds', PROJECTS, CLIENTS);
const mine = (value: string | null, client: string | null = null) =>
  resolveTodoProject(value, client, 'personal', PROJECTS, CLIENTS);

describe('parseProjectKey', () => {
  it('reads client and personal keys', () => {
    expect(parseProjectKey('skyseal/website-rebuild')).toEqual({
      client: 'skyseal',
      slug: 'website-rebuild',
    });
    expect(parseProjectKey('personal/jev')).toEqual({ client: 'personal', slug: 'jev' });
  });

  it('refuses anything not shaped like a key', () => {
    for (const bad of [
      '',
      'skyseal',
      'Skyseal/website',
      'skyseal/website/x',
      '/website',
      'skyseal/',
      'sky seal/website',
      'skyseal/web--site',
      '-skyseal/website',
      '_archive/website',
      'skyseal/website ',
    ]) {
      expect(parseProjectKey(bad), bad).toBeNull();
    }
  });

  it('caps each side at 60 characters', () => {
    const long = 'a'.repeat(61);
    expect(parseProjectKey(`${long}/x`)).toBeNull();
    expect(parseProjectKey(`x/${long}`)).toBeNull();
    expect(parseProjectKey(`${'a'.repeat(60)}/${'b'.repeat(60)}`)).not.toBeNull();
  });
});

describe('isProjectSlug', () => {
  it('takes folder names that fit the slug rule', () => {
    expect(isProjectSlug('client-portal')).toBe(true);
    expect(isProjectSlug('Client Portal')).toBe(false);
    expect(isProjectSlug('a'.repeat(61))).toBe(false);
    expect(isProjectSlug('')).toBe(false);
  });
});

describe('resolveTodoProject', () => {
  it('is none for no value or a blank one', () => {
    expect(tds(null)).toEqual({ how: 'none' });
    expect(tds('   ')).toEqual({ how: 'none' });
  });

  it('matches a well-formed key to its folder', () => {
    expect(tds('skyseal/website-rebuild', 'skyseal')).toEqual({ how: 'key', key: 'skyseal/website-rebuild' });
    expect(tds('the-digital-stride/client-portal')).toEqual({
      how: 'key',
      key: 'the-digital-stride/client-portal',
    });
  });

  it("lets the key's client win over a disagreeing client:", () => {
    expect(tds('skyseal/website-rebuild', 'acme')).toEqual({ how: 'key', key: 'skyseal/website-rebuild' });
  });

  it('is missing for a well-formed key with no folder (it may arrive with a sync)', () => {
    expect(tds('skyseal/new-thing')).toEqual({ how: 'missing', key: 'skyseal/new-thing' });
  });

  it('matches a client slug label as client only', () => {
    expect(tds('harvey-nash')).toEqual({ how: 'client', client: 'harvey-nash' });
    // Before a project slug: a client name always reads as the client.
    expect(tds('the-digital-stride')).toEqual({ how: 'client', client: 'the-digital-stride' });
  });

  it('matches a unique project slug as legacy', () => {
    expect(tds('client-portal')).toEqual({ how: 'legacy', key: 'the-digital-stride/client-portal' });
  });

  it("matches a slug within the to-do's client: when it has one", () => {
    expect(tds('website-rebuild', 'acme')).toEqual({ how: 'legacy', key: 'acme/website-rebuild' });
    expect(tds('website-rebuild', 'skyseal')).toEqual({ how: 'legacy', key: 'skyseal/website-rebuild' });
    // A client: with no such project there: loose, not a guess elsewhere.
    expect(tds('client-portal', 'acme')).toEqual({ how: 'loose', label: 'client-portal' });
  });

  it('is loose for an ambiguous slug', () => {
    expect(tds('website-rebuild')).toEqual({ how: 'loose', label: 'website-rebuild' });
  });

  it('is loose for anything else, kept as written', () => {
    expect(tds('optional-project-slug')).toEqual({ how: 'loose', label: 'optional-project-slug' });
    expect(tds('Website Rebuild')).toEqual({ how: 'loose', label: 'Website Rebuild' });
    expect(tds('Skyseal/Website')).toEqual({ how: 'loose', label: 'Skyseal/Website' });
  });

  it('never resolves a TDS to-do to a personal project (the real tds-brain-app case)', () => {
    expect(tds('tds-brain-app')).toEqual({ how: 'loose', label: 'tds-brain-app' });
    expect(tds('jev')).toEqual({ how: 'loose', label: 'jev' });
    // A personal key on a shared to-do reads the same on every Mac: missing, never matched.
    expect(tds('personal/tds-brain-app')).toEqual({ how: 'missing', key: 'personal/tds-brain-app' });
  });

  it('lets a personal to-do resolve against personal and shared projects', () => {
    expect(mine('tds-brain-app')).toEqual({ how: 'legacy', key: 'personal/tds-brain-app' });
    expect(mine('personal/jev')).toEqual({ how: 'key', key: 'personal/jev' });
    expect(mine('skyseal/website-rebuild')).toEqual({ how: 'key', key: 'skyseal/website-rebuild' });
    expect(mine('client-portal')).toEqual({ how: 'legacy', key: 'the-digital-stride/client-portal' });
  });
});

describe('matchedKey', () => {
  it('gives the key for key and legacy matches only', () => {
    expect(matchedKey({ how: 'key', key: 'a/b' })).toBe('a/b');
    expect(matchedKey({ how: 'legacy', key: 'a/c' })).toBe('a/c');
    expect(matchedKey({ how: 'missing', key: 'a/d' })).toBeNull();
    expect(matchedKey({ how: 'client', client: 'a' })).toBeNull();
    expect(matchedKey({ how: 'loose', label: 'x' })).toBeNull();
    expect(matchedKey({ how: 'none' })).toBeNull();
    expect(matchedKey(undefined)).toBeNull();
  });
});

describe('projectLabel', () => {
  it('reads "Client · Title"', () => {
    expect(projectLabel({ title: 'Website rebuild', client: 'skyseal' }, 'Skyseal')).toBe(
      'Skyseal · Website rebuild',
    );
    expect(projectLabel({ title: 'Website rebuild', client: 'skyseal' })).toBe('skyseal · Website rebuild');
    expect(projectLabel({ title: 'Jev', client: null })).toBe('Personal · Jev');
  });
});

describe('folderTitle', () => {
  it('tidies a folder name into a title', () => {
    expect(folderTitle('client-portal')).toBe('Client portal');
    expect(folderTitle('ai-blueprint')).toBe('Ai blueprint');
  });
});

describe('the ## Linked files section', () => {
  const BODY = [
    'The brief.',
    '',
    '## Linked files',
    '',
    '- [logo.png](../../../../clients/acme/images/logo.png)',
    '- [Spec](<../../projects/client-portal/Launch plan.md>)',
    '- [web](https://example.com/a.pdf)',
    '- [up](../clients/../todo/x.md)',
    '- [dup](../../clients/acme/images/logo.png)',
    '',
    '## Notes',
    '',
    'After.',
  ].join('\n');

  it('reads brain paths in order, each once, skipping anything else', () => {
    expect(parseLinkedFiles(BODY)).toEqual([
      'clients/acme/images/logo.png',
      'projects/client-portal/Launch plan.md',
    ]);
  });

  it('splits the brief from the section', () => {
    const { brief, section } = splitLinkedFiles(BODY);
    expect(brief).toBe('The brief.\n\n## Notes\n\nAfter.');
    expect(section.startsWith('## Linked files')).toBe(true);
    expect(splitLinkedFiles('Just a brief.\n')).toEqual({ brief: 'Just a brief.', section: '' });
  });

  it('ignores a heading inside a code fence', () => {
    expect(parseLinkedFiles('```\n## Linked files\n- [a](../clients/a/b.pdf)\n```\n')).toEqual([]);
  });

  it('resolves link targets like to-do attachments, plus projects/', () => {
    expect(resolveLinkedFilePath('../../projects/x/a.pdf')).toBe('projects/x/a.pdf');
    expect(resolveLinkedFilePath('../templates/a.docx')).toBe('templates/a.docx');
    expect(resolveLinkedFilePath('../personal/files/a.pdf')).toBe('personal/files/a.pdf');
    for (const bad of ['/clients/a.pdf', '../todo/x.md', '../clients/%2e%2e/a', '../clients/./a', 'a:b']) {
      expect(resolveLinkedFilePath(bad), bad).toBeNull();
    }
  });
});

// Move plan decisions 5 and S2/S6: old keys resolve through a card's movedFrom.
describe('moved projects (aliases)', () => {
  type M = P & { movedFrom?: string[] };
  const moved = (p: P, movedFrom: string[]): M => ({ ...p, movedFrom });
  const MOVED: M[] = [
    moved(shared('skyseal', 'jev'), ['personal/jev', 'acme/jev']),
    moved(shared('skyseal', 'site'), ['acme/site']),
    moved(shared('harvey-nash', 'site'), ['acme/site']),
    moved(shared('book-vault', 'live'), ['acme/live']),
    shared('acme', 'live'),
    // A hand edit: a personal card claiming a shared key.
    moved(personal('notes'), ['acme/notes']),
  ];
  const t = (value: string, client: string | null = null) =>
    resolveTodoProject(value, client, 'tds', MOVED, CLIENTS);
  const m = (value: string, client: string | null = null) =>
    resolveTodoProject(value, client, 'personal', MOVED, CLIENTS);

  it('resolves an old key to the project that moved, as a key match', () => {
    expect(t('acme/jev')).toEqual({ how: 'key', key: 'skyseal/jev' });
    expect(m('acme/jev')).toEqual({ how: 'key', key: 'skyseal/jev' });
  });

  it('lets a live folder at the key win over an alias', () => {
    expect(t('acme/live')).toEqual({ how: 'key', key: 'acme/live' });
  });

  it('picks the lowest sorted key when two cards claim one old key', () => {
    expect(t('acme/site')).toEqual({ how: 'key', key: 'harvey-nash/site' });
    expect(movedKey('acme/site', MOVED)).toBe('harvey-nash/site');
  });

  it('resolves a personal/ alias only for a personal to-do', () => {
    expect(t('personal/jev')).toEqual({ how: 'missing', key: 'personal/jev' });
    expect(m('personal/jev')).toEqual({ how: 'key', key: 'skyseal/jev' });
  });

  it('never resolves a TDS to-do to a personal project through an alias', () => {
    expect(t('acme/notes')).toEqual({ how: 'missing', key: 'acme/notes' });
    expect(m('acme/notes')).toEqual({ how: 'key', key: 'personal/notes' });
  });

  it('resolves a bare slug through <to-do client>/<label>, never personal/ for a TDS to-do', () => {
    // The slug is unchanged by a move, so a client-less label still finds it by slug.
    expect(t('jev')).toEqual({ how: 'legacy', key: 'skyseal/jev' });
    expect(t('jev', 'acme')).toEqual({ how: 'legacy', key: 'skyseal/jev' });
    expect(t('site', 'acme')).toEqual({ how: 'legacy', key: 'harvey-nash/site' });
    expect(t('jev', 'personal')).toEqual({ how: 'loose', label: 'jev' });
    expect(m('jev', 'personal')).toEqual({ how: 'legacy', key: 'skyseal/jev' });
    expect(t('nothing', 'acme')).toEqual({ how: 'loose', label: 'nothing' });
  });

  it("lets this Mac's own personal folder (card or not) win over a teammate's personal/ alias", () => {
    // skyseal/jev synced from a teammate lists personal/jev; this Mac has its own personal/projects/jev.
    const here: M[] = [...MOVED, personal('jev')];
    expect(movedKey('personal/jev', here)).toBeNull();
    expect(resolveTodoProject('personal/jev', null, 'personal', here, CLIENTS)).toEqual({
      how: 'key',
      key: 'personal/jev',
    });
    const cards = [
      {
        ...moved(shared('skyseal', 'jev'), ['personal/jev']),
        folder: 'clients/skyseal/projects/jev',
      },
      { ...personal('jev'), folder: 'personal/projects/jev' },
    ];
    expect(movedFolderPath('personal/projects/jev/notes.md', cards)).toBe('personal/projects/jev/notes.md');
    // With no such folder here, the alias still applies.
    expect(movedKey('personal/jev', MOVED)).toBe('skyseal/jev');
    expect(movedFolderPath('personal/projects/jev/notes.md', cards.slice(0, 1))).toBe(
      'clients/skyseal/projects/jev/notes.md',
    );
  });

  it('is missing for an unknown key, as before', () => {
    expect(t('acme/nothing')).toEqual({ how: 'missing', key: 'acme/nothing' });
    expect(movedKey('acme/nothing', MOVED)).toBeNull();
  });

  it('maps a path in an old folder to where the project went (S8)', () => {
    const cards = [
      {
        ...moved(shared('skyseal', 'jev'), ['personal/jev', 'acme/jev']),
        folder: 'clients/skyseal/projects/jev',
      },
      { ...shared('acme', 'live'), folder: 'clients/acme/projects/live' },
      { ...moved(shared('book-vault', 'live'), ['acme/live']), folder: 'clients/book-vault/projects/live' },
    ];
    expect(movedFolderPath('clients/acme/projects/jev/brief.pdf', cards)).toBe(
      'clients/skyseal/projects/jev/brief.pdf',
    );
    expect(movedFolderPath('personal/projects/jev/a/b.md', cards)).toBe(
      'clients/skyseal/projects/jev/a/b.md',
    );
    // A live project at the old key keeps its own files; anything else is left as written.
    expect(movedFolderPath('clients/acme/projects/live/a.pdf', cards)).toBe(
      'clients/acme/projects/live/a.pdf',
    );
    expect(movedFolderPath('clients/acme/projects/jevx/a.pdf', cards)).toBe(
      'clients/acme/projects/jevx/a.pdf',
    );
    expect(movedFolderPath('clients/acme/files/a.pdf', cards)).toBe('clients/acme/files/a.pdf');
  });
});

describe('archive folders (archive plan decision 1, S5)', () => {
  it('puts the archive beside the live folder, at the same depth', () => {
    expect(archiveFolderFor('clients/acme/projects/site')).toBe('clients/acme/projects-archive/site');
    expect(archiveFolderFor('personal/projects/jev')).toBe('personal/projects-archive/jev');
    expect(archiveFolderFor('projects/old')).toBe('projects-archive/old');
    expect(liveFolderFor('clients/acme/projects-archive/site')).toBe('clients/acme/projects/site');
    expect(liveFolderFor('projects-archive/old')).toBe('projects/old');
  });

  it('has no archive for an archive, or for an archived client', () => {
    expect(archiveFolderFor('clients/acme/projects-archive/site')).toBeNull();
    expect(archiveFolderFor('clients/_archive/acme/projects/site')).toBeNull();
    expect(liveFolderFor('clients/_archive/acme/projects/site')).toBeNull();
    expect(archiveFolderFor('clients/acme/projects/site/sub')).toBeNull();
  });

  it("maps a link into an archived project's old folder to where it is now", () => {
    const cards = [
      { folder: 'clients/acme/projects-archive/site', archived: true },
      { folder: 'clients/acme/projects/live', archived: false },
    ];
    expect(archivedFolderPath('clients/acme/projects/site/brief.md', cards)).toBe(
      'clients/acme/projects-archive/site/brief.md',
    );
    expect(archivedFolderPath('clients/acme/projects/live/a.md', cards)).toBe(
      'clients/acme/projects/live/a.md',
    );
    expect(archivedFolderPath('clients/acme/projects/sites/a.md', cards)).toBe(
      'clients/acme/projects/sites/a.md',
    );
  });

  it('leaves the path alone when a live project holds the old folder again', () => {
    const cards = [
      { folder: 'clients/acme/projects-archive/site', archived: true },
      { folder: 'clients/acme/projects/site', archived: false },
    ];
    expect(archivedFolderPath('clients/acme/projects/site/a.md', cards)).toBe(
      'clients/acme/projects/site/a.md',
    );
  });
});
