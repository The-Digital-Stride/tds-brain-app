/**
 * `GET /api/stream` (A3): one Server-Sent Events connection per tab, carrying app-wide events and,
 * when `session` is given, that chat's numbered events (replayed after `after`, then live).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  type AppEvent,
  type SequencedEvent,
  STREAM_PING_EVENT,
  STREAM_PING_MS,
  type StreamFrame,
} from '../../shared/contract.ts';
import type { SessionManager, Subscription } from '../engine/session-manager.ts';

export interface AppEventHub {
  publish(event: AppEvent): void;
  subscribe(listener: (event: AppEvent) => void): () => void;
}

export function createAppEventHub(): AppEventHub {
  const listeners = new Set<(event: AppEvent) => void>();
  return {
    publish(event) {
      for (const l of listeners) {
        try {
          l(event);
        } catch {
          // a dead stream must not stop the others
        }
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function parseSeq(raw: string | string[] | null | undefined): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v) return 0;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

export interface StreamContext {
  sessions: SessionManager;
  hub: AppEventHub;
  serverStartedAt: string;
}

/**
 * Opens the stream. Throws a SessionError (before any byte is written) when `session` names a chat
 * that does not exist or has closed, so the caller can answer with a normal ApiError.
 */
export function openStream(req: IncomingMessage, res: ServerResponse, url: URL, ctx: StreamContext): void {
  const sessionId = url.searchParams.get('session');
  // A reconnecting EventSource sends the last id it saw; it wins over the original `after`.
  const after = Math.max(parseSeq(url.searchParams.get('after')), parseSeq(req.headers['last-event-id']));

  let open = true;
  const write = (chunk: string) => {
    if (open && !res.writableEnded) res.write(chunk);
  };
  const writeFrame = (frame: StreamFrame, id?: number) => {
    write(`${id !== undefined ? `id: ${id}\n` : ''}data: ${JSON.stringify(frame)}\n\n`);
  };

  let chat: Subscription | null = null;
  if (sessionId) {
    // Subscribing first and replaying in the same tick means no event can fall in between.
    chat = ctx.sessions.subscribe(sessionId, after, (item: SequencedEvent) =>
      writeFrame({ kind: 'chat', sessionId, item }, item.seq),
    );
  }

  let offApp: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  const cleanup = () => {
    if (!open) return;
    open = false;
    if (heartbeat) clearInterval(heartbeat);
    offApp?.();
    chat?.unsubscribe();
  };

  try {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    write('retry: 3000\n\n');
    writeFrame({ kind: 'app', event: { type: 'hello', serverStartedAt: ctx.serverStartedAt } });
    if (chat && sessionId) {
      for (const item of chat.replay) writeFrame({ kind: 'chat', sessionId, item }, item.seq);
    }
    offApp = ctx.hub.subscribe((event) => writeFrame({ kind: 'app', event }));
    // A named event, not an SSE comment: the page can see it and spot a stream that has gone silent.
    heartbeat = setInterval(() => write(`event: ${STREAM_PING_EVENT}\ndata: {}\n\n`), STREAM_PING_MS);
  } catch (err) {
    // Never leave a subscription attached to a stream that could not open.
    cleanup();
    throw err;
  }

  req.on('close', cleanup);
  res.on('close', cleanup);
  res.on('error', cleanup);
}
