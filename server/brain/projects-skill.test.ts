import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { PROJECTS_CHAT_SUMMARY_CAPABILITY } from '../../shared/chat-summary-contract.ts';
import { PROJECTS_EMAIL_CAPABILITY } from '../../shared/project-email-contract.ts';
import { PROJECTS_EMAIL_THREADS_CAPABILITY } from '../../shared/project-email-threads-contract.ts';
import { PROJECTS_REFS_CAPABILITY } from '../../shared/project-refs-contract.ts';
import { PROJECTS_UPDATES_CAPABILITY } from '../../shared/project-updates-contract.ts';
import { PROJECTS_VISIBILITY_CAPABILITY } from '../../shared/project-visibility.ts';
import {
  INTERNAL_CLIENT,
  PROJECTS_ARCHIVE_CAPABILITY,
  PROJECTS_CAPABILITY,
  PROJECTS_MOVE_CAPABILITY,
  ProjectsError,
} from '../../shared/projects-contract.ts';
import {
  createProjectsSkillRunner,
  findProjectsScript,
  PROJECTS_CHANGE_MESSAGES,
  PROJECTS_MOVE_FILES_CHANGED,
  PROJECTS_SCRIPT,
} from './projects-skill.ts';

const made: string[] = [];
afterAll(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
}

/** A stand-in script: logs argv and stdin to FAKE_LOG, answers FAKE_REPLY `{ exit, out, sleepMs }`. */
const FAKE = `
const fs = require('node:fs');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => {
  const reply = JSON.parse(process.env.FAKE_REPLY || '{}');
  if (process.env.FAKE_LOG) fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ argv: process.argv.slice(2), stdin: input, root: process.env.BRAIN_ROOT }) + '\\n');
  if (reply.sleepMs) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, reply.sleepMs);
  process.stdout.write(reply.out === undefined ? '{"ok":true,"key":"acme/site","version":"${'a'.repeat(64)}"}\\n' : reply.out);
  process.exitCode = reply.exit || 0;
});
`;

function brain(script: string | null = FAKE) {
  const root = tempDir('tba-projects-skill-');
  if (script !== null) {
    mkdirSync(join(root, '.claude', 'skills', 'tdsapp-projects', 'scripts'), { recursive: true });
    writeFileSync(join(root, PROJECTS_SCRIPT), script);
  }
  const log = join(tempDir('tba-projects-log-'), 'calls.jsonl');
  const env = (reply: object = {}) => ({
    PATH: process.env.PATH,
    FAKE_LOG: log,
    FAKE_REPLY: JSON.stringify(reply),
  });
  const calls = () =>
    existsSync(log)
      ? readFileSync(log, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((l) => JSON.parse(l) as { argv: string[]; stdin: string; root: string })
      : [];
  return { root, env, calls };
}

async function errorOf(p: Promise<unknown>): Promise<{ code: string; message: string } | null> {
  try {
    await p;
    return null;
  } catch (err) {
    expect(err).toBeInstanceOf(ProjectsError);
    return { code: (err as ProjectsError).code, message: (err as ProjectsError).message };
  }
}

const EDIT = { kind: 'edit', key: 'acme/site', fields: { title: 'Site' }, expect: 'b'.repeat(64) } as const;

describe('createProjectsSkillRunner', () => {
  it('runs node on the script with the action as the command and the action as JSON on stdin', async () => {
    const b = brain();
    const runner = createProjectsSkillRunner(b.root, { env: b.env() });
    expect(await runner.run(EDIT)).toEqual({ key: 'acme/site', version: 'a'.repeat(64) });
    const [call] = b.calls();
    expect(call?.argv).toEqual(['edit']);
    expect(JSON.parse(call?.stdin ?? '')).toEqual(EDIT);
  });

  it('maps refusals to ProjectsError, showing the script reason for bad-request, exists and not-allowed', async () => {
    const cases: [object, { code: string; message: string }][] = [
      [
        {
          exit: 2,
          out: '{"ok":false,"error":"bad-request","message":"the end date can\'t be before the start date"}',
        },
        { code: 'bad-request', message: "The end date can't be before the start date." },
      ],
      [
        { exit: 2, out: '{"ok":false,"error":"exists","message":"there is already a project called site"}' },
        { code: 'exists', message: 'There is already a project called site.' },
      ],
      [
        { exit: 2, out: '{"ok":false,"error":"changed","message":"the card has changed"}' },
        { code: 'changed', message: PROJECTS_CHANGE_MESSAGES.changed },
      ],
      [
        { exit: 2, out: '{"ok":false,"error":"not-found","message":"x"}' },
        { code: 'not-found', message: PROJECTS_CHANGE_MESSAGES['not-found'] },
      ],
      [
        { exit: 2, out: '{"ok":false,"error":"not-allowed"}' },
        { code: 'not-allowed', message: PROJECTS_CHANGE_MESSAGES['not-allowed'] },
      ],
    ];
    for (const [reply, expected] of cases) {
      const b = brain();
      expect(await errorOf(createProjectsSkillRunner(b.root, { env: b.env(reply) }).run(EDIT))).toEqual(
        expected,
      );
    }
  });

  it('runs ref: the one-card form answers key and version, all answers no key, and a ref internal refusal shows its reason', async () => {
    const V = 'b'.repeat(64);
    const one = { kind: 'ref', key: 'acme/site', expect: V } as const;
    const b = brain();
    const runner = createProjectsSkillRunner(b.root, { env: b.env() });
    expect(await runner.run(one)).toEqual({ key: 'acme/site', version: 'a'.repeat(64) });
    expect(b.calls()[0]?.argv).toEqual(['ref']);
    const all = brain();
    const allReply = '{"ok":true,"action":"ref","given":[],"skipped":[]}';
    const r = await createProjectsSkillRunner(all.root, { env: all.env({ out: allReply }) }).run({
      kind: 'ref',
      all: true,
    });
    expect(r.key).toBeUndefined();
    const wrong = brain();
    expect(
      await errorOf(
        createProjectsSkillRunner(wrong.root, {
          env: wrong.env({ out: `{"ok":true,"key":"acme/other","version":"${'a'.repeat(64)}"}` }),
        }).run(one),
      ),
    ).toEqual({ code: 'internal', message: PROJECTS_CHANGE_MESSAGES.internal });
    const git = brain();
    const out =
      '{"ok":false,"error":"internal","message":"Couldn\'t check old codes just now. Try again in a moment."}';
    expect(
      // The real script exits 1 for an internal refusal (tdsapp-projects test "refuses the ref action with internal").
      await errorOf(createProjectsSkillRunner(git.root, { env: git.env({ exit: 1, out }) }).run(one)),
    ).toEqual({ code: 'internal', message: "Couldn't check old codes just now. Try again in a moment." });
    const raw = brain();
    const rawOut =
      '{"ok":false,"error":"internal","message":"EACCES: permission denied, open \'/Users/x/brain/a\'"}';
    expect(
      await errorOf(createProjectsSkillRunner(raw.root, { env: raw.env({ exit: 1, out: rawOut }) }).run(one)),
    ).toEqual({ code: 'internal', message: PROJECTS_CHANGE_MESSAGES.internal });
    const full = brain();
    const fullOut = '{"ok":false,"error":"internal","message":"Every code for Acme is used."}';
    expect(
      await errorOf(
        createProjectsSkillRunner(full.root, { env: full.env({ exit: 1, out: fullOut }) }).run(one),
      ),
    ).toEqual({ code: 'internal', message: 'Every code for Acme is used.' });
    const other = brain();
    expect(
      await errorOf(createProjectsSkillRunner(other.root, { env: other.env({ exit: 1, out }) }).run(EDIT)),
    ).toEqual({ code: 'internal', message: PROJECTS_CHANGE_MESSAGES.internal });
  });

  it('treats a crash, a bad reply, exit 1 or a reply without a version as internal', async () => {
    for (const reply of [
      { exit: 1, out: '{"ok":false,"error":"internal","message":"disk"}' },
      { exit: 2, out: 'not json' },
      { exit: 2, out: '{"ok":false,"error":"weird"}' },
      { exit: 0, out: '{"ok":true,"key":"acme/site"}' },
      { exit: 0, out: '{"ok":false}' },
    ]) {
      const b = brain();
      expect((await errorOf(createProjectsSkillRunner(b.root, { env: b.env(reply) }).run(EDIT)))?.code).toBe(
        'internal',
      );
    }
  });

  it('kills a script that runs too long', async () => {
    const b = brain();
    const runner = createProjectsSkillRunner(b.root, { env: b.env({ sleepMs: 3000 }), timeoutMs: 200 });
    expect((await errorOf(runner.run(EDIT)))?.code).toBe('internal');
  });

  it('is internal without a script, and refuses capabilities as a change', async () => {
    const none = brain(null);
    expect((await errorOf(createProjectsSkillRunner(none.root).run(EDIT)))?.code).toBe('internal');
    expect(await findProjectsScript(none.root)).toBeNull();
    const b = brain();
    expect(
      (await errorOf(createProjectsSkillRunner(b.root, { env: b.env() }).run({ kind: 'capabilities' })))
        ?.code,
    ).toBe('bad-request');
    expect(b.calls()).toEqual([]);
  });

  it('runs one change at a time, in the order asked', async () => {
    const b = brain();
    const runner = createProjectsSkillRunner(b.root, { env: b.env({ sleepMs: 50 }) });
    await Promise.all([
      runner.run(EDIT),
      runner.run({ kind: 'link', key: 'acme/site', path: 'clients/acme/a.pdf', expect: 'c'.repeat(64) }),
      runner.run({ kind: 'unlink', key: 'acme/site', path: 'clients/acme/a.pdf', expect: 'c'.repeat(64) }),
    ]);
    expect(b.calls().map((c) => c.argv[0])).toEqual(['edit', 'link', 'unlink']);
  });

  it('reads capabilities, none on a missing script or an older one that refuses the command', async () => {
    const b = brain();
    const caps = createProjectsSkillRunner(b.root, {
      env: b.env({ out: `{"ok":true,"action":"capabilities","features":["${PROJECTS_CAPABILITY}"]}` }),
    });
    expect(await caps.capabilities()).toEqual([PROJECTS_CAPABILITY]);
    const old = brain();
    const refusing = createProjectsSkillRunner(old.root, {
      env: old.env({ exit: 2, out: '{"ok":false,"error":"bad-request","message":"unknown action"}' }),
    });
    expect(await refusing.capabilities()).toEqual([]);
    expect(await createProjectsSkillRunner(brain(null).root).capabilities()).toEqual([]);
  });
});

describe('with the real script', () => {
  it('creates a card in a git brain, with who from git', async () => {
    const root = tempDir('tba-projects-real-');
    const home = tempDir('tba-projects-home-');
    const git = (args: string[]) =>
      spawnSync('git', args, {
        cwd: root,
        env: { PATH: process.env.PATH, HOME: home, GIT_CONFIG_NOSYSTEM: '1' },
      });
    git(['init', '-q']);
    git(['config', 'user.email', 'sam@example.test']);
    mkdirSync(join(root, '.team-config'));
    writeFileSync(
      join(root, '.team-config', 'roles.json'),
      JSON.stringify({ members: [{ name: 'Sam Example', email: 'sam@example.test', role: 'scout' }] }),
    );
    mkdirSync(join(root, 'clients', 'acme'), { recursive: true });
    mkdirSync(join(root, '.claude', 'skills', 'tdsapp-projects', 'scripts'), { recursive: true });
    copyFileSync(
      fileURLToPath(
        new URL('../../brain-skills/tdsapp-projects/scripts/tdsapp-projects.cjs', import.meta.url),
      ),
      join(root, PROJECTS_SCRIPT),
    );
    const runner = createProjectsSkillRunner(root, { env: { PATH: process.env.PATH, HOME: home } });
    expect(await runner.capabilities()).toEqual([
      PROJECTS_CAPABILITY,
      PROJECTS_MOVE_CAPABILITY,
      PROJECTS_ARCHIVE_CAPABILITY,
      PROJECTS_UPDATES_CAPABILITY,
      PROJECTS_REFS_CAPABILITY,
      PROJECTS_EMAIL_CAPABILITY,
      PROJECTS_CHAT_SUMMARY_CAPABILITY,
      PROJECTS_EMAIL_THREADS_CAPABILITY,
      PROJECTS_VISIBILITY_CAPABILITY,
    ]);
    const done = await runner.run({
      kind: 'create',
      space: 'client',
      client: 'acme',
      slug: 'site',
      fields: { title: 'Site' },
    });
    expect(done.key).toBe('acme/site');
    expect(readFileSync(join(root, 'clients', 'acme', 'projects', 'site', 'project.md'), 'utf8')).toContain(
      'created_by: sam-example',
    );
    const again = await errorOf(
      runner.run({
        kind: 'create',
        space: 'client',
        client: 'acme',
        slug: 'site',
        fields: { title: 'Site' },
      }),
    );
    expect(again?.code).toBe('exists');
    // Move plan: check, then move to another client.
    mkdirSync(join(root, 'clients', 'skyseal'), { recursive: true });
    const move = { kind: 'move', key: 'acme/site', client: 'skyseal', expect: done.version } as const;
    const checked = await runner.run({ ...move, check: true });
    expect(checked).toEqual({
      key: 'skyseal/site',
      version: done.version,
      check: {
        key: 'skyseal/site',
        files: ['clients/acme/projects/site/project.md'],
        fileCount: 1,
        ignoredCount: 0,
        personalLinks: [],
        filesVersion: createHash('sha256').update('project.md').digest('hex'),
      },
    });
    // A file saved into the folder after the check: the move with the check's fingerprint is refused.
    writeFileSync(join(root, 'clients', 'acme', 'projects', 'site', 'late.txt'), 'x');
    const late = await errorOf(runner.run({ ...move, filesExpect: checked.check?.filesVersion as string }));
    expect(late).toMatchObject({ code: 'changed', message: PROJECTS_MOVE_FILES_CHANGED });
    rmSync(join(root, 'clients', 'acme', 'projects', 'site', 'late.txt'));
    const moved = await runner.run({ ...move, filesExpect: checked.check?.filesVersion as string });
    expect(moved.key).toBe('skyseal/site');
    expect(moved.check).toBeUndefined();
    expect(
      readFileSync(join(root, 'clients', 'skyseal', 'projects', 'site', 'project.md'), 'utf8'),
    ).toContain('moved_from:\n  - "acme/site"\n');
    // Updates log: the new entry's path comes back as `file`, inside the project's updates folder.
    const logged = await runner.run({
      kind: 'update',
      key: 'skyseal/site',
      entry: { kind: 'note', summary: 'Kick-off booked.', clientSafe: false },
    });
    expect(logged.file).toMatch(
      /^clients\/skyseal\/projects\/site\/updates\/\d{4}-\d{2}-\d{2}-\d{4}-sam-example-[a-z0-9]{6}\.md$/,
    );
    expect(readFileSync(join(root, ...(logged.file ?? '').split('/')), 'utf8')).toContain('Kick-off booked.');
  });
});

describe('move (move plan)', () => {
  const MOVE = { kind: 'move', key: 'personal/jev', client: 'skyseal', expect: 'b'.repeat(64) } as const;
  const V = 'a'.repeat(64);
  const CHECK = {
    key: 'skyseal/jev',
    files: ['personal/projects/jev/project.md'],
    fileCount: 2,
    ignoredCount: 1,
    personalLinks: ['personal/files/a.pdf'],
    filesVersion: 'c'.repeat(64),
  };
  const reply = (extra: object) => ({
    out: JSON.stringify({ ok: true, key: 'skyseal/jev', version: V, ...extra }),
  });

  it('runs the move command and answers the new key, with the check when asked', async () => {
    const b = brain();
    const runner = createProjectsSkillRunner(b.root, { env: b.env(reply({})) });
    expect(await runner.run(MOVE)).toEqual({ key: 'skyseal/jev', version: V });
    const c = brain();
    const checking = createProjectsSkillRunner(c.root, { env: c.env(reply({ check: CHECK })) });
    expect(await checking.run({ ...MOVE, check: true })).toEqual({
      key: 'skyseal/jev',
      version: V,
      check: CHECK,
    });
    const [call] = c.calls();
    expect(call?.argv).toEqual(['move']);
    expect(JSON.parse(call?.stdin ?? '')).toEqual({ ...MOVE, check: true });
    const d = brain();
    const fenced = createProjectsSkillRunner(d.root, { env: d.env(reply({})) });
    await fenced.run({ ...MOVE, filesExpect: CHECK.filesVersion });
    expect(JSON.parse(d.calls()[0]?.stdin ?? '')).toEqual({ ...MOVE, filesExpect: CHECK.filesVersion });
  });

  it("says the folder's files changed since the check, and keeps the card message for any other change", async () => {
    const files = brain();
    const runner = createProjectsSkillRunner(files.root, {
      env: files.env({
        exit: 2,
        out: JSON.stringify({
          ok: false,
          error: 'changed',
          message: 'the files in this project changed since you checked: check again',
        }),
      }),
    });
    expect(await errorOf(runner.run({ ...MOVE, filesExpect: CHECK.filesVersion }))).toMatchObject({
      code: 'changed',
      message: PROJECTS_MOVE_FILES_CHANGED,
    });
    const card = brain();
    const other = createProjectsSkillRunner(card.root, {
      env: card.env({ exit: 2, out: '{"ok":false,"error":"changed","message":"the card has changed"}' }),
    });
    expect(await errorOf(other.run(MOVE))).toMatchObject({
      code: 'changed',
      message: PROJECTS_CHANGE_MESSAGES.changed,
    });
  });

  it('is internal when the new key is not <client>/<slug> or the check is not the contract shape', async () => {
    for (const [action, extra] of [
      [MOVE, { key: 'acme/jev' }],
      [MOVE, { key: 'skyseal/other' }],
      [{ ...MOVE, check: true }, {}],
      [{ ...MOVE, check: true }, { check: { ...CHECK, key: 'acme/jev' } }],
      [{ ...MOVE, check: true }, { check: { ...CHECK, fileCount: -1 } }],
      [{ ...MOVE, check: true }, { check: { ...CHECK, fileCount: 0 } }],
      [{ ...MOVE, check: true }, { check: { ...CHECK, ignoredCount: 3 } }],
      [
        { ...MOVE, check: true },
        { check: { ...CHECK, files: Array.from({ length: 51 }, (_, i) => `f${i}`) } },
      ],
      [{ ...MOVE, check: true }, { check: { ...CHECK, personalLinks: [7] } }],
      [{ ...MOVE, check: true }, { check: { ...CHECK, filesVersion: undefined } }],
      [{ ...MOVE, check: true }, { check: { ...CHECK, filesVersion: 'C'.repeat(64) } }],
      [{ ...MOVE, check: true }, { check: { ...CHECK, filesVersion: 'c'.repeat(63) } }],
    ] as const) {
      const b = brain();
      const runner = createProjectsSkillRunner(b.root, { env: b.env(reply(extra)) });
      expect((await errorOf(runner.run(action)))?.code, JSON.stringify(extra).slice(0, 60)).toBe('internal');
    }
  });
});

describe('archive, unarchive and delete (archive plan)', () => {
  const KEY = 'acme/site';
  const CHECK = {
    key: KEY,
    from: 'clients/acme/projects/site',
    to: 'clients/acme/projects-archive/site',
    files: ['clients/acme/projects/site/project.md'],
    fileCount: 2,
    images: 0,
    documents: 1,
    other: 1,
    bytes: 120,
    ignoredCount: 1,
    localOnlyCount: 1,
    references: ['todo/a.md'],
    referenceCount: 1,
    filesVersion: 'c'.repeat(64),
    empty: false,
    allowed: false,
    allowedWho: "Ian Hancock (the Account Owner) or the brain's Owner",
  };
  const reply = (extra: object) => ({ out: JSON.stringify({ ok: true, key: KEY, version: '', ...extra }) });

  it('runs each as its own command and answers the key; a check answers the contract shape', async () => {
    for (const kind of ['archive', 'unarchive', 'delete'] as const) {
      const b = brain();
      const runner = createProjectsSkillRunner(b.root, { env: b.env(reply({})) });
      expect(await runner.run({ kind, key: KEY, filesExpect: 'd'.repeat(64) })).toEqual({
        key: KEY,
        version: '',
      });
      expect(b.calls()[0]?.argv).toEqual([kind]);
      const c = brain();
      const checking = createProjectsSkillRunner(c.root, { env: c.env(reply({ check: CHECK })) });
      const r = await checking.run({ kind, key: KEY, check: true });
      expect(r.removeCheck).toEqual({
        ...CHECK,
        allowedWho: "Ian Hancock (the Account Owner) or the brain's Owner.",
      });
      expect(JSON.parse(c.calls()[0]?.stdin ?? '')).toEqual({ kind, key: KEY, check: true });
    }
  });

  it('is internal when the key is not the project, or the check is not the contract shape', async () => {
    for (const [check, extra] of [
      [false, { key: 'acme/other' }],
      [true, {}],
      [true, { check: { ...CHECK, key: 'acme/other' } }],
      [true, { check: { ...CHECK, allowed: 'yes' } }],
      [true, { check: { ...CHECK, to: 5 } }],
      [true, { check: { ...CHECK, localOnlyCount: 3 } }],
      [true, { check: { ...CHECK, referenceCount: 0 } }],
      [
        true,
        {
          check: { ...CHECK, references: Array.from({ length: 21 }, (_, i) => `f${i}`), referenceCount: 21 },
        },
      ],
      [true, { check: { ...CHECK, filesVersion: 'x' } }],
      [true, { check: { ...CHECK, empty: undefined } }],
    ] as const) {
      const b = brain();
      const runner = createProjectsSkillRunner(b.root, { env: b.env(reply(extra)) });
      const action = check
        ? ({ kind: 'delete', key: KEY, check: true } as const)
        : ({ kind: 'delete', key: KEY } as const);
      expect((await errorOf(runner.run(action)))?.code, JSON.stringify(extra).slice(0, 60)).toBe('internal');
    }
  });

  it('passes on a delete that left its hidden folder behind, and nothing else like it', async () => {
    const LEFT = 'clients/acme/projects-archive/.tdsapp-projects-site-0123456789ab.deleting~';
    const b = brain();
    const runner = createProjectsSkillRunner(b.root, { env: b.env(reply({ leftBehind: LEFT })) });
    expect(await runner.run({ kind: 'delete', key: KEY, filesExpect: 'd'.repeat(64) })).toEqual({
      key: KEY,
      version: '',
      leftBehind: LEFT,
    });
    // Its own live folder's parent, and the legacy ones for a The Digital Stride key.
    for (const [key, left] of [
      [KEY, 'clients/acme/projects/.tdsapp-projects-site-0123456789ab.deleting~'],
      [`${INTERNAL_CLIENT}/site`, 'projects-archive/.tdsapp-projects-site-0123456789ab.deleting~'],
      [
        `${INTERNAL_CLIENT}/site`,
        `clients/${INTERNAL_CLIENT}/projects/.tdsapp-projects-site-0123456789ab.deleting~`,
      ],
      ['personal/site', 'personal/projects-archive/.tdsapp-projects-site-0123456789ab.deleting~'],
    ] as const) {
      const c = brain();
      const r = createProjectsSkillRunner(c.root, { env: c.env(reply({ key, leftBehind: left })) });
      expect(await r.run({ kind: 'delete', key, filesExpect: 'd'.repeat(64) }), left).toEqual({
        key,
        version: '',
        leftBehind: left,
      });
    }
    for (const [kind, left] of [
      ['archive', LEFT],
      ['delete', 'clients/acme/projects-archive/site'],
      ['delete', 'clients/acme/projects-archive/.tdsapp-projects-other-0123456789ab.deleting~'],
      ['delete', '../outside/.tdsapp-projects-site-0123456789ab.deleting~'],
      // The right slug in another client's, someone's personal or the legacy folders: never its own.
      ['delete', 'clients/skyseal/projects-archive/.tdsapp-projects-site-0123456789ab.deleting~'],
      ['delete', 'personal/projects/.tdsapp-projects-site-0123456789ab.deleting~'],
      ['delete', 'projects-archive/.tdsapp-projects-site-0123456789ab.deleting~'],
      ['delete', 5],
    ] as const) {
      const c = brain();
      const r = createProjectsSkillRunner(c.root, { env: c.env(reply({ leftBehind: left })) });
      expect(
        (await errorOf(r.run({ kind, key: KEY, filesExpect: 'd'.repeat(64) })))?.code,
        String(left),
      ).toBe('internal');
    }
  });

  it("shows the script's refusal reason and says when the files changed", async () => {
    const refused = brain();
    const runner = createProjectsSkillRunner(refused.root, {
      env: refused.env({
        exit: 2,
        out: '{"ok":false,"error":"not-allowed","message":"only the owner can delete this project"}',
      }),
    });
    expect(await errorOf(runner.run({ kind: 'delete', key: KEY }))).toEqual({
      code: 'not-allowed',
      message: 'Only the owner can delete this project.',
    });
    const files = brain();
    const changed = createProjectsSkillRunner(files.root, {
      env: files.env({
        exit: 2,
        out: '{"ok":false,"error":"changed","message":"the files in this project changed since you checked"}',
      }),
    });
    expect(
      await errorOf(changed.run({ kind: 'archive', key: KEY, filesExpect: 'c'.repeat(64) })),
    ).toMatchObject({
      code: 'changed',
      message: PROJECTS_MOVE_FILES_CHANGED,
    });
  });
});
