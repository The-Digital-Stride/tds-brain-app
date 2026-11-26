// POST ROUTES.libraryUpload and the upload flags (plan docs/plans/2026-11-26-file-types-and-uploads.md). Every
// request passes the real request gate (checkRequest) first, then handleApi, as server.ts runs them. The upload
// staging is the real one; the brain is a fake around the real upload service.
import { mkdtempSync, rmSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, describe, expect, it } from 'vitest';
import {
  type Identity,
  type LibraryListing,
  type LibraryScope,
  ROUTES,
  SESSION_COOKIE,
} from '../../shared/contract.ts';
import { FilesChangeError } from '../../shared/files-contract.ts';
import { LIBRARY_UPLOAD_MESSAGES, type LibraryUploadResponse } from '../../shared/library-upload-contract.ts';
import type { ProjectCard, ProjectList } from '../../shared/projects-contract.ts';
import { createLibraryUpload } from '../brain/library-upload.ts';
import { createUploadStaging, type UploadStaging } from '../uploads/staging.ts';
import { handleApi, parseLibraryUploadRequest, type RouteContext } from './routes.ts';
import { checkRequest, cookieValueFor } from './security.ts';

const PORT = 3877;
const TOKEN = 'library-upload-token';
const VERSION = 'c'.repeat(64);

const sam: Identity = {
  name: 'Sam Example',
  slug: 'sam-example',
  email: null,
  role: 'scout',
  knownMember: true,
};

const SCOPES: LibraryScope[] = [
  { id: 'personal', name: 'My personal files', kind: 'personal' },
  { id: 'shared:templates', name: 'Templates', kind: 'shared' },
  { id: 'client:acme-heating', name: 'Acme Heating', kind: 'client' },
];

const card = (over: Partial<ProjectCard>): ProjectCard =>
  ({
    key: 'acme-heating/web',
    space: 'client',
    slug: 'web',
    client: 'acme-heating',
    folder: 'clients/acme-heating/projects/web',
    card: 'ok',
    archived: false,
    links: [],
    version: VERSION,
    ...over,
  }) as ProjectCard;
const CARDS = [card({}), card({ key: 'acme-heating/old', slug: 'old', archived: true })];

const tempDirs: string[] = [];
const stagings: UploadStaging[] = [];
afterAll(() => {
  for (const s of stagings.splice(0)) s.close();
  for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

interface Opts {
  may?: boolean;
  caps?: string[];
  canChange?: boolean;
  projectsAccess?: string;
  addFails?: unknown;
  linkFails?: unknown;
  noService?: boolean;
}

function setup(opts: Opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'tba-lib-upload-route-'));
  tempDirs.push(dir);
  const uploads = createUploadStaging({
    dataDir: join(dir, 'data'),
    brainRoot: join(dir, 'brain'),
    sweepMs: 0,
  });
  stagings.push(uploads);
  const added: string[] = [];
  const linked: unknown[] = [];
  const published: unknown[] = [];
  const logs: string[] = [];
  const list = (): ProjectList =>
    ({ projects: CARDS, canChange: opts.canChange ?? true }) as unknown as ProjectList;
  const service = createLibraryUpload('/nonexistent', {
    files: {
      capabilities: async () => opts.caps ?? ['files-add-v1'],
      add: async (r) => {
        if (opts.addFails) throw opts.addFails;
        added.push(r.path);
        return r.path;
      },
    },
    scopes: async () => SCOPES,
    projects: async () => list(),
    link: async (action) => {
      if (opts.linkFails) throw opts.linkFails;
      linked.push(action);
      return list();
    },
    mayUseFiles: async () => opts.may ?? true,
  });
  const brain = {
    identity: async () => sam,
    skillAccess: async (_: Identity, name: string) =>
      name === 'tdsapp-projects' ? (opts.projectsAccess ?? 'allowed') : 'allowed',
    library: async (scope: string): Promise<LibraryListing | null> =>
      SCOPES.some((s) => s.id === scope) ? { scope, groups: [], items: [], truncated: false } : null,
    projects: async () => list(),
    changeProject: async () => list(),
    ...(opts.noService ? {} : { libraryUpload: service }),
  };
  const ctx = (over: Partial<RouteContext> = {}) =>
    ({
      brain,
      uploads,
      // The Tasks switch is off: library uploads never look at it (ruling 5).
      store: { get: async () => ({ directWrites: false }) },
      hub: { publish: (e: unknown) => published.push(e) },
      log: (l: string) => logs.push(l),
      ...over,
    }) as unknown as RouteContext;
  const stage = (name = 'quote.pdf') => uploads.save(Readable.from([Buffer.from('bytes')]), name, 5);
  const used = (id: string) => {
    try {
      uploads.peek([id]);
      return false;
    } catch {
      return true;
    }
  };
  return { ctx, stage, used, uploads, added, linked, published, logs };
}

/** Through the real gate first, as server.ts runs it, then the route. */
async function call(
  ctx: RouteContext,
  path: string,
  body: unknown,
  opts: { method?: string; contentType?: string } = {},
): Promise<{ gate: string; status: number; json: Record<string, unknown> | null }> {
  const method = opts.method ?? (body === undefined ? 'GET' : 'POST');
  const headers: Record<string, string | undefined> = {
    host: `127.0.0.1:${PORT}`,
    cookie: `${SESSION_COOKIE}=${cookieValueFor(TOKEN)}`,
    'sec-fetch-site': 'same-origin',
    origin: `http://127.0.0.1:${PORT}`,
    ...(method === 'GET' ? {} : { 'content-type': opts.contentType ?? 'application/json' }),
  };
  const url = new URL(`http://127.0.0.1:${PORT}${path}`);
  const gate = checkRequest({ method, path: url.pathname, headers }, { port: PORT, launchToken: TOKEN });
  if (gate.action !== 'allow')
    return { gate: gate.action, status: gate.action === 'reject' ? gate.status : 0, json: null };
  const raw = body === undefined ? [] : [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))];
  const req = Object.assign(Readable.from(raw), { method, headers });
  const sent = { status: 0, body: '' };
  const res = {
    headersSent: false,
    setHeader: () => {},
    writeHead: (status: number) => {
      sent.status = status;
    },
    end: (text: string) => {
      sent.body = text;
    },
  };
  await handleApi(req as unknown as IncomingMessage, res as unknown as ServerResponse, url, ctx);
  return { gate: 'allow', status: sent.status, json: sent.body ? JSON.parse(sent.body) : null };
}

const upload = (ctx: RouteContext, body: unknown, opts?: { method?: string; contentType?: string }) =>
  call(ctx, ROUTES.libraryUpload, body, opts);
const message = (r: { json: Record<string, unknown> | null }) =>
  (r.json as { error?: { message?: string; code?: string } } | null)?.error;

describe('parseLibraryUploadRequest: exactly the two shapes', () => {
  it('passes the two shapes through', () => {
    expect(parseLibraryUploadRequest({ upload: 'u1', scope: 'personal' })).toEqual({
      upload: 'u1',
      scope: 'personal',
    });
    expect(parseLibraryUploadRequest({ upload: 'u1', project: 'acme/web', expect: VERSION })).toEqual({
      upload: 'u1',
      project: 'acme/web',
      expect: VERSION,
    });
  });

  it.each([
    null,
    [],
    'x',
    {},
    { upload: 'u1' },
    { scope: 'personal' },
    { upload: 'u1', scope: 'personal', extra: 1 },
    { upload: 'u1', scope: 'personal', project: 'acme/web', expect: VERSION },
    { upload: 'u1', scope: 'personal', project: 'acme/web' },
    { upload: 'u1', project: 'acme/web' },
    { upload: 'u1', project: 'acme/web', expect: VERSION, extra: true },
    { upload: 'u1', project: 'Not A Key!', expect: VERSION },
    { upload: 'u1', project: 'acme/web', expect: 5 },
    { upload: 'u1', project: 'acme/web', expect: 'x'.repeat(200) },
    { upload: 7, scope: 'personal' },
    { upload: '', scope: 'personal' },
    { upload: 'u'.repeat(65), scope: 'personal' },
    { upload: 'u1', scope: 5 },
    { upload: 'u1', scope: '' },
    { upload: 'u1', scope: 's'.repeat(201) },
  ])('refuses %j', (body) => {
    expect(() => parseLibraryUploadRequest(body)).toThrow(LIBRARY_UPLOAD_MESSAGES.badRequest);
  });
});

describe('POST ROUTES.libraryUpload', () => {
  it('saves into a client library, uses the upload up and tells open pages, with the Tasks switch off', async () => {
    const s = setup();
    const info = await s.stage();
    const r = await upload(s.ctx(), { upload: info.id, scope: 'client:acme-heating' });
    expect(r.gate).toBe('allow');
    expect(r.status).toBe(200);
    expect(r.json).toEqual({
      path: 'clients/acme-heating/files/quote.pdf',
      kind: 'document',
      scope: 'client:acme-heating',
      personal: false,
    } satisfies LibraryUploadResponse);
    expect(s.added).toEqual(['clients/acme-heating/files/quote.pdf']);
    expect(s.used(info.id)).toBe(true);
    expect(s.published).toEqual([{ type: 'brain-changed', area: 'library' }]);
    expect(s.logs).toEqual(['Added a file to the library.']);
  });

  it('files an image sent from Documents in images/, by its own kind', async () => {
    const s = setup();
    const info = await s.stage('logo.png');
    const r = await upload(s.ctx(), { upload: info.id, scope: 'personal' });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ path: 'personal/images/logo.png', kind: 'image', personal: true });
  });

  it('refuses a body that is not one of the two shapes with 400, leaving the upload', async () => {
    const s = setup();
    const info = await s.stage();
    for (const body of [
      null,
      { upload: info.id },
      { upload: info.id, scope: 'personal', extra: 1 },
      { upload: info.id, scope: 'personal', project: 'acme-heating/web', expect: VERSION },
      { upload: info.id, project: 'acme-heating/web' },
    ]) {
      const r = await upload(s.ctx(), body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(message(r)).toEqual({ code: 'bad-request', message: LIBRARY_UPLOAD_MESSAGES.badRequest });
    }
    expect(s.used(info.id)).toBe(false);
    expect(s.added).toEqual([]);
  });

  it('refuses an unknown or used upload with 400', async () => {
    const s = setup();
    expect((await upload(s.ctx(), { upload: 'not-an-id', scope: 'personal' })).status).toBe(400);
    const info = await s.stage();
    expect((await upload(s.ctx(), { upload: info.id, scope: 'personal' })).status).toBe(200);
    const again = await upload(s.ctx(), { upload: info.id, scope: 'personal' });
    expect(again.status).toBe(400);
    expect(message(again)?.message).toBe(LIBRARY_UPLOAD_MESSAGES.badRequest);
    expect(s.added).toHaveLength(1);
  });

  it('refuses a type not in LIBRARY_UPLOAD_TYPES, using the upload up', async () => {
    const s = setup();
    const page = await s.stage('page.html');
    const r = await upload(s.ctx(), { upload: page.id, scope: 'personal' });
    expect(r.status).toBe(400);
    expect(message(r)?.message).toBe(LIBRARY_UPLOAD_MESSAGES.badType);
    expect(s.used(page.id)).toBe(true);
    expect(s.added).toEqual([]);
  });

  it('refuses a staged kind that is not the library kind for its extension', async () => {
    const s = setup();
    const uploads = {
      claim: () => ({
        files: [{ id: 'x', name: 'logo.png', size: 1, kind: 'document', path: '/tmp/logo.png' }],
        release() {},
      }),
    };
    const r = await upload(s.ctx({ uploads } as never), { upload: 'x', scope: 'personal' });
    expect(r.status).toBe(400);
    expect(message(r)?.message).toBe(LIBRARY_UPLOAD_MESSAGES.badType);
    expect(s.added).toEqual([]);
  });

  it.each([
    [
      'a scope that cannot take uploads',
      {},
      { scope: 'shared:templates' },
      403,
      LIBRARY_UPLOAD_MESSAGES.notAllowed,
    ],
    ['an unlisted client', {}, { scope: 'client:nobody' }, 404, LIBRARY_UPLOAD_MESSAGES.noSuchPlace],
    ['a scope shaped like a path', {}, { scope: 'client:../x' }, 404, LIBRARY_UPLOAD_MESSAGES.noSuchPlace],
    [
      'a person the skill refuses',
      { may: false },
      { scope: 'personal' },
      403,
      LIBRARY_UPLOAD_MESSAGES.notAllowed,
    ],
    ["no 'files-add-v1'", { caps: [] }, { scope: 'personal' }, 403, LIBRARY_UPLOAD_MESSAGES.notAllowed],
    [
      'no upload service',
      { noService: true },
      { scope: 'personal' },
      403,
      LIBRARY_UPLOAD_MESSAGES.notAllowed,
    ],
    [
      'a missing project',
      {},
      { project: 'acme-heating/gone', expect: VERSION },
      404,
      LIBRARY_UPLOAD_MESSAGES.noSuchProject,
    ],
    [
      'an archived project',
      {},
      { project: 'acme-heating/old', expect: VERSION },
      403,
      LIBRARY_UPLOAD_MESSAGES.projectClosed,
    ],
    [
      'a changed card',
      {},
      { project: 'acme-heating/web', expect: 'd'.repeat(64) },
      409,
      LIBRARY_UPLOAD_MESSAGES.projectChanged,
    ],
    [
      'projects locked',
      { canChange: false },
      { project: 'acme-heating/web', expect: VERSION },
      403,
      LIBRARY_UPLOAD_MESSAGES.notAllowed,
    ],
    [
      'no projects access',
      { projectsAccess: 'restricted' },
      { project: 'acme-heating/web', expect: VERSION },
      403,
      LIBRARY_UPLOAD_MESSAGES.notAllowed,
    ],
    [
      'a script refusal',
      { addFails: new FilesChangeError('not-allowed', 'script words') },
      { scope: 'personal' },
      403,
      LIBRARY_UPLOAD_MESSAGES.saveRefused,
    ],
    [
      'a script failure',
      { addFails: new Error('boom') },
      { scope: 'personal' },
      500,
      LIBRARY_UPLOAD_MESSAGES.saveFailed,
    ],
  ] as const)('refuses %s, still using the upload up', async (_, opts, target, status, words) => {
    const s = setup(opts as Opts);
    const info = await s.stage();
    const r = await upload(s.ctx(), { upload: info.id, ...target });
    expect(r.status).toBe(status);
    expect(message(r)?.message).toBe(words);
    expect(s.used(info.id)).toBe(true);
    expect(s.published).toEqual([]);
    expect(JSON.stringify(r.json)).not.toContain('script words');
  });

  it('saves and links a project upload, answering the list with its flags', async () => {
    const s = setup();
    const info = await s.stage();
    const r = await upload(s.ctx(), { upload: info.id, project: 'acme-heating/web', expect: VERSION });
    expect(r.status).toBe(200);
    const body = r.json as unknown as LibraryUploadResponse;
    expect(body).toMatchObject({
      path: 'clients/acme-heating/files/quote.pdf',
      scope: 'client:acme-heating',
      linked: true,
    });
    expect(body.list?.canUploadFiles).toBe(true);
    expect(s.linked).toEqual([
      {
        kind: 'link',
        key: 'acme-heating/web',
        path: 'clients/acme-heating/files/quote.pdf',
        expect: VERSION,
      },
    ]);
    // Once when the file is saved and again once it is linked: a list narrowed to the project reloads on the
    // first, before the link has been written, and would miss the file without the second.
    expect(s.published).toEqual([
      { type: 'brain-changed', area: 'library' },
      { type: 'brain-changed', area: 'library' },
    ]);
    expect(s.logs).toEqual(['Added a file to a project.']);
  });

  it('answers 200 with linked: false and the problem when the link fails after the save', async () => {
    const s = setup({ linkFails: new Error('changed') });
    const info = await s.stage();
    const r = await upload(s.ctx(), { upload: info.id, project: 'acme-heating/web', expect: VERSION });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({
      path: 'clients/acme-heating/files/quote.pdf',
      kind: 'document',
      scope: 'client:acme-heating',
      personal: false,
      linked: false,
      problem: LIBRARY_UPLOAD_MESSAGES.savedNotLinked("Acme Heating's Documents"),
    });
    expect(s.published).toEqual([{ type: 'brain-changed', area: 'library' }]);
  });

  it('goes through the request gate: JSON only, POST only', async () => {
    const s = setup();
    expect((await upload(s.ctx(), '{}', { contentType: 'text/plain' })).status).toBe(415);
    const get = await upload(s.ctx(), undefined, { method: 'GET' });
    expect(get.gate).toBe('allow');
    expect(get.status).toBe(405);
  });
});

describe('the upload flags', () => {
  it('sets canUpload on a personal or client listing only, when allowed', async () => {
    const s = setup();
    const client = await call(s.ctx(), ROUTES.library('client:acme-heating'), undefined);
    expect(client.status).toBe(200);
    expect(client.json?.canUpload).toBe(true);
    expect((await call(s.ctx(), ROUTES.library('personal'), undefined)).json?.canUpload).toBe(true);
    const templates = await call(s.ctx(), ROUTES.library('shared:templates'), undefined);
    expect(templates.status).toBe(200);
    expect(templates.json?.canUpload).toBeUndefined();
    const refused = setup({ may: false });
    expect(
      (await call(refused.ctx(), ROUTES.library('personal'), undefined)).json?.canUpload,
    ).toBeUndefined();
    const older = setup({ noService: true });
    expect((await call(older.ctx(), ROUTES.library('personal'), undefined)).json?.canUpload).toBeUndefined();
  });

  it('sets canUploadFiles on the project list and the change answer', async () => {
    const s = setup();
    const list = await call(s.ctx(), ROUTES.projects, undefined);
    expect(list.status).toBe(200);
    expect(list.json?.canUploadFiles).toBe(true);
    const change = await call(s.ctx(), ROUTES.projectsChange, {
      kind: 'link',
      key: 'acme-heating/web',
      path: 'clients/acme-heating/files/a.pdf',
      expect: VERSION,
    });
    expect(change.status).toBe(200);
    expect(change.json?.canUploadFiles).toBe(true);
    for (const opts of [{ canChange: false }, { caps: [] }, { noService: true }] as Opts[]) {
      const off = setup(opts);
      expect(
        (await call(off.ctx(), ROUTES.projects, undefined)).json?.canUploadFiles,
        JSON.stringify(opts),
      ).toBeUndefined();
    }
  });
});
