import { spawnSync } from 'node:child_process';
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
import { PROJECTS_CAPABILITY, ProjectsError } from '../../shared/projects-contract.ts';
import {
  createProjectsSkillRunner,
  findProjectsScript,
  PROJECTS_CHANGE_MESSAGES,
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
    expect(await runner.capabilities()).toEqual([PROJECTS_CAPABILITY]);
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
  });
});
