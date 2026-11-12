import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { BrainCheck, BrainCheckContext } from '../shared/install-contract.ts';
import { mergeSettings } from './settings.ts';
import { createSetupService, normalizePastedPath, type SetupServiceDeps } from './setup-service.ts';

const tempDirs: string[] = [];
afterAll(() => {
  for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tba-setup-'));
  tempDirs.push(dir);
  return dir;
}

const HOME = '/Users/sam';

function deps(over: Partial<SetupServiceDeps> = {}): SetupServiceDeps & { lines: string[] } {
  const lines: string[] = [];
  return {
    env: {},
    home: HOME,
    appRoot: '/app',
    dataDir: tempDir(),
    underService: true,
    current: null,
    openChats: async () => 0,
    checkBrain: async (p) => ({ ok: true, path: p }),
    findBrainCandidates: async () => [],
    mergeSettings,
    log: (l) => lines.push(l),
    restart: () => {},
    lines,
    ...over,
  };
}

describe('normalizePastedPath', () => {
  it('trims and strips one pair of surrounding quotes', () => {
    expect(normalizePastedPath('  /Users/sam/brain \n', HOME)).toBe('/Users/sam/brain');
    expect(normalizePastedPath("'/Users/sam/My Brain'", HOME)).toBe('/Users/sam/My Brain');
    expect(normalizePastedPath(' "/Users/sam/My Brain" ', HOME)).toBe('/Users/sam/My Brain');
    expect(normalizePastedPath(`"'/a'"`, HOME)).toBe(`'/a'`);
    // Unmatched quotes are left alone.
    expect(normalizePastedPath(`"/a'`, HOME)).toBe(`"/a'`);
  });

  it('unescapes backslash-space from Terminal', () => {
    expect(normalizePastedPath('/Users/sam/My\\ Repos/agency\\ brain', HOME)).toBe(
      '/Users/sam/My Repos/agency brain',
    );
  });

  it('expands a leading ~ against home', () => {
    expect(normalizePastedPath('~/agencybrain', HOME)).toBe('/Users/sam/agencybrain');
    expect(normalizePastedPath('~', HOME)).toBe(HOME);
    expect(normalizePastedPath("'~/My\\ Repos/b'", HOME)).toBe('/Users/sam/My Repos/b');
    expect(normalizePastedPath('a/~/b', HOME)).toBe('a/~/b');
  });
});

describe('save', () => {
  it('refuses with env-override when TDS_BRAIN_PATH is set, without checking or writing', async () => {
    const checkBrain = vi.fn(async (p: string): Promise<BrainCheck> => ({ ok: true, path: p }));
    const d = deps({ env: { TDS_BRAIN_PATH: '/Users/sam/x' }, checkBrain });
    const s = createSetupService(d);
    expect(await s.save('/Users/sam/brain')).toEqual({ ok: false, reason: 'env-override' });
    expect(checkBrain).not.toHaveBeenCalled();
    expect(() => readFileSync(join(d.dataDir, 'settings.json'))).toThrow();
  });

  it('passes a refusal on, and writes nothing', async () => {
    const d = deps({ checkBrain: async () => ({ ok: false, reason: 'missing-whoami' }) });
    expect(await createSetupService(d).save('/Users/sam/nope')).toEqual({
      ok: false,
      reason: 'missing-whoami',
    });
    expect(() => readFileSync(join(d.dataDir, 'settings.json'))).toThrow();
    expect(d.lines).toEqual([]);
  });

  it('checks the tidied path against home, the app and the data folder', async () => {
    const seen: [string, BrainCheckContext][] = [];
    const d = deps({
      checkBrain: async (p, ctx) => {
        seen.push([p, ctx]);
        return { ok: false, reason: 'not-found' };
      },
    });
    await createSetupService(d).save(" '~/My\\ Repos/brain' ");
    expect(seen).toEqual([
      ['/Users/sam/My Repos/brain', { home: HOME, appRoot: '/app', dataDir: d.dataDir }],
    ]);
  });

  it('on a pass merges the resolved path into settings, keeping other keys, and logs it', async () => {
    const d = deps({ checkBrain: async () => ({ ok: true, path: '/Users/sam/real "brain"' }) });
    writeFileSync(join(d.dataDir, 'settings.json'), JSON.stringify({ brainPath: '/old', other: true }));
    const result = await createSetupService(d).save('~/link');
    expect(result).toEqual({ ok: true, path: '/Users/sam/real "brain"', restarting: true });
    expect(JSON.parse(readFileSync(join(d.dataDir, 'settings.json'), 'utf8'))).toEqual({
      brainPath: '/Users/sam/real "brain"',
      other: true,
    });
    expect(d.lines).toEqual(['Brain folder changed to "/Users/sam/real \\"brain\\"".']);
  });

  it('reports restarting only under the service, and never restarts by itself', async () => {
    const restart = vi.fn();
    const manual = createSetupService(deps({ underService: false, restart }));
    expect(await manual.save('/Users/sam/brain')).toEqual({
      ok: true,
      path: '/Users/sam/brain',
      restarting: false,
    });
    const service = createSetupService(deps({ underService: true, restart }));
    expect(await service.save('/Users/sam/brain')).toMatchObject({ ok: true, restarting: true });
    expect(restart).not.toHaveBeenCalled();
    service.restart();
    expect(restart).toHaveBeenCalledTimes(1);
  });
});

describe('candidates', () => {
  it('carries the folders found, the brain in use, the open chats and the env override', async () => {
    const seen: BrainCheckContext[] = [];
    const d = deps({
      current: { path: '/Users/sam/agencybrain', source: 'settings' },
      openChats: async () => 3,
      findBrainCandidates: async (ctx) => {
        seen.push(ctx);
        return ['/Users/sam/agencybrain', '/Users/sam/Documents/b'];
      },
    });
    expect(await createSetupService(d).candidates()).toEqual({
      candidates: ['/Users/sam/agencybrain', '/Users/sam/Documents/b'],
      current: { path: '/Users/sam/agencybrain', source: 'settings' },
      openChats: 3,
      envOverride: false,
    });
    expect(seen).toEqual([{ home: HOME, appRoot: '/app', dataDir: d.dataDir }]);
  });

  it('in setup mode: no current brain and no chats; a set TDS_BRAIN_PATH is an override', async () => {
    const s = createSetupService(deps({ env: { TDS_BRAIN_PATH: '/x' } }));
    expect(await s.candidates()).toEqual({ candidates: [], current: null, openChats: 0, envOverride: true });
    const blank = createSetupService(deps({ env: { TDS_BRAIN_PATH: '  ' } }));
    expect((await blank.candidates()).envOverride).toBe(false);
  });

  it('counts no chats when the count fails', async () => {
    const s = createSetupService(
      deps({
        openChats: async () => {
          throw new Error('nope');
        },
      }),
    );
    expect((await s.candidates()).openChats).toBe(0);
  });
});
