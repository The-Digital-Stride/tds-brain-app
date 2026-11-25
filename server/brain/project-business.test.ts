import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ClientInfo } from '../../shared/contract.ts';
import { BUSINESS_MAX_BYTES } from '../../shared/project-business-contract.ts';
import { ProjectsError } from '../../shared/projects-contract.ts';
import { createProjectBusiness } from './project-business.ts';
import type { ProjectsIndex } from './projects.ts';

const clients: ClientInfo[] = [{ slug: 'acme', name: 'Acme Ltd' }];
const card = (key: string, extra: Record<string, unknown> = {}) => ({
  key,
  space: 'client',
  client: 'acme',
  archived: false,
  service: ['ppc'],
  ...extra,
});
const cards = [
  card('acme/ppc'),
  card('acme/old', { archived: true }),
  card('ghost/ppc', { client: 'ghost' }),
  card('the-digital-stride/site', { client: 'the-digital-stride' }),
  card('legacy-thing', { space: 'legacy', client: 'the-digital-stride' }),
  card('personal/diary', { space: 'personal', client: null }),
];
const index = {
  cards,
  byKey: (k: string) => cards.find((c) => c.key === k) ?? null,
} as unknown as ProjectsIndex;

const BUSINESS = `# Business Context

## Business Model

### What We Sell
Widgets.

## Account

**Services we provide:** PPC

## Goals & KPIs

### Budget
**Monthly budget:** About a thousand.
`;
const PROFILE =
  '---\nstatus: active\n---\n# Acme\n\n**Main contact:** Kim Example\n\n## Where they stand\n\nStable.\n';

let root: string;
const svc = () => createProjectBusiness({ root, index: async () => index, clients: async () => clients });
const write = async (rel: string, text: string) => {
  await fs.mkdir(join(root, rel, '..'), { recursive: true });
  await fs.writeFile(join(root, rel), text);
};

/** Every path under root with its size and mtime, to prove nothing changed. */
async function snapshot(dir = root): Promise<string[]> {
  const out: string[] = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    const st = await fs.lstat(p);
    out.push(`${p}|${st.size}|${st.mtimeMs}|${st.mode}`);
    if (e.isDirectory()) out.push(...(await snapshot(p)));
  }
  return out.sort();
}

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'tds-business-'));
  await fs.mkdir(join(root, 'clients', 'acme', 'context'), { recursive: true });
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('createProjectBusiness', () => {
  it('reads facts and sections for a live client project', async () => {
    await write('clients/acme/context/business.md', BUSINESS);
    await write('clients/acme/profile.md', PROFILE);
    const r = await svc().read('acme/ppc');
    expect(r.state).toBe('ok');
    expect(r.client).toEqual({ slug: 'acme', name: 'Acme Ltd', status: 'active' });
    expect(r.path).toBe('clients/acme/context/business.md');
    expect(r.facts.map((f) => [f.id, f.from])).toEqual([
      ['contact', 'profile'],
      ['services', 'business'],
      ['budget', 'business'],
    ]);
    expect(r.sections.map((s) => s.title)).toEqual(['Where they stand', 'What they sell', 'Budget']);
  });

  it('sends the contacts that have an address, from both files, main contact first', async () => {
    await write(
      'clients/acme/context/business.md',
      `${BUSINESS}\n## Contacts\n\n- **Lee Other** — lee@acme.co.uk\n\n## Competitors\n\nElsewhere: sales@rival.co.uk\n`,
    );
    await write('clients/acme/profile.md', '**Main contact:** Kim Example (kim@acme.co.uk)\n');
    const r = await svc().read('acme/ppc');
    expect(r.contacts).toEqual([
      { name: 'Kim Example', email: 'kim@acme.co.uk', main: true },
      { name: 'Lee Other', email: 'lee@acme.co.uk', main: false },
    ]);
  });

  it('a contact with no address gives an empty list', async () => {
    await write('clients/acme/context/business.md', BUSINESS);
    await write('clients/acme/profile.md', PROFILE);
    expect((await svc().read('acme/ppc')).contacts).toEqual([]);
  });

  it("another client's contacts never show: only the project's own client folder is read", async () => {
    await write('clients/other/profile.md', '**Main contact:** Not Ours (not@other.co.uk)\n');
    await write('clients/acme/profile.md', PROFILE);
    expect((await svc().read('acme/ppc')).contacts).toEqual([]);
    expect((await svc().read('ghost/ppc')).contacts).toEqual([]);
  });

  it('profile.md still gives contacts when business.md is absent or refused', async () => {
    await write('clients/acme/profile.md', '## Contacts\n- **Kim Example** — kim@acme.co.uk\n');
    const missing = await svc().read('acme/ppc');
    expect(missing.state).toBe('missing');
    expect(missing.contacts?.map((c) => c.email)).toEqual(['kim@acme.co.uk']);
    await write('outside.md', '**Main contact:** Leak (leak@outside.co.uk)\n');
    await fs.symlink(join(root, 'outside.md'), join(root, 'clients/acme/context/business.md'));
    const refused = await svc().read('acme/ppc');
    expect(refused.state).toBe('unreadable');
    expect(refused.contacts?.map((c) => c.email)).toEqual(['kim@acme.co.uk']);
  });

  it('answers an unknown key as not-found', async () => {
    await expect(svc().read('nope/nope')).rejects.toBeInstanceOf(ProjectsError);
  });

  it('gives none for personal, TDS, legacy and archived projects, and for a client not in the list', async () => {
    await write('clients/acme/context/business.md', BUSINESS);
    for (const key of [
      'personal/diary',
      'the-digital-stride/site',
      'legacy-thing',
      'acme/old',
      'ghost/ppc',
    ]) {
      const r = await svc().read(key);
      expect(r, key).toEqual({
        state: 'none',
        client: null,
        path: null,
        facts: [],
        sections: [],
        contacts: [],
      });
    }
  });

  it('is missing when there is no business.md and profile.md gives nothing', async () => {
    expect((await svc().read('acme/ppc')).state).toBe('missing');
    await write('clients/acme/profile.md', '---\nstatus: active\n---\n# Acme\n');
    const r = await svc().read('acme/ppc');
    expect(r.state).toBe('missing');
    expect(r.client?.status).toBe('active');
  });

  it('is ok with no path when only profile.md supplies something', async () => {
    await write('clients/acme/profile.md', PROFILE);
    const r = await svc().read('acme/ppc');
    expect(r.state).toBe('ok');
    expect(r.path).toBeNull();
    expect(r.facts.map((f) => f.id)).toEqual(['contact']);
  });

  it('is ok and empty for a file that is not in the usual layout', async () => {
    await write('clients/acme/context/business.md', '# Notes\n\nSome prose.\n');
    const r = await svc().read('acme/ppc');
    expect(r).toMatchObject({
      state: 'ok',
      facts: [],
      sections: [],
      path: 'clients/acme/context/business.md',
    });
  });

  it('refuses a symlinked business.md', async () => {
    await write('outside.md', BUSINESS);
    await fs.symlink(join(root, 'outside.md'), join(root, 'clients/acme/context/business.md'));
    const r = await svc().read('acme/ppc');
    expect(r).toMatchObject({ state: 'unreadable', path: null, facts: [], sections: [] });
  });

  it('refuses a symlinked context folder', async () => {
    await fs.rm(join(root, 'clients/acme/context'), { recursive: true });
    await write('elsewhere/business.md', BUSINESS);
    await fs.symlink(join(root, 'elsewhere'), join(root, 'clients/acme/context'));
    expect((await svc().read('acme/ppc')).state).toBe('unreadable');
  });

  it('refuses a business.md over the size cap', async () => {
    await write('clients/acme/context/business.md', `${BUSINESS}${'x'.repeat(BUSINESS_MAX_BYTES)}`);
    expect((await svc().read('acme/ppc')).state).toBe('unreadable');
  });

  it('refuses a business.md that is a folder', async () => {
    await fs.mkdir(join(root, 'clients/acme/context/business.md'));
    expect((await svc().read('acme/ppc')).state).toBe('unreadable');
  });

  it('ignores an oversize or symlinked profile.md', async () => {
    await write('clients/acme/context/business.md', BUSINESS);
    await write('clients/acme/profile.md', `${PROFILE}${'x'.repeat(BUSINESS_MAX_BYTES)}`);
    let r = await svc().read('acme/ppc');
    expect(r.state).toBe('ok');
    expect(r.client?.status).toBeNull();
    expect(r.sections.map((s) => s.title)).not.toContain('Where they stand');

    await fs.rm(join(root, 'clients/acme/profile.md'));
    await write('outside.md', PROFILE);
    await fs.symlink(join(root, 'outside.md'), join(root, 'clients/acme/profile.md'));
    r = await svc().read('acme/ppc');
    expect(r.state).toBe('ok');
    expect(r.facts.map((f) => f.from)).not.toContain('profile');
  });

  it('never writes: the brain is unchanged after reads of every kind', async () => {
    await write('clients/acme/context/business.md', BUSINESS);
    await write('clients/acme/profile.md', PROFILE);
    const before = await snapshot();
    for (const key of ['acme/ppc', 'acme/old', 'ghost/ppc', 'personal/diary']) await svc().read(key);
    expect(await snapshot()).toEqual(before);
  });
});
