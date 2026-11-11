import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STREAM_PING_EVENT, STREAM_PING_MS } from '../../shared/contract.ts';
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
