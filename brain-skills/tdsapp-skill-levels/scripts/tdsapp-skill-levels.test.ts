// Tests for the brain's `tdsapp-skill-levels` skill script. Each case runs the real script as a
// child process against a throwaway brain. This test stays in the app repo; it is not copied into the brain.
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SKILL_LEVELS_FILE, type SkillLevelsFile } from '../../../shared/levels-contract.ts';

const SCRIPT = fileURLToPath(new URL('./tdsapp-skill-levels.cjs', import.meta.url));

const ROLES = {
  members: [
    { name: 'Sam Example', email: 'sam@example.test', role: 'scout' },
    { name: 'Ian Owner', email: 'ian@example.test', role: 'owner' },
    { name: 'Ben McAdam', email: 'ben@example.test', role: 'team' },
  ],
};

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'skill-levels-'));
  mkdirSync(join(root, '.team-config'));
  writeFileSync(join(root, '.team-config', 'roles.json'), JSON.stringify(ROLES));
  mkdirSync(join(root, '.claude', 'skills', 'google-ads-audit'), { recursive: true });
  writeFileSync(join(root, '.claude', 'skills', 'google-ads-audit', 'SKILL.md'), '---\nname: x\n---\n');
  mkdirSync(join(root, '.claude', 'skills', 'meeting-notes'), { recursive: true });
  writeFileSync(join(root, '.claude', 'skills', 'meeting-notes', 'SKILL.md'), '---\nname: x\n---\n');
  mkdirSync(join(root, '.claude', 'commands'), { recursive: true });
  writeFileSync(join(root, '.claude', 'commands', 'gm.md'), 'Good morning.\n');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function gitEnv(who: { email?: string | null; name?: string | null }): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: root,
    BRAIN_ROOT: root,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
  };
  const pairs: [string, string][] = [];
  if (who.name) pairs.push(['user.name', who.name]);
  if (who.email) pairs.push(['user.email', who.email]);
  env.GIT_CONFIG_COUNT = String(pairs.length);
  pairs.forEach(([k, v], i) => {
    env[`GIT_CONFIG_KEY_${i}`] = k;
    env[`GIT_CONFIG_VALUE_${i}`] = v;
  });
  return env;
}

const SAM = { name: 'Sam Example', email: 'sam@example.test' };
const IAN = { name: 'Ian Owner', email: 'ian@example.test' };
const BEN = { name: 'Ben McAdam', email: 'ben@example.test' };

function run(
  command: string,
  input: unknown = {},
  opts: { who?: { email?: string | null; name?: string | null }; env?: NodeJS.ProcessEnv } = {},
) {
  const r = spawnSync(process.execPath, [SCRIPT, command], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    env: { ...gitEnv(opts.who ?? SAM), ...opts.env },
    cwd: root,
    encoding: 'utf8',
  });
  const lines = r.stdout.split('\n').filter(Boolean);
  expect(lines, r.stderr).toHaveLength(1);
  return { code: r.status, json: JSON.parse(lines[0] as string) as Record<string, unknown> };
}

const file = () => join(root, SKILL_LEVELS_FILE);
const text = () => readFileSync(file(), 'utf8');
const data = () => JSON.parse(text()) as SkillLevelsFile;
const temps = () => readdirSync(join(root, '.claude')).filter((f) => f.endsWith('.tmp~'));

describe('capabilities', () => {
  it('lists what the script can do', () => {
    const r = run('capabilities');
    expect(r.code).toBe(0);
    expect(r.json).toEqual({ version: '0.1', features: ['set', 'clear', 'import'] });
  });

  it('refuses an unknown command and bad JSON', () => {
    expect(run('nope')).toMatchObject({ code: 2, json: { status: 400 } });
    expect(run('set', 'not json')).toMatchObject({ code: 2, json: { status: 400 } });
    expect(run('set', '[1]')).toMatchObject({ code: 2, json: { status: 400 } });
  });
});

describe('set', () => {
  it('writes the level, recording the person and the time', () => {
    const r = run('set', { skill: 'google-ads-audit', tier: 'deep', note: 'Needs  careful\njudgement' });
    expect(r).toMatchObject({
      code: 0,
      json: { ok: true, skill: 'google-ads-audit', tier: 'deep', setBy: 'sam-example' },
    });
    const row = data().levels['google-ads-audit'];
    expect(row).toMatchObject({ tier: 'deep', setBy: 'sam-example', note: 'Needs careful judgement' });
    expect(Number.isNaN(Date.parse(row?.at ?? ''))).toBe(false);
    expect(data().version).toBe(1);
  });

  it('accepts a command as well as a skill', () => {
    expect(run('set', { skill: 'gm', tier: 'quick' }).code).toBe(0);
    expect(data().levels.gm?.tier).toBe('quick');
  });

  it('takes the role and name from the brain identity, never from the input', () => {
    const r = run(
      'set',
      { skill: 'gm', tier: 'quick', role: 'owner', by: 'ian-owner', setBy: 'ian-owner' },
      { who: BEN },
    );
    expect(r).toMatchObject({ code: 2, json: { status: 403 } });
    expect(existsSync(file())).toBe(false);
    run('set', { skill: 'gm', tier: 'quick', by: 'ian-owner', setBy: 'ian-owner' }, { who: SAM });
    expect(data().levels.gm?.setBy).toBe('sam-example');
  });

  it('lets the owner set one, and refuses someone who is not on the team or has no identity', () => {
    expect(run('set', { skill: 'gm', tier: 'deep' }, { who: IAN }).code).toBe(0);
    expect(data().levels.gm?.setBy).toBe('ian-owner');
    expect(
      run('set', { skill: 'gm', tier: 'deep' }, { who: { name: 'Sam Example', email: 'other@example.test' } })
        .json.status,
    ).toBe(403);
    expect(run('set', { skill: 'gm', tier: 'deep' }, { who: { name: null, email: null } }).json.status).toBe(
      403,
    );
  });

  it('falls back to the git name when there is no email', () => {
    expect(run('set', { skill: 'gm', tier: 'deep' }, { who: { name: 'Sam Example' } }).code).toBe(0);
  });

  it('refuses an unknown skill, a bad name and a bad tier', () => {
    expect(run('set', { skill: 'no-such-skill', tier: 'deep' }).json.status).toBe(400);
    expect(run('set', { skill: '../etc/passwd', tier: 'deep' }).json.status).toBe(400);
    expect(run('set', { skill: '.hidden', tier: 'deep' }).json.status).toBe(400);
    expect(run('set', { skill: 'gm', tier: 'turbo' }).json.status).toBe(400);
    expect(run('set', { skill: 'gm', tier: null }).json.status).toBe(400);
    expect(run('set', { skill: 'gm', tier: 'deep', note: 'x'.repeat(161) }).json.status).toBe(400);
    expect(run('set', { skill: 'gm', tier: 'deep', note: 7 }).json.status).toBe(400);
    expect(existsSync(file())).toBe(false);
  });

  it('refuses a skill folder with no SKILL.md', () => {
    mkdirSync(join(root, '.claude', 'skills', 'empty'));
    expect(run('set', { skill: 'empty', tier: 'deep' }).json.status).toBe(400);
  });
});

describe('writing', () => {
  it('writes sorted keys, one entry per line, and ends with a newline', () => {
    run('set', { skill: 'meeting-notes', tier: 'standard' });
    run('set', { skill: 'google-ads-audit', tier: 'deep', note: 'Careful' });
    const lines = text().split('\n');
    expect(lines[0]).toBe('{');
    expect(lines[1]).toBe('  "version": 1,');
    expect(lines[2]).toBe('  "levels": {');
    expect(lines[3]).toMatch(
      /^ {4}"google-ads-audit": \{"tier":"deep","setBy":"sam-example","at":"[^"]+","note":"Careful"\},$/,
    );
    expect(lines[4]).toMatch(
      /^ {4}"meeting-notes": \{"tier":"standard","setBy":"sam-example","at":"[^"]+"\}$/,
    );
    expect(lines.slice(5)).toEqual(['  }', '}', '']);
    expect(Object.keys(data().levels)).toEqual(['google-ads-audit', 'meeting-notes']);
  });

  it('leaves no temporary file behind on success', () => {
    run('set', { skill: 'gm', tier: 'quick' });
    expect(temps()).toEqual([]);
  });

  it('removes the temporary file and keeps the old file when the swap fails', () => {
    run('set', { skill: 'gm', tier: 'quick' });
    const before = text();
    const r = run(
      'set',
      { skill: 'meeting-notes', tier: 'deep' },
      { env: { NODE_ENV: 'test', TDSAPP_SKILL_LEVELS_TEST_FAIL: 'rename' } },
    );
    expect(r).toMatchObject({ code: 2, json: { status: 500 } });
    expect(temps()).toEqual([]);
    expect(text()).toBe(before);
  });

  it('removes the temporary file when the write fails', () => {
    const r = run(
      'set',
      { skill: 'gm', tier: 'deep' },
      { env: { NODE_ENV: 'test', TDSAPP_SKILL_LEVELS_TEST_FAIL: 'write' } },
    );
    expect(r.json.status).toBe(500);
    expect(temps()).toEqual([]);
  });

  it('creates .claude when it is missing', () => {
    rmSync(join(root, '.claude', 'skills'), { recursive: true });
    rmSync(join(root, '.claude', 'commands'), { recursive: true });
    // no skills at all now, so only clear (which needs no skill) can run
    expect(run('clear', { skill: 'gm' }).code).toBe(0);
  });

  it('refuses to overwrite a file that is not valid, and keeps rows it does not understand', () => {
    writeFileSync(file(), '{ not json');
    expect(run('set', { skill: 'gm', tier: 'deep' }).json.status).toBe(500);
    expect(readFileSync(file(), 'utf8')).toBe('{ not json');
    writeFileSync(
      file(),
      JSON.stringify({
        version: 1,
        levels: { 'future-skill': { tier: 'ultra', setBy: 'x', at: 'y' }, 'z-junk': 5 },
      }),
    );
    expect(run('set', { skill: 'gm', tier: 'deep' }).code).toBe(0);
    expect(data().levels['future-skill']).toEqual({ tier: 'ultra', setBy: 'x', at: 'y' });
    expect(data().levels['z-junk']).toBe(5);
    expect(data().levels.gm?.tier).toBe('deep');
  });

  it('refuses a file that is a link', () => {
    writeFileSync(join(root, 'elsewhere.json'), '{"version":1,"levels":{}}');
    symlinkSync(join(root, 'elsewhere.json'), file());
    expect(run('set', { skill: 'gm', tier: 'deep' }).json.status).toBe(500);
    expect(readFileSync(join(root, 'elsewhere.json'), 'utf8')).toBe('{"version":1,"levels":{}}');
  });
});

describe('clear', () => {
  it('removes a level, and says when there was none', () => {
    run('set', { skill: 'gm', tier: 'deep' });
    run('set', { skill: 'meeting-notes', tier: 'quick' });
    expect(run('clear', { skill: 'gm' })).toMatchObject({ code: 0, json: { ok: true, changed: true } });
    expect(Object.keys(data().levels)).toEqual(['meeting-notes']);
    expect(run('clear', { skill: 'gm' })).toMatchObject({ code: 0, json: { changed: false } });
  });

  it('clears the last one to an empty levels object', () => {
    run('set', { skill: 'gm', tier: 'deep' });
    run('clear', { skill: 'gm' });
    expect(data()).toEqual({ version: 1, levels: {} });
  });

  it('clears the level of a skill that has since been deleted', () => {
    run('set', { skill: 'gm', tier: 'deep' });
    rmSync(join(root, '.claude', 'commands', 'gm.md'));
    expect(run('clear', { skill: 'gm' }).code).toBe(0);
    expect(data().levels).toEqual({});
  });

  it('is for the owner and scouts only, and needs a valid name', () => {
    expect(run('clear', { skill: 'gm' }, { who: BEN }).json.status).toBe(403);
    expect(run('clear', { skill: 'a b' }).json.status).toBe(400);
    expect(run('clear', {}).json.status).toBe(400);
  });
});

describe('import', () => {
  it('adds a batch as prefill', () => {
    const r = run('import', {
      levels: { gm: { tier: 'quick', note: 'Short' }, 'google-ads-audit': { tier: 'deep' } },
      setBy: 'ian-owner',
    });
    expect(r).toMatchObject({ code: 0, json: { ok: true, imported: 2, skipped: [] } });
    expect(data().levels.gm).toMatchObject({ tier: 'quick', setBy: 'prefill', note: 'Short' });
    expect(data().levels['google-ads-audit']?.setBy).toBe('prefill');
  });

  it('is all or nothing', () => {
    expect(
      run('import', { levels: { gm: { tier: 'quick' }, 'no-such': { tier: 'deep' } } }).json.status,
    ).toBe(400);
    expect(
      run('import', { levels: { gm: { tier: 'quick' }, 'meeting-notes': { tier: 'huge' } } }).json.status,
    ).toBe(400);
    expect(run('import', { levels: {} }).json.status).toBe(400);
    expect(run('import', {}).json.status).toBe(400);
    expect(existsSync(file())).toBe(false);
  });

  it('never replaces a level a person set, but refreshes an earlier prefill', () => {
    run('set', { skill: 'gm', tier: 'deep' });
    run('import', { levels: { 'meeting-notes': { tier: 'quick' } } });
    const r = run('import', {
      levels: {
        gm: { tier: 'quick' },
        'meeting-notes': { tier: 'standard' },
        'google-ads-audit': { tier: 'deep' },
      },
    });
    expect(r.json).toMatchObject({ imported: 2, skipped: ['gm'] });
    expect(data().levels.gm).toMatchObject({ tier: 'deep', setBy: 'sam-example' });
    expect(data().levels['meeting-notes']?.tier).toBe('standard');
  });

  it('is for the owner and scouts only', () => {
    expect(run('import', { levels: { gm: { tier: 'quick' } } }, { who: BEN }).json.status).toBe(403);
    expect(existsSync(file())).toBe(false);
  });
});
