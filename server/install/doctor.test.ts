import { describe, expect, it } from 'vitest';
import { BRAIN_REFUSAL_TEXT, type DoctorCheck } from '../../shared/install-contract.ts';
import { type DoctorDeps, runDoctor } from './doctor.ts';

const healthy = (over: Partial<DoctorDeps> = {}): DoctorDeps => ({
  appRoot: '/app',
  port: 3877,
  launchToken: 't'.repeat(43),
  brainCandidate: { path: '/Users/a/agencybrain', source: 'settings' },
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

  it('says no brain folder is chosen yet when the never-chosen default is not a brain', async () => {
    const r = await runDoctor(
      healthy({
        brainCandidate: { path: '/Users/a/agencybrain', source: 'default' },
        checkBrain: async () => ({ ok: false, reason: 'not-found' }),
      }),
    );
    expect(failed(r)).toEqual(['brain']);
    expect(r.results.find((x) => x.check === 'brain')?.message).toBe(
      'No brain folder chosen yet; open TDS Brain to choose one.',
    );
  });

  it('passes the default folder when it is a brain', async () => {
    const r = await runDoctor(
      healthy({ brainCandidate: { path: '/Users/a/agencybrain', source: 'default' } }),
    );
    expect(failed(r)).toEqual([]);
  });

  it('explains a refused chosen folder in the same words as the Setup page, naming it', async () => {
    for (const source of ['settings', 'env'] as const) {
      const r = await runDoctor(
        healthy({
          brainCandidate: { path: '/Users/a/old-brain', source },
          checkBrain: async () => ({ ok: false, reason: 'missing-whoami' }),
        }),
      );
      const brain = r.results.find((x) => x.check === 'brain');
      expect(brain?.ok).toBe(false);
      expect(brain?.message).toContain(BRAIN_REFUSAL_TEXT['missing-whoami']);
      expect(brain?.message).toContain('/Users/a/old-brain');
    }
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
