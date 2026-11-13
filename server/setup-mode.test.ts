import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { type Identity, type LibraryFile, TodoChangeError } from '../shared/contract.ts';
import { SessionError } from './engine/session-manager.ts';
import {
  createEngineHealth,
  createSetupBrain,
  createSetupSessions,
  createSetupThumbs,
  createSetupUploads,
} from './setup-mode.ts';
import { UploadError } from './uploads/staging.ts';

const someone: Identity = { name: 'Sam', slug: 'sam', email: null, role: 'scout', knownMember: true };

describe('createSetupBrain', () => {
  it('reads nothing: every list is empty and nothing is found', async () => {
    const brain = createSetupBrain();
    expect(await brain.skills(someone)).toEqual([]);
    expect(await brain.clients()).toEqual([]);
    expect(await brain.usedOften(someone)).toEqual([]);
    expect(await brain.libraryScopes()).toEqual([]);
    expect(await brain.library('personal')).toBeNull();
    expect(await brain.libraryFile('personal.abc')).toBeNull();
    expect(await brain.todos(someone)).toEqual({
      mine: [],
      open: [],
      othersCount: 0,
      team: [],
      changes: 'no-skill',
      canAddOpen: false,
      canUsePersonal: false,
    });
    expect(await brain.profile(someone)).toEqual({ title: null, departments: [], owns: null });
    expect(await brain.skillAccess(someone, 'anything')).toBe('unknown-skill');
    expect(await brain.sync()).toEqual({ lastSync: null });
  });

  it('is an unknown person and an unhealthy brain with a plain reason', async () => {
    const brain = createSetupBrain();
    expect(await brain.identity()).toMatchObject({ role: 'unknown', knownMember: false });
    const health = await brain.health();
    expect(health.ok).toBe(false);
    expect(health.problems).toHaveLength(1);
    expect(health.problems[0]).toMatch(/brain folder/);
  });

  it('refuses the one write, and every to-do change', async () => {
    await expect(createSetupBrain().completeTodo('20261111-x.md', someone)).rejects.toThrow();
    await expect(
      createSetupBrain().changeTodo({ kind: 'delete', id: '20261111-x.md' }, someone),
    ).rejects.toThrow(TodoChangeError);
  });

  it('watches nothing, and the stop function is harmless', () => {
    const onChange = vi.fn();
    const stop = createSetupBrain().watch(onChange);
    expect(typeof stop).toBe('function');
    stop();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('createSetupSessions', () => {
  it('lists no chats', async () => {
    expect(await createSetupSessions().list()).toEqual({ live: [], past: [] });
  });

  it('refuses to start a chat with brain-missing', async () => {
    const err = await createSetupSessions()
      .start({ prompt: 'hi' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SessionError);
    expect((err as SessionError).code).toBe('brain-missing');
  });

  it('knows no chat by id', async () => {
    const s = createSetupSessions();
    const calls = [
      () => s.send('x', 'hi'),
      () => s.replyPermission('x', { requestId: 'r', allow: true } as never),
      () => s.replyQuestion('x', {} as never),
      () => s.interrupt('x'),
      () => s.close('x'),
    ];
    for (const call of calls) {
      const err = await call().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SessionError);
      expect((err as SessionError).code).toBe('not-found');
    }
    expect(() => s.subscribe('x', 0, () => {})).toThrow(SessionError);
  });

  it('closes everything at once with nothing to close, and changes never fire', async () => {
    const s = createSetupSessions();
    await expect(s.closeAll()).resolves.toBeUndefined();
    const stop = s.onChange(() => {
      throw new Error('should not be called');
    });
    stop();
  });
});

describe('stand-in thumbs and uploads', () => {
  it('makes no pictures', async () => {
    expect(await createSetupThumbs().get({} as LibraryFile, 320)).toBeNull();
  });

  it('takes no uploads and has no folder', async () => {
    const u = createSetupUploads();
    expect(u.root).toBeNull();
    await expect(u.save(Readable.from([]), 'a.png', 1)).rejects.toBeInstanceOf(UploadError);
    expect(() => u.peek(['x'])).toThrow(UploadError);
    expect(() => u.claim(['x'])).toThrow(UploadError);
    expect(u.peek([])).toEqual([]);
    await expect(u.discard('x')).resolves.toBeUndefined();
    await expect(u.sweep()).resolves.toBeUndefined();
    u.start();
    u.close();
  });
});

describe('createEngineHealth', () => {
  it('reads the permission mode from the brain afresh each time when ready', () => {
    const resolveMode = vi.fn(() => 'acceptEdits' as const);
    const health = createEngineHealth('/Users/a/brain', '/bin/claude', '/Users/a', resolveMode);
    expect(health()).toEqual({
      ok: true,
      permissionMode: 'acceptEdits',
      claudePath: '/bin/claude',
      problem: null,
    });
    health();
    expect(resolveMode).toHaveBeenCalledTimes(2);
    expect(resolveMode).toHaveBeenCalledWith('/Users/a/brain', '/Users/a');
  });

  it('in setup mode says default without reading any folder', () => {
    const resolveMode = vi.fn(() => 'acceptEdits' as const);
    const health = createEngineHealth(null, '/bin/claude', '/Users/a', resolveMode);
    expect(health().permissionMode).toBe('default');
    expect(resolveMode).not.toHaveBeenCalled();
  });

  it('says plainly when Claude Code is missing', () => {
    const health = createEngineHealth(null, null, '/Users/a', () => 'default');
    expect(health()).toMatchObject({ ok: false, claudePath: null });
    expect(health().problem).toMatch(/Claude Code/);
  });
});
