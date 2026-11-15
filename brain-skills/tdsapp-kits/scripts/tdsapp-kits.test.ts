// Tests for the brain's `tdsapp-kits` skill scripts. Each case runs the real script as a child process
// against a throwaway brain. This test stays in the app repo; it is not copied into the brain.
import { spawnSync } from 'node:child_process';
import {
  createDecipheriv,
  createPrivateKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
} from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  APP_USAGE_CAPABILITY,
  APP_USAGE_SCRIPT,
  BUILT_IN_KITS,
  KIT_IDS,
  KITS_FILE,
} from '../../../shared/kits-contract.ts';

const KITS = fileURLToPath(new URL('./tdsapp-kits.cjs', import.meta.url));
const USAGE = fileURLToPath(new URL('./tdsapp-usage.cjs', import.meta.url));

const ROLES = {
  members: [
    { name: 'Sam Example', email: 'sam@example.test', role: 'scout' },
    { name: 'Ben McAdam', email: 'ben@example.test', role: 'team' },
  ],
};
const SAM = { name: 'Sam Example', email: 'sam@example.test' };
const BEN = { name: 'Ben McAdam', email: 'ben@example.test' };

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'kits-'));
  mkdirSync(join(root, '.team-config'));
  writeFileSync(join(root, '.team-config', 'roles.json'), JSON.stringify(ROLES));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function env(who: { name: string; email: string }, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: root,
    BRAIN_ROOT: root,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: 'user.name',
    GIT_CONFIG_VALUE_0: who.name,
    GIT_CONFIG_KEY_1: 'user.email',
    GIT_CONFIG_VALUE_1: who.email,
    ...extra,
  };
}

function kits(args: string[], who = SAM) {
  const r = spawnSync(process.execPath, [KITS, ...args], { env: env(who), cwd: root, encoding: 'utf8' });
  return { code: r.status, out: r.stdout.trim() };
}
function kitsJson(args: string[], who = SAM) {
  const r = kits([...args, '--json'], who);
  return { code: r.code, json: JSON.parse(r.out) as Record<string, any> };
}
/** A copy of the script with the shipped switch turned on, in the test's own temporary folder. */
function syncedCopy(): string {
  const src = readFileSync(USAGE, 'utf8');
  if (!src.includes('const SYNC_APP_EVENTS = false;')) throw new Error('switch line not found');
  const path = join(root, 'tdsapp-usage-sync-on.cjs');
  writeFileSync(path, src.replace('const SYNC_APP_EVENTS = false;', 'const SYNC_APP_EVENTS = true;'));
  return path;
}

function usage(command: string, input: unknown, extra: NodeJS.ProcessEnv = {}, who = SAM, script = USAGE) {
  const r = spawnSync(process.execPath, [script, command], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    env: env(who, { NODE_ENV: 'test', ...extra }),
    cwd: root,
    encoding: 'utf8',
  });
  return { code: r.status, out: r.stdout.trim(), json: r.stdout.trim() ? JSON.parse(r.stdout.trim()) : null };
}

function event(over: Record<string, unknown> = {}, work: Record<string, unknown> | null = {}) {
  return {
    v: 1,
    event: 'app',
    chat: 'a1b2c3d4e5f60718',
    mode: 'shadow',
    app: '0.36.0',
    day: '2026-11-15',
    kind: 'tds',
    seq: 1,
    turns: 3,
    compacted: 0,
    cacheRead: 1200,
    ...(work === null
      ? {}
      : {
          work: {
            kit: 'core',
            how: 'auto',
            fits: ['core', 'ads', 'full'],
            tier: 'standard',
            startup: {
              total: 30000,
              byGroup: { system: 1, skills: 2, connectors: 3, agents: 4, memory: 5, hooks: 6, other: 7 },
            },
            wouldSave: { sure: 4000, approx: 6000 },
            used: { skills: ['meeting-notes'], connectors: ['gmail'] },
            peakPercent: 41.26,
            summaries: 1,
            ...work,
          },
        }),
    ...over,
  };
}

const appFile = () => join(root, 'z-logs', 'app-usage', 'sam-example.jsonl');
const syncedFile = () => join(root, 'z-logs', 'team-usage', 'sam-example.jsonl');
const plainLines = () =>
  readFileSync(appFile(), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));

// ---- usage ----------------------------------------------------------------------

describe('usage', () => {
  it('refuses input over 64 KB without writing anything', () => {
    const r = usage('usage', 'x'.repeat(70 * 1024));
    expect(r).toMatchObject({ code: 2, json: { error: expect.any(String) } });
    expect(existsSync(appFile())).toBe(false);
  });

  it('writes a plain line and nothing synced by default', () => {
    const r = usage('usage', event());
    expect(r).toMatchObject({ code: 0, json: { ok: true, synced: false } });
    expect(plainLines()).toHaveLength(1);
    expect(plainLines()[0]).toMatchObject({ event: 'app', chat: 'a1b2c3d4e5f60718', seq: 1 });
    expect(existsSync(syncedFile())).toBe(false);
  });

  describe('sealed line', () => {
    const keys = generateKeyPairSync('x25519');
    const pub = keys.publicKey.export({ format: 'jwk' }).x as string;
    const writeObserve = (on: boolean) =>
      writeFileSync(
        join(root, '.team-config', 'observe.json'),
        JSON.stringify({ on, publicKey: pub, keyId: 'k1' }),
      );

    it('can never be turned on from the environment', () => {
      writeObserve(true);
      expect(usage('usage', event(), { TDSAPP_USAGE_TEST_SYNC: '1', NODE_ENV: 'test' }).json).toMatchObject({
        synced: false,
      });
      expect(existsSync(syncedFile())).toBe(false);
    });

    it('is not written when Observe is on but the shipped switch is off', () => {
      writeObserve(true);
      expect(usage('usage', event()).json).toMatchObject({ synced: false });
      expect(existsSync(syncedFile())).toBe(false);
    });

    it('is not written when the switch is on but Observe is off', () => {
      writeObserve(false);
      expect(usage('usage', event(), {}, SAM, syncedCopy()).json).toMatchObject({ synced: false });
      expect(existsSync(syncedFile())).toBe(false);
    });

    it('is written when both are on, starts {"v":1, and opens with the key', () => {
      writeObserve(true);
      expect(usage('usage', event(), {}, SAM, syncedCopy()).json).toMatchObject({ synced: true });
      const line = readFileSync(syncedFile(), 'utf8').trim();
      expect(line.startsWith('{"v":1,')).toBe(true);
      const { k, e, n, c } = JSON.parse(line);
      expect(k).toBe('k1');
      const shared = diffieHellman({
        privateKey: createPrivateKey(keys.privateKey.export({ format: 'pem', type: 'pkcs8' })),
        publicKey: (() => {
          const { createPublicKey } = require('node:crypto');
          return createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x: e }, format: 'jwk' });
        })(),
      });
      const key = Buffer.from(hkdfSync('sha256', shared, Buffer.from(`${e}.${pub}`), 'observe-v1', 32));
      const ct = Buffer.from(c, 'base64url');
      const d = createDecipheriv('aes-256-gcm', key, Buffer.from(n, 'base64url'));
      d.setAuthTag(ct.subarray(ct.length - 16));
      const plain = JSON.parse(
        Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]).toString('utf8'),
      );
      expect(plain).toMatchObject({
        who: 'sam@example.test',
        date: '2026-11-15',
        event: 'app',
        chat: 'a1b2c3d4e5f60718',
      });
    });
  });

  it('whitelists keys and drops anything typed', () => {
    const r = usage(
      'usage',
      event(
        { prompt: 'secret', extra: 1 },
        {
          reason: 'typed words',
          used: { skills: ['x'], connectors: [], text: 'hi' },
          startup: { total: 5, byGroup: { system: 1, nope: 9 } },
        },
      ),
    );
    expect(r.code).toBe(0);
    const rec = plainLines()[0];
    expect(rec.prompt).toBeUndefined();
    expect(rec.extra).toBeUndefined();
    expect(rec.work.reason).toBeUndefined();
    expect(rec.work.used.text).toBeUndefined();
    expect(rec.work.startup.byGroup.nope).toBeUndefined();
    expect(readFileSync(appFile(), 'utf8')).not.toContain('secret');
  });

  it('cleans names, dedupes and caps arrays at 40', () => {
    const skills = [
      'Plugin:Meeting Notes!',
      '/path/to/My_Skill',
      'meeting-notes',
      5,
      ...Array.from({ length: 60 }, (_, i) => `s${i}`),
    ];
    usage('usage', event({}, { used: { skills, connectors: ['claude.ai Gmail'] } }));
    const used = plainLines()[0].work.used;
    expect(used.skills.slice(0, 4)).toEqual(['plugin:meeting-notes', 'my-skill', 'meeting-notes', 's0']);
    expect(used.skills).toHaveLength(40);
    expect(used.connectors).toEqual(['claude-ai-gmail']);
  });

  it('keeps the plugin prefix, cleaning each side on its own', () => {
    usage(
      'usage',
      event(
        {},
        { used: { skills: ['Document Skills!:XLSX Tool', ':lonely', 'Plain Skill'], connectors: [] } },
      ),
    );
    expect(plainLines()[0].work.used.skills).toEqual(['document-skills:xlsx-tool', 'lonely', 'plain-skill']);
  });

  it('keeps a line under 4 KB', () => {
    const long = Array.from({ length: 40 }, (_, i) => 'x'.repeat(55) + i);
    const r = usage('usage', event({}, { used: { skills: long, connectors: long } }));
    expect(r.code).toBe(0);
    expect(readFileSync(appFile(), 'utf8').split('\n')[0]?.length).toBeLessThanOrEqual(4096);
  });

  it('drops work details for a personal chat', () => {
    usage('usage', event({ kind: 'personal' }));
    expect(plainLines()[0].work).toBeUndefined();
  });

  it('refuses bad input with exit 2 and writes nothing', () => {
    for (const bad of [
      'not json',
      '[1]',
      event({ chat: 'raw-session-id' }),
      event({ event: 'skill' }),
      event({ seq: -1 }),
      event({ day: 'today' }),
      event({}, { kit: 'nope' }),
    ]) {
      expect(usage('usage', bad).code).toBe(2);
    }
    expect(existsSync(appFile())).toBe(false);
  });

  it('needs no role', () => {
    expect(usage('usage', event(), {}, BEN).code).toBe(0);
    expect(existsSync(join(root, 'z-logs', 'app-usage', 'ben-mcadam.jsonl'))).toBe(true);
  });
});

describe('capabilities', () => {
  it('lists the app-event capability', () => {
    const r = usage('capabilities', '');
    expect(r.code).toBe(0);
    expect(r.json.capabilities).toContain('app-event-v1');
  });
  it('refuses an unknown command', () => {
    expect(usage('nope', '').code).toBe(2);
  });
});

// ---- kits -------------------------------------------------------------------------

describe('show', () => {
  it('prints the built-in kits when there is no file', () => {
    expect(kitsJson(['show']).json.kits).toEqual(JSON.parse(JSON.stringify(BUILT_IN_KITS)));
    expect(kits(['show']).out).toContain('Shadow mode');
  });
});

describe('set', () => {
  it('writes the file and show merges it', () => {
    const r = kitsJson(['set', 'ads', '--connectors', 'semrush, Google Ads', '--plugins', 'marketing']);
    expect(r).toMatchObject({
      code: 0,
      json: {
        ok: true,
        kit: 'ads',
        connectors: ['semrush', 'googleads'],
        plugins: ['marketing'],
        updatedBy: 'sam-example',
      },
    });
    const data = JSON.parse(readFileSync(join(root, KITS_FILE), 'utf8'));
    expect(data).toMatchObject({
      version: 1,
      kits: { ads: { connectors: ['semrush', 'googleads'], plugins: ['marketing'] } },
    });
    const shown = kitsJson(['show']).json.kits;
    expect(shown.ads.connectors).toEqual(['semrush', 'googleads']);
    expect(shown.core.connectors).toEqual([...BUILT_IN_KITS.core.connectors]);
  });

  it('keeps the other list when only one flag is given', () => {
    kitsJson(['set', 'web', '--plugins', 'vercel']);
    expect(kitsJson(['show']).json.kits.web.connectors).toEqual([...BUILT_IN_KITS.web.connectors]);
  });

  it('refuses people who are not the owner or a scout', () => {
    expect(kitsJson(['set', 'ads', '--plugins', 'x'], BEN)).toMatchObject({ code: 2 });
    expect(existsSync(join(root, KITS_FILE))).toBe(false);
  });

  it('refuses full, unknown kits and a missing list', () => {
    expect(kitsJson(['set', 'full', '--plugins', 'x']).code).toBe(2);
    expect(kitsJson(['set', 'nope', '--plugins', 'x']).code).toBe(2);
    expect(kitsJson(['set', 'ads']).code).toBe(2);
    expect(existsSync(join(root, KITS_FILE))).toBe(false);
  });

  it('never overwrites a file that is not valid', () => {
    mkdirSync(join(root, '.claude'));
    writeFileSync(join(root, KITS_FILE), 'not json');
    expect(kitsJson(['set', 'ads', '--plugins', 'x']).code).toBe(2);
    expect(readFileSync(join(root, KITS_FILE), 'utf8')).toBe('not json');
  });
});

describe('review', () => {
  const today = new Date().toISOString().slice(0, 10);
  const write = (...recs: unknown[]) => {
    mkdirSync(join(root, 'z-logs', 'app-usage'), { recursive: true });
    writeFileSync(appFile(), recs.map((r) => `${JSON.stringify(r)}\n`).join(''));
  };

  it('keeps the highest seq per chat and reports hits, misses and savings', () => {
    write(
      event(
        { day: today, seq: 1, chat: 'aaaaaaaaaaaaaaaa' },
        { fits: ['full'], used: { skills: [], connectors: [] } },
      ),
      event(
        { day: today, seq: 3, chat: 'aaaaaaaaaaaaaaaa' },
        {
          fits: ['core', 'full'],
          summaries: 2,
          used: { skills: ['meeting-notes', 'document-skills:xlsx'], connectors: ['gmail'] },
        },
      ),
      event(
        { day: today, seq: 1, chat: 'bbbbbbbbbbbbbbbb' },
        { kit: 'ads', how: 'rule', fits: ['full'], wouldSave: { sure: 100, approx: 200 } },
      ),
      event({ day: '2020-01-01', seq: 9, chat: 'cccccccccccccccc' }),
    );
    const r = kitsJson(['review']).json;
    expect(r).toMatchObject({ chats: 2, workChats: 2, summaries: 3 });
    expect(r.hitRate.auto).toEqual({ chats: 1, hits: 1, percent: 100 });
    expect(r.hitRate.rule).toEqual({ chats: 1, hits: 0, percent: 0 });
    expect(r.misses).toHaveLength(1);
    expect(r.misses[0]).toMatchObject({ kit: 'ads', how: 'rule' });
    expect(r.kits.core.wouldSave).toEqual({ sure: 4000, approx: 6000 });
    expect(r.kits.ads.wouldSave).toEqual({ sure: 100, approx: 200 });
    expect(r.kits.core.unusedConnectors).not.toContain('gmail');
    expect(r.kits.core.unusedConnectors).toContain('xero');
    expect(r.kits.core.unusedPlugins).toEqual(['productivity']);
  });

  it('prints plain text and copes with no data', () => {
    expect(kits(['review']).out).toContain('No kit picks recorded yet');
    write(event({ day: today }));
    expect(kits(['review', '--days', '7']).out).toContain('would have been enough');
    expect(kits(['review', '--days', '0']).code).toBe(2);
  });
});

describe('constants', () => {
  it('match the contract', () => {
    expect(kitsJson(['show']).json.kits).toEqual(JSON.parse(JSON.stringify(BUILT_IN_KITS)));
    expect(Object.keys(kitsJson(['show']).json.kits)).toEqual([...KIT_IDS]);
    expect(APP_USAGE_CAPABILITY).toBe('app-event-v1');
    expect(usage('capabilities', '').json.capabilities).toEqual([APP_USAGE_CAPABILITY]);
    expect(
      USAGE.endsWith(APP_USAGE_SCRIPT.replace('.claude/skills/tdsapp-kits/', '').replace(/^/, '/')),
    ).toBe(true);
    kitsJson(['set', 'core', '--plugins', 'x']);
    expect(existsSync(join(root, KITS_FILE))).toBe(true);
  });

  it('keeps the shipped sync switch off', () => {
    expect(readFileSync(USAGE, 'utf8')).toContain('const SYNC_APP_EVENTS = false;');
  });
});
