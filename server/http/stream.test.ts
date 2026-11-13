import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type SequencedEvent, STREAM_PING_EVENT, STREAM_PING_MS } from '../../shared/contract.ts';
import type { SessionManager } from '../engine/session-manager.ts';
import { createAppEventHub, openStream } from './stream.ts';

function fakeRes() {
  const res = new EventEmitter() as EventEmitter & {
    chunks: string[];
    writableEnded: boolean;
    writeHead: (status: number, headers: Record<string, string>) => void;
    write: (chunk: string) => boolean;
  };
  res.chunks = [];
  res.writableEnded = false;
  res.writeHead = () => {};
  res.write = (chunk: string) => {
    res.chunks.push(chunk);
    return true;
  };
  return res;
}

function open(sessions: Partial<SessionManager> = {}) {
  const req = new EventEmitter() as EventEmitter & { headers: Record<string, string> };
  req.headers = {};
  const res = fakeRes();
  const hub = createAppEventHub();
  openStream(
    req as unknown as IncomingMessage,
    res as unknown as ServerResponse,
    new URL('http://127.0.0.1:3877/api/stream'),
    { sessions: sessions as SessionManager, hub, serverStartedAt: 'now' },
  );
  return { req, res, hub };
}

const PING = `event: ${STREAM_PING_EVENT}\ndata: {}\n\n`;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('stream heartbeat', () => {
  it('sends a named ping event the page can see, at the contract interval', () => {
    const { res } = open();
    const pings = () => res.chunks.filter((c) => c === PING).length;
    expect(pings()).toBe(0);
    vi.advanceTimersByTime(STREAM_PING_MS - 1);
    expect(pings()).toBe(0);
    vi.advanceTimersByTime(1);
    expect(pings()).toBe(1);
    vi.advanceTimersByTime(STREAM_PING_MS * 2);
    expect(pings()).toBe(3);
    expect(res.chunks.some((c) => c.startsWith(':'))).toBe(false);
  });

  it('stops pinging and stops app events once the stream closes', () => {
    const { res, hub } = open();
    res.emit('close');
    const before = res.chunks.length;
    vi.advanceTimersByTime(STREAM_PING_MS * 3);
    hub.publish({ type: 'sessions-changed' });
    expect(res.chunks.length).toBe(before);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('lets go of the chat subscription if the stream fails while opening', () => {
    const unsubscribe = vi.fn();
    const req = new EventEmitter() as EventEmitter & { headers: Record<string, string> };
    req.headers = {};
    const res = fakeRes();
    res.writeHead = () => {
      throw new Error('socket gone');
    };
    const sessions = { subscribe: vi.fn(() => ({ replay: [], unsubscribe })) };
    expect(() =>
      openStream(
        req as unknown as IncomingMessage,
        res as unknown as ServerResponse,
        new URL('http://127.0.0.1:3877/api/stream?session=s1'),
        { sessions: sessions as unknown as SessionManager, hub: createAppEventHub(), serverStartedAt: 'now' },
      ),
    ).toThrow();
    expect(unsubscribe).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('chat files events (opt-in)', () => {
  const item = (seq: number, event: SequencedEvent['event']): SequencedEvent => ({ seq, at: 'now', event });
  const filesEvent: SequencedEvent['event'] = { type: 'files', files: [], attachments: [], links: [] };

  function openChat(query: string) {
    let push: (item: SequencedEvent) => void = () => {};
    const sessions = {
      subscribe: vi.fn((_id: string, _after: number, listener: (item: SequencedEvent) => void) => {
        push = listener;
        return {
          replay: [
            item(1, { type: 'state', state: 'idle' }),
            item(2, filesEvent),
            item(3, { type: 'state', state: 'working' }),
          ],
          unsubscribe: () => {},
        };
      }),
    };
    const req = new EventEmitter() as EventEmitter & { headers: Record<string, string> };
    req.headers = {};
    const res = fakeRes();
    openStream(
      req as unknown as IncomingMessage,
      res as unknown as ServerResponse,
      new URL(`http://127.0.0.1:3877/api/stream?session=s1${query}`),
      { sessions: sessions as unknown as SessionManager, hub: createAppEventHub(), serverStartedAt: 'now' },
    );
    const chatFrames = () =>
      res.chunks
        .filter((c) => c.includes('"kind":"chat"'))
        .map((c) => JSON.parse(c.slice(c.indexOf('data: ') + 6)) as { item: SequencedEvent });
    return { push: (i: SequencedEvent) => push(i), chatFrames, res };
  }

  it('leaves files events out of replay and live without files=1, keeping each other frame’s id', () => {
    const { push, chatFrames, res } = openChat('&after=0');
    push(item(4, filesEvent));
    push(item(5, { type: 'state', state: 'idle' }));
    expect(chatFrames().map((f) => f.item.seq)).toEqual([1, 3, 5]);
    expect(res.chunks.some((c) => c.startsWith('id: 3\n'))).toBe(true);
    expect(res.chunks.some((c) => c.includes('"type":"files"'))).toBe(false);
  });

  it('sends them, replay and live, with files=1', () => {
    const { push, chatFrames } = openChat('&after=0&files=1');
    push(item(4, filesEvent));
    expect(chatFrames().map((f) => f.item.seq)).toEqual([1, 2, 3, 4]);
    expect(chatFrames()[1]?.item.event.type).toBe('files');
  });
});
