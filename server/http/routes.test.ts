import { describe, expect, it } from 'vitest';
import { HttpError, parseStartRequest } from './routes.ts';

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
