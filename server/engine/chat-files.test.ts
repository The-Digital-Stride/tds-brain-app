import { describe, expect, it } from 'vitest';
import type { ChatFile, ChatFilesSnapshot, LibraryItem, LibraryScope } from '../../shared/contract.ts';
import {
  CHAT_FILE_CHANGES_BUDGET,
  CHAT_FILE_CHANGES_MAX,
  CHAT_FILES_MAX,
  CHAT_LINK_MAX_CHARS,
  CHAT_LINKS_MAX,
} from '../../shared/contract.ts';
import {
  type ChatFilesTracker,
  createChatFiles,
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
    expect(s.files).toEqual([]);
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
