import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LAUNCH_AGENT_LABEL, SIGNIN_APP_NAME } from '../../shared/install-contract.ts';
import {
  type InstallDeps,
  install,
  installPaths,
  openApp,
  restartApp,
  signOutEverywhere,
  uninstall,
} from './install.ts';

const TOKEN = 'k'.repeat(43);
let home: string;
let calls: string[];

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'tds-install-'));
  calls = [];
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function deps(over: Partial<InstallDeps> = {}): InstallDeps {
  const dataDir = join(home, 'Library', 'Application Support', 'TDS Brain', 'data');
  return {
    home,
    appRoot: join(home, 'Library', 'Application Support', 'TDS Brain', 'app'),
    port: 3877,
    env: {},
    settings: {
      resolveDataDir: () => dataDir,
      readSettings: () => ({ brainPath: '/Users/a/agencybrain' }),
      writeSettings: (_d, s) => void calls.push(`writeSettings:${s.brainPath}`),
    },
    checkBrain: async (p) => {
      calls.push('checkBrain');
      return p.includes('brain') ? { ok: true, path: p } : { ok: false, reason: 'missing-roles' };
    },
    launchctl: {
      bootout: async () => void calls.push('bootout'),
      enable: async () => void calls.push('enable'),
      bootstrap: async (p) => void calls.push(`bootstrap:${p}`),
      kickstart: async () => void calls.push('kickstart'),
      isLoaded: async () => true,
      isDisabled: async () => false,
    },
    loadLaunchToken: () => TOKEN,
    readLaunchToken: () => TOKEN,
    portInUse: async () => false,
    precheckMigrate: () => ({ ok: true }),
    isOurServer: async () => calls.includes(`bootstrap:${installPaths(home).plist}`),
    codeFromRunningServer: async () => 'CODE123',
    openBrowser: (url) => void calls.push(`open:${url}`),
    migrate: (from, to) => {
      calls.push(`migrate:${from}->${to}`);
      return { ok: true };
    },
    sleep: async () => void calls.push('sleep'),
    log: () => {},
    ...over,
  };
}

const d0 = () => deps().settings.resolveDataDir({}, home);

describe('install', () => {
  it('checks the brain, writes files, runs launchctl in order, then opens the sign-in', async () => {
    const d = deps();
    const r = await install({ brain: '/Users/a/agencybrain' }, d);
    expect(r.ok).toBe(true);
    const p = installPaths(home);
    expect(calls.filter((c) => c !== 'sleep')).toEqual([
      'checkBrain',
      'bootout',
      'writeSettings:/Users/a/agencybrain',
      'enable',
      `bootstrap:${p.plist}`,
      'open:http://127.0.0.1:3877/auth?code=CODE123',
    ]);
    const plist = readFileSync(p.plist, 'utf8');
    expect(plist).toContain(LAUNCH_AGENT_LABEL);
    expect(plist).toContain(join(p.signinApp, 'Contents', 'MacOS', 'tds-brain-service'));
    expect(existsSync(join(p.signinApp, 'Contents', 'MacOS', 'signin'))).toBe(true);
    expect(p.signinApp.endsWith(`${SIGNIN_APP_NAME}.app`)).toBe(true);
    expect(existsSync(p.logDir)).toBe(true);
  });

  it('refuses a folder that is not a brain, before changing anything', async () => {
    const r = await install({ brain: '/Users/a/Documents' }, deps());
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/team list|roles/i);
    expect(calls).toEqual(['checkBrain']);
    expect(readdirSync(home)).toEqual([]);
  });

  it('migrates before writing settings', async () => {
    const d = deps();
    const r = await install({ brain: '/Users/a/agencybrain', migrateFrom: '/old/data' }, d);
    expect(r.ok).toBe(true);
    expect(calls.indexOf(`migrate:/old/data->${d.settings.resolveDataDir({}, home)}`)).toBeGreaterThan(0);
    expect(calls.findIndex((c) => c.startsWith('migrate'))).toBeLessThan(
      calls.findIndex((c) => c.startsWith('writeSettings')),
    );
  });

  it('stops before switching anything off when a migration is refused', async () => {
    const r = await install(
      { brain: '/Users/a/agencybrain', migrateFrom: '/old' },
      deps({ precheckMigrate: () => ({ ok: false, message: 'Already has data.' }) }),
    );
    expect(r.ok).toBe(false);
    expect(r.message).toContain('Already has data.');
    expect(calls).toEqual(['checkBrain']);
  });

  it('refuses before changing anything when another copy holds the port', async () => {
    const old = join(home, 'old-data');
    mkdirSync(old);
    writeFileSync(join(old, 'runtime.json'), '{}');
    const r = await install(
      { brain: '/Users/a/agencybrain', migrateFrom: old },
      deps({ portInUse: async () => true }),
    );
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/terminal/i);
    expect(calls).toEqual(['checkBrain', 'bootout']);
    expect(existsSync(installPaths(home).plist)).toBe(false);
    expect(existsSync(old)).toBe(true);
    expect(existsSync(`${old}.moved`)).toBe(false);
  });

  it('puts the old agent back when the port is held after bootout', async () => {
    const p = installPaths(home);
    mkdirSync(join(home, 'Library', 'LaunchAgents'), { recursive: true });
    writeFileSync(p.plist, 'old');
    const r = await install({ brain: '/Users/a/agencybrain' }, deps({ portInUse: async () => true }));
    expect(r.ok).toBe(false);
    expect(calls).toEqual(['checkBrain', 'bootout', `bootstrap:${p.plist}`]);
    expect(readFileSync(p.plist, 'utf8')).toBe('old');
  });

  it('gives up with a plain message when the app never answers', async () => {
    const r = await install(
      { brain: '/Users/a/agencybrain' },
      deps({ isOurServer: async () => false, timeoutMs: 2000 }),
    );
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/doctor/);
    expect(calls.some((c) => c.startsWith('open:'))).toBe(false);
  });

  it('passes the data folder and port to the service only when the environment sets them', async () => {
    await install({ brain: '/Users/a/agencybrain' }, deps({ env: { TDS_BRAIN_APP_PORT: '3999' } }));
    const plist = readFileSync(installPaths(home).plist, 'utf8');
    expect(plist).toContain('TDS_BRAIN_APP_PORT');
    expect(plist).not.toContain('TDS_BRAIN_APP_DATA');
  });
});

describe('uninstall', () => {
  it('removes the agent and the sign-in app but keeps the data', async () => {
    const d = deps();
    await install({ brain: '/Users/a/agencybrain' }, d);
    const dataDir = d.settings.resolveDataDir({}, home);
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, 'prefs.json'), '{}');
    calls.length = 0;
    const r = await uninstall({}, d);
    const p = installPaths(home);
    expect(r.ok).toBe(true);
    expect(calls).toEqual(['bootout']);
    expect(existsSync(p.plist)).toBe(false);
    expect(existsSync(p.signinApp)).toBe(false);
    expect(existsSync(dataDir)).toBe(true);
    expect(r.message).toContain('chrome://apps');
  });

  it('--all also removes the data folder, never the app folder', async () => {
    const d = deps();
    const dataDir = d.settings.resolveDataDir({}, home);
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(d.appRoot, { recursive: true });
    writeFileSync(join(dataDir, 'runtime.json'), '{}');
    await uninstall({ all: true }, d);
    expect(existsSync(dataDir)).toBe(false);
    expect(existsSync(d.appRoot)).toBe(true);
  });

  it('--all refuses to remove a data folder that holds the app', async () => {
    const d = deps();
    const dataDir = d.settings.resolveDataDir({}, home);
    mkdirSync(join(dataDir, 'app'), { recursive: true });
    writeFileSync(join(dataDir, 'runtime.json'), '{}');
    const r = await uninstall({ all: true }, { ...d, appRoot: join(dataDir, 'app') });
    expect(existsSync(dataDir)).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/app folder/);
  });
});

describe('uninstall --all safety', () => {
  const refuse = async (dataDir: string, over: Partial<InstallDeps> = {}) => {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, 'runtime.json'), '{}');
    const d = deps({ settings: { ...deps().settings, resolveDataDir: () => dataDir }, ...over });
    const r = await uninstall({ all: true }, d);
    expect(r.ok).toBe(false);
    expect(existsSync(dataDir)).toBe(true);
    expect(calls).toEqual([]);
    return r;
  };

  it('refuses the home folder', async () => void (await refuse(home)));
  it('refuses an ancestor of home', async () => void (await refuse(join(home, '..'), { home })));
  it('refuses the brain folder', async () => {
    const brain = join(home, 'agencybrain');
    await refuse(brain, {
      settings: {
        ...deps().settings,
        resolveDataDir: () => brain,
        readSettings: () => ({ brainPath: brain }),
      },
    });
  });

  it('refuses a folder with no runtime.json', async () => {
    const dataDir = join(home, 'whatever');
    mkdirSync(dataDir);
    const r = await uninstall(
      { all: true },
      deps({ settings: { ...deps().settings, resolveDataDir: () => dataDir } }),
    );
    expect(r.ok).toBe(false);
    expect(existsSync(dataDir)).toBe(true);
  });
});

describe('restart, open and sign-out-everywhere', () => {
  it('restart kickstarts the agent', async () => {
    expect((await restartApp(deps())).ok).toBe(true);
    expect(calls).toEqual(['kickstart']);
  });

  it('open says plainly when the app is not running', async () => {
    const r = await openApp(deps({ codeFromRunningServer: async () => null }));
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/not running/i);
    expect(calls).toEqual([]);
  });

  it('open does not create runtime.json and says the app is not installed', async () => {
    const r = await openApp(deps({ readLaunchToken: () => null }));
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/install/i);
    expect(existsSync(join(d0(), 'runtime.json'))).toBe(false);
  });

  it('open opens the sign-in when it is', async () => {
    expect((await openApp(deps())).ok).toBe(true);
    expect(calls).toEqual(['open:http://127.0.0.1:3877/auth?code=CODE123']);
  });

  it('sign-out-everywhere writes a new token (mode 0600) and restarts', async () => {
    const d = deps();
    const dataDir = d.settings.resolveDataDir({}, home);
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, 'runtime.json'), JSON.stringify({ launchToken: TOKEN }));
    const r = await signOutEverywhere(d);
    expect(r.ok).toBe(true);
    expect(r.message).toContain('signed out');
    const next = JSON.parse(readFileSync(join(dataDir, 'runtime.json'), 'utf8')).launchToken as string;
    expect(next).not.toBe(TOKEN);
    expect(next).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(calls).toEqual(['kickstart']);
  });

  it('sign-out-everywhere without a loaded agent still rotates but says people stay signed in', async () => {
    const d = deps();
    d.launchctl.isLoaded = async () => false;
    const r = await signOutEverywhere(d);
    expect(r.message).toMatch(/stay signed in/);
    expect(r.message).not.toContain('Everyone is signed out');
    expect(calls).toEqual([]);
    expect(existsSync(join(d.settings.resolveDataDir({}, home), 'runtime.json'))).toBe(true);
  });

  it('sign-out-everywhere does not claim success when the restart fails', async () => {
    const d = deps();
    d.launchctl.kickstart = async () => {
      throw new Error('nope');
    };
    const r = await signOutEverywhere(d);
    expect(r.message).toMatch(/stay signed in/);
    expect(r.message).not.toContain('Everyone is signed out');
  });
});
