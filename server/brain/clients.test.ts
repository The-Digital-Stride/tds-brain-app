import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listClients } from './clients.ts';
import { createBrainReaders } from './index.ts';
import { FIXTURE } from './test-helpers.ts';

describe('clients', () => {
  it('lists folders only, skipping _ and . names, naming from accounts.json when it matches', async () => {
    expect(await createBrainReaders(FIXTURE).clients()).toEqual([
      { slug: 'acme-heating', name: 'Acme Heating Ltd', code: null },
      { slug: 'northwind', name: 'Northwind', code: null },
    ]);
  });

  it('returns an empty list when clients/ is missing', async () => {
    expect(await createBrainReaders('/nonexistent/brain').clients()).toEqual([]);
  });
});

describe('client codes', () => {
  it('reads profile code: upper-cased, and a bad code reads as none', async () => {
    const root = mkdtempSync(join(tmpdir(), 'clients-code-'));
    const put = (slug: string, fm: string) => {
      mkdirSync(join(root, 'clients', slug), { recursive: true });
      writeFileSync(join(root, 'clients', slug, 'profile.md'), `---\nclient: ${slug}\n${fm}\n---\n`);
    };
    put('a', 'code: ast');
    put('b', 'code: "H2O"');
    put('c', 'code: TOOLONG');
    put('d', 'code: A-B');
    put('e', 'code: X');
    put('f', 'other: 1');
    const codes = Object.fromEntries((await listClients(root)).map((c) => [c.slug, c.code]));
    expect(codes).toEqual({ a: 'AST', b: 'H2O', c: null, d: null, e: null, f: null });
  });
});

describe('client names (task rows showed "Gladwell and patterson")', () => {
  const brain = (files: Record<string, string>) => {
    const root = mkdtempSync(join(tmpdir(), 'clients-'));
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(join(root, dirname(rel)), { recursive: true });
      writeFileSync(join(root, rel), text);
    }
    return root;
  };

  it('takes accounts.json first, then map.json, then the profile, then the folder name', async () => {
    const root = brain({
      '.claude/accounts.json': JSON.stringify({ acme_heating: { name: 'Acme Heating Ltd' } }),
      'clients/map.json': JSON.stringify({
        acme_heating: { name: 'Acme (map)' },
        'the-digital-stride': { name: 'The Digital Stride' },
      }),
      'clients/acme-heating/profile.md': '---\nclient: Acme (profile)\n---\n',
      'clients/the-digital-stride/profile.md': '---\nclient: TDS profile name\n---\n',
      'clients/gladwell-and-patterson/profile.md':
        '---\nowner: x\nclient: Gladwell & Patterson\ncode: GAP\n---\n',
      'clients/ai-stores/profile.md': '---\nclient: "AI Stores (Associated Independent Stores Ltd)"\n---\n',
      'clients/harvey-nash/notes.md': 'no profile',
      'clients/sig-and-the-roofers/notes.md': 'no profile',
      'clients/odd-one/profile.md': 'client: not frontmatter\n',
    });
    expect(await listClients(root)).toEqual([
      { slug: 'acme-heating', name: 'Acme Heating Ltd', code: null },
      { slug: 'ai-stores', name: 'AI Stores', code: null },
      { slug: 'gladwell-and-patterson', name: 'Gladwell & Patterson', code: 'GAP' },
      { slug: 'harvey-nash', name: 'Harvey Nash', code: null },
      { slug: 'odd-one', name: 'Odd One', code: null },
      { slug: 'sig-and-the-roofers', name: 'Sig and the Roofers', code: null },
      { slug: 'the-digital-stride', name: 'The Digital Stride', code: null },
    ]);
  });
});
