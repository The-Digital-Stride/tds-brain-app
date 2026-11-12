import { describe, expect, it } from 'vitest';
import type { BrainCheck } from '../../shared/install-contract.ts';
import { appStateFor, decideBrain } from './decide.ts';

const pass = (real: string) => async (): Promise<BrainCheck> => ({ ok: true, path: real });
const fail = (reason: 'not-found' | 'missing-roles') => async (): Promise<BrainCheck> => ({
  ok: false,
  reason,
});

describe('decideBrain', () => {
  it('is ready on the checked, link-resolved path when the check passes', async () => {
    const seen: string[] = [];
    const decision = await decideBrain({ path: '/Users/a/link', source: 'settings' }, async (p) => {
      seen.push(p);
      return { ok: true, path: '/Users/a/real-brain' };
    });
    expect(seen).toEqual(['/Users/a/link']);
    expect(decision).toEqual({ kind: 'ready', path: '/Users/a/real-brain', source: 'settings' });
  });

  it('is ready for the default folder too when it passes', async () => {
    expect(
      await decideBrain({ path: '/Users/a/agencybrain', source: 'default' }, pass('/Users/a/agencybrain')),
    ).toEqual({
      kind: 'ready',
      path: '/Users/a/agencybrain',
      source: 'default',
    });
  });

  it('goes to setup with the path tried and the refusal when a chosen folder fails', async () => {
    expect(await decideBrain({ path: '/Users/a/gone', source: 'settings' }, fail('not-found'))).toEqual({
      kind: 'setup',
      tried: '/Users/a/gone',
      source: 'settings',
      reason: 'not-found',
    });
    expect(await decideBrain({ path: '/Users/a/x', source: 'env' }, fail('missing-roles'))).toEqual({
      kind: 'setup',
      tried: '/Users/a/x',
      source: 'env',
      reason: 'missing-roles',
    });
  });

  it('goes to setup with nothing tried when the never-chosen default fails', async () => {
    expect(await decideBrain({ path: '/Users/a/agencybrain', source: 'default' }, fail('not-found'))).toEqual(
      {
        kind: 'setup',
        tried: null,
        source: null,
        reason: null,
      },
    );
  });

  it('never throws: a check that throws counts as not found', async () => {
    const decision = await decideBrain({ path: '/Users/a/b', source: 'settings' }, async () => {
      throw new Error('boom');
    });
    expect(decision).toEqual({ kind: 'setup', tried: '/Users/a/b', source: 'settings', reason: 'not-found' });
  });
});

describe('appStateFor', () => {
  it('says ready, or carries what setup tried', () => {
    expect(appStateFor({ kind: 'ready', path: '/b', source: 'env' })).toEqual({ kind: 'ready' });
    expect(appStateFor({ kind: 'setup', tried: '/x', source: 'env', reason: 'not-found' })).toEqual({
      kind: 'setup',
      tried: '/x',
      source: 'env',
      reason: 'not-found',
    });
  });
});
