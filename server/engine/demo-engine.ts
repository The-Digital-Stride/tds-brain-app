/**
 * A scripted pretend Claude for the help screenshots (plan 2026-11-15-cortex-help-phase-1, decision 12).
 *
 * Never starts Claude, never reads or writes anything. Message shapes follow the session manager's test fake
 * (`session-manager.test.ts`). Replies depend on the first word of the prompt:
 *   `approve ...` an Edit the person must allow or refuse; `ask ...` a question with options; anything else
 *   a short reply after one Read step. The level picker's own call (no session file, no tools) gets a fixed pick.
 */
import { randomUUID } from 'node:crypto';
import type { Options, PermissionResult, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { EngineFns, EngineQuery, HistoryMessage, PastInfo } from './session-manager.ts';

/** The level picker's fixed answer: the same on every Mac, so pictures match. */
export const DEMO_PICK = { tier: 'standard', helpers: false, reason: 'A short, everyday request.' } as const;

/** The chat's fixed "how full" reading (the engine's own call): 30% of the summarise point, the same every run. */
export const DEMO_CONTEXT = {
  totalTokens: 48_000,
  rawMaxTokens: 200_000,
  autoCompactThreshold: 160_000,
  isAutoCompactEnabled: true,
} as const;

export const DEMO_EDIT_FILE = 'clients/acme-heating/notes/2026-11-01-call-follow-up.md';

const PAST: PastInfo[] = [
  {
    sessionId: '6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f',
    summary: 'Acme Heating: tidy the call notes',
    lastModified: Date.parse('2026-11-18T15:10:00Z'),
    firstPrompt: 'Tidy the call notes for Acme Heating and list the follow-ups.',
  },
  {
    sessionId: '7a2d3e4f-5b6c-4d7e-9f80-1b2c3d4e5f60',
    summary: 'Northwind: draft the monthly update',
    lastModified: Date.parse('2026-11-17T10:40:00Z'),
    firstPrompt: 'Draft the monthly update email for Northwind.',
  },
];

const HISTORY: Record<string, string[]> = {
  '6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f': [
    'Tidy the call notes for Acme Heating and list the follow-ups.',
    'Done. I grouped the notes by topic and listed three follow-ups at the end.',
  ],
  '7a2d3e4f-5b6c-4d7e-9f80-1b2c3d4e5f60': [
    'Draft the monthly update email for Northwind.',
    'Here is a short draft. It leads with the good news and ends with one clear next step.',
  ],
};

type Rec = Record<string, unknown>;

function textOf(m: SDKUserMessage): string {
  const c = m.message.content;
  if (typeof c === 'string') return c;
  return c
    .map((b) => (b.type === 'text' && 'text' in b ? String(b.text) : ''))
    .filter(Boolean)
    .join('\n');
}

/** First word of the prompt, lower case, ignoring a leading "/" and the app's wrapper tags. */
function keyword(text: string): string {
  return (
    text
      .replace(/<[^>]+>/g, ' ')
      .trim()
      .split(/\s+/)[0]
      ?.toLowerCase()
      .replace(/[^a-z]/g, '') ?? ''
  );
}

class DemoQuery implements EngineQuery {
  private queue: unknown[] = [];
  private wake: (() => void) | null = null;
  private ended = false;
  private closed = false;
  private inited = false;
  private controller = new AbortController();
  private readonly sid = randomUUID();
  private n = 0;

  private readonly options: Options;

  constructor(options: Options, prompt: AsyncIterable<SDKUserMessage>) {
    this.options = options;
    void this.run(prompt);
  }

  private emit(msg: unknown): void {
    this.queue.push(msg);
    this.wake?.();
  }

  private finish(): void {
    this.ended = true;
    this.wake?.();
  }

  private isPicker(): boolean {
    return (
      this.options.persistSession === false &&
      Array.isArray(this.options.tools) &&
      this.options.tools.length === 0
    );
  }

  private id(): string {
    return `msg_demo_${++this.n}`;
  }

  private text(text: string): void {
    this.emit({
      type: 'assistant',
      message: { id: this.id(), content: [{ type: 'text', text }] },
      parent_tool_use_id: null,
      session_id: this.sid,
    });
  }

  private toolUse(name: string, input: Rec): string {
    const toolUseId = `toolu_demo_${++this.n}`;
    this.emit({
      type: 'assistant',
      message: { id: this.id(), content: [{ type: 'tool_use', id: toolUseId, name, input }] },
      parent_tool_use_id: null,
      session_id: this.sid,
    });
    return toolUseId;
  }

  private toolResult(toolUseId: string, ok: boolean): void {
    this.emit({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: toolUseId, content: 'ok', is_error: !ok }],
      },
      parent_tool_use_id: null,
    });
  }

  private result(result: string): void {
    this.emit({ type: 'result', subtype: 'success', is_error: false, duration_ms: 1200, result, errors: [] });
  }

  private init(): void {
    if (this.inited) return;
    this.inited = true;
    this.emit({
      type: 'system',
      subtype: 'init',
      session_id: this.sid,
      model: 'claude-demo',
      claude_code_version: '2.1.322',
      apiKeySource: 'none',
    });
  }

  /** Asks the person through the same hook the real engine uses; waits for the answer. */
  private async ask(toolName: string, input: Rec, toolUseId: string): Promise<PermissionResult> {
    const canUseTool = this.options.canUseTool;
    if (!canUseTool) return { behavior: 'allow', updatedInput: input };
    this.controller = new AbortController();
    // The real engine has shown the tool step before it asks; give the reader time to take it in first.
    await new Promise<void>((r) => setTimeout(r, 30));
    const answer = await canUseTool(toolName, input, {
      signal: this.controller.signal,
      toolUseID: toolUseId,
      requestId: `req-demo-${++this.n}`,
    } as Parameters<typeof canUseTool>[2]);
    return answer ?? { behavior: 'deny', message: 'No answer.' };
  }

  private async turn(text: string): Promise<void> {
    if (this.isPicker()) {
      this.result(JSON.stringify(DEMO_PICK));
      return;
    }
    this.init();
    const cwd = typeof this.options.cwd === 'string' ? this.options.cwd : '';
    const file = `${cwd.replace(/\/$/, '')}/${DEMO_EDIT_FILE}`;
    const word = keyword(text);
    if (word === 'approve') {
      const input = {
        file_path: file,
        old_string: 'Follow up with the office manager about the boiler quote.',
        new_string: 'Follow up with the office manager about the boiler quote by Friday.',
      };
      const id = this.toolUse('Edit', input);
      const answer = await this.ask('Edit', input, id);
      if (this.closed) return;
      const allowed = answer.behavior === 'allow';
      this.toolResult(id, allowed);
      this.text(
        allowed
          ? 'Done. I added a deadline to the follow-up in the call notes.'
          : 'No problem. I have left the call notes as they were.',
      );
      this.result('ok');
      return;
    }
    if (word === 'ask') {
      const input = {
        questions: [
          {
            question: 'Which client should I start with?',
            header: 'Client',
            multiSelect: false,
            options: [
              { label: 'Acme Heating', description: 'The boiler campaign.' },
              { label: 'Northwind', description: 'The monthly update.' },
            ],
          },
        ],
      };
      const id = this.toolUse('AskUserQuestion', input);
      const answer = await this.ask('AskUserQuestion', input, id);
      if (this.closed) return;
      this.toolResult(id, answer.behavior === 'allow');
      this.text('Thanks, I will start there.');
      this.result('ok');
      return;
    }
    const id = this.toolUse('Read', { file_path: file });
    this.toolResult(id, true);
    this.text(
      [
        'Here is a short summary of the notes:',
        '',
        '- **Boiler quote:** the office manager is waiting for a price.',
        '- **Next call:** booked for the end of the month.',
        '',
        'Would you like me to turn these into to-dos?',
      ].join('\n'),
    );
    this.result('ok');
  }

  private async run(prompt: AsyncIterable<SDKUserMessage>): Promise<void> {
    try {
      for await (const m of prompt) {
        if (this.closed) break;
        await this.turn(textOf(m));
      }
    } catch {
      // a closed chat ends quietly
    }
    this.finish();
  }

  /** Only the summary reading: never any item detail. */
  async getContextUsage(): Promise<typeof DEMO_CONTEXT> {
    return DEMO_CONTEXT;
  }

  async interrupt(): Promise<undefined> {
    this.controller.abort();
    return undefined;
  }

  close(): void {
    this.closed = true;
    this.controller.abort();
    this.finish();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<unknown> {
    while (true) {
      if (this.queue.length > 0) {
        yield this.queue.shift();
        continue;
      }
      if (this.ended) return;
      await new Promise<void>((r) => {
        this.wake = r;
      });
      this.wake = null;
    }
  }
}

export function createDemoEngine(): EngineFns {
  return {
    query: ({ prompt, options }) => new DemoQuery(options, prompt),
    listSessions: async () => PAST.map((p) => ({ ...p })),
    getSessionMessages: async (id): Promise<HistoryMessage[]> => {
      const lines = HISTORY[id] ?? [];
      return lines.map((text, i) => ({
        type: i % 2 === 0 ? 'user' : 'assistant',
        uuid: `${id}-${i}`,
        message: { role: i % 2 === 0 ? 'user' : 'assistant', content: [{ type: 'text', text }] },
        parent_tool_use_id: null,
      }));
    },
  };
}
