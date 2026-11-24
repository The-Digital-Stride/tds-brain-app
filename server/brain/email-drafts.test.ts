import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Identity } from '../../shared/contract.ts';
import {
  EMAIL_DRAFT_MAX_BYTES,
  type EmailDraftFile,
  PROJECTS_EMAIL_CAPABILITY,
} from '../../shared/project-email-contract.ts';
import { type ProjectCard, ProjectsError } from '../../shared/projects-contract.ts';
import { createEmailDrafts, isSlugOf, memberEmailOfSlug } from './email-drafts.ts';
import type { ProjectsIndex } from './projects.ts';
import { PROJECTS_SCRIPT } from './projects-skill.ts';

let root: string;
let logFile: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'tds-email-drafts-'));
  logFile = join(root, '..', `calls-${Date.now()}-${Math.random()}.jsonl`);
  put(
    '.team-config/roles.json',
    JSON.stringify({ members: [{ name: 'Sam Example', email: 'sam@tds.test', role: 'team' }] }),
  );
  // The fake script: logs argv and stdin, answers FAKE_REPLY.
  put(
    PROJECTS_SCRIPT,
    `const fs=require('node:fs');let i='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>{i+=c});
process.stdin.on('end',()=>{fs.appendFileSync(process.env.FAKE_LOG,JSON.stringify({argv:process.argv.slice(2),stdin:i})+'\\n');
const r=JSON.parse(process.env.FAKE_REPLY||'{}');process.stdout.write(r.out||'{"ok":true}');process.exitCode=r.exit||0;});`,
  );
  mkdirSync(join(root, '.claude', 'skills', 'tdsapp-projects'), { recursive: true });
});
afterEach(() => {
  rmSync(keysDir(), { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
});

function put(rel: string, text: string) {
  const abs = join(root, ...rel.split('/'));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text);
}
const calls = () =>
  existsSync(logFile)
    ? readFileSync(logFile, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { argv: string[]; stdin: string })
    : [];

const TOKEN = 'f'.repeat(32);
const sam: Identity = {
  name: 'Sam Example',
  slug: 'sam-example',
  email: 'sam@tds.test',
  role: 'team',
  knownMember: true,
};
const card = (over: Partial<ProjectCard> = {}): ProjectCard =>
  ({
    key: 'acme/web',
    space: 'client',
    slug: 'web',
    client: 'acme',
    folder: 'clients/acme/projects/web',
    card: 'ok',
    archived: false,
    status: 'active',
    title: 'Web',
    ...over,
  }) as ProjectCard;

function draft(id: string, over: Partial<EmailDraftFile> = {}): EmailDraftFile {
  return {
    v: 1,
    id,
    inbox_owner: 'sam-example',
    created_at: new Date().toISOString(),
    thread_id: 'abcdef0123',
    email_key: `<${id}@mail.test>`,
    thread_message_ids: [],
    subject: 'Quote for the new site',
    from: { name: 'Alex Smith', address: 'alex.smith@acme.test' },
    from_domain: 'acme.test',
    people: [
      { name: 'Jo Bloggs', address: 'jo@acme.test' },
      { name: null, address: 'ops@acme.test' },
    ],
    sent_at: '2026-11-20T16:30:00Z',
    summary: 'They agreed the quote.',
    codes_subject: [],
    codes_body: [],
    requested: null,
    ...over,
  };
}
/** The draft, and (unless `key: false`) its approve key in the keys folder outside the brain. */
const putDraft = (d: EmailDraftFile, opts: { key?: boolean } = {}) => {
  put(`briefing/email-drafts/${d.id}.json`, JSON.stringify(d));
  if (opts.key === false) return;
  mkdirSync(keysDir(), { recursive: true });
  writeFileSync(
    join(keysDir(), `${d.id}.key`),
    JSON.stringify({ v: 1, token: TOKEN, draft_sha256: 'a'.repeat(64), brain: root }),
  );
};
const keysDir = () => join(root, '..', `${basename(root)}-keys`);

function setup(
  opts: {
    cards?: ProjectCard[];
    caps?: string[];
    ignored?: boolean;
    reply?: object;
    who?: Identity;
    refs?: Record<string, string>;
  } = {},
) {
  const cards = opts.cards ?? [card()];
  const index: ProjectsIndex = {
    cards,
    byKey: (k) => cards.find((c) => c.key === k) ?? null,
    keysForPath: () => [],
    resolve: () => ({}) as never,
    refs: { resolve: (c) => opts.refs?.[c] ?? null, near: () => [] },
  };
  let changed = 0;
  const svc = createEmailDrafts(root, {
    index: async () => index,
    clients: async () => [{ slug: 'acme', name: 'Acme' } as never],
    identity: async () => opts.who ?? sam,
    capabilities: async () => opts.caps ?? [PROJECTS_EMAIL_CAPABILITY],
    ignored: async (rels) => new Set(opts.ignored === false ? [] : rels),
    onChanged: () => changed++,
    keysDir: keysDir(),
    script: {
      env: { PATH: process.env.PATH, FAKE_LOG: logFile, FAKE_REPLY: JSON.stringify(opts.reply ?? {}) },
    },
  });
  return { svc, changed: () => changed };
}

describe('approve keys outside the brain (overseer ruling)', () => {
  it('never lists a draft with no key file, and counts it', async () => {
    putDraft(draft('aaaaaaaaaaaa'), { key: false });
    expect(await setup().svc.list(null)).toMatchObject({ drafts: [], unreadable: 1 });
  });
});

describe('listing drafts', () => {
  it('lists nothing and cannot approve when git does not ignore the folder', async () => {
    putDraft(draft('aaaaaaaaaaaa'));
    expect(await setup({ ignored: false }).svc.list(null)).toEqual({
      drafts: [],
      unreadable: 0,
      canApprove: false,
    });
  });

  it('lists this owner’s draft with names only, and routes it', async () => {
    put('clients/acme/profile.md', '- **Website:** https://www.acme.test\n');
    putDraft(draft('aaaaaaaaaaaa'));
    const r = await setup().svc.list(null);
    expect(r.canApprove).toBe(true);
    expect(r.drafts).toEqual([
      {
        id: 'aaaaaaaaaaaa',
        subject: 'Quote for the new site',
        from: 'Alex Smith',
        people: ['Jo Bloggs', 'ops'],
        sentAt: '2026-11-20T16:30:00Z',
        summary: 'They agreed the quote.',
        route: { key: 'acme/web', why: 'domain' },
      },
    ]);
  });

  it('never puts an address, the domain or the token in the response', async () => {
    put('clients/acme/profile.md', '- **Website:** https://acme.test\n');
    putDraft(draft('aaaaaaaaaaaa', { requested: 'acme/web' }));
    const text = JSON.stringify(await setup().svc.list(null));
    expect(text).not.toContain('@');
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain('acme.test');
    expect(text).not.toContain('approve_token');
    expect(text).not.toContain('abcdef0123');
  });

  it('can approve only with the script capability', async () => {
    putDraft(draft('aaaaaaaaaaaa'));
    expect((await setup({ caps: [] }).svc.list(null)).canApprove).toBe(false);
  });

  it('skips and counts a bad, oversized or linked file; never lists another owner’s or an old draft', async () => {
    putDraft(draft('aaaaaaaaaaaa'));
    put('briefing/email-drafts/bbbbbbbbbbbb.json', '{not json');
    put('briefing/email-drafts/cccccccccccc.json', JSON.stringify({ ...draft('cccccccccccc'), v: 2 }));
    put('briefing/email-drafts/dddddddddddd.json', 'x'.repeat(EMAIL_DRAFT_MAX_BYTES + 1));
    symlinkSync(
      join(root, 'briefing/email-drafts/aaaaaaaaaaaa.json'),
      join(root, 'briefing/email-drafts/eeeeeeeeeeee.json'),
    );
    putDraft(draft('ffffffffffff', { inbox_owner: 'ben-mcadam' }));
    putDraft(draft('gggggggggggg', { created_at: new Date(Date.now() - 31 * 86_400_000).toISOString() }));
    put('briefing/email-drafts/dismissed-sam-example.json', '{}');
    put('briefing/email-drafts/notes.txt', 'x');
    const r = await setup().svc.list(null);
    expect(r.drafts.map((d) => d.id)).toEqual(['aaaaaaaaaaaa']);
    expect(r.unreadable).toBe(4);
  });

  it('?key= keeps only drafts routed there', async () => {
    putDraft(draft('aaaaaaaaaaaa', { codes_subject: ['ACM1A2'] }));
    putDraft(draft('bbbbbbbbbbbb', { codes_subject: ['ZET1A2'] }));
    const s = setup({
      cards: [
        card(),
        card({ key: 'zeta/one', client: 'zeta', slug: 'one', folder: 'clients/zeta/projects/one' }),
      ],
      refs: { ACM1A2: 'acme/web', ZET1A2: 'zeta/one' },
    });
    expect((await s.svc.list('zeta/one')).drafts.map((d) => d.id)).toEqual(['bbbbbbbbbbbb']);
    expect((await s.svc.list('acme/web')).drafts.map((d) => d.id)).toEqual(['aaaaaaaaaaaa']);
  });

  it('a thread this owner already linked wins over a code', async () => {
    put(
      'clients/acme/projects/web/updates/2026-11-01-0900-sam-example-abc123.md',
      '---\nv: 1\nkind: email\nby: sam-example\nat: 2026-11-01T09:00:00Z\nemail_thread_id: abcdef0123\nemail_inbox_owner: sam-example\nemail_key: <old@mail.test>\n---\nx\n',
    );
    putDraft(draft('aaaaaaaaaaaa', { codes_subject: ['ZET1A2'] }));
    const r = await setup({
      cards: [
        card(),
        card({ key: 'zeta/one', client: 'zeta', slug: 'one', folder: 'clients/zeta/projects/one' }),
      ],
      refs: { ZET1A2: 'zeta/one' },
    }).svc.list(null);
    expect(r.drafts[0]?.route).toEqual({ key: 'acme/web', why: 'thread' });
  });
});

describe('approving', () => {
  const body = {
    action: 'approve' as const,
    id: 'aaaaaaaaaaaa',
    key: 'acme/web',
    summary: '  Edited summary  ',
    subject: 'Edited subject',
    from: 'Alex Smith',
    people: ['Jo Bloggs'],
    clientSafe: true,
  };

  it('refuses to save a draft whose key is missing, without running the script', async () => {
    putDraft(draft('aaaaaaaaaaaa'), { key: false });
    await expect(setup().svc.approve(body)).rejects.toMatchObject({ code: 'not-allowed' });
    expect(calls()).toEqual([]);
  });

  it('runs update with the edited fields and the token read from the key file outside the brain', async () => {
    putDraft(draft('aaaaaaaaaaaa'));
    const s = setup({
      reply: {
        out: JSON.stringify({
          ok: true,
          action: 'update',
          key: 'acme/web',
          version: 'a'.repeat(64),
          file: 'clients/acme/projects/web/updates/x.md',
        }),
      },
    });
    const { action: _a, ...req } = body;
    const answer = await s.svc.approve({ action: 'approve', ...req });
    expect(answer).toEqual({ ok: true, key: 'acme/web', file: 'clients/acme/projects/web/updates/x.md' });
    const [call] = calls();
    expect(call?.argv).toEqual(['update']);
    expect(JSON.parse(call?.stdin ?? '')).toEqual({
      kind: 'update',
      key: 'acme/web',
      entry: {
        kind: 'email',
        draft: 'aaaaaaaaaaaa',
        token: TOKEN,
        summary: 'Edited summary',
        subject: 'Edited subject',
        from: 'Alex Smith',
        people: ['Jo Bloggs'],
        clientSafe: true,
      },
    });
    expect(s.changed()).toBe(1);
  });

  it('passes an empty subject through to the script (correctness review)', async () => {
    putDraft(draft('aaaaaaaaaaaa'));
    const s = setup({
      reply: {
        out: JSON.stringify({
          ok: true,
          action: 'update',
          key: 'acme/web',
          version: 'a'.repeat(64),
          file: 'f',
        }),
      },
    });
    await s.svc.approve({ ...body, subject: '' });
    expect(JSON.parse(calls()[0]?.stdin ?? '{}').entry.subject).toBe('');
  });

  it('answers exists with the project and who added it', async () => {
    putDraft(draft('aaaaaaaaaaaa'));
    const file = 'clients/acme/projects/web/updates/2026-11-01-0900-sam-example-abc123.md';
    put(file, '---\nv: 1\nkind: email\nby: sam-example\nat: 2026-11-01T09:00:00Z\n---\nx\n');
    const s = setup({
      reply: { exit: 2, out: JSON.stringify({ ok: false, error: 'exists', key: 'acme/web', file }) },
    });
    expect(await s.svc.approve(body)).toEqual({
      ok: false,
      code: 'exists',
      key: 'acme/web',
      byName: 'Sam Example',
    });
  });

  it('refuses another owner’s draft, a missing draft and a missing capability without running the script', async () => {
    putDraft(draft('aaaaaaaaaaaa', { inbox_owner: 'ben-mcadam' }));
    await expect(setup().svc.approve(body)).rejects.toMatchObject({ code: 'not-found' });
    await expect(setup().svc.approve({ ...body, id: 'zzzzzzzzzzzz' })).rejects.toMatchObject({
      code: 'not-found',
    });
    putDraft(draft('aaaaaaaaaaaa'));
    await expect(setup({ caps: [] }).svc.approve(body)).rejects.toMatchObject({ code: 'not-allowed' });
    await expect(setup({ ignored: false }).svc.approve(body)).rejects.toMatchObject({ code: 'not-allowed' });
    expect(calls()).toEqual([]);
  });

  it('refuses an archived project and bad fields', async () => {
    putDraft(draft('aaaaaaaaaaaa'));
    await expect(setup({ cards: [card({ archived: true })] }).svc.approve(body)).rejects.toBeInstanceOf(
      ProjectsError,
    );
    for (const bad of [{ subject: 'a\nb' }, { from: '' }, { summary: '  ' }, { people: ['x'.repeat(121)] }]) {
      await expect(setup().svc.approve({ ...body, ...bad })).rejects.toMatchObject({ code: 'bad-request' });
    }
    expect(calls()).toEqual([]);
  });

  it('maps a script refusal to the app’s words, never the script’s text or the token', async () => {
    putDraft(draft('aaaaaaaaaaaa'));
    const s = setup({
      reply: {
        exit: 2,
        out: JSON.stringify({ ok: false, error: 'not-allowed', message: `bad token ${TOKEN}` }),
      },
    });
    const err = await s.svc.approve(body).catch((e) => e as ProjectsError);
    expect(err).toMatchObject({ code: 'not-allowed' });
    expect((err as Error).message).not.toContain(TOKEN);
  });
});

describe('dismissing', () => {
  it('runs email-draft-remove with dismiss for this owner’s draft only', async () => {
    putDraft(draft('aaaaaaaaaaaa'));
    putDraft(draft('bbbbbbbbbbbb', { inbox_owner: 'ben-mcadam' }));
    const s = setup();
    await s.svc.dismiss('aaaaaaaaaaaa');
    const [call] = calls();
    expect(call?.argv).toEqual(['email-draft-remove']);
    expect(JSON.parse(call?.stdin ?? '')).toEqual({
      kind: 'email-draft-remove',
      id: 'aaaaaaaaaaaa',
      dismiss: true,
    });
    await expect(s.svc.dismiss('bbbbbbbbbbbb')).rejects.toMatchObject({ code: 'not-found' });
    await expect(s.svc.dismiss('../etc')).rejects.toMatchObject({ code: 'bad-request' });
    expect(calls()).toHaveLength(1);
  });
});

describe('identity helpers', () => {
  it('matches the script’s slug form or the app’s', () => {
    expect(isSlugOf(sam, 'sam-example')).toBe(true);
    expect(isSlugOf({ ...sam, slug: 'sam' }, 'sam-example')).toBe(true);
    expect(isSlugOf(sam, 'ben-mcadam')).toBe(false);
    expect(isSlugOf(sam, null)).toBe(false);
  });
  it('finds a member’s roles.json email by script slug', async () => {
    expect(await memberEmailOfSlug(root, 'sam-example')).toBe('sam@tds.test');
    expect(await memberEmailOfSlug(root, 'nobody')).toBeNull();
  });
});
