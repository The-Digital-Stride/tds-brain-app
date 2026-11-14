import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SessionError } from './session-manager.ts';
import { createTrashSession, projectDirName, TrashMissingError } from './trash-session.ts';

const ID = '11111111-2222-4333-8444-555555555555';

let tmp: string;
let brain: string;
let config: string;

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'trash-session-')));
  brain = join(tmp, 'brain');
  config = join(tmp, 'config');
  mkdirSync(brain);
  mkdirSync(config);
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

function projectFolder(name = projectDirName(brain)): string {
  const dir = join(config, 'projects', name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** A fake `trash` that really removes the path, so "has it gone" checks work, and records every call. */
function fakeRun(failOn?: (path: string) => Error | null) {
  const calls: Array<{ file: string; args: string[] }> = [];
  const run = async (file: string, args: string[]) => {
    calls.push({ file, args });
    const failure = failOn?.(args[0] ?? '');
    if (failure) throw failure;
    rmSync(args[0] ?? '', { recursive: true, force: true });
  };
  return { run, calls };
}

async function code(p: Promise<unknown>): Promise<SessionError> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(SessionError);
  return err as SessionError;
}

describe('projectDirName', () => {
  it('replaces every character other than letters and digits with a dash', () => {
    expect(projectDirName('/Users/ian/agency brain_1')).toBe('-Users-ian-agency-brain-1');
  });
  it('normalises to NFC first, so a decomposed letter is one dash', () => {
    expect(projectDirName('/a/café')).toBe(projectDirName('/a/café'));
    expect(projectDirName('/a/café')).toBe('-a-caf-');
  });
});

describe('createTrashSession', () => {
  it('trashes the .jsonl first, then the folder, one path per call, with no shell', async () => {
    const dir = projectFolder();
    writeFileSync(join(dir, `${ID}.jsonl`), '{}');
    mkdirSync(join(dir, ID));
    const { run, calls } = fakeRun();
    await createTrashSession({ run, configDir: config, env: {} })(ID, { dir: brain });
    expect(calls).toEqual([
      { file: '/usr/bin/trash', args: [join(dir, `${ID}.jsonl`)] },
      { file: '/usr/bin/trash', args: [join(dir, ID)] },
    ]);
  });

  it('trashes only the .jsonl when there is no folder', async () => {
    const dir = projectFolder();
    writeFileSync(join(dir, `${ID}.jsonl`), '{}');
    const { run, calls } = fakeRun();
    await createTrashSession({ run, configDir: config, env: {} })(ID, { dir: brain });
    expect(calls).toHaveLength(1);
  });

  it('finds the folder through a symlinked brain path (realpath)', async () => {
    const dir = projectFolder();
    writeFileSync(join(dir, `${ID}.jsonl`), '{}');
    const link = join(tmp, 'link');
    symlinkSync(brain, link);
    const { run, calls } = fakeRun();
    await createTrashSession({ run, configDir: config, env: {} })(ID, { dir: link });
    expect(calls).toHaveLength(1);
  });

  it('says not-found when the .jsonl is missing, and runs nothing', async () => {
    projectFolder();
    const { run, calls } = fakeRun();
    const err = await code(createTrashSession({ run, configDir: config, env: {} })(ID, { dir: brain }));
    expect(err.code).toBe('not-found');
    expect(err.message).toBe("That chat's files couldn't be found, so nothing was deleted.");
    expect(calls).toEqual([]);
  });

  it('refuses a .jsonl that is a symlink', async () => {
    const dir = projectFolder();
    writeFileSync(join(tmp, 'secret.txt'), 'x');
    symlinkSync(join(tmp, 'secret.txt'), join(dir, `${ID}.jsonl`));
    const { run, calls } = fakeRun();
    const err = await code(createTrashSession({ run, configDir: config, env: {} })(ID, { dir: brain }));
    expect(err.code).toBe('not-found');
    expect(calls).toEqual([]);
  });

  it('never trashes a folder that is a symlink, but still succeeds', async () => {
    const dir = projectFolder();
    writeFileSync(join(dir, `${ID}.jsonl`), '{}');
    mkdirSync(join(tmp, 'elsewhere'));
    symlinkSync(join(tmp, 'elsewhere'), join(dir, ID));
    const { run, calls } = fakeRun();
    await createTrashSession({ run, configDir: config, env: {} })(ID, { dir: brain });
    expect(calls.map((c) => c.args[0])).toEqual([join(dir, `${ID}.jsonl`)]);
  });

  it('refuses a project folder name over 200 characters', async () => {
    const long = join(tmp, 'x'.repeat(210));
    mkdirSync(long);
    const { run, calls } = fakeRun();
    const err = await code(createTrashSession({ run, configDir: config, env: {} })(ID, { dir: long }));
    expect(err.code).toBe('not-found');
    expect(calls).toEqual([]);
  });

  it('an other failure is internal with the plain message and no path or stderr', async () => {
    const dir = projectFolder();
    writeFileSync(join(dir, `${ID}.jsonl`), '{}');
    const { run } = fakeRun(() => Object.assign(new Error(`boom ${dir}`), { stderr: `denied ${dir}` }));
    const err = await code(createTrashSession({ run, configDir: config, env: {} })(ID, { dir: brain }));
    expect(err.code).toBe('internal');
    expect(err.message).toBe("That chat couldn't be moved to the Bin, so it hasn't been deleted. Try again.");
    expect(err.message).not.toContain(tmp);
  });

  it('a trash that exits fine but leaves the .jsonl is a failure', async () => {
    const dir = projectFolder();
    writeFileSync(join(dir, `${ID}.jsonl`), '{}');
    const err = await code(
      createTrashSession({ run: async () => {}, configDir: config, env: {} })(ID, { dir: brain }),
    );
    expect(err.code).toBe('internal');
  });

  it('a missing /usr/bin/trash throws TrashMissingError (its own error), never an erase', async () => {
    const dir = projectFolder();
    writeFileSync(join(dir, `${ID}.jsonl`), '{}');
    const { run } = fakeRun(() => Object.assign(new Error('spawn'), { code: 'ENOENT' }));
    const err = await createTrashSession({ run, configDir: config, env: {} })(ID, { dir: brain }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(TrashMissingError);
  });

  it('logs and still succeeds when only the folder fails', async () => {
    const dir = projectFolder();
    writeFileSync(join(dir, `${ID}.jsonl`), '{}');
    mkdirSync(join(dir, ID));
    const { run } = fakeRun((p) => (p.endsWith(ID) ? new Error(`no ${p}`) : null));
    const logs: string[] = [];
    await createTrashSession({ run, configDir: config, env: {}, log: (l) => logs.push(l) })(ID, {
      dir: brain,
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]).not.toContain(tmp);
  });

  describe('CLAUDE_CODE_PROJECT_DIR_NAME', () => {
    it('is honoured when CLAUDE_CONFIG_DIR is set and the name is safe', async () => {
      const dir = projectFolder('custom_name-1');
      writeFileSync(join(dir, `${ID}.jsonl`), '{}');
      const { run, calls } = fakeRun();
      await createTrashSession({
        run,
        configDir: config,
        env: { CLAUDE_CONFIG_DIR: config, CLAUDE_CODE_PROJECT_DIR_NAME: 'custom_name-1' },
      })(ID, { dir: brain });
      expect(calls).toHaveLength(1);
    });

    it('is ignored when CLAUDE_CONFIG_DIR is not set', async () => {
      const dir = projectFolder();
      writeFileSync(join(dir, `${ID}.jsonl`), '{}');
      const { run, calls } = fakeRun();
      await createTrashSession({ run, configDir: config, env: { CLAUDE_CODE_PROJECT_DIR_NAME: '../x' } })(
        ID,
        { dir: brain },
      );
      expect(calls).toHaveLength(1);
    });

    it.each(['../x', 'a/b', '', 'a'.repeat(65), 'a b'])('refuses an unsafe name (%j)', async (name) => {
      const { run, calls } = fakeRun();
      const err = await code(
        createTrashSession({
          run,
          configDir: config,
          env: { CLAUDE_CONFIG_DIR: config, CLAUDE_CODE_PROJECT_DIR_NAME: name },
        })(ID, { dir: brain }),
      );
      expect(err.code).toBe('not-found');
      expect(calls).toEqual([]);
    });
  });
});
