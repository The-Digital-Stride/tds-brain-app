// Chat summaries (plan 2026-11-24-chat-summary-updates): the draft route, the "chats not saved yet" route and
// the save checks on projectsChange, sent over real HTTP to the real server so every request passes the real
// security gate (checkRequest) first. The brain and the session manager are fakes: the draft itself is tested in
// server/engine/chat-summary.test.ts and session-manager.test.ts.
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { composeChatSummary } from '../../shared/chat-summary.ts';
import type { ChatSummaryDraft, UnsavedChat } from '../../shared/chat-summary-contract.ts';
import { type Identity, ROUTES, sessionCookieName } from '../../shared/contract.ts';
import type { ProjectChat, ProjectChatsInput } from '../../shared/project-chats-contract.ts';
import type { ProjectCard, ProjectList } from '../../shared/projects-contract.ts';
import { ChatDraftError, type ChatDraftInput, type UnsavedInput } from '../engine/chat-summary.ts';
import { SessionError } from '../engine/session-manager.ts';
import { cookieValueFor, createAuthCodes } from './security.ts';
import { type AppServer, createAppServer } from './server.ts';

const PORT = 45931;
const HOST = `127.0.0.1:${PORT}`;
const TOKEN = 'launch-token-chat-summary';
const COOKIE = `${sessionCookieName(PORT)}=${cookieValueFor(TOKEN)}`;
const CHAT = '11111111-2222-4333-8444-555555555555';
const STRANGER = '99999999-2222-4333-8444-555555555555';

const sam: Identity = {
  name: 'Sam Example',
  slug: 'sam-example',
  email: null,
  role: 'team',
  knownMember: true,
};

function card(key: string, over: Partial<ProjectCard> = {}): ProjectCard {
  const [client, slug] = key.split('/') as [string, string];
  return {
    key,
    space: client === 'personal' ? 'personal' : 'client',
    slug,
    client: client === 'personal' ? null : client,
    folder: client === 'personal' ? `personal/projects/${slug}` : `clients/${client}/projects/${slug}`,
    card: 'ok',
    archived: false,
    title: `Project ${slug}`,
    ...over,
  } as ProjectCard;
}

const DRAFT: ChatSummaryDraft = {
  chat: CHAT,
  project: 'acme/web',
  title: 'Launch chat',
  fields: { objective: 'Plan', outcome: 'Agreed', figures: [], nextSteps: [] },
  documents: [],
  fromEmail: false,
  earlier: [],
  nothingNew: false,
};

interface State {
  access: 'allowed' | 'restricted';
  list: ProjectList;
  owns: Set<string>;
  draftFail: unknown;
  entries: { path: string; at: string; summary: string }[];
  library: Record<string, 'client' | 'personal'>;
  unsaved: UnsavedChat[];
  chats: ProjectChat[];
  myEntries: Map<string, string> | 'fail';
  noService: boolean;
}
let state: State;
const seen = {
  drafts: [] as ChatDraftInput[],
  changes: [] as unknown[],
  recorded: [] as [string, string][],
  unsaved: [] as UnsavedInput[],
  projectChats: [] as ProjectChatsInput[],
  myEntriesFor: [] as [string, string][],
  entriesRead: [] as (Map<string, string> | 'fail')[],
  hasEntry: [] as boolean[],
  holds: [] as ((id: string) => Promise<boolean>)[],
};

function freshState(): State {
  return {
    access: 'allowed',
    list: {
      projects: [
        card('acme/web', { movedFrom: ['acme/old-web'] }),
        card('acme/old', { archived: true }),
        card('acme/nocard', { card: 'none' }),
        card('personal/garden'),
      ],
      canChange: true,
      canSaveChat: true,
      looseLabels: 0,
      duplicates: [],
      skippedFolders: 0,
    },
    owns: new Set([CHAT]),
    draftFail: null,
    entries: [],
    library: {
      'clients/acme/projects/web/brief.md': 'client',
      'personal/scratch.md': 'personal',
    },
    unsaved: [{ chat: CHAT, title: 'Launch chat', lastActive: '2026-11-24T10:00:00.000Z', savedAt: null }],
    chats: [
      {
        chat: CHAT,
        title: 'Launch chat',
        lastActive: '2026-11-24T10:00:00.000Z',
        busy: false,
        saved: 'never',
        savedAt: null,
      },
    ],
    myEntries: new Map([[CHAT, '2026-11-20T10:00:00Z']]),
    noService: false,
  };
}

let app: AppServer;
let listenPort: number;

beforeAll(async () => {
  const brain = {
    watch: () => () => {},
    identity: async () => sam,
    skillAccess: async () => state.access,
    projects: async () => state.list,
    projectsIndex: async () => ({
      cards: state.list.projects,
      byKey: (k: string) =>
        state.list.projects.find((c) => c.key === k || (c.movedFrom ?? []).includes(k)) ?? null,
    }),
    changeProject: async (action: unknown) => {
      seen.changes.push(action);
      return { ...state.list, file: 'clients/acme/projects/web/updates/x.md' };
    },
    libraryItemForPath: async (rel: string) => {
      const kind = state.library[rel];
      return kind
        ? { key: `k:${rel}`, scope: { id: kind, name: kind, kind }, item: { path: rel, name: rel } }
        : null;
    },
    chatEntries: async () => state.entries,
    myChatEntries: async (key: string, who: Identity) => {
      seen.myEntriesFor.push([key, who.slug]);
      if (state.myEntries === 'fail') throw new Error('unreadable');
      return state.myEntries;
    },
    setHoldsChat: (fn: (id: string) => Promise<boolean>) => {
      seen.holds.push(fn);
    },
    projectUpdates: async () => ({ items: [], unreadable: 0, more: false, canAdd: true }),
  };
  const owns = async (id: string) => state.owns.has(id);
  const summaries = {
    owns,
    draft: async (input: ChatDraftInput) => {
      seen.drafts.push(input);
      if (state.draftFail) throw state.draftFail;
      return { ...DRAFT, project: input.project.key };
    },
    recordSaved: async (chat: string, key: string) => {
      seen.recorded.push([chat, key]);
    },
    unsaved: async (input: UnsavedInput) => {
      seen.unsaved.push(input);
      seen.hasEntry.push(await input.hasEntry(CHAT));
      return state.unsaved;
    },
    forProject: async (input: ProjectChatsInput) => {
      seen.projectChats.push(input);
      seen.entriesRead.push(await input.entries().catch(() => 'fail' as const));
      return { chats: state.chats, more: false };
    },
  };
  app = createAppServer({
    port: PORT,
    clientDir: '/nonexistent',
    launchToken: TOKEN,
    authCodes: createAuthCodes(TOKEN),
    appVersion: '0',
    underService: false,
    brain: brain as never,
    store: { get: async () => ({ directWrites: true }) } as never,
    sessions: {
      onChange: () => () => {},
      subscribe: () => {
        throw new SessionError('not-found', 'no such chat');
      },
      ownsChat: owns,
      get chatSummaries() {
        return state.noService ? undefined : summaries;
      },
    } as never,
    thumbs: {} as never,
    uploads: {} as never,
    engineHealth: () => ({}) as never,
    appState: { kind: 'ready' },
    setup: {} as never,
  });
  await new Promise<void>((done) => app.server.listen(0, '127.0.0.1', done));
  listenPort = (app.server.address() as AddressInfo).port;
});
afterAll(async () => {
  app.stop();
  await new Promise((done) => app.server.close(done));
});
beforeEach(() => {
  state = freshState();
  for (const list of Object.values(seen)) list.length = 0;
});

interface Reply {
  status: number;
  json: Record<string, unknown> & { error?: { code: string; message: string } };
}
function send(
  path: string,
  opts: { method?: string; headers?: Record<string, string>; body?: unknown } = {},
): Promise<Reply> {
  return new Promise<Reply>((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: listenPort,
        path,
        method: opts.method ?? 'GET',
        headers: { host: HOST, ...opts.headers },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          let json: Reply['json'] = {};
          try {
            json = JSON.parse(Buffer.concat(chunks).toString());
          } catch {}
          resolve({ status: res.statusCode ?? 0, json });
        });
      },
    );
    req.on('error', reject);
    req.end(opts.body === undefined ? undefined : JSON.stringify(opts.body));
  });
}
const JSON_POST = { cookie: COOKIE, origin: `http://${HOST}`, 'content-type': 'application/json' };
const postTo = (path: string, body: unknown) => send(path, { method: 'POST', headers: JSON_POST, body });
const draft = (body: unknown) => postTo(ROUTES.chatSummaryDraft, body);
const get = (path: string) => send(path, { headers: { cookie: COOKIE } });

const body = (docs: { ref: string; name: string }[] = []) =>
  composeChatSummary({
    objective: 'Plan',
    outcome: 'Agreed',
    figures: ['£4,200'],
    documents: docs,
    nextSteps: [],
  });
const save = (over: Record<string, unknown> = {}, key = 'acme/web') =>
  postTo(ROUTES.projectsChange, {
    kind: 'update',
    key,
    entry: { kind: 'chat', summary: body(), clientSafe: false, chat: CHAT, title: 'Launch chat', ...over },
  });

describe('the security gate on the draft route', () => {
  it('refuses no cookie, no origin and the wrong content type; GET is not allowed', async () => {
    expect(
      (await send(ROUTES.chatSummaryDraft, { method: 'POST', body: { chat: CHAT, project: 'acme/web' } }))
        .status,
    ).toBe(401);
    const noOrigin = await send(ROUTES.chatSummaryDraft, {
      method: 'POST',
      headers: { cookie: COOKIE, 'content-type': 'application/json' },
      body: { chat: CHAT, project: 'acme/web' },
    });
    expect(noOrigin.status).toBe(403);
    const wrongType = await send(ROUTES.chatSummaryDraft, {
      method: 'POST',
      headers: { cookie: COOKIE, origin: `http://${HOST}`, 'content-type': 'text/plain' },
      body: { chat: CHAT, project: 'acme/web' },
    });
    expect(wrongType.status).toBe(415);
    expect((await get(ROUTES.chatSummaryDraft)).status).toBe(405);
    expect(seen.drafts).toHaveLength(0);
  });

  it('a well-formed POST passes the real gate and answers the draft', async () => {
    const r = await draft({ chat: CHAT, project: 'acme/web' });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ chat: CHAT, project: 'acme/web', title: 'Launch chat' });
    expect(seen.drafts[0]).toEqual({
      chat: CHAT,
      project: { key: 'acme/web', title: 'Project web', personal: false },
      earlier: [],
    });
  });
});

describe('POST chatSummaryDraft', () => {
  it('bad shapes are bad-request', async () => {
    for (const b of [
      {},
      { chat: CHAT },
      { chat: 'nope', project: 'acme/web' },
      { chat: CHAT, project: '../x' },
      { chat: CHAT, project: 'acme/web', extra: 1 },
    ]) {
      const r = await draft(b);
      expect([r.status, r.json.error?.code]).toEqual([400, 'bad-request']);
    }
  });

  it("another Mac's chat is not-found", async () => {
    const r = await draft({ chat: STRANGER, project: 'acme/web' });
    expect([r.status, r.json.error?.code]).toEqual([404, 'not-found']);
    expect(r.json.error?.message).toBe("That chat couldn't be found on this Mac.");
    expect(seen.drafts).toHaveLength(0);
  });

  it('project not found, archived, no card, no capability, no change rights, or a refused role', async () => {
    expect((await draft({ chat: CHAT, project: 'acme/gone' })).json.error?.code).toBe('not-found');
    for (const project of ['acme/old', 'acme/nocard']) {
      const r = await draft({ chat: CHAT, project });
      expect([r.status, r.json.error?.code]).toEqual([403, 'not-allowed']);
    }
    state.list = { ...state.list, canSaveChat: false };
    expect((await draft({ chat: CHAT, project: 'acme/web' })).json.error?.message).toMatch(
      /Update the brain's skills/,
    );
    state.list = { ...state.list, canSaveChat: true, canChange: false };
    expect((await draft({ chat: CHAT, project: 'acme/web' })).json.error?.code).toBe('not-allowed');
    state = freshState();
    state.access = 'restricted';
    expect((await draft({ chat: CHAT, project: 'acme/web' })).json.error?.code).toBe('not-allowed');
    expect(seen.drafts).toHaveLength(0);
  });

  it('follows a moved key, and sends every earlier summary by this person', async () => {
    state.entries = [{ path: 'u/2.md', at: '2026-11-22T10:00:00Z', summary: 'Earlier' }];
    const r = await draft({ chat: CHAT, project: 'acme/old-web' });
    expect(r.status).toBe(200);
    expect(seen.drafts[0]?.project.key).toBe('acme/web');
    expect(seen.drafts[0]?.earlier).toEqual(state.entries);
  });

  it("the draft's own errors keep their code and sentence", async () => {
    state.draftFail = new ChatDraftError('busy', 'Claude is still working in this chat.');
    let r = await draft({ chat: CHAT, project: 'acme/web' });
    expect([r.status, r.json.error?.code, r.json.error?.message]).toEqual([
      409,
      'busy',
      'Claude is still working in this chat.',
    ]);
    state.draftFail = new ChatDraftError('internal', "Claude couldn't write a summary this time. Try again.");
    r = await draft({ chat: CHAT, project: 'acme/web' });
    expect([r.status, r.json.error?.code]).toEqual([500, 'internal']);
  });
});

describe('saving a chat entry through projectsChange', () => {
  it('saves this Mac’s chat in the layout, then records the count under the live key', async () => {
    const r = await save({}, 'acme/old-web');
    expect(r.status).toBe(200);
    expect(seen.changes[0]).toMatchObject({
      kind: 'update',
      entry: { kind: 'chat', chat: CHAT, title: 'Launch chat' },
    });
    expect(seen.recorded).toEqual([[CHAT, 'acme/web']]);
  });

  it('refuses a chat this Mac does not hold (not-allowed)', async () => {
    const r = await save({ chat: STRANGER });
    expect([r.status, r.json.error?.code]).toEqual([403, 'not-allowed']);
    expect(r.json.error?.message).toBe('Only the person who had this chat can save a summary of it.');
    expect(seen.changes).toHaveLength(0);
  });

  it('refuses a body that is not the layout, and bad shapes', async () => {
    expect((await save({ summary: 'Just some text I typed.' })).json.error?.code).toBe('bad-request');
    for (const over of [
      { chat: 'nope' },
      { title: '' },
      { title: 'two\nlines' },
      { title: 'x'.repeat(121) },
      { extra: 1 },
    ]) {
      expect((await save(over)).status).toBe(400);
    }
    expect(seen.changes).toHaveLength(0);
  });

  it('refuses a ref that is not https or a listed brain file', async () => {
    for (const ref of [
      'http://example.com/a',
      'javascript:alert(1)',
      'clients/acme/missing.md',
      '/etc/passwd',
      'clients/../secrets.md',
      'https://user:pw@example.com/',
    ]) {
      const r = await save({ summary: body([{ ref, name: 'Doc' }]) });
      expect([ref, r.status]).toEqual([ref, 400]);
    }
    expect(seen.changes).toHaveLength(0);
    const ok = await save({
      summary: body([
        { ref: 'clients/acme/projects/web/brief.md', name: 'Brief' },
        { ref: 'https://claude.ai/public/artifacts/abc', name: 'Page' },
      ]),
    });
    expect(ok.status).toBe(200);
  });

  it('a personal file only on a personal project', async () => {
    const doc = [{ ref: 'personal/scratch.md', name: 'Scratch' }];
    const shared = await save({ summary: body(doc) });
    expect([shared.status, shared.json.error?.message]).toEqual([
      400,
      "A file in your personal files can't be linked from a shared project. Untick it and try again.",
    ]);
    expect((await save({ summary: body(doc) }, 'personal/garden')).status).toBe(200);
  });

  it('a note is unchanged by the chat rules', async () => {
    const r = await postTo(ROUTES.projectsChange, {
      kind: 'update',
      key: 'acme/web',
      entry: { kind: 'note', summary: 'Plain note', clientSafe: false },
    });
    expect(r.status).toBe(200);
    expect(seen.recorded).toHaveLength(0);
  });
});

describe('GET projectUnsavedChats', () => {
  it('asks for the live and moved_from keys over the last 30 days, with this person’s entries', async () => {
    const before = Date.now();
    const r = await get(`${ROUTES.projectUnsavedChats}?key=acme/web`);
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ chats: state.unsaved, canSave: true });
    expect(seen.unsaved[0]?.keys).toEqual(['acme/web', 'acme/old-web']);
    const since = seen.unsaved[0]?.since ?? 0;
    expect(before - since).toBeGreaterThanOrEqual(30 * 86_400_000 - 1000);
    expect(before - since).toBeLessThan(30 * 86_400_000 + 5000);
    expect(seen.hasEntry).toEqual([false]);
    state.entries = [{ path: 'u/1.md', at: '2026-11-20T10:00:00Z', summary: 'x' }];
    await get(`${ROUTES.projectUnsavedChats}?key=acme/web`);
    expect(seen.hasEntry).toEqual([false, true]);
  });

  it('empty with canSave false when saving is not possible here', async () => {
    for (const key of ['acme/old', 'acme/nocard']) {
      expect((await get(`${ROUTES.projectUnsavedChats}?key=${key}`)).json).toEqual({
        chats: [],
        canSave: false,
      });
    }
    state.list = { ...state.list, canSaveChat: false };
    expect((await get(`${ROUTES.projectUnsavedChats}?key=acme/web`)).json).toEqual({
      chats: [],
      canSave: false,
    });
    state = freshState();
    state.access = 'restricted';
    expect((await get(`${ROUTES.projectUnsavedChats}?key=acme/web`)).json).toEqual({
      chats: [],
      canSave: false,
    });
    expect(seen.unsaved).toHaveLength(0);
  });

  it('a bad key is bad-request; an unknown project not-found', async () => {
    expect((await get(`${ROUTES.projectUnsavedChats}?key=../x`)).status).toBe(400);
    expect((await get(`${ROUTES.projectUnsavedChats}?key=acme/gone`)).status).toBe(404);
  });
});

describe('GET projectChats', () => {
  const URL_OK = `${ROUTES.projectChats}?key=acme/web`;

  it('answers the rows through the real gate; asks with the live and moved_from keys', async () => {
    const r = await get(URL_OK);
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ chats: state.chats, canSave: true, more: false });
    expect(seen.projectChats[0]?.keys).toEqual(['acme/web', 'acme/old-web']);
    expect(seen.entriesRead).toEqual([state.myEntries]);
    expect(seen.myEntriesFor).toEqual([['acme/web', 'sam-example']]);
  });

  it('is refused without the launch cookie, like the other project routes', async () => {
    const r = await send(URL_OK);
    expect(r.status).not.toBe(200);
    expect(seen.projectChats).toHaveLength(0);
  });

  it('only GET: other methods are refused', async () => {
    for (const method of ['POST', 'PUT', 'PATCH']) {
      const r = await send(URL_OK, { method, headers: JSON_POST, body: {} });
      expect([method, r.status]).toEqual([method, 405]);
    }
    expect(seen.projectChats).toHaveLength(0);
  });

  it('a bad or missing key is bad-request; an unknown project not-found', async () => {
    expect((await get(`${ROUTES.projectChats}?key=../x`)).status).toBe(400);
    expect((await get(ROUTES.projectChats)).status).toBe(400);
    const gone = await get(`${ROUTES.projectChats}?key=acme/gone`);
    expect(gone.status).toBe(404);
    expect(gone.json.error?.code).toBe('not-found');
  });

  it('finds the project by a moved_from key', async () => {
    const r = await get(`${ROUTES.projectChats}?key=acme/old-web`);
    expect(r.status).toBe(200);
    expect(seen.projectChats[0]?.keys).toEqual(['acme/web', 'acme/old-web']);
  });

  it('an archived project, or one this person cannot save to, still lists chats with canSave false', async () => {
    const archived = await get(`${ROUTES.projectChats}?key=acme/old`);
    expect(archived.json).toEqual({ chats: state.chats, canSave: false, more: false });
    state.list = { ...state.list, canSaveChat: false };
    expect((await get(URL_OK)).json).toEqual({ chats: state.chats, canSave: false, more: false });
    state = freshState();
    state.access = 'restricted';
    expect((await get(URL_OK)).json).toEqual({ chats: state.chats, canSave: false, more: false });
    state = freshState();
    state.list = { ...state.list, canChange: false };
    expect((await get(URL_OK)).json).toMatchObject({ canSave: false });
  });

  it('unreadable updates reach the service as a rejecting entries, not an empty one', async () => {
    state.myEntries = 'fail';
    expect((await get(URL_OK)).status).toBe(200);
    expect(seen.entriesRead).toEqual(['fail']);
  });

  it('no chat service is an error, never an empty list', async () => {
    state.noService = true;
    const r = await get(URL_OK);
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.json.error?.code).toBeTruthy();
    expect(r.json.chats).toBeUndefined();
  });
});

describe('Open chat on chat entries', () => {
  it('reading updates hands the brain ownsChat once', async () => {
    await get(`${ROUTES.projectUpdates}?key=acme/web`);
    await get(`${ROUTES.projectUpdates}?key=acme/web`);
    expect(seen.holds).toHaveLength(1);
    expect(await seen.holds[0]?.(CHAT)).toBe(true);
    expect(await seen.holds[0]?.(STRANGER)).toBe(false);
  });
});
