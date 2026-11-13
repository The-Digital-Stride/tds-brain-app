import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readClientAliases } from './client-aliases.ts';

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function brainWithMap(map: string | null): string {
  const root = mkdtempSync(join(tmpdir(), 'tba-aliases-'));
  dirs.push(root);
  mkdirSync(join(root, 'clients'));
  if (map !== null) writeFileSync(join(root, 'clients', 'map.json'), map);
  return root;
}

const CLIENTS = [
  { slug: 'astrum', name: 'Astrum' },
  { slug: 'skyseal', name: 'Skyseal' },
  { slug: 'urban-cooling', name: 'Urban Cooling' },
];

describe('readClientAliases', () => {
  it('adds map.json aliases, in map order, then clients the map leaves out', async () => {
    const root = brainWithMap(
      JSON.stringify({
        'urban-cooling': {
          cid: '1',
          name: 'Urban Cooling',
          aliases: ['Urban Cooling', 'UC', 'AC', 'Air Con', 'urban_cooling'],
        },
        skyseal: { name: 'Skyseal Ltd', aliases: ['Skyseal', 'Rooflights'] },
        'not-a-folder': { name: 'Gone', aliases: ['G'] },
      }),
    );
    expect(await readClientAliases(root, CLIENTS)).toEqual([
      {
        slug: 'urban-cooling',
        name: 'Urban Cooling',
        aliases: ['Urban Cooling', 'UC', 'AC', 'Air Con', 'urban_cooling'],
      },
      { slug: 'skyseal', name: 'Skyseal', aliases: ['Skyseal', 'Rooflights', 'Skyseal Ltd'] },
      { slug: 'astrum', name: 'Astrum', aliases: [] },
    ]);
  });

  it('matches underscore keys and skips aliases that are not short text', async () => {
    const root = brainWithMap(
      JSON.stringify({ urban_cooling: { aliases: ['UC', 42, '', '  ', 'x'.repeat(200), null] } }),
    );
    expect((await readClientAliases(root, CLIENTS))[0]).toEqual({
      slug: 'urban-cooling',
      name: 'Urban Cooling',
      aliases: ['UC'],
    });
  });

  it('gives every client with no aliases when map.json is missing or unreadable', async () => {
    const plain = CLIENTS.map((c) => ({ ...c, aliases: [] }));
    expect(await readClientAliases(brainWithMap(null), CLIENTS)).toEqual(plain);
    expect(await readClientAliases(brainWithMap('{nope'), CLIENTS)).toEqual(plain);
    expect(await readClientAliases(brainWithMap('[1,2]'), CLIENTS)).toEqual(plain);
  });
});
