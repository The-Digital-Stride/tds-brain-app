import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SKILL_LEVELS_FILE } from '../../shared/levels-contract.ts';
import {
  createSkillLevels,
  parseSkillLevels,
  readSkillLevels,
  SKILL_LEVELS_SCRIPT,
  SkillLevelError,
} from './skill-levels.ts';

const SCRIPT_SRC = join(
  import.meta.dirname,
  '..',
  '..',
  'brain-skills',
  'tdsapp-skill-levels',
  'scripts',
  'tdsapp-skill-levels.cjs',
);

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'skill-levels-reader-'));
  mkdirSync(join(root, '.claude'), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const row = (tier: unknown) => ({ tier, setBy: 'sam-example', at: '2026-11-14T10:00:00.000Z' });
const put = (v: unknown) =>
  writeFileSync(join(root, SKILL_LEVELS_FILE), typeof v === 'string' ? v : JSON.stringify(v));

describe('readSkillLevels', () => {
  it('reads valid rows, skips junk rows and unknown tiers', async () => {
    put({
      version: 1,
      levels: {
        a: { ...row('deep'), note: 'Careful' },
        b: row('quick'),
        c: row('ultra'),
        d: 5,
        e: { tier: 'deep' },
        f: [],
        g: { ...row('standard'), note: 12 },
      },
    });
    const levels = await readSkillLevels(root);
    expect(Object.keys(levels).sort()).toEqual(['a', 'b', 'g']);
    expect(levels.a).toEqual({ ...row('deep'), note: 'Careful' });
    expect(levels.g).toEqual(row('standard'));
  });

  it('gives {} for a missing file, junk, the wrong shape or a link', async () => {
    expect(await readSkillLevels(root)).toEqual({});
    put('{ nope');
    expect(await readSkillLevels(root)).toEqual({});
    put({ version: 1, levels: [1, 2] });
    expect(await readSkillLevels(root)).toEqual({});
    put('null');
    expect(await readSkillLevels(root)).toEqual({});
    rmSync(join(root, SKILL_LEVELS_FILE));
    writeFileSync(join(root, 'real.json'), JSON.stringify({ version: 1, levels: { a: row('deep') } }));
    symlinkSync(join(root, 'real.json'), join(root, SKILL_LEVELS_FILE));
    expect(await readSkillLevels(root)).toEqual({});
  });

  it('reads fresh every time', async () => {
    const svc = createSkillLevels(root);
    expect(await svc.read()).toEqual({});
    put({ version: 1, levels: { a: row('deep') } });
    expect(Object.keys(await svc.read())).toEqual(['a']);
  });

  it('is safe with a skill called __proto__', () => {
    const levels = parseSkillLevels(
      '{"version":1,"levels":{"__proto__":{"tier":"deep","setBy":"x","at":"y"}}}',
    );
    expect(Object.getPrototypeOf(levels)).toBe(Object.prototype);
    expect(Object.keys(levels)).toEqual(['__proto__']);
  });
});

describe('writable and change', () => {
  function installScript(): void {
    const dir = join(root, '.claude', 'skills', 'tdsapp-skill-levels', 'scripts');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(root, SKILL_LEVELS_SCRIPT),
      spawnSync('cat', [SCRIPT_SRC], { encoding: 'utf8' }).stdout,
    );
    mkdirSync(join(root, '.claude', 'commands'), { recursive: true });
    writeFileSync(join(root, '.claude', 'commands', 'gm.md'), 'Hello.\n');
    mkdirSync(join(root, '.team-config'), { recursive: true });
    writeFileSync(
      join(root, '.team-config', 'roles.json'),
      JSON.stringify({ members: [{ name: 'Sam Example', email: 'sam@example.test', role: 'scout' }] }),
    );
  }
  const env = {
    PATH: process.env.PATH,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'user.email',
    GIT_CONFIG_VALUE_0: 'sam@example.test',
  };

  it('is not writable until the skill is in the brain', async () => {
    expect(await createSkillLevels(root).writable()).toBe(false);
    await expect(createSkillLevels(root).change('gm', 'deep')).rejects.toBeInstanceOf(SkillLevelError);
    installScript();
    expect(await createSkillLevels(root).writable()).toBe(true);
  });

  it('is not writable when the script is a link out of the brain', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'outside-'));
    try {
      writeFileSync(join(outside, 's.cjs'), '');
      mkdirSync(join(root, '.claude', 'skills', 'tdsapp-skill-levels', 'scripts'), { recursive: true });
      symlinkSync(join(outside, 's.cjs'), join(root, SKILL_LEVELS_SCRIPT));
      expect(await createSkillLevels(root).writable()).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('runs the script to set and clear, and the reader sees the result', async () => {
    installScript();
    const svc = createSkillLevels(root, { env });
    await svc.change('gm', 'deep', 'Careful');
    expect((await svc.read()).gm).toMatchObject({ tier: 'deep', setBy: 'sam-example', note: 'Careful' });
    await svc.change('gm', null);
    expect(await svc.read()).toEqual({});
  });

  it('maps the script refusals to codes', async () => {
    installScript();
    const svc = createSkillLevels(root, { env });
    await expect(svc.change('no-such-skill', 'deep')).rejects.toMatchObject({ code: 'bad-request' });
    const stranger = createSkillLevels(root, { env: { ...env, GIT_CONFIG_VALUE_0: 'x@example.test' } });
    await expect(stranger.change('gm', 'deep')).rejects.toMatchObject({ code: 'not-allowed' });
  });

  it('never writes the file itself and fails as internal when the script cannot run', async () => {
    installScript();
    chmodSync(join(root, SKILL_LEVELS_SCRIPT), 0o644);
    const svc = createSkillLevels(root, {
      spawn: () => {
        throw new Error('no process');
      },
    });
    await expect(svc.change('gm', 'deep')).rejects.toMatchObject({ code: 'internal' });
    expect(await svc.read()).toEqual({});
  });
});
