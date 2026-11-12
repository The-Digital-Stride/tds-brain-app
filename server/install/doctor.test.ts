import { describe, expect, it } from 'vitest';
import type { DoctorCheck } from '../../shared/install-contract.ts';
import { type DoctorDeps, runDoctor } from './doctor.ts';

const healthy = (over: Partial<DoctorDeps> = {}): DoctorDeps => ({
  appRoot: '/app',
  port: 3877,
  launchToken: 't'.repeat(43),
  brainPath: '/Users/a/agencybrain',
  servicePath: ['/app/bin', '/usr/bin'],
  logFile: '/log/server.log',
  signinAppDir: '/Users/a/Applications/TDS Brain Sign-in.app',
  claudePath: '/Users/a/.local/bin/claude',
  nodeVersion: async () => '24.15.0',
  which: () => true,
  checkBrain: async (p) => ({ ok: true, path: p }),
  exists: () => true,
  isLoaded: async () => true,
  isDisabled: async () => false,
  portOwner: async () => 'node',
  isOurServer: async () => true,
  readLogTail: () => ['line one', 'line two'],
  ...over,
});

const failed = (r: Awaited<ReturnType<typeof runDoctor>>): DoctorCheck[] =>
  r.results.filter((x) => !x.ok).map((x) => x.check);

describe('runDoctor', () => {
  it('reports every check and passes when all is well, without a log tail', async () => {
    const r = await runDoctor(healthy());
    expect(r.ok).toBe(true);
    expect(r.results.map((x) => x.check).sort()).toEqual(
      [
        'agent-loaded',
        'answering',
        'brain',
        'build',
        'claude',
        'login-item',
        'node',
        'port',
        'signin-app',
        'tools',
      ].sort(),
    );
    expect(r.logTail).toEqual([]);
  });

  it('flags an old or missing Node', async () => {
    expect(failed(await runDoctor(healthy({ nodeVersion: async () => '22.17.0' })))).toEqual(['node']);
    expect(failed(await runDoctor(healthy({ nodeVersion: async () => null })))).toEqual(['node']);
  });

  it('names the tools missing from the service PATH', async () => {
    const r = await runDoctor(healthy({ which: (t) => t !== 'jq' && t !== 'python3' }));
    const tools = r.results.find((x) => x.check === 'tools');
    expect(tools?.ok).toBe(false);
    expect(tools?.message).toContain('jq');
    expect(tools?.message).toContain('python3');
  });

  it('flags a missing claude, a refused brain and a missing build', async () => {
    const r = await runDoctor(
      healthy({
        claudePath: null,
        checkBrain: async () => ({ ok: false, reason: 'missing-roles' }),
        exists: (p) => !p.endsWith('index.html'),
      }),
    );
    expect(failed(r).sort()).toEqual(['brain', 'build', 'claude']);
  });

  it('flags no brain set', async () => {
    expect(failed(await runDoctor(healthy({ brainPath: null })))).toEqual(['brain']);
  });

  it('flags the agent not loaded and the app not answering', async () => {
    const r = await runDoctor(
      healthy({ isLoaded: async () => false, isOurServer: async () => false, portOwner: async () => null }),
    );
    expect(failed(r).sort()).toEqual(['agent-loaded', 'answering']);
    expect(r.logTail).toEqual(['line one', 'line two']);
  });

  it('names another program on the port', async () => {
    const r = await runDoctor(healthy({ isOurServer: async () => false, portOwner: async () => 'Python' }));
    const port = r.results.find((x) => x.check === 'port');
    expect(port?.ok).toBe(false);
    expect(port?.message).toContain('Python');
  });

  it('treats a missing token as not running, without probing the server', async () => {
    const r = await runDoctor(
      healthy({
        launchToken: null,
        portOwner: async () => null,
        isOurServer: async () => {
          throw new Error('probed');
        },
      }),
    );
    expect(failed(r)).toEqual(['answering']);
  });

  it('flags the login item switched off and a missing sign-in app', async () => {
    const r = await runDoctor(
      healthy({ isDisabled: async () => true, exists: (p) => !p.includes('Sign-in.app') }),
    );
    expect(failed(r).sort()).toEqual(['login-item', 'signin-app']);
  });

  it('every message is one sentence', async () => {
    const r = await runDoctor(
      healthy({ nodeVersion: async () => null, claudePath: null, isLoaded: async () => false }),
    );
    for (const x of r.results) expect(x.message.split(/(?<=\.)\s/).length).toBe(1);
  });
});
