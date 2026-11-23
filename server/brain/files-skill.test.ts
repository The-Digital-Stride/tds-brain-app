import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  FILES_CAPABILITY,
  FILES_CHANGE_MESSAGES,
  FilesChangeError,
  type FilesErrorCode,
} from '../../shared/files-contract.ts';
import {
  createFilesSkillRunner,
  FILES_ADD_CAPABILITY,
  FILES_ARTIFACT_CAPABILITY,
  FILES_SCRIPT,
  findFilesScript,
  findFilesSkill,
  hasAddCapability,
  hasArtifactCapability,
} from './files-skill.ts';
import { createBrainReaders } from './index.ts';
import { idFor } from './library.ts';
import { copyFixture } from './test-helpers.ts';

const made: string[] = [];
afterAll(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'tba-files-'));
  made.push(d);
  return d;
}

/** Stands in for the brain's script. It logs each call outside the brain and answers per command. */
const FAKE = `
const fs = require('node:fs');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => {
  const cmd = process.argv[2];
  const log = process.env.FAKE_LOG;
  if (log) fs.appendFileSync(log, JSON.stringify({ cmd, argv: process.argv.slice(2), stdin: input, root: process.env.BRAIN_ROOT }) + '\\n');
  const replies = JSON.parse(process.env.FAKE_REPLIES || '{}');
  const r = replies[cmd] || replies.default || { exit: 0, out: '{"ok":true}' };
  if (r.hang) { setInterval(() => {}, 1000); return; }
  process.stdout.write(r.out === undefined ? '{"ok":true}' : r.out);
  process.exitCode = r.exit || 0;
});
`;

const CAPS = {
  exit: 0,
  out: JSON.stringify({ ok: true, action: 'capabilities', version: '1', features: [FILES_CAPABILITY] }),
};

interface Logged {
  cmd: string;
  argv: string[];
  stdin: string;
  root: string;
}

function setup(replies: Record<string, unknown> = {}, root = tempDir()) {
  mkdirSync(join(root, '.claude', 'skills', 'tdsapp-files', 'scripts'), { recursive: true });
  writeFileSync(join(root, FILES_SCRIPT), FAKE);
  const log = join(tempDir(), 'calls.jsonl');
  const env = {
    PATH: process.env.PATH,
    FAKE_LOG: log,
    FAKE_REPLIES: JSON.stringify({ capabilities: CAPS, ...replies }),
  };
  const calls = (): Logged[] =>
    existsSync(log)
      ? readFileSync(log, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((l) => JSON.parse(l) as Logged)
      : [];
  return { root, env, calls };
}

async function codeOf(p: Promise<unknown>): Promise<{ code: string; message: string } | null> {
  try {
    await p;
    return null;
  } catch (err) {
    expect(err).toBeInstanceOf(FilesChangeError);
    const e = err as FilesChangeError;
    return { code: e.code, message: e.message };
  }
}

describe('finding the script', () => {
  it('is null when the skill is not there, and unusable when the script is missing', async () => {
    const root = tempDir();
    expect(await findFilesSkill(root)).toBeNull();
    mkdirSync(join(root, '.claude', 'skills', 'tdsapp-files'), { recursive: true });
    expect(await findFilesSkill(root)).toEqual({ skill: 'tdsapp-files', script: null });
    expect(await findFilesScript(root)).toBeNull();
    const t = setup();
    expect(await findFilesScript(t.root)).toContain('tdsapp-files.cjs');
  });
});

describe('the runner', () => {
  it('runs delete with a fixed command, no shell input from the path, and the app as the tool', async () => {
    const t = setup();
    const runner = createFilesSkillRunner(t.root, { env: t.env });
    await runner.delete({
      path: 'clients/acme/logo.png; rm -rf /',
      expect: '12-34',
      by: { slug: 'sam', name: 'Sam Lee' },
    });
    const [call] = t.calls();
    expect(call?.argv).toEqual(['delete']);
    expect(JSON.parse(call?.stdin ?? '{}')).toEqual({
      path: 'clients/acme/logo.png; rm -rf /',
      expect: '12-34',
      via: 'TDS Cortex',
      by: 'sam',
      by_name: 'Sam Lee',
    });
  });

  it('leaves out expect and by when not given', async () => {
    const t = setup();
    await createFilesSkillRunner(t.root, { env: t.env }).delete({ path: 'clients/a/b.md' });
    expect(JSON.parse(t.calls()[0]?.stdin ?? '{}')).toEqual({ path: 'clients/a/b.md', via: 'TDS Cortex' });
  });

  it.each(['bad-request', 'not-found', 'not-allowed', 'changed', 'exists'] as FilesErrorCode[])(
    'maps the script code %s to the app’s own words, never the script’s',
    async (code) => {
      const t = setup({
        delete: { exit: 2, out: JSON.stringify({ ok: false, code, error: 'SCRIPT-ONLY TEXT /Users/x' }) },
      });
      const err = await codeOf(
        createFilesSkillRunner(t.root, { env: t.env }).delete({ path: 'clients/a/b.md' }),
      );
      expect(err).toEqual({ code, message: FILES_CHANGE_MESSAGES[code] });
      expect(err?.message).not.toContain('SCRIPT-ONLY');
    },
  );

  it.each([
    ['an unknown code', { exit: 2, out: '{"ok":false,"code":"weird"}' }],
    ['exit 0 with ok false', { exit: 0, out: '{"ok":false,"code":"changed"}' }],
    ['exit 1', { exit: 1, out: '{"ok":false,"code":"not-found"}' }],
    ['not JSON', { exit: 0, out: 'hello' }],
    ['a hang', { hang: true }],
  ])('treats %s as internal', async (_name, reply) => {
    const t = setup({ delete: reply });
    const runner = createFilesSkillRunner(t.root, { env: t.env, timeoutMs: 300 });
    expect(await codeOf(runner.delete({ path: 'clients/a/b.md' }))).toEqual({
      code: 'internal',
      message: FILES_CHANGE_MESSAGES.internal,
    });
  });

  it('is internal when the script is missing', async () => {
    const runner = createFilesSkillRunner(tempDir(), { env: { PATH: process.env.PATH } });
    expect((await codeOf(runner.delete({ path: 'clients/a/b.md' })))?.code).toBe('internal');
  });

  it('is internal when the output is over the cap', async () => {
    const t = setup({ delete: { out: 'x'.repeat(5000) } });
    const runner = createFilesSkillRunner(t.root, { env: t.env, maxOutputBytes: 100 });
    expect((await codeOf(runner.delete({ path: 'clients/a/b.md' })))?.code).toBe('internal');
  });

  it('runs purge and reads how many were erased', async () => {
    const t = setup({ purge: { exit: 0, out: '{"ok":true,"action":"purge","erased":3}' } });
    const runner = createFilesSkillRunner(t.root, { env: t.env });
    expect(await runner.purge()).toBe(3);
    expect(t.calls()[0]?.argv).toEqual(['purge']);
    expect(JSON.parse(t.calls()[0]?.stdin ?? '{}')).toEqual({ via: 'TDS Cortex' });
  });

  it('runs changes one at a time', async () => {
    const t = setup();
    const runner = createFilesSkillRunner(t.root, { env: t.env });
    await Promise.all([runner.delete({ path: 'clients/a/1.md' }), runner.delete({ path: 'clients/a/2.md' })]);
    expect(t.calls().map((c) => JSON.parse(c.stdin).path)).toEqual(['clients/a/1.md', 'clients/a/2.md']);
  });

  it('reads the capabilities once, and gives none for an older script that refuses the command', async () => {
    const t = setup();
    const runner = createFilesSkillRunner(t.root, { env: t.env });
    expect(await runner.capabilities()).toEqual([FILES_CAPABILITY]);
    expect(await runner.capabilities()).toEqual([FILES_CAPABILITY]);
    expect(t.calls().filter((c) => c.cmd === 'capabilities')).toHaveLength(1);
    const old = setup({
      capabilities: { exit: 2, out: '{"ok":false,"code":"bad-request","error":"unknown command"}' },
    });
    expect(await createFilesSkillRunner(old.root, { env: old.env }).capabilities()).toEqual([]);
    const crashed = setup({ capabilities: { exit: 1, out: 'boom' } });
    expect(await createFilesSkillRunner(crashed.root, { env: crashed.env }).capabilities()).toEqual([]);
  });
});

describe('the brain’s deleteLibraryFile and purgeDeletedFiles', () => {
  const ACME = 'clients/acme-heating/';
  const LOGO = `${ACME}logo.png`;
  const me = (role: string) => async (_file: string, args: string[]) => {
    if (args.some((a) => a.endsWith('whoami.cjs')))
      return {
        stdout: JSON.stringify({
          name: 'Sam Lee',
          slug: 'sam-lee',
          email: 'sam@x.com',
          role,
          knownMember: true,
        }),
      };
    throw new Error('no git');
  };

  function brainWith(
    role: string,
    opts: { skill?: boolean; roles?: string; replies?: Record<string, unknown> } = {},
  ) {
    const root = copyFixture();
    writeFileSync(join(root, LOGO), 'png');
    const t = setup(opts.replies ?? {}, root);
    if (opts.skill !== false) {
      writeFileSync(
        join(root, '.claude', 'skills', 'tdsapp-files', 'SKILL.md'),
        `---\nname: tdsapp-files\ndescription: x\n${opts.roles ? `roles: ${opts.roles}\n` : ''}---\n# Files\n`,
      );
    }
    const brain = createBrainReaders(root, {
      run: me(role),
      filesSkill: { env: t.env },
      libraryIgnored: async () => new Set(),
    });
    return { root, brain, t };
  }

  async function idOf(brain: ReturnType<typeof brainWith>['brain'], rel: string) {
    const listing = await brain.library(
      rel.startsWith('templates') ? 'shared:templates' : 'client:acme-heating',
    );
    return listing?.items.find((i) => i.path === rel);
  }

  it('deletes a client file through the script, with the version and who did it', async () => {
    const { brain, t } = brainWith('team');
    const item = await idOf(brain, LOGO);
    expect(item?.canDelete).toBe(true);
    await brain.deleteLibraryFile?.(item?.id ?? '', { expect: item?.version });
    const del = t.calls().find((c) => c.cmd === 'delete');
    expect(JSON.parse(del?.stdin ?? '{}')).toMatchObject({
      path: LOGO,
      expect: item?.version,
      by: 'sam-lee',
      by_name: 'Sam Lee',
      via: 'TDS Cortex',
    });
  });

  it('shows no bin and refuses when the skill is missing, restricted, or reports no capability', async () => {
    for (const opts of [
      { skill: false },
      { roles: 'owner' },
      { replies: { capabilities: { exit: 0, out: '{"ok":true,"features":[]}' } } },
    ]) {
      const { brain, t } = brainWith('team', opts);
      const item = await idOf(brain, LOGO);
      expect(item).toBeDefined();
      expect(item?.canDelete).toBeFalsy();
      const err = await codeOf(brain.deleteLibraryFile?.(item?.id ?? '', {}) ?? Promise.resolve());
      expect(err?.code).toBe('not-allowed');
      expect(t.calls().find((c) => c.cmd === 'delete')).toBeUndefined();
      expect(await brain.purgeDeletedFiles?.()).toBe(0);
    }
  });

  it('refuses personal files, templates for a non-owner, protected names and unknown ids before the script', async () => {
    const { brain, t, root } = brainWith('team');
    writeFileSync(join(root, 'templates-note.md'), 'x');
    mkdirSync(join(root, 'templates'), { recursive: true });
    writeFileSync(join(root, 'templates', 'brief.md'), 'x');
    writeFileSync(join(root, 'personal', 'me.md'), 'x', { flag: 'w' });
    const personal = (await brain.library('personal'))?.items[0];
    const tpl = await idOf(brain, 'templates/brief.md');
    const profile = await idOf(brain, `${ACME}profile.md`);
    expect([personal, tpl, profile].every((i) => i !== undefined)).toBe(true);
    for (const id of [personal?.id, tpl?.id, profile?.id, 'nonsense']) {
      const err = await codeOf(brain.deleteLibraryFile?.(id ?? 'x', {}) ?? Promise.resolve());
      expect(err?.code, String(id)).toBe('not-allowed');
    }
    expect(t.calls().find((c) => c.cmd === 'delete')).toBeUndefined();
  });

  it('lets the owner delete a template', async () => {
    const { brain, t, root } = brainWith('owner');
    mkdirSync(join(root, 'templates'), { recursive: true });
    writeFileSync(join(root, 'templates', 'brief.md'), 'x');
    const tpl = await idOf(brain, 'templates/brief.md');
    expect(tpl?.canDelete).toBe(true);
    await brain.deleteLibraryFile?.(tpl?.id ?? '', {});
    expect(JSON.parse(t.calls().find((c) => c.cmd === 'delete')?.stdin ?? '{}').path).toBe(
      'templates/brief.md',
    );
  });

  it('is not-found for a file that is not there, and passes the script’s refusals on', async () => {
    const { brain } = brainWith('team', {
      replies: { delete: { exit: 2, out: '{"ok":false,"code":"changed","error":"x"}' } },
    });
    expect(
      (
        await codeOf(
          brain.deleteLibraryFile?.(idFor('client:acme-heating', `${ACME}gone.png`), {}) ?? Promise.resolve(),
        )
      )?.code,
    ).toBe('not-found');
    const item = await idOf(brain, LOGO);
    expect(
      (await codeOf(brain.deleteLibraryFile?.(item?.id ?? '', { expect: 'old' }) ?? Promise.resolve()))?.code,
    ).toBe('changed');
  });

  it('purges through the script, and never throws', async () => {
    const ok = brainWith('team', {
      replies: { purge: { exit: 0, out: '{"ok":true,"action":"purge","erased":2}' } },
    });
    expect(await ok.brain.purgeDeletedFiles?.()).toBe(2);
    const bad = brainWith('team', { replies: { purge: { exit: 1, out: 'boom' } } });
    expect(await bad.brain.purgeDeletedFiles?.()).toBe(0);
  });
});

describe('add (release 3, files-add-v1)', () => {
  it('sends source, path, the app and the display name, and resolves to the path the script replied', async () => {
    const t = setup({
      add: { exit: 0, out: JSON.stringify({ ok: true, action: 'add', path: 'personal/files/a (2).pdf' }) },
    });
    const runner = createFilesSkillRunner(t.root, { env: t.env });
    const saved = await runner.add({
      source: '/staging/x/a.pdf',
      path: 'personal/files/a.pdf',
      by: { slug: 'sam', name: 'Sam Lee' },
    });
    expect(saved).toBe('personal/files/a (2).pdf');
    const [call] = t.calls();
    expect(call?.argv).toEqual(['add']);
    expect(JSON.parse(call?.stdin ?? '{}')).toEqual({
      source: '/staging/x/a.pdf',
      path: 'personal/files/a.pdf',
      via: 'TDS Cortex',
      by_name: 'Sam Lee',
    });
  });

  it('is internal when the reply has no path, and maps refusals', async () => {
    const t = setup({ add: { exit: 0, out: '{"ok":true}' } });
    const runner = createFilesSkillRunner(t.root, { env: t.env });
    expect((await codeOf(runner.add({ source: '/s/a.pdf', path: 'personal/files/a.pdf' })))?.code).toBe(
      'internal',
    );
    const r = setup({ add: { exit: 2, out: '{"ok":false,"code":"bad-request","error":"x"}' } });
    expect(
      (
        await codeOf(
          createFilesSkillRunner(r.root, { env: r.env }).add({ source: '/s/a.pdf', path: 'p/a.pdf' }),
        )
      )?.code,
    ).toBe('bad-request');
  });

  it('reports the add feature only when the script lists it', async () => {
    const t = setup();
    expect(await hasAddCapability(createFilesSkillRunner(t.root, { env: t.env }))).toBe(false);
    const caps = {
      exit: 0,
      out: JSON.stringify({
        ok: true,
        action: 'capabilities',
        version: '2',
        features: [FILES_ADD_CAPABILITY],
      }),
    };
    const u = setup({ capabilities: caps });
    expect(await hasAddCapability(createFilesSkillRunner(u.root, { env: u.env }))).toBe(true);
  });
});

describe('add-artifact (claude artifacts in projects, files-artifact-v1)', () => {
  it('sends url, path, title and the app, and resolves to the saved path and kind', async () => {
    const t = setup({
      'add-artifact': {
        exit: 0,
        out: JSON.stringify({
          ok: true,
          action: 'add-artifact',
          path: 'personal/projects/x/files/a (2).html',
          kind: 'link',
        }),
      },
    });
    const runner = createFilesSkillRunner(t.root, { env: t.env });
    const saved = await runner.addArtifact({
      url: 'https://claude.ai/artifact/AbC123',
      path: 'personal/projects/x/files/a.html',
      title: 'A page',
      description: 'About it',
      by: { slug: 'sam', name: 'Sam Lee' },
    });
    expect(saved).toEqual({ path: 'personal/projects/x/files/a (2).html', kind: 'link' });
    const [call] = t.calls();
    expect(call?.argv).toEqual(['add-artifact']);
    expect(JSON.parse(call?.stdin ?? '{}')).toEqual({
      url: 'https://claude.ai/artifact/AbC123',
      path: 'personal/projects/x/files/a.html',
      title: 'A page',
      description: 'About it',
      via: 'TDS Cortex',
      by_name: 'Sam Lee',
    });
  });

  it('is internal for a reply without a path or kind, and maps refusals', async () => {
    const t = setup({ 'add-artifact': { exit: 0, out: '{"ok":true,"path":"p/a.html"}' } });
    const input = { url: 'https://claude.ai/artifact/a', path: 'p/a.html', title: 'T' };
    expect((await codeOf(createFilesSkillRunner(t.root, { env: t.env }).addArtifact(input)))?.code).toBe(
      'internal',
    );
    const r = setup({ 'add-artifact': { exit: 2, out: '{"ok":false,"code":"exists","error":"x"}' } });
    expect((await codeOf(createFilesSkillRunner(r.root, { env: r.env }).addArtifact(input)))?.code).toBe(
      'exists',
    );
  });

  it('reports the feature only when the script lists it', async () => {
    const t = setup();
    expect(await hasArtifactCapability(createFilesSkillRunner(t.root, { env: t.env }))).toBe(false);
    const caps = {
      exit: 0,
      out: JSON.stringify({
        ok: true,
        action: 'capabilities',
        version: '4',
        features: [FILES_ARTIFACT_CAPABILITY],
      }),
    };
    const u = setup({ capabilities: caps });
    expect(await hasArtifactCapability(createFilesSkillRunner(u.root, { env: u.env }))).toBe(true);
    expect(FILES_ARTIFACT_CAPABILITY).toBe('files-artifact-v1');
  });
});
