import { describe, expect, it } from 'vitest';
import {
  folderTitle,
  isProjectSlug,
  matchedKey,
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
