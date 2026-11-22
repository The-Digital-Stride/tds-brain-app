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
      { slug: 'acme-heating', name: 'Acme Heating Ltd' },
      { slug: 'northwind', name: 'Northwind' },
    ]);
  });

  it('returns an empty list when clients/ is missing', async () => {
    expect(await createBrainReaders('/nonexistent/brain').clients()).toEqual([]);
  });
});

describe('client names (to-do rows showed "Gladwell and patterson")', () => {
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
      { slug: 'acme-heating', name: 'Acme Heating Ltd' },
      { slug: 'ai-stores', name: 'AI Stores' },
      { slug: 'gladwell-and-patterson', name: 'Gladwell & Patterson' },
      { slug: 'harvey-nash', name: 'Harvey Nash' },
      { slug: 'odd-one', name: 'Odd One' },
      { slug: 'sig-and-the-roofers', name: 'Sig and the Roofers' },
      { slug: 'the-digital-stride', name: 'The Digital Stride' },
    ]);
  });
});
