import { existsSync, readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createBrainReaders } from '../brain/index.ts';
import { copyFixture } from '../brain/test-helpers.ts';
import { HttpError, handleApi, parseStartRequest, type RouteContext } from './routes.ts';

describe('parseStartRequest', () => {
  it('passes prompt, client, resume and todoId through', () => {
    expect(
      parseStartRequest({ prompt: 'hi', client: 'acme', resume: null, todoId: '20261111-x.md' }),
    ).toEqual({
      prompt: 'hi',
      client: 'acme',
      resume: null,
      todoId: '20261111-x.md',
    });
    expect(parseStartRequest({ prompt: 'hi', todoId: null })).toEqual({ prompt: 'hi', todoId: null });
    expect(parseStartRequest({ prompt: 'hi' })).toEqual({ prompt: 'hi' });
  });

  it('refuses a todoId that is not text or null', () => {
    for (const todoId of [42, true, ['a'], { id: 'a' }]) {
      expect(() => parseStartRequest({ prompt: 'hi', todoId })).toThrow(HttpError);
    }
  });

  it('refuses other fields of the wrong type, and a body that is not an object', () => {
    expect(() => parseStartRequest({ prompt: 7 })).toThrow(HttpError);
    expect(() => parseStartRequest({ client: 7 })).toThrow(HttpError);
    expect(() => parseStartRequest({ resume: 7 })).toThrow(HttpError);
    expect(() => parseStartRequest([])).toThrow(HttpError);
  });
});

describe('POST /api/todos/complete', () => {
  const TODO = '20261105-send-report.md';

  async function tick(directWrites: boolean) {
    const root = copyFixture();
    const whoami = { name: 'Sam Example', slug: 'sam-example', role: 'scout', knownMember: true };
    const brain = createBrainReaders(root, {
      run: async () => ({ stdout: JSON.stringify(whoami) }),
      now: () => new Date('2026-11-11T17:07:38Z'),
    });
    const req = Object.assign(Readable.from([Buffer.from(JSON.stringify({ id: TODO }))]), {
      method: 'POST',
      headers: {},
    });
    const sent = { status: 0, body: '' };
    const res = {
      headersSent: false,
      writeHead: (status: number) => {
        sent.status = status;
      },
      end: (text: string) => {
        sent.body = text;
      },
    };
    const ctx = { brain, store: { get: async () => ({ directWrites }) }, log: () => {} };
    await handleApi(
      req as unknown as IncomingMessage,
      res as unknown as ServerResponse,
      new URL('http://127.0.0.1:3877/api/todos/complete'),
      ctx as unknown as RouteContext,
    );
    return { root, sent };
  }

  it('records the person using the app as the one who ticked it', async () => {
    const { root, sent } = await tick(true);
    expect(sent.status).toBe(200);
    expect(existsSync(join(root, 'todo', TODO))).toBe(false);
    const done = readFileSync(join(root, 'todo', 'done', TODO), 'utf8');
    expect(done).toContain('\ncompleted_at: 2026-11-11T17:07:38+00:00\ncompleted_by: sam-example\n');
    expect(done).toContain('Ticked off by Sam Example at 17:07 UK time (TDS Brain App).');
    expect(JSON.parse(sent.body).mine.map((t: { id: string }) => t.id)).not.toContain(TODO);
  });

  it('changes nothing while changes to the shared brain are switched off', async () => {
    const { root, sent } = await tick(false);
    expect(sent.status).toBe(403);
    expect(existsSync(join(root, 'todo', TODO))).toBe(true);
    expect(existsSync(join(root, 'todo', 'done', TODO))).toBe(false);
  });
});
