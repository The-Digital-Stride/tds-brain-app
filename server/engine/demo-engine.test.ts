import type { Options, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatEvent, Identity } from '../../shared/contract.ts';
import { createDemoEngine, DEMO_CONTEXT, DEMO_PICK } from './demo-engine.ts';
import { parsePick } from './level-picker.ts';
import { createSessionManager, type SessionManager } from './session-manager.ts';

const IDENTITY: Identity = {
  name: 'Sam Taylor',
  slug: 'sam-taylor',
  email: null,
  role: 'owner',
  knownMember: true,
};
const BRAIN = '/tmp/demo-brain-root';

let mgr: SessionManager | null = null;
afterEach(async () => {
  await mgr?.closeAll();
  mgr = null;
});

async function flush(times = 30): Promise<void> {
  for (let i = 0; i < times; i++) await new Promise<void>((r) => setImmediate(r));
  // the demo engine pauses briefly between showing a tool step and asking about it
  await new Promise<void>((r) => setTimeout(r, 80));
  for (let i = 0; i < times; i++) await new Promise<void>((r) => setImmediate(r));
}

function makeManager(): SessionManager {
  return createSessionManager({
    brain: {
      identity: async () => IDENTITY,
      skillAccess: async () => 'unknown-skill',
      clients: async () => [],
      todos: async () => ({
        mine: [],
        open: [],
        othersCount: 0,
        team: [],
        changes: 'no-skill',
        canAddOpen: false,
        canUsePersonal: false,
        canAttach: false,
        canUpload: false,
      }),
    },
    brainRoot: BRAIN,
    claudePath: '/never/run',
    engine: createDemoEngine(),
    env: { PATH: '/bin' },
    permissionMode: () => 'default',
    engineDefaults: () => ({ model: null }),
  });
}

function events(m: SessionManager, id: string): ChatEvent[] {
  const sub = m.subscribe(id, 0, () => {});
  sub.unsubscribe();
  return sub.replay.map((s) => s.event);
}

async function once(m: SessionManager, id: string, type: ChatEvent['type']): Promise<ChatEvent | undefined> {
  await flush();
  return events(m, id).find((e) => e.type === type);
}

describe('createDemoEngine through the session manager', () => {
  it('an ordinary message: a Read step, a Markdown reply, then the turn ends', async () => {
    mgr = makeManager();
    const s = await mgr.start({ prompt: 'summarise the notes' });
    await flush();
    const ev = events(mgr, s.id);
    expect(ev.find((e) => e.type === 'tool-start')).toMatchObject({ tool: 'Read' });
    expect(ev.find((e) => e.type === 'assistant-message')).toMatchObject({
      text: expect.stringContaining('**'),
    });
    expect(ev.find((e) => e.type === 'turn-end')).toMatchObject({ ok: true });
  });

  it('gives a fixed "how full" reading after a reply', async () => {
    mgr = makeManager();
    const s = await mgr.start({ prompt: 'summarise the notes' });
    await flush();
    expect(events(mgr, s.id).find((e) => e.type === 'context')).toMatchObject({
      usedTokens: DEMO_CONTEXT.totalTokens,
      limitTokens: DEMO_CONTEXT.autoCompactThreshold,
      windowTokens: DEMO_CONTEXT.rawMaxTokens,
      percent: 30,
    });
  });

  it('"approve" shows the Edit first, then asks, then finishes once answered', async () => {
    mgr = makeManager();
    const s = await mgr.start({ prompt: 'approve the change' });
    const req = await once(mgr, s.id, 'permission-request');
    expect(req).toMatchObject({ tool: 'Edit', title: 'Claude wants to change a file' });
    const ev = events(mgr, s.id);
    expect(ev.findIndex((e) => e.type === 'tool-start')).toBeLessThan(
      ev.findIndex((e) => e.type === 'permission-request'),
    );
    expect(ev.some((e) => e.type === 'turn-end')).toBe(false);
    expect((await mgr.list()).live[0]?.state).toBe('waiting');
    await mgr.replyPermission(s.id, {
      requestId: (req as { requestId: string }).requestId,
      decision: 'allow',
    });
    await flush();
    const after = events(mgr, s.id);
    expect(after.some((e) => e.type === 'request-resolved')).toBe(true);
    expect(after.find((e) => e.type === 'turn-end')).toMatchObject({ ok: true });
  });

  it('"ask" shows a question the app accepts', async () => {
    mgr = makeManager();
    const s = await mgr.start({ prompt: 'ask me something' });
    const q = await once(mgr, s.id, 'question-request');
    expect(q).toMatchObject({
      questions: [{ header: 'Client', options: [{ label: 'Acme Heating' }, { label: 'Northwind' }] }],
    });
    await mgr.replyQuestion(s.id, {
      requestId: (q as { requestId: string }).requestId,
      answers: { 'Which client should I start with?': 'Northwind' },
    });
    await flush();
    expect(events(mgr, s.id).find((e) => e.type === 'turn-end')).toMatchObject({ ok: true });
  });

  it('closing a chat that is waiting ends it cleanly', async () => {
    mgr = makeManager();
    const s = await mgr.start({ prompt: 'approve it' });
    await once(mgr, s.id, 'permission-request');
    await mgr.close(s.id);
    await flush();
    expect((await mgr.list()).live).toHaveLength(0);
  });

  it('lists earlier chats with readable history', async () => {
    const engine = createDemoEngine();
    const past = await engine.listSessions({ dir: BRAIN });
    expect(past.map((p) => p.summary).join(' ')).toMatch(/Acme Heating/);
    expect(past.map((p) => p.summary).join(' ')).toMatch(/Northwind/);
    const msgs = await engine.getSessionMessages(past[0]?.sessionId ?? '', { dir: BRAIN });
    expect(msgs.length).toBeGreaterThan(1);
  });
});

describe('the level picker call', () => {
  it('gets a fixed pick at once that the real parser accepts', async () => {
    const engine = createDemoEngine();
    const message: SDKUserMessage = {
      type: 'user',
      message: { role: 'user', content: '<request>approve this</request>' },
      parent_tool_use_id: null,
    };
    const q = engine.query({
      prompt: (async function* () {
        yield message;
      })(),
      options: { persistSession: false, tools: [] } as Options,
    });
    let result: unknown = null;
    for await (const m of q) {
      const r = m as { type?: string; result?: string };
      if (r.type === 'result') {
        result = r.result;
        break;
      }
    }
    q.close();
    expect(parsePick(String(result))).toEqual(DEMO_PICK);
  });
});
