import { describe, expect, it } from 'vitest';
import { demoGitEnv, redact } from './help-shots-lib.ts';

describe('redact', () => {
  it('hides a sign-in code in a quoted address', () => {
    const msg = 'page.goto: net::ERR at http://127.0.0.1:3879/auth?code=AbC123_-x&next=1 failed';
    expect(redact(msg)).toBe('page.goto: net::ERR at http://127.0.0.1:3879/auth?code=[hidden]&next=1 failed');
  });

  it('leaves text without a code alone', () => {
    expect(redact('The demo server stopped at start-up.')).toBe('The demo server stopped at start-up.');
  });
});

describe('demoGitEnv', () => {
  const date = new Date('2026-11-01T09:00:00Z');

  it('drops every GIT_* variable from the caller', () => {
    const env = demoGitEnv({ PATH: '/usr/bin', GIT_DIR: '/elsewhere/.git', GIT_INDEX_FILE: '/x' }, date);
    expect(env.GIT_DIR).toBeUndefined();
    expect(env.GIT_INDEX_FILE).toBeUndefined();
    expect(env.PATH).toBe('/usr/bin');
  });

  it('drops secrets and sets fixed dates', () => {
    const env = demoGitEnv({ PATH: '/usr/bin', JEV_PROXY_SECRET: 's3cret' }, date);
    expect(env.JEV_PROXY_SECRET).toBeUndefined();
    expect(env.GIT_AUTHOR_DATE).toBe('2026-11-01T09:00:00.000Z');
    expect(env.GIT_COMMITTER_DATE).toBe('2026-11-01T09:00:00.000Z');
  });
});
