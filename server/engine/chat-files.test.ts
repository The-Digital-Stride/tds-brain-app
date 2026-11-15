import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ChatFile, ChatFilesSnapshot, LibraryItem, LibraryScope } from '../../shared/contract.ts';
import {
  CHAT_FILE_CHANGES_BUDGET,
  CHAT_FILE_CHANGES_MAX,
  CHAT_FILES_MAX,
  CHAT_LINK_MAX_CHARS,
  CHAT_LINKS_MAX,
} from '../../shared/contract.ts';
import { isRealPage, pageTitle } from '../../shared/pages.ts';
import { CHAT_PAGES_MAX, PAGE_VERSIONS_MAX } from '../../shared/pages-contract.ts';
import { isPageKey } from '../store/page-copies.ts';
import {
  type ChatFilesTracker,
  createChatFiles,
  type EvictedCopies,
  type PageCopyPort,
  PENDING_MAX,
  type ResolvePath,
  TRACKED_MAX,
  type TrackedAttachment,
} from './chat-files.ts';

const ROOT = '/Users/me/brain';
const REAL = '/private/var/brain';
const ACME: LibraryScope = { id: 'client:acme', name: 'Acme', kind: 'client' };
const PERSONAL: LibraryScope = { id: 'personal', name: 'My personal files', kind: 'personal' };

function itemOf(rel: string): LibraryItem {
  const name = rel.split('/').pop() ?? rel;
  return {
    id: `key:${rel}`,
    kind: 'document',
    format: 'doc',
    ext: name.split('.').pop() ?? '',
    group: 'Other',
    name,
    title: name,
    path: rel,
    bytes: 1,
    modified: '2026-11-13T00:00:00.000Z',
    width: null,
    height: null,
    thumb: false,
    view: 'text',
  };
}

/** A fake library: `clients/acme/…` and `personal/…` are scopes; `disk` holds the files there now. */
function fakeBrain() {
  const disk = new Set<string>();
  const calls: string[] = [];
  const resolve: ResolvePath = async (rel) => {
    calls.push(rel);
    const scope = rel.startsWith('personal/') ? PERSONAL : rel.startsWith('clients/acme/') ? ACME : null;
    if (!scope || rel.split('/').some((s) => s.startsWith('.'))) return null;
    if (!/\.[a-z]+$/.test(rel)) return null;
    return { key: `key:${rel}`, scope, item: disk.has(rel) ? itemOf(rel) : null };
  };
  return { disk, calls, resolve };
}

function setup(over: { now?: () => Date } = {}) {
  const brain = fakeBrain();
  const t = createChatFiles({ brainRoots: [ROOT, REAL], resolve: brain.resolve, ...over });
  return { ...brain, t };
}

let n = 0;
function use(name: string, input: Record<string, unknown>, parent: string | null = null) {
  const id = `tu${++n}`;
  return {
    id,
    msg: {
      type: 'assistant',
      uuid: `u${n}`,
      message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] },
      parent_tool_use_id: parent,
    },
  };
}
function result(id: string, isError = false) {
  return {
    type: 'user',
    uuid: `r${id}`,
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: id, is_error: isError, content: 'ok' }],
    },
    parent_tool_use_id: null,
  };
}
function say(text: string, parent: string | null = null) {
  return {
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text }] },
    parent_tool_use_id: parent,
  };
}
function step(
  t: ChatFilesTracker,
  name: string,
  input: Record<string, unknown>,
  o: { ok?: boolean; parent?: string | null; history?: boolean } = {},
): string {
  const u = use(name, input, o.parent ?? null);
  t.observe(u.msg, { history: o.history });
  t.observe(result(u.id, o.ok === false), { history: o.history });
  return u.id;
}

async function snap(t: ChatFilesTracker): Promise<ChatFilesSnapshot> {
  const s = await t.snapshot();
  if (!s) throw new Error('expected a snapshot');
  return s;
}
const byPath = (s: ChatFilesSnapshot, path: string): ChatFile | undefined =>
  s.files.find((f) => f.path === path);

describe('createChatFiles: steps', () => {
  it('counts Read, Write and Edit only once their result comes back ok', async () => {
    const { t, disk } = setup();
    disk.add('clients/acme/a.md');
    const u = use('Read', { file_path: `${ROOT}/clients/acme/a.md` });
    t.observe(u.msg);
    expect(await t.snapshot()).toBeNull();
    t.observe(result(u.id));
    const s = await snap(t);
    expect(s.files).toEqual([
      {
        key: 'key:clients/acme/a.md',
        path: 'clients/acme/a.md',
        item: itemOf('clients/acme/a.md'),
        scope: ACME,
        actions: ['read'],
        toolUseIds: [u.id],
        edits: 0,
        order: expect.any(Number),
      },
    ]);
    const e = step(t, 'Edit', { file_path: `${ROOT}/clients/acme/a.md`, old_string: 'a', new_string: 'b' });
    const f = byPath(await snap(t), 'clients/acme/a.md');
    expect(f?.actions).toEqual(['read', 'changed']);
    expect(f?.toolUseIds).toEqual([u.id, e]);
    expect(f?.edits).toBe(1);
  });

  it('calls a Write with no earlier Read created, and one after a Read changed', async () => {
    const { t, disk } = setup();
    disk.add('clients/acme/new.md');
    disk.add('clients/acme/old.md');
    step(t, 'Write', { file_path: `${ROOT}/clients/acme/new.md`, content: 'x' });
    step(t, 'Read', { file_path: `${ROOT}/clients/acme/old.md` });
    step(t, 'Write', { file_path: `${ROOT}/clients/acme/old.md`, content: 'y' });
    step(t, 'Write', { file_path: `${ROOT}/clients/acme/new.md`, content: 'z' });
    const s = await snap(t);
    expect(byPath(s, 'clients/acme/new.md')?.actions).toEqual(['created', 'changed']);
    expect(byPath(s, 'clients/acme/old.md')?.actions).toEqual(['read', 'changed']);
  });

  it('does not count a failed step, nor let a failed Read make a later Write a change', async () => {
    const { t, disk } = setup();
    disk.add('clients/acme/a.md');
    step(t, 'Read', { file_path: `${ROOT}/clients/acme/a.md` }, { ok: false });
    step(
      t,
      'Edit',
      { file_path: `${ROOT}/clients/acme/b.md`, old_string: 'a', new_string: 'b' },
      { ok: false },
    );
    expect(await t.snapshot()).toBeNull();
    step(t, 'Write', { file_path: `${ROOT}/clients/acme/a.md`, content: 'x' });
    const s = await snap(t);
    expect(s.files.map((f) => [f.path, f.actions])).toEqual([['clients/acme/a.md', ['created']]]);
  });

  it('leaves out paths outside every scope and never-listed paths', async () => {
    const { t, disk } = setup();
    for (const p of ['clients/acme/.env', 'os/README.md', '.claude/settings.json', 'clients/acme/ok.md'])
      disk.add(p);
    step(t, 'Read', { file_path: `${ROOT}/clients/acme/.env` });
    step(t, 'Read', { file_path: `${ROOT}/.claude/settings.json` });
    step(t, 'Read', { file_path: `${ROOT}/os/README.md` });
    step(t, 'Read', { file_path: '/etc/passwd' });
    step(t, 'Read', { file_path: `${ROOT}/clients/acme/../../etc/passwd` });
    step(t, 'Write', { file_path: '/tmp/x.md', content: 'x' });
    step(t, 'Read', { file_path: `${REAL}/clients/acme/ok.md` });
    const s = await snap(t);
    expect(s.files.map((f) => f.path)).toEqual(['clients/acme/ok.md']);
  });

  it('reads notebook_path for NotebookEdit and counts it as a change with no kept edit', async () => {
    const { t, disk } = setup();
    disk.add('personal/n.ipynb');
    step(t, 'NotebookEdit', { notebook_path: `${ROOT}/personal/n.ipynb`, new_source: 'x' });
    const f = byPath(await snap(t), 'personal/n.ipynb');
    expect(f?.actions).toEqual(['changed']);
    expect(f?.edits).toBe(1);
    expect(t.changes('key:personal/n.ipynb')).toBeNull();
  });

  it("counts a helper agent's steps", async () => {
    const { t, disk } = setup();
    disk.add('personal/h.md');
    const id = step(t, 'Read', { file_path: `${ROOT}/personal/h.md` }, { parent: 'task1' });
    expect(byPath(await snap(t), 'personal/h.md')?.toolUseIds).toEqual([id]);
  });

  it('forgets steps still waiting at turn end', async () => {
    const { t, disk } = setup();
    disk.add('personal/w.md');
    const u = use('Read', { file_path: `${ROOT}/personal/w.md` });
    t.observe(u.msg);
    t.endTurn();
    t.observe(result(u.id));
    expect((await snap(t)).files).toEqual([]);
  });

  it('orders files most recently touched first', async () => {
    const { t, disk } = setup();
    for (const p of ['personal/1.md', 'personal/2.md']) disk.add(p);
    step(t, 'Read', { file_path: `${ROOT}/personal/1.md` });
    step(t, 'Read', { file_path: `${ROOT}/personal/2.md` });
    expect((await snap(t)).files.map((f) => f.path)).toEqual(['personal/2.md', 'personal/1.md']);
    step(t, 'Edit', { file_path: `${ROOT}/personal/1.md`, old_string: 'a', new_string: 'b' });
    expect((await snap(t)).files.map((f) => f.path)).toEqual(['personal/1.md', 'personal/2.md']);
  });

  it('never throws on odd input', async () => {
    const { t } = setup();
    for (const m of [
      null,
      42,
      'x',
      { type: 'assistant' },
      { type: 'assistant', message: { content: [null, 1, { type: 'tool_use' }, { type: 'text', text: 5 }] } },
      { type: 'user', message: { content: 'hello' } },
      { type: 'user', message: { content: [{ type: 'tool_result' }] } },
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'x', name: 'Read', input: null }] } },
      {
        type: 'assistant',
        message: { content: [{ type: 'tool_use', id: 'y', name: 'Bash', input: { command: 7 } }] },
      },
    ]) {
      expect(() => t.observe(m)).not.toThrow();
    }
    expect(() => t.addAttachments([null as unknown as TrackedAttachment])).not.toThrow();
  });
});

describe('createChatFiles: snapshot', () => {
  it('is null when nothing changed since the last one', async () => {
    const { t, disk } = setup();
    expect(await t.snapshot()).toBeNull();
    disk.add('personal/a.md');
    step(t, 'Read', { file_path: `${ROOT}/personal/a.md` });
    expect(await t.snapshot()).not.toBeNull();
    expect(await t.snapshot()).toBeNull();
  });

  it('keeps a read or edited file that has gone, with no item; drops one only mentioned', async () => {
    const { t, disk } = setup();
    disk.add('personal/gone.md');
    step(t, 'Read', { file_path: `${ROOT}/personal/gone.md` });
    t.observe(say('See `personal/never.md` and `personal/gone.md`.'));
    expect(byPath(await snap(t), 'personal/gone.md')?.item).not.toBeNull();
    disk.delete('personal/gone.md');
    t.endTurn();
    const s = await snap(t);
    expect(byPath(s, 'personal/gone.md')).toMatchObject({ item: null, actions: ['read', 'mentioned'] });
    expect(byPath(s, 'personal/never.md')).toBeUndefined();
  });

  it('re-resolves only touched paths mid-turn, and every path after the turn ends', async () => {
    const { t, disk, calls } = setup();
    for (const p of ['personal/a.md', 'personal/b.md']) disk.add(p);
    step(t, 'Read', { file_path: `${ROOT}/personal/a.md` });
    await snap(t);
    calls.length = 0;
    step(t, 'Read', { file_path: `${ROOT}/personal/b.md` });
    await snap(t);
    expect(calls).toEqual(['personal/b.md']);
    calls.length = 0;
    t.endTurn();
    await snap(t);
    expect(calls.sort()).toEqual(['personal/a.md', 'personal/b.md']);
  });

  it('runs again after an observe that lands while a snapshot is resolving', async () => {
    const brain = fakeBrain();
    brain.disk.add('personal/a.md');
    brain.disk.add('personal/b.md');
    let release: () => void = () => {};
    const held = new Promise<void>((r) => {
      release = r;
    });
    const t = createChatFiles({
      brainRoots: [ROOT],
      resolve: async (rel) => {
        if (rel === 'personal/a.md') await held;
        return brain.resolve(rel);
      },
    });
    step(t, 'Read', { file_path: `${ROOT}/personal/a.md` });
    const first = t.snapshot();
    step(t, 'Read', { file_path: `${ROOT}/personal/b.md` });
    release();
    await first;
    const second = await snap(t);
    expect(second.files.map((f) => f.path)).toContain('personal/b.md');
  });

  it('never throws when resolve fails', async () => {
    const t = createChatFiles({
      brainRoots: [ROOT],
      resolve: async () => {
        throw new Error('boom');
      },
    });
    step(t, 'Read', { file_path: `${ROOT}/personal/a.md` });
    expect((await snap(t)).files).toEqual([]);
  });

  it('puts the paths back when building a snapshot fails, so the next one has them without a turn end', async () => {
    let broken = true;
    const t = createChatFiles({
      brainRoots: [ROOT],
      resolve: async (rel) => {
        const scope = broken
          ? {
              get id(): string {
                throw new Error('boom');
              },
              name: 'Acme',
              kind: 'client' as const,
            }
          : ACME;
        return { key: `key:${rel}`, scope, item: itemOf(rel) };
      },
    });
    step(t, 'Read', { file_path: `${ROOT}/clients/acme/a.md` });
    expect(await t.snapshot()).toBeNull();
    broken = false;
    const s = await snap(t);
    expect(s.files.map((f) => f.path)).toEqual(['clients/acme/a.md']);
  });
});

describe('createChatFiles: replies', () => {
  it('takes mentions and web links from the text of a reply', async () => {
    const { t, disk } = setup();
    disk.add('clients/acme/reports/audit.md');
    disk.add('personal/plan.md');
    t.observe(
      say(
        `I saved it to \`clients/acme/reports/audit.md\` and [the plan](${ROOT}/personal/plan.md). ` +
          'Sources: https://example.com/a, https://user:pw@example.com/secret and ' +
          `https://example.com/${'x'.repeat(CHAT_LINK_MAX_CHARS)}.`,
      ),
    );
    const s = await snap(t);
    expect(s.files.map((f) => [f.path, f.actions])).toEqual(
      expect.arrayContaining([
        ['clients/acme/reports/audit.md', ['mentioned']],
        ['personal/plan.md', ['mentioned']],
      ]),
    );
    expect(s.links).toEqual([{ url: 'https://example.com/a' }]);
  });

  it('keeps links newest first, once each', async () => {
    const { t } = setup();
    t.observe(say('https://a.example/ and https://b.example/'));
    t.observe(say('again https://a.example/'));
    expect((await snap(t)).links.map((l) => l.url)).toEqual(['https://a.example/', 'https://b.example/']);
  });

  it('adds a WebFetch address once the fetch worked', async () => {
    const { t } = setup();
    step(t, 'WebFetch', { url: 'https://fail.example/', prompt: 'x' }, { ok: false });
    step(t, 'WebFetch', { url: 'https://ok.example/page', prompt: 'x' });
    step(t, 'WebFetch', { url: 'file:///etc/passwd', prompt: 'x' });
    expect((await snap(t)).links).toEqual([{ url: 'https://ok.example/page' }]);
  });

  it("takes no mentions or links from a helper agent's text", async () => {
    const { t, disk } = setup();
    disk.add('personal/plan.md');
    t.observe(say('See `personal/plan.md` at https://example.com/', 'task1'));
    expect(await t.snapshot()).toBeNull();
  });
});

describe('createChatFiles: attachments', () => {
  const brief: TrackedAttachment = {
    name: 'Brief v2.pdf',
    kind: 'document',
    stagedPath: '/data/uploads/u1/Brief v2.pdf',
  };

  it('files an attachment copied by a Bash step that worked', async () => {
    const { t, disk } = setup();
    disk.add('clients/acme/reports/brief-v2.pdf');
    t.addAttachments([brief]);
    expect((await snap(t)).attachments).toEqual([{ name: 'Brief v2.pdf', kind: 'document', filedKey: null }]);
    step(
      t,
      'Bash',
      { command: `cp "${brief.stagedPath}" "${ROOT}/clients/acme/reports/elsewhere.pdf"` },
      { ok: false },
    );
    expect(await t.snapshot()).toBeNull(); // a failed step changes nothing
    step(t, 'Bash', { command: `cp '${brief.stagedPath}' ${ROOT}/clients/acme/reports/brief-v2.pdf` });
    const s = await snap(t);
    expect(s.attachments).toEqual([
      { name: 'Brief v2.pdf', kind: 'document', filedKey: 'key:clients/acme/reports/brief-v2.pdf' },
    ]);
    expect(byPath(s, 'clients/acme/reports/brief-v2.pdf')?.actions).toEqual(['filed']);
    expect(await t.snapshot()).toBeNull();
  });

  it('files an attachment copied into a folder', async () => {
    const { t, disk } = setup();
    disk.add('clients/acme/reports/Brief v2.pdf');
    t.addAttachments([brief]);
    step(t, 'Bash', {
      command: `mkdir -p ${ROOT}/clients/acme/reports && cp "${brief.stagedPath}" ${ROOT}/clients/acme/reports/`,
    });
    const s = await snap(t);
    expect(s.attachments[0]?.filedKey).toBe('key:clients/acme/reports/Brief v2.pdf');
  });

  it('ignores Bash steps that name no staged file, and keeps attachments in order, once each', async () => {
    const { t, disk } = setup();
    disk.add('personal/x.pdf');
    const other: TrackedAttachment = {
      name: 'pic.png',
      kind: 'image',
      stagedPath: '/data/uploads/u2/pic.png',
    };
    t.addAttachments([brief, other]);
    t.addAttachments([brief]);
    step(t, 'Bash', { command: `cp /somewhere/x.pdf ${ROOT}/personal/x.pdf` });
    const s = await snap(t);
    expect(s.attachments.map((a) => [a.name, a.filedKey])).toEqual([
      ['Brief v2.pdf', null],
      ['pic.png', null],
    ]);
    // Not an attachment, but the copy still made a file in the brain.
    expect(s.files.map((f) => [f.path, f.actions])).toEqual([['personal/x.pdf', ['changed']]]);
  });
});

describe('createChatFiles: changes', () => {
  it('keeps edits for What changed, the created Write as a new file', async () => {
    const { t, disk } = setup({ now: () => new Date('2026-11-13T10:00:00Z') });
    disk.add('personal/n.md');
    step(t, 'Write', { file_path: `${ROOT}/personal/n.md`, content: 'one\n' });
    step(t, 'Edit', { file_path: `${ROOT}/personal/n.md`, old_string: 'one', new_string: 'two' });
    step(t, 'Write', { file_path: `${ROOT}/personal/n.md`, content: 'three\n' });
    expect(t.changes('key:personal/n.md')).toBeNull(); // not resolved yet
    await snap(t);
    const c = t.changes('key:personal/n.md');
    expect(c?.truncated).toBe(false);
    expect(c?.changes.map((x) => [x.tool, x.change.kind, x.at])).toEqual([
      ['Write', 'new-file', '2026-11-13T10:00:00.000Z'],
      ['Edit', 'edit', '2026-11-13T10:00:00.000Z'],
      ['Write', 'replace-file', '2026-11-13T10:00:00.000Z'],
    ]);
    expect(t.changes('key:personal/other.md')).toBeNull();
  });

  it('gives no changes for a file that has gone', async () => {
    const { t } = setup();
    step(t, 'Edit', { file_path: `${ROOT}/personal/gone.md`, old_string: 'a', new_string: 'b' });
    expect(byPath(await snap(t), 'personal/gone.md')?.edits).toBe(1);
    expect(t.changes('key:personal/gone.md')).toBeNull();
  });

  it(`keeps at most ${CHAT_FILE_CHANGES_MAX} edits per file, the newest`, async () => {
    const { t, disk } = setup();
    disk.add('personal/e.md');
    for (let i = 0; i < CHAT_FILE_CHANGES_MAX + 5; i++) {
      step(t, 'Edit', { file_path: `${ROOT}/personal/e.md`, old_string: `v${i}`, new_string: `v${i + 1}` });
    }
    expect(byPath(await snap(t), 'personal/e.md')?.edits).toBe(CHAT_FILE_CHANGES_MAX + 5);
    const c = t.changes('key:personal/e.md');
    expect(c?.truncated).toBe(true);
    expect(c?.changes).toHaveLength(CHAT_FILE_CHANGES_MAX);
    expect(JSON.stringify(c?.changes[0]?.change)).toContain('v5');
  });

  it("drops the chat's oldest kept edits over the byte budget, and says so", async () => {
    const { t, disk } = setup();
    disk.add('personal/big1.md');
    disk.add('personal/big2.md');
    // Three fit in the budget; a fourth does not.
    const third = 'x'.repeat(Math.floor(CHAT_FILE_CHANGES_BUDGET / 3) - 200);
    step(t, 'Write', { file_path: `${ROOT}/personal/big1.md`, content: third });
    step(t, 'Write', { file_path: `${ROOT}/personal/big2.md`, content: third });
    step(t, 'Write', { file_path: `${ROOT}/personal/big2.md`, content: third });
    await snap(t);
    expect(t.changes('key:personal/big1.md')?.changes).toHaveLength(1);
    expect(t.changes('key:personal/big1.md')?.truncated).toBe(false);
    step(t, 'Write', { file_path: `${ROOT}/personal/big2.md`, content: third });
    await snap(t);
    expect(t.changes('key:personal/big1.md')).toBeNull();
    const two = t.changes('key:personal/big2.md');
    expect(two?.changes).toHaveLength(3);
    expect(two?.truncated).toBe(false);
    step(t, 'Write', { file_path: `${ROOT}/personal/big2.md`, content: third });
    await snap(t);
    const after = t.changes('key:personal/big2.md');
    expect(after?.changes).toHaveLength(3);
    expect(after?.truncated).toBe(true);
  });
});

describe('createChatFiles: history', () => {
  it('builds the same list from stored messages, with no times on kept edits', async () => {
    const { t, disk } = setup({ now: () => new Date('2026-11-13T10:00:00Z') });
    disk.add('clients/acme/r.md');
    disk.add('clients/acme/brief.pdf');
    const att: TrackedAttachment = {
      name: 'brief.pdf',
      kind: 'document',
      stagedPath: '/data/uploads/u9/brief.pdf',
    };
    t.addAttachments([att]);
    const history = { history: true };
    step(t, 'Read', { file_path: `${REAL}/clients/acme/r.md` }, history);
    step(t, 'Edit', { file_path: `${REAL}/clients/acme/r.md`, old_string: 'a', new_string: 'b' }, history);
    step(t, 'Bash', { command: `cp ${att.stagedPath} ${REAL}/clients/acme/brief.pdf` }, history);
    t.observe({ ...say('Done: `clients/acme/r.md`, see https://example.com/'), uuid: 'h1' }, history);
    const s = await snap(t);
    expect(byPath(s, 'clients/acme/r.md')?.actions).toEqual(['read', 'changed', 'mentioned']);
    expect(s.attachments[0]?.filedKey).toBe('key:clients/acme/brief.pdf');
    expect(s.links).toEqual([{ url: 'https://example.com/' }]);
    expect(t.changes('key:clients/acme/r.md')?.changes.map((c) => c.at)).toEqual([null]);
  });
});

describe('createChatFiles: limits', () => {
  it('merges two spellings of one file into one row; the newer spelling gives path and order', async () => {
    const brain = fakeBrain();
    const t = createChatFiles({
      brainRoots: [ROOT],
      // Like the library: case does not matter, the key is the listed path's.
      resolve: (rel) => brain.resolve(rel.toLowerCase()),
    });
    brain.disk.add('personal/a.md');
    const r = step(t, 'Read', { file_path: `${ROOT}/personal/A.md` });
    const e = step(t, 'Edit', { file_path: `${ROOT}/personal/a.md`, old_string: 'x', new_string: 'y' });
    let s = await snap(t);
    expect(s.files).toHaveLength(1);
    const first = s.files[0];
    expect(first).toMatchObject({
      key: 'key:personal/a.md',
      path: 'personal/a.md',
      actions: ['read', 'changed'],
      toolUseIds: [r, e],
      edits: 1,
    });
    // Gone: no item, so the newest spelling is shown, with the newest order.
    brain.disk.delete('personal/a.md');
    step(t, 'Read', { file_path: `${ROOT}/personal/A.md` }, { ok: true });
    t.endTurn();
    s = await snap(t);
    expect(s.files).toHaveLength(1);
    expect(s.files[0]?.path).toBe('personal/A.md');
    expect(s.files[0]?.order).toBeGreaterThan(first?.order ?? 0);
  });

  it(`sends at most ${CHAT_FILES_MAX} files, the newest, and no filedKey for a file left out`, async () => {
    const { t, disk } = setup();
    const att: TrackedAttachment = { name: 'f.pdf', kind: 'document', stagedPath: '/data/uploads/u3/f.pdf' };
    t.addAttachments([att]);
    disk.add('personal/f.pdf');
    step(t, 'Bash', { command: `cp ${att.stagedPath} ${ROOT}/personal/f.pdf` });
    expect((await snap(t)).attachments[0]?.filedKey).toBe('key:personal/f.pdf');
    for (let i = 0; i < CHAT_FILES_MAX; i++) {
      disk.add(`personal/${i}.md`);
      step(t, 'Read', { file_path: `${ROOT}/personal/${i}.md` });
    }
    const s = await snap(t);
    expect(s.files).toHaveLength(CHAT_FILES_MAX);
    expect(s.files[0]?.path).toBe(`personal/${CHAT_FILES_MAX - 1}.md`);
    expect(s.files.some((f) => f.path === 'personal/f.pdf')).toBe(false);
    expect(s.attachments[0]?.filedKey).toBeNull();
  });

  it(`sends at most ${CHAT_LINKS_MAX} links, the newest`, async () => {
    const { t } = setup();
    const many = (from: number) =>
      Array.from({ length: 60 }, (_, i) => `https://example.com/${from + i}`).join(' ');
    t.observe(say(many(0)));
    t.observe(say(many(60)));
    const links = (await snap(t)).links.map((l) => l.url);
    expect(links).toHaveLength(CHAT_LINKS_MAX);
    expect(links[0]).toBe('https://example.com/119');
    expect(links.at(-1)).toBe('https://example.com/20');
  });

  it(`tracks at most ${TRACKED_MAX} paths, forgetting the least recently touched`, async () => {
    const { t, disk } = setup();
    disk.add('personal/first.md');
    step(t, 'Edit', { file_path: `${ROOT}/personal/first.md`, old_string: 'a', new_string: 'b' });
    await snap(t);
    expect(t.changes('key:personal/first.md')).not.toBeNull();
    for (let i = 0; i < TRACKED_MAX; i++) step(t, 'Read', { file_path: `${ROOT}/personal/${i}.md` });
    await snap(t);
    expect(t.changes('key:personal/first.md')).toBeNull();
  });

  it(`keeps at most ${PENDING_MAX} steps waiting for a result, dropping the oldest`, async () => {
    const { t, disk } = setup();
    const uses = Array.from({ length: PENDING_MAX + 1 }, (_, i) => {
      disk.add(`personal/${i}.md`);
      const u = use('Read', { file_path: `${ROOT}/personal/${i}.md` });
      t.observe(u.msg);
      return u;
    });
    // Answered newest first, so the oldest would be the newest file if it still counted.
    for (const u of [...uses].reverse()) t.observe(result(u.id));
    const paths = (await snap(t)).files.map((f) => f.path);
    expect(paths).not.toContain('personal/0.md');
    expect(paths[0]).toBe('personal/1.md');
  });
});

describe('createChatFiles: shell steps', () => {
  const kinds = (s: ChatFilesSnapshot) => s.files.map((f) => [f.path, f.actions]).sort();

  it('counts the files a Bash step reads, from the folder it moved to, once the step worked', async () => {
    const { t, disk } = setup();
    disk.add('clients/acme/profile.md');
    disk.add('clients/acme/reports/audit.md');
    step(t, 'Bash', { command: `cd ${ROOT}/clients/acme && cat profile.md` }, { ok: false });
    expect(await t.snapshot()).toBeNull();
    step(t, 'Bash', {
      command: `cd ${ROOT}/clients/acme && cat profile.md reports/audit.md missing.md 2>/dev/null | head -50`,
    });
    expect(kinds(await snap(t))).toEqual([
      ['clients/acme/profile.md', ['read']],
      ['clients/acme/reports/audit.md', ['read']],
    ]);
  });

  it('remembers the folder for the next Bash step, as the shell does, and follows ..', async () => {
    const { t, disk } = setup();
    disk.add('clients/acme/profile.md');
    disk.add('clients/acme/reports/audit.md');
    step(t, 'Bash', { command: `cd "${ROOT}/clients/acme"` });
    step(t, 'Bash', { command: "sed -n 1,80p reports/audit.md; echo '####'" });
    step(t, 'Bash', { command: 'cd reports && wc -l ../profile.md' });
    expect(kinds(await snap(t))).toEqual([
      ['clients/acme/profile.md', ['read']],
      ['clients/acme/reports/audit.md', ['read']],
    ]);
  });

  it('marks files a Bash step writes as changed, and skips removed files and here-document text', async () => {
    const { t, disk } = setup();
    for (const f of ['new.md', 'a.md', 'b.md', 'c.md', 'd.md', 'e.md', 'profile.md'])
      disk.add(`clients/acme/${f}`);
    step(t, 'Bash', {
      command:
        "cat > clients/acme/new.md <<'EOF'\nSee clients/acme/profile.md\nEOF\necho done >> clients/acme/e.md",
    });
    step(t, 'Bash', { command: 'cp clients/acme/a.md clients/acme/b.md && rm clients/acme/c.md' });
    step(t, 'Bash', { command: "sed -i '' 's/x/y/' clients/acme/d.md" });
    const s = await snap(t);
    expect(kinds(s)).toEqual([
      ['clients/acme/a.md', ['read']],
      ['clients/acme/b.md', ['changed']],
      ['clients/acme/d.md', ['changed']],
      ['clients/acme/e.md', ['changed']],
      ['clients/acme/new.md', ['changed']],
    ]);
    expect(byPath(s, 'clients/acme/new.md')?.edits).toBe(0);
  });

  it('links a Bash step to its file only when it named exactly one', async () => {
    const { t, disk } = setup();
    disk.add('clients/acme/a.md');
    disk.add('clients/acme/b.md');
    const one = step(t, 'Bash', { command: 'cat clients/acme/a.md' });
    const two = step(t, 'Bash', { command: 'cat clients/acme/a.md clients/acme/b.md' });
    const s = await snap(t);
    expect(byPath(s, 'clients/acme/a.md')?.toolUseIds).toEqual([one]);
    expect(byPath(s, 'clients/acme/b.md')?.toolUseIds).toEqual([]);
    expect(two).toBeTruthy();
  });

  it("keeps a helper's folder apart from the chat's, and follows no cd it cannot place", async () => {
    const { t, disk } = setup();
    disk.add('clients/acme/profile.md');
    step(t, 'Bash', { command: `cd ${ROOT}/clients/acme` }, { parent: 'task1' });
    step(t, 'Bash', { command: 'cat profile.md' });
    step(t, 'Bash', { command: 'cd ~/elsewhere && cat profile.md' });
    step(t, 'Bash', { command: 'cd /tmp; cat profile.md; cat $f "*.md"' });
    expect((await t.snapshot())?.files ?? []).toEqual([]);
  });
});

describe('createChatFiles: short names in replies', () => {
  const kinds = (s: ChatFilesSnapshot | null) => (s?.files ?? []).map((f) => [f.path, f.actions]).sort();

  it('finds a name written under a folder the reply names', async () => {
    const { t, disk } = setup();
    disk.add('clients/acme/reports/audit.md');
    disk.add('clients/acme/reports/sub/deep.md');
    t.observe(
      say('## Recent reports (all in `clients/acme/reports/`)\n\n| `audit.md` | x |\n| `sub/deep.md` | y |'),
    );
    const s = await snap(t);
    expect(kinds(s)).toEqual([
      ['clients/acme/reports/audit.md', ['mentioned']],
      ['clients/acme/reports/sub/deep.md', ['mentioned']],
    ]);
    // Linking is decided per reply on the client, so no chat-wide names are sent.
    expect(byPath(s, 'clients/acme/reports/audit.md')).not.toHaveProperty('aliases');
  });

  it('finds a name in the folder of a file the reply names in full', async () => {
    const { t, disk } = setup();
    disk.add('clients/acme/context/business.md');
    disk.add('clients/acme/context/profile.md');
    t.observe(say('I read `clients/acme/context/business.md`; `profile.md` is out of date.'));
    expect(kinds(await snap(t))).toEqual([
      ['clients/acme/context/business.md', ['mentioned']],
      ['clients/acme/context/profile.md', ['mentioned']],
    ]);
  });

  it('finds a path that names its client folder without clients/', async () => {
    const { t, disk } = setup();
    disk.add('clients/acme/context/business.md');
    t.observe(say('Updated `acme/context/business.md`.'));
    expect(kinds(await snap(t))).toEqual([['clients/acme/context/business.md', ['mentioned']]]);
  });

  it('never takes a lone name from the folder the chat worked in, or a client folder it used before', async () => {
    const { t, disk } = setup();
    disk.add('clients/acme/profile.md');
    disk.add('clients/acme/context/business.md');
    disk.add('personal/profile.md');
    step(t, 'Bash', { command: `cd ${ROOT}/clients/acme` });
    step(t, 'Read', { file_path: `${ROOT}/personal/profile.md` });
    t.observe(say('`profile.md` and `context/business.md` need updating.'));
    expect(kinds(await snap(t))).toEqual([['personal/profile.md', ['read']]]);
  });

  it("never takes a lone name from another reply's folder", async () => {
    const { t, disk } = setup();
    disk.add('clients/acme/reports/audit.md');
    t.observe(say('Reports are in `clients/acme/reports/`.'));
    t.observe(say('For Beta, `audit.md` is due.'));
    expect((await t.snapshot())?.files ?? []).toEqual([]);
  });

  it('never takes a lone name from personal/ unless the reply names that folder', async () => {
    const { t, disk } = setup();
    disk.add('personal/notes.md');
    t.observe(say('See `notes.md`.'));
    expect((await t.snapshot())?.files ?? []).toEqual([]);
    t.observe(say('In `personal/`: `notes.md`.'));
    expect(kinds(await snap(t))).toEqual([['personal/notes.md', ['mentioned']]]);
  });

  it('links nothing when a short name fits files in two folders the reply names', async () => {
    const { t, disk } = setup();
    disk.add('clients/acme/reports/x.md');
    disk.add('clients/acme/drafts/x.md');
    t.observe(say('In `clients/acme/reports/` and `clients/acme/drafts/`: `x.md`.'));
    expect((await snap(t)).files).toEqual([]);
  });

  it('never takes a lone name from a reply that names folders of two clients', async () => {
    const { t, disk } = setup();
    disk.add('clients/acme/context/profile.md');
    t.observe(
      say(
        "Compared `clients/acme/context/` with `clients/beta/context/`. Beta's `profile.md` is out of date.",
      ),
    );
    expect((await t.snapshot())?.files ?? []).toEqual([]);
  });

  it('never guesses a short name with no folder in the reply', async () => {
    const { t, disk } = setup();
    disk.add('clients/acme/reports/audit.md');
    t.observe(say('See `audit.md`.'));
    expect((await t.snapshot())?.files ?? []).toEqual([]);
  });
});

describe('createChatFiles: review follow-ups', () => {
  const kinds = (s: ChatFilesSnapshot | null) => (s?.files ?? []).map((f) => [f.path, f.actions]).sort();

  it('prefers the folder a reply names over a personal file with the same name', async () => {
    const { t, disk } = setup();
    disk.add('personal/notes.md');
    disk.add('clients/acme/reports/notes.md');
    t.observe(say('All in `clients/acme/reports/`:\n\n| `notes.md` | x |'));
    const s = await snap(t);
    expect(kinds(s)).toEqual([['clients/acme/reports/notes.md', ['mentioned']]]);
  });

  it('keeps a cd inside brackets, $( ) or backticks to that part of the command', async () => {
    const { t, disk } = setup();
    disk.add('clients/acme/a/profile.md');
    disk.add('clients/acme/b/profile.md');
    step(t, 'Bash', { command: `cd ${ROOT}/clients/acme/b` });
    step(t, 'Bash', { command: '(cd ../a && ls); x=$(cd ../a; pwd); y=`cd ../a`; cat profile.md' });
    step(t, 'Bash', { command: 'cat profile.md' });
    expect(kinds(await snap(t))).toEqual([['clients/acme/b/profile.md', ['read']]]);
  });

  it('reads files from inside brackets from the folder moved to there', async () => {
    const { t, disk } = setup();
    disk.add('clients/acme/a/profile.md');
    step(t, 'Bash', { command: `(cd ${ROOT}/clients/acme/a && cat profile.md)` });
    expect(kinds(await snap(t))).toEqual([['clients/acme/a/profile.md', ['read']]]);
  });

  it('cannot follow popd', async () => {
    const { t, disk } = setup();
    disk.add('clients/acme/profile.md');
    step(t, 'Bash', { command: `cd ${ROOT}/clients/acme && pushd reports && popd && cat profile.md` });
    expect(kinds(await t.snapshot())).toEqual([]);
  });

  it('counts perl and sed as changing a file only with an in-place flag', async () => {
    const { t, disk } = setup();
    for (const f of ['x.md', 'y.md', 'z.md']) disk.add(`clients/acme/${f}`);
    step(t, 'Bash', { command: "perl -Mwarnings -ne 'print if /a/' clients/acme/x.md" });
    step(t, 'Bash', { command: "perl -pi -e 's/a/b/' clients/acme/y.md" });
    step(t, 'Bash', { command: "sed --in-place 's/a/b/' clients/acme/z.md" });
    expect(kinds(await snap(t))).toEqual([
      ['clients/acme/x.md', ['read']],
      ['clients/acme/y.md', ['changed']],
      ['clients/acme/z.md', ['changed']],
    ]);
  });

  it('does not count search patterns, echoed text or commit messages as files read', async () => {
    const { t, disk } = setup();
    for (const f of ['report.md', 'notes.md', 'y.md', 'hit.md']) disk.add(`clients/acme/${f}`);
    step(t, 'Bash', { command: `cd ${ROOT}/clients/acme` });
    step(t, 'Bash', {
      command:
        'grep -l report.md hit.md; rg -e notes.md .; echo notes.md; printf y.md; git commit -m y.md; ' +
        'grep -A 3 report.md hit.md; grep -e notes.md -e y.md hit.md; git commit -am y.md',
    });
    expect(kinds(await snap(t))).toEqual([['clients/acme/hit.md', ['read']]]);
  });
});

// ---------------------------------------------------------------------------
// Pages (plan docs/plans/2026-11-14-artifacts-in-app.md, revision 2 and the overseer's rulings)
// ---------------------------------------------------------------------------

interface FixtureCall {
  name: string;
  input: Record<string, unknown>;
  is_error: boolean;
  result: unknown;
}
const FIXTURE = JSON.parse(
  readFileSync(new URL('../../test/fixtures/artifact-calls.json', import.meta.url), 'utf8'),
) as { calls: FixtureCall[] };
const call = (name: string): FixtureCall => {
  const c = FIXTURE.calls.find((x) => x.name === name);
  if (!c) throw new Error(`no fixture ${name}`);
  return c;
};

const TMP = '/private/tmp/claude-501/p/scratchpad';
const page = (title: string, body = '') =>
  `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`;

/**
 * Copies the fake way: `files` is the disk now (a source path → its HTML); `drafts` and `kept` are the
 * app's copies. `/tmp/` is a link to `/private/tmp/`; `/outside/` is not an allowed root.
 */
function fakePages() {
  const files = new Map<string, string>();
  const drafts = new Map<string, { id: string; html: string }>();
  const kept = new Map<string, string>();
  const log: string[] = [];
  let evict: EvictedCopies = [];
  const takeEvictions = (): EvictedCopies => {
    const e = evict;
    evict = [];
    for (const x of e) kept.delete(`${x.key}/${x.id}`);
    return e;
  };
  const port: PageCopyPort = {
    async locate(p) {
      if (p.startsWith('/outside/')) return null;
      return p.replace(/^\/tmp\//, '/private/tmp/');
    },
    async draft(key, id, p, mustBePage) {
      log.push(`draft ${key}/${id}`);
      const html = files.get(p);
      if (html === undefined) return null;
      const isPage = isRealPage(html);
      const title = pageTitle(html, p);
      if (mustBePage && !isPage) return { title, page: false };
      drafts.set(key, { id, html });
      return { title, page: isPage };
    },
    async keep(key, id) {
      log.push(`keep ${key}/${id}`);
      if (kept.has(`${key}/${id}`)) return { evicted: [] };
      const d = drafts.get(key);
      if (!d || d.id !== id) return null;
      drafts.delete(key);
      kept.set(`${key}/${id}`, d.html);
      return { evicted: takeEvictions() };
    },
    async copy(key, id, p) {
      log.push(`copy ${key}/${id}`);
      const html = files.get(p);
      if (html === undefined) return null;
      kept.set(`${key}/${id}`, html);
      return { title: pageTitle(html, p), evicted: takeEvictions() };
    },
    async held(key, id) {
      const html = kept.get(`${key}/${id}`);
      return html === undefined ? null : { title: pageTitle(html, '') };
    },
    async isPage(p) {
      const html = files.get(p);
      return html === undefined ? null : isRealPage(html);
    },
  };
  return {
    port,
    files,
    drafts,
    kept,
    log,
    evictNext: (e: EvictedCopies) => {
      evict = e;
    },
  };
}

function setupPages(
  over: {
    now?: () => Date;
    pages?: ReturnType<typeof fakePages>;
    modified?: (p: string) => Promise<number | null>;
  } = {},
) {
  const brain = fakeBrain();
  const pages = over.pages ?? fakePages();
  const t = createChatFiles({
    brainRoots: [ROOT, REAL],
    resolve: brain.resolve,
    pages: pages.port,
    ...(over.now ? { now: over.now } : {}),
    ...(over.modified ? { modified: over.modified } : {}),
  });
  return { ...brain, pages, t };
}

/** A successful Write of `content` to `path`; live, the disk then holds it. */
function write(
  x: { t: ChatFilesTracker; pages: ReturnType<typeof fakePages> },
  path: string,
  content: string,
  o: { parent?: string | null; history?: boolean; ok?: boolean } = {},
): string {
  if (!o.history && o.ok !== false) x.pages.files.set(path, content);
  return step(x.t, 'Write', { file_path: path, content }, o);
}

/** A successful Edit of `path`; live, the disk then holds `after`. */
function edit(
  x: { t: ChatFilesTracker; pages: ReturnType<typeof fakePages> },
  path: string,
  after: string,
  o: { parent?: string | null; history?: boolean } = {},
): string {
  if (!o.history) x.pages.files.set(path, after);
  return step(x.t, 'Edit', { file_path: path, old_string: 'a', new_string: 'b' }, o);
}

function publish(
  t: ChatFilesTracker,
  c: Pick<FixtureCall, 'input' | 'is_error' | 'result'>,
  o: { parent?: string | null; history?: boolean } = {},
): string {
  const u = use('Artifact', c.input, o.parent ?? null);
  t.observe(u.msg, { history: o.history });
  t.observe(
    {
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: u.id, is_error: c.is_error, content: c.result }],
      },
      parent_tool_use_id: o.parent ?? null,
    },
    { history: o.history },
  );
  return u.id;
}

/** A publish of `path` that claude.ai answered with `url`, version `remote`. */
function pub(path: string, url: string, remote: number | null = 1) {
  return {
    input: { file_path: path },
    is_error: false,
    result: `Published ${path} at ${url}${remote === null ? '' : ` (Version ${remote}, version id 1-a)`}`,
  };
}

const pagesOf = (s: ChatFilesSnapshot) => s.pages ?? [];
/** What a page's versions say, without the times. */
const shape = (s: ChatFilesSnapshot) =>
  pagesOf(s).map((p) => ({
    key: p.key,
    title: p.title,
    draft: p.draft,
    versions: p.versions.map((v) => [v.n, v.hasCopy]),
    toolUseIds: p.toolUseIds,
  }));

describe('createChatFiles: pages Claude writes', () => {
  it('shows a page from its first write as in progress, then one version per boundary', async () => {
    const now = new Date('2026-11-14T10:00:00.000Z');
    const x = setupPages({ now: () => now });
    const path = `${TMP}/plan.html`;
    const first = write(x, path, page('The plan', 'one'));
    const draft = pagesOf(await snap(x.t));
    expect(draft).toHaveLength(1);
    expect(draft[0]).toMatchObject({
      title: 'The plan',
      draft: true,
      versions: [],
      url: null,
      fileKey: null,
    });
    expect(draft[0]?.toolUseIds).toEqual([first]);
    const key = draft[0]?.key as string;
    expect(isPageKey(key)).toBe(true);
    expect(x.t.page(key)).toEqual({
      title: 'The plan',
      url: null,
      filePath: path,
      draft: { id: first, hasCopy: true },
      versions: [],
    });
    // Ten edits in one reply: still one page in progress, its copy refreshed each time.
    const ids = [first];
    for (let i = 0; i < 10; i++) ids.push(edit(x, path, page('The plan', `edit ${i}`)));
    await x.t.settled();
    expect(x.pages.drafts.get(key)).toEqual({ id: ids.at(-1), html: page('The plan', 'edit 9') });
    x.t.boundary();
    const one = pagesOf(await snap(x.t));
    expect(one[0]).toMatchObject({ draft: false });
    expect(one[0]?.versions).toEqual([{ n: 1, remote: null, at: now.toISOString(), hasCopy: true }]);
    // The kept copy is named by the last tool use that touched the page.
    expect([...x.pages.kept.keys()]).toEqual([`${key}/${ids.at(-1)}`]);
    expect(x.t.page(key)?.versions).toEqual([{ n: 1, id: ids.at(-1), hasCopy: true }]);
    // A boundary with nothing written since makes no version.
    x.t.boundary();
    expect(await x.t.snapshot()).toBeNull();
    const again = write(x, path, page('The plan v2'));
    x.t.boundary();
    const two = pagesOf(await snap(x.t));
    expect(two).toHaveLength(1);
    expect(two[0]?.title).toBe('The plan v2');
    expect(two[0]?.versions.map((v) => v.n)).toEqual([1, 2]);
    expect(x.t.page(key)?.versions[1]?.id).toBe(again);
  });

  it('takes only real pages: a fragment is not one until the file becomes a page (O8)', async () => {
    const x = setupPages();
    const path = `${TMP}/body.html`;
    write(x, path, '<section><p>part of a page</p></section>');
    expect(await x.t.snapshot()).toBeNull();
    const id = write(x, path, '<html><title>Now whole</title></html>');
    const [p] = pagesOf(await snap(x.t));
    expect(p).toMatchObject({ title: 'Now whole', toolUseIds: [id] });
  });

  it('leaves out writes that failed, aren’t HTML, are relative or sit outside the allowed folders', async () => {
    const x = setupPages();
    write(x, `${TMP}/failed.html`, page('Failed'), { ok: false });
    write(x, `${TMP}/notes.md`, page('Notes'));
    write(x, 'scratchpad/rel.html', page('Relative'));
    write(x, '/outside/secret.html', page('Secret'));
    x.pages.files.set(`${TMP}/x\n.html`, page('Control'));
    step(x.t, 'Write', { file_path: `${TMP}/x\n.html`, content: page('Control') });
    expect('pages' in (await snap(x.t))).toBe(false);
  });

  it('counts an edit of a file that was already a page, and a helper’s writes', async () => {
    const x = setupPages();
    const path = `${TMP}/existing.html`;
    x.pages.files.set(path, page('Existing'));
    const e = edit(x, path, page('Existing', 'changed'));
    const h = write(x, path, page('Existing', 'by helper'), { parent: 'toolu_helper' });
    const [p] = pagesOf(await snap(x.t));
    expect(p?.toolUseIds).toEqual([e, h]);
  });

  it('keys a page by where it really is, so two spellings are one page', async () => {
    const x = setupPages();
    write(x, '/tmp/claude-501/p/scratchpad/a.html', page('A'));
    write(x, `${TMP}/a.html`, page('A again'));
    expect(pagesOf(await snap(x.t))).toHaveLength(1);
  });

  it('gives a page in the brain its library key (it opens in Documents too)', async () => {
    const x = setupPages();
    x.disk.add('clients/acme/reports/r.html');
    write(x, `${ROOT}/clients/acme/reports/r.html`, page('Report'));
    write(x, `${TMP}/t.html`, page('Temp'));
    const s = await snap(x.t);
    expect(pagesOf(s).map((p) => [p.title, p.fileKey])).toEqual([
      ['Temp', null],
      ['Report', 'key:clients/acme/reports/r.html'],
    ]);
    // It stays in the files list as well: the client leaves it out of "Made" (O6).
    expect(byPath(s, 'clients/acme/reports/r.html')).toBeDefined();
  });

  it('builds the same pages and versions from history as live, with a helper writing mid-turn (O4)', async () => {
    const pages = fakePages();
    const path = `${TMP}/report.html`;
    // Live: the person's message, Claude writes, a helper edits, Claude edits; next message; one more write.
    const live = setupPages({ pages });
    const script = (x: ReturnType<typeof setupPages>, history: boolean) => {
      x.t.boundary({ history });
      write(x, path, page('Report', '1'), { history });
      edit(x, path, page('Report', '2'), { parent: 'toolu_helper', history });
      say('working on it');
      edit(x, path, page('Report', '3'), { history });
      x.t.boundary({ history });
      write(x, path, page('Report', '4'), { history });
      x.t.boundary({ history });
    };
    n = 1000;
    script(live, false);
    const liveSnap = shape(await snap(live.t));
    expect(liveSnap[0]?.versions).toEqual([
      [1, true],
      [2, true],
    ]);
    // Reopened: the same messages from history, the same boundaries, and the copies live kept.
    n = 1000;
    pages.log.length = 0;
    const replay = setupPages({ pages });
    script(replay, true);
    expect(shape(await snap(replay.t))).toEqual(liveSnap);
    expect(pages.log.filter((l) => !l.startsWith('keep'))).toEqual([]);
    expect(replay.t.page(liveSnap[0]?.key as string)?.versions).toEqual(
      live.t.page(liveSnap[0]?.key as string)?.versions,
    );
  });

  it('replays a page made by a shell copy then edited, after its source has gone, as live had it', async () => {
    const pages = fakePages();
    const path = `${TMP}/copied.html`;
    const script = (x: ReturnType<typeof setupPages>, history: boolean) => {
      x.t.boundary({ history });
      // Not a write the tracker follows: the copy only puts the file on disk.
      if (!history) x.pages.files.set(path, page('Copied'));
      step(x.t, 'Bash', { command: `cp /Users/me/template.html ${path}` }, { history });
      edit(x, path, page('Copied', 'edited'), { history });
      x.t.boundary({ history });
    };
    n = 2000;
    const live = setupPages({ pages });
    script(live, false);
    const liveSnap = shape(await snap(live.t));
    expect(liveSnap).toHaveLength(1);
    expect(liveSnap[0]?.versions).toEqual([[1, true]]);
    // The temporary file is cleared before the chat is reopened.
    pages.files.delete(path);
    n = 2000;
    const replay = setupPages({ pages });
    script(replay, true);
    expect(shape(await snap(replay.t))).toEqual(liveSnap);
  });

  it('from history: decides page-ness from a Write’s content, or the file now for an edit', async () => {
    const x = setupPages();
    write(x, `${TMP}/frag.html`, '<p>fragment</p>', { history: true });
    write(x, `${TMP}/whole.html`, page('Whole'), { history: true });
    x.pages.files.set(`${TMP}/pre.html`, page('Was there'));
    edit(x, `${TMP}/pre.html`, '', { history: true });
    edit(x, `${TMP}/gone.html`, '', { history: true });
    x.t.boundary({ history: true });
    expect(
      pagesOf(await snap(x.t))
        .map((p) => p.title)
        .sort(),
    ).toEqual(['Was there', 'Whole']);
  });

  it('from history: copies only a missing newest version, and keeps a copy left in progress', async () => {
    const x = setupPages();
    const path = `${TMP}/b.html`;
    const start = n;
    const a = write(x, path, page('B1'), { history: true });
    x.t.boundary({ history: true });
    const b = write(x, path, page('B2'), { history: true });
    x.t.boundary({ history: true });
    x.pages.files.set(path, page('B now'));
    const [p] = pagesOf(await snap(x.t));
    const key = p?.key as string;
    // The older one would get today's content: never copied.
    expect(x.pages.log.filter((l) => l.startsWith('copy'))).toEqual([`copy ${key}/${b}`]);
    expect(p?.versions.map((v) => v.hasCopy)).toEqual([false, true]);
    expect(p?.title).toBe('B now');

    // A stop left an in-progress copy of version 1: it is exactly that version, so it is kept.
    const y = setupPages();
    n = start;
    y.pages.drafts.set(key, { id: a, html: page('B1') });
    write(y, path, page('B1'), { history: true });
    y.t.boundary({ history: true });
    write(y, path, page('B2'), { history: true });
    y.t.boundary({ history: true });
    const [q] = pagesOf(await snap(y.t));
    expect(q?.versions.map((v) => v.hasCopy)).toEqual([true, false]);
    expect(y.pages.kept.get(`${key}/${a}`)).toBe(page('B1'));
  });

  it('never copies a newest version from its source while the page is being written again', async () => {
    const x = setupPages();
    const path = `${TMP}/c.html`;
    write(x, path, page('C'), { history: true });
    x.t.boundary({ history: true });
    x.pages.files.set(path, page('C live'));
    write(x, path, page('C live'));
    await snap(x.t);
    expect(x.pages.log.filter((l) => l.startsWith('copy'))).toEqual([]);
  });

  it('marks versions whose copies made room for a newer one as not kept', async () => {
    const x = setupPages();
    const path = `${TMP}/e.html`;
    const first = write(x, path, page('E'));
    x.t.boundary();
    const key = pagesOf(await snap(x.t))[0]?.key as string;
    x.pages.evictNext([{ key, id: first }]);
    write(x, path, page('E2'));
    x.t.boundary();
    expect(pagesOf(await snap(x.t))[0]?.versions.map((v) => v.hasCopy)).toEqual([false, true]);
  });

  it('keeps at most PAGE_VERSIONS_MAX versions and CHAT_PAGES_MAX pages, newest first', async () => {
    const x = setupPages();
    const path = `${TMP}/v.html`;
    for (let i = 1; i <= PAGE_VERSIONS_MAX + 5; i++) {
      write(x, path, page(`V${i}`));
      x.t.boundary();
    }
    const [p] = pagesOf(await snap(x.t));
    expect(p?.versions).toHaveLength(PAGE_VERSIONS_MAX);
    expect(p?.versions[0]?.n).toBe(6);
    for (let i = 0; i < CHAT_PAGES_MAX + 5; i++) write(x, `${TMP}/p${i}.html`, page(`P${i}`));
    const s = pagesOf(await snap(x.t));
    expect(s).toHaveLength(CHAT_PAGES_MAX);
    expect(s[0]?.title).toBe(`P${CHAT_PAGES_MAX + 4}`);
    expect(s.map((y) => y.order)).toEqual([...s.map((y) => y.order)].sort((a, b) => b - a));
  });

  it('works without a copy store: pages from what the history shows, none kept', async () => {
    const { t } = setup();
    step(t, 'Write', { file_path: `${TMP}/w.html`, content: page('Written') });
    t.boundary();
    const [p] = pagesOf(await snap(t));
    expect(p).toMatchObject({ title: 'Written', draft: false });
    expect(p?.versions[0]?.hasCopy).toBe(false);
  });
});

describe('createChatFiles: Artifact publishes (R2)', () => {
  it('follows every fixture call: publishes and republishes count, nothing else does', async () => {
    const { t } = setupPages();
    const ids = FIXTURE.calls.map((c) => {
      const id = publish(t, c);
      t.boundary();
      return id;
    });
    const byName = (name: string) => ids[FIXTURE.calls.findIndex((c) => c.name === name)];
    const s = pagesOf(await snap(t));
    expect(s.map((p) => p.url)).toEqual([
      'https://claude.ai/artifact/BlOcKs00000000000000aa',
      'https://claude.ai/artifact/CaPaB1l1t1e5000000000x',
      'https://claude.ai/code/artifact/0b5c3c2e-1111-4a2b-9c3d-123456789abc',
      'https://claude.ai/artifact/ZzYyXx9876543210abcDef',
      'https://claude.ai/artifact/AbCdEf0123456789xyzQrs',
    ]);
    const budget = s[4];
    expect(budget?.versions.map((v) => [v.n, v.remote])).toEqual([
      [1, 1],
      [2, 2],
    ]);
    expect(budget?.toolUseIds).toEqual([byName('new page'), byName('republish same file, no url')]);
    expect(s[3]?.versions.map((v) => v.remote)).toEqual([3]);
    expect(s[2]?.multiFile).toBe(true);
    expect(s[2]?.live).toBe(false);
    expect(s[1]?.live).toBe(true);
    expect(s[1]?.multiFile).toBe(false);
    for (const p of s) expect(isPageKey(p.key)).toBe(true);
    expect(new Set(s.map((p) => p.key)).size).toBe(5);
  });

  it('gives a written page its claude.ai address and version when the same file is published', async () => {
    const x = setupPages();
    const path = `${TMP}/plan.html`;
    const url = 'https://claude.ai/artifact/PlAn0000000000000000aa';
    const w = write(x, path, page('The plan'));
    const pubId = publish(x.t, pub(path, `${url}/`, 3));
    x.t.boundary();
    const s = pagesOf(await snap(x.t));
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ title: 'The plan', url, toolUseIds: [w, pubId] });
    expect(s[0]?.versions.map((v) => [v.n, v.remote, v.hasCopy])).toEqual([[1, 3, true]]);
  });

  it('leaves a page’s address out of the web links', async () => {
    const { t } = setupPages();
    publish(t, call('new page'));
    t.observe(
      say(
        'Here it is: https://claude.ai/artifact/AbCdEf0123456789xyzQrs and the docs at https://example.com/docs',
      ),
    );
    const s = await snap(t);
    expect(s.links).toEqual([{ url: 'https://example.com/docs' }]);
    expect(pagesOf(s)).toHaveLength(1);
  });

  it('leaves `pages` out of a snapshot for a chat with none (as before)', async () => {
    const { t } = setupPages();
    publish(t, call('quickstart (mentions artifact addresses, not a publish)'));
    t.observe(say('See https://example.com/a'));
    const s = await snap(t);
    expect('pages' in s).toBe(false);
  });
});

describe('createChatFiles: pages made with Bash', () => {
  const fresh = async () => Date.now() + 1000;
  const bash = (x: ReturnType<typeof setupPages>, command: string, o: { ok?: boolean } = {}) =>
    step(x.t, 'Bash', { command }, o);

  it('shows an absolute .html written by cat > in a scratchpad, like a Write', async () => {
    const x = setupPages({ modified: fresh });
    const path = `${TMP}/hello.html`;
    x.pages.files.set(path, page('Hello', 'hi'));
    const id = bash(x, `cat > ${path} <<'EOF'\n<html></html>\nEOF`);
    await x.t.settled();
    const s = pagesOf(await snap(x.t));
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ title: 'Hello', draft: true, toolUseIds: [id] });
    x.t.boundary();
    expect(pagesOf(await snap(x.t))[0]?.versions).toHaveLength(1);
  });

  it('shows a page copied into the brain by cp, and one named by a relative path', async () => {
    const x = setupPages({ modified: fresh });
    const abs = `${ROOT}/personal/a.html`;
    x.pages.files.set(abs, page('Copied'));
    bash(x, `cp ${TMP}/src.html ${abs}`);
    await x.t.settled();
    expect(pagesOf(await snap(x.t)).map((p) => p.title)).toEqual(['Copied']);
    const rel = `${ROOT}/personal/b.html`;
    x.pages.files.set(rel, page('Relative'));
    bash(x, 'cd personal && cp a.html b.html');
    await x.t.settled();
    expect(
      pagesOf(await snap(x.t))
        .map((p) => p.title)
        .sort(),
    ).toEqual(['Copied', 'Relative']);
  });

  it('ignores a non-page .html, a path the port refuses, a failed command and a file older than the command', async () => {
    const x = setupPages({ modified: fresh });
    x.pages.files.set(`${TMP}/frag.html`, '<p>just a fragment</p>');
    bash(x, `cat > ${TMP}/frag.html`);
    x.pages.files.set('/outside/x.html', page('Outside'));
    bash(x, 'cat > /outside/x.html');
    x.pages.files.set(`${TMP}/failed.html`, page('Failed'));
    bash(x, `cat > ${TMP}/failed.html`, { ok: false });
    await x.t.settled();
    expect((await x.t.snapshot())?.pages ?? []).toHaveLength(0);

    const old = setupPages({ modified: async () => 1000 });
    old.pages.files.set(`${TMP}/old.html`, page('Old'));
    bash(old, `cat ${TMP}/old.html | wc -c > ${TMP}/old.html`);
    await old.t.settled();
    expect((await old.t.snapshot())?.pages ?? []).toHaveLength(0);
  });

  it('allows for coarse file times: 1.5 s before the command still shows, 5 s before does not', async () => {
    const near = setupPages({ modified: async () => Date.now() - 1500 });
    near.pages.files.set(`${TMP}/near.html`, page('Near'));
    bash(near, `cat > ${TMP}/near.html`);
    await near.t.settled();
    expect(pagesOf(await snap(near.t)).map((p) => p.title)).toEqual(['Near']);

    const far = setupPages({ modified: async () => Date.now() - 5000 });
    far.pages.files.set(`${TMP}/far.html`, page('Far'));
    bash(far, `cat > ${TMP}/far.html`);
    await far.t.settled();
    expect((await far.t.snapshot())?.pages ?? []).toHaveLength(0);
  });

  it('rebuilds a page a Bash command made live, with its versions, when the chat is replayed', async () => {
    const pages = fakePages();
    const path = `${TMP}/script.html`;
    const script = (x: ReturnType<typeof setupPages>, history: boolean) => {
      x.t.boundary({ history });
      if (!history) x.pages.files.set(path, page('Script'));
      step(x.t, 'Bash', { command: `cat > ${path} <<'EOF'\n<html></html>\nEOF` }, { history });
      x.t.boundary({ history });
    };
    n = 3000;
    const live = setupPages({ pages, modified: fresh });
    script(live, false);
    await live.t.settled();
    const liveSnap = pagesOf(await snap(live.t));
    expect(liveSnap).toHaveLength(1);
    expect(liveSnap[0]?.versions.map((v) => v.hasCopy)).toEqual([true]);
    // The script's file is cleared before the chat is reopened after a restart.
    pages.files.delete(path);
    n = 3000;
    const replay = setupPages({ pages });
    script(replay, true);
    await replay.t.settled();
    const got = pagesOf(await snap(replay.t));
    expect(got.map((p) => p.key)).toEqual(liveSnap.map((p) => p.key));
    expect(got[0]?.versions.map((v) => v.hasCopy)).toEqual([true]);
  });

  it('does not make pages from history, and leaves other shell changes as they were', async () => {
    const x = setupPages({ modified: fresh });
    x.pages.files.set(`${TMP}/h.html`, page('H'));
    step(x.t, 'Bash', { command: `cat > ${TMP}/h.html` }, { history: true });
    await x.t.settled();
    expect((await x.t.snapshot())?.pages ?? []).toHaveLength(0);
  });
});
