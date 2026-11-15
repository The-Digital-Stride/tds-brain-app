import { mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClientGuesser } from './client-guess.ts';
import {
  checkDemoBrain,
  checkDemoEnv,
  DEMO_MARKER,
  demoClientGuess,
  demoRefusalLine,
  demoSafeEnv,
  scrubSecretEnv,
} from './demo-guard.ts';
import { jevFromBrain } from './jev.ts';

const SEED = resolve(import.meta.dirname, '..', '..', 'scripts', 'help-demo', 'brain');

let root: string;
let appRoot: string;
let good: NodeJS.ProcessEnv;
const argv = ['node', 'server/index.ts', '--no-open'];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'demo-guard-'));
  appRoot = join(root, 'app');
  mkdirSync(join(appRoot, '.help-demo', 'data'), { recursive: true });
  mkdirSync(join(appRoot, '.help-demo', 'brain'), { recursive: true });
  good = {
    TDS_CORTEX_DEMO: '1',
    TDS_BRAIN_APP_PORT: '3879',
    TDS_BRAIN_APP_DATA: join(appRoot, '.help-demo', 'data'),
    TDS_BRAIN_PATH: join(appRoot, '.help-demo', 'brain'),
  };
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const run = (env: NodeJS.ProcessEnv, args: readonly string[] = argv) =>
  checkDemoEnv({ env, argv: args, appRoot, defaultPort: 3877, home: join(root, 'home') });

function expectRefused(d: ReturnType<typeof run>, word: RegExp) {
  expect(d).toMatchObject({ demo: true, ok: false });
  if (d.demo && !d.ok) expect(d.rule).toMatch(word);
}

describe('checkDemoEnv', () => {
  it('flag unset: demo is off whatever else is set (no behaviour change)', () => {
    const { TDS_CORTEX_DEMO: _drop, ...rest } = good;
    expect(run(rest)).toEqual({ demo: false });
    expect(run({}, [])).toEqual({ demo: false });
    expect(run({ TDS_BRAIN_SERVICE: '1', TDS_BRAIN_PATH: '/Users/someone/agencybrain' }, [])).toEqual({
      demo: false,
    });
  });
  it('all rules pass', () => {
    expect(run(good)).toEqual({ demo: true, ok: true });
  });
  it('flag must be exactly 1', () => {
    for (const v of ['0', 'true', '', ' 1', 'yes'])
      expectRefused(run({ ...good, TDS_CORTEX_DEMO: v }), /exactly 1/);
  });
  it('refuses under the service', () => {
    expectRefused(run({ ...good, TDS_BRAIN_SERVICE: '1' }), /service/);
  });
  it('needs --no-open', () => {
    expectRefused(run(good, ['node', 'server/index.ts']), /--no-open/);
  });
  it('needs a port', () => {
    const { TDS_BRAIN_APP_PORT: _p, ...rest } = good;
    expectRefused(run(rest), /PORT/);
  });
  it('refuses the usual port, and a bad port', () => {
    expectRefused(run({ ...good, TDS_BRAIN_APP_PORT: '3877' }), /usual port/);
    expectRefused(run({ ...good, TDS_BRAIN_APP_PORT: 'abc' }), /port number/);
  });
  it('needs the data folder set and inside .help-demo', () => {
    const { TDS_BRAIN_APP_DATA: _d, ...rest } = good;
    expectRefused(run(rest), /TDS_BRAIN_APP_DATA/);
    expectRefused(run({ ...good, TDS_BRAIN_APP_DATA: join(root, 'elsewhere') }), /TDS_BRAIN_APP_DATA/);
    expectRefused(run({ ...good, TDS_BRAIN_APP_DATA: appRoot }), /TDS_BRAIN_APP_DATA/);
  });
  it('needs the Brain path set and inside .help-demo', () => {
    const { TDS_BRAIN_PATH: _b, ...rest } = good;
    expectRefused(run(rest), /TDS_BRAIN_PATH/);
    expectRefused(run({ ...good, TDS_BRAIN_PATH: root }), /TDS_BRAIN_PATH/);
  });
  it('follows links: a link inside .help-demo that points outside is refused', () => {
    const outside = join(root, 'outside');
    mkdirSync(outside);
    symlinkSync(outside, join(appRoot, '.help-demo', 'link'));
    expectRefused(run({ ...good, TDS_BRAIN_PATH: join(appRoot, '.help-demo', 'link') }), /TDS_BRAIN_PATH/);
  });
  it('refuses a ../ path that escapes', () => {
    expectRefused(
      run({ ...good, TDS_BRAIN_PATH: join(appRoot, '.help-demo', '..', 'outside') }),
      /TDS_BRAIN_PATH/,
    );
  });
  it('refuses a relative data folder (the server would swap it for the real one)', () => {
    expectRefused(run({ ...good, TDS_BRAIN_APP_DATA: '.help-demo/data' }), /TDS_BRAIN_APP_DATA.*full path/);
    expectRefused(run({ ...good, TDS_BRAIN_PATH: '.help-demo/brain' }), /TDS_BRAIN_PATH.*full path/);
  });
  it('refuses ~ and values with spaces around them', () => {
    expectRefused(run({ ...good, TDS_BRAIN_APP_DATA: '~/x' }), /full path/);
    expectRefused(run({ ...good, TDS_BRAIN_APP_DATA: ` ${good.TDS_BRAIN_APP_DATA}` }), /full path/);
    expectRefused(run({ ...good, TDS_BRAIN_PATH: `${good.TDS_BRAIN_PATH}\n` }), /full path/);
  });
  it('refuses a .help-demo that is a link, even to a folder that looks right', () => {
    const real = join(root, 'real-demo');
    renameSync(join(appRoot, '.help-demo'), real);
    symlinkSync(real, join(appRoot, '.help-demo'));
    expectRefused(run(good), /not a link/);
  });
  it('refuses when .help-demo does not exist', () => {
    rmSync(join(appRoot, '.help-demo'), { recursive: true });
    expectRefused(run(good), /does not exist/);
  });
});

describe('checkDemoBrain', () => {
  const brain = () => join(appRoot, '.help-demo', 'brain');
  const ready = () => ({ kind: 'ready' as const, path: brain() });
  it('all pass', () => {
    expect(checkDemoBrain({ decision: ready(), env: good, hasMarker: () => true })).toBeNull();
  });
  it('refuses setup mode', () => {
    expect(checkDemoBrain({ decision: { kind: 'setup' }, env: good, hasMarker: () => true })).toMatch(
      /setup/,
    );
  });
  it('refuses a Brain that is not the one named by TDS_BRAIN_PATH', () => {
    const other = join(root, 'other');
    mkdirSync(other);
    expect(
      checkDemoBrain({ decision: { kind: 'ready', path: other }, env: good, hasMarker: () => true }),
    ).toMatch(/TDS_BRAIN_PATH/);
  });
  it('refuses a Brain with no marker, asking for the right file', () => {
    const seen: string[] = [];
    const out = checkDemoBrain({
      decision: ready(),
      env: good,
      hasMarker: (p) => {
        seen.push(p);
        return false;
      },
    });
    expect(out).toContain(DEMO_MARKER);
    expect(seen).toHaveLength(1);
  });
});

describe('checkDemoBrain and Jev', () => {
  const brain = () => join(appRoot, '.help-demo', 'brain');
  it('refuses a Brain with Jev set up', () => {
    writeFileSync(join(brain(), 'jev-proxy.yaml'), 'url: https://example.test\nsecret: abc\n');
    expect(
      checkDemoBrain({ decision: { kind: 'ready', path: brain() }, env: good, hasMarker: () => true }),
    ).toMatch(/Jev/);
  });
  it('refuses Jev set up in the env', () => {
    const env = { ...good, JEV_PROXY_URL: 'https://example.test', JEV_PROXY_SECRET: 'abc' };
    expect(
      checkDemoBrain({ decision: { kind: 'ready', path: brain() }, env, hasMarker: () => true }),
    ).toMatch(/Jev/);
  });
  it('the demo seed Brain has no Jev config, so a guess never reaches the network', async () => {
    const env = demoSafeEnv({
      ...good,
      TDS_BRAIN_PATH: SEED,
      JEV_PROXY_URL: 'https://example.test',
      JEV_PROXY_SECRET: 'abc',
    });
    expect(
      checkDemoBrain({ decision: { kind: 'ready', path: SEED }, env, hasMarker: () => true }),
    ).toBeNull();
    const fetchSpy = vi.fn(async () => new Response('{}'));
    expect(jevFromBrain(SEED, env, fetchSpy)).toBeNull();
    const guess = createClientGuesser({ ask: jevFromBrain(SEED, env, fetchSpy) });
    const out = await guess('Plan the spring campaign', [
      { slug: 'acme-heating', name: 'Acme Heating', aliases: [] },
    ]);
    expect(out.kind).toBe('ask');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('demo env scrubbing and client guess', () => {
  it('drops secrets and proxies, keeps what the server needs', () => {
    const env = {
      ...good,
      PATH: '/usr/bin',
      HOME: '/Users/x',
      JEV_PROXY_URL: 'u',
      JEV_PROXY_SECRET: 's',
      ANTHROPIC_API_KEY: 'k',
      GITHUB_TOKEN: 't',
      https_proxy: 'p',
    };
    const out = demoSafeEnv(env);
    expect(Object.keys(out).sort()).toEqual([...Object.keys(good), 'HOME', 'PATH'].sort());
    expect(env.JEV_PROXY_SECRET).toBe('s');
    scrubSecretEnv(env);
    expect(env.JEV_PROXY_SECRET).toBeUndefined();
  });
  it('the demo client guess is a fixed "no guess"', async () => {
    expect(await demoClientGuess()).toEqual({ kind: 'ask', options: [] });
  });
});

describe('demoRefusalLine', () => {
  it('is one plain line', () => {
    expect(demoRefusalLine('No.')).not.toContain('\n');
  });
});
